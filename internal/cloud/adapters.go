package cloud

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type ObjectStore interface {
	Put(context.Context, string, []byte) (string, error)
	Get(context.Context, string, string) ([]byte, error)
	Delete(context.Context, string, string) error
	Boundary() string
}

type DirectUploadStore interface {
	Presign(context.Context, DirectUploadRequest) (DirectUploadPlan, error)
	VerifyDirect(context.Context, string, string, int64) (DirectUploadVerification, error)
}

type LocalObjectStore struct{ Root string }

func (s LocalObjectStore) Put(_ context.Context, hash string, body []byte) (string, error) {
	return writeBlob(s.Root, hash, body)
}
func (s LocalObjectStore) Get(_ context.Context, ref, hash string) ([]byte, error) {
	return readBlob(ref, hash)
}
func (s LocalObjectStore) Delete(_ context.Context, ref, hash string) error {
	want := filepath.Join(s.Root, hash[:2], hash)
	clean, err := filepath.Abs(ref)
	if err != nil {
		return err
	}
	expected, err := filepath.Abs(want)
	if err != nil || clean != expected {
		return errors.New("object delete reference is outside content-addressed root")
	}
	if _, err := readBlob(clean, hash); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	return os.Remove(clean)
}
func (s LocalObjectStore) Boundary() string { return "bounded-local-filesystem-not-production-durable" }

type RemoteObjectStore struct {
	BaseURL, Token, DirectUploadOrigin string
	Client                             *http.Client
}

func (s RemoteObjectStore) client() *http.Client {
	if s.Client != nil {
		return s.Client
	}
	return &http.Client{Timeout: 20 * time.Second}
}
func (s RemoteObjectStore) Put(ctx context.Context, hash string, body []byte) (string, error) {
	if err := validRemote(s.BaseURL, s.Token); err != nil {
		return "", err
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPut, strings.TrimRight(s.BaseURL, "/")+"/objects/"+hash, bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+s.Token)
	req.Header.Set("Content-Type", "application/octet-stream")
	resp, err := s.client().Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("object store put returned %d", resp.StatusCode)
	}
	var out struct {
		Ref  string `json:"ref"`
		Hash string `json:"hash"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 32<<10)).Decode(&out); err != nil {
		return "", err
	}
	if out.Ref == "" || out.Hash != hash {
		return "", errors.New("object store response integrity mismatch")
	}
	return out.Ref, nil
}
func (s RemoteObjectStore) Get(ctx context.Context, ref, hash string) ([]byte, error) {
	if err := validRemote(s.BaseURL, s.Token); err != nil {
		return nil, err
	}
	u := strings.TrimRight(s.BaseURL, "/") + "/objects/" + url.PathEscape(ref)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	req.Header.Set("Authorization", "Bearer "+s.Token)
	resp, err := s.client().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("object store get returned %d", resp.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, MaxUploadBytes+1))
	if err != nil || len(b) > MaxUploadBytes {
		return nil, errors.New("object store response exceeds bound")
	}
	if hashBytes(b) != hash {
		return nil, errors.New("object store response integrity mismatch")
	}
	return b, nil
}
func (s RemoteObjectStore) Delete(ctx context.Context, ref, hash string) error {
	if err := validRemote(s.BaseURL, s.Token); err != nil {
		return err
	}
	u := strings.TrimRight(s.BaseURL, "/") + "/objects/" + url.PathEscape(ref)
	req, _ := http.NewRequestWithContext(ctx, http.MethodDelete, u, nil)
	req.Header.Set("Authorization", "Bearer "+s.Token)
	req.Header.Set("X-Content-SHA256", hash)
	resp, err := s.client().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusNotFound {
		return fmt.Errorf("object store delete returned %d", resp.StatusCode)
	}
	return nil
}

func (s RemoteObjectStore) Presign(ctx context.Context, in DirectUploadRequest) (DirectUploadPlan, error) {
	if err := validRemote(s.BaseURL, s.Token); err != nil {
		return DirectUploadPlan{}, err
	}
	payload, _ := json.Marshal(in)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(s.BaseURL, "/")+"/uploads/presign", bytes.NewReader(payload))
	req.Header.Set("Authorization", "Bearer "+s.Token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client().Do(req)
	if err != nil {
		return DirectUploadPlan{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		return DirectUploadPlan{}, fmt.Errorf("object store presign returned %d", resp.StatusCode)
	}
	var out DirectUploadPlan
	d := json.NewDecoder(io.LimitReader(resp.Body, 32<<10))
	d.DisallowUnknownFields()
	if err := d.Decode(&out); err != nil {
		return DirectUploadPlan{}, err
	}
	u, err := url.Parse(out.URL)
	now := time.Now()
	allowed, originErr := validatedUploadOrigin(s.DirectUploadOrigin)
	if err != nil || originErr != nil || out.Method != "PUT" || out.Ref == "" || !out.ExpiresAt.After(now) || out.ExpiresAt.After(now.Add(20*time.Minute)) || !safeUploadURL(u) || u.Scheme+"://"+u.Host != allowed {
		return DirectUploadPlan{}, errors.New("object store presign response is invalid")
	}
	for k := range out.Headers {
		lower := strings.ToLower(k)
		if lower == "authorization" || lower == "cookie" || strings.HasPrefix(lower, "x-ynx-") {
			return DirectUploadPlan{}, errors.New("presigned upload headers contain forbidden credential")
		}
	}
	return out, nil
}

func (s RemoteObjectStore) VerifyDirect(ctx context.Context, ref, hash string, size int64) (DirectUploadVerification, error) {
	if err := validRemote(s.BaseURL, s.Token); err != nil {
		return DirectUploadVerification{}, err
	}
	payload, _ := json.Marshal(map[string]any{"ref": ref, "hash": hash, "size": size})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(s.BaseURL, "/")+"/uploads/verify", bytes.NewReader(payload))
	req.Header.Set("Authorization", "Bearer "+s.Token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client().Do(req)
	if err != nil {
		return DirectUploadVerification{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return DirectUploadVerification{}, fmt.Errorf("object store direct verification returned %d", resp.StatusCode)
	}
	var out DirectUploadVerification
	d := json.NewDecoder(io.LimitReader(resp.Body, 16<<10))
	d.DisallowUnknownFields()
	if err := d.Decode(&out); err != nil {
		return DirectUploadVerification{}, err
	}
	if !out.Verified || out.Hash != hash || out.Size != size || out.ScanStatus != "accepted" {
		return DirectUploadVerification{}, errors.New("direct upload verification binding mismatch")
	}
	return out, nil
}

func safeUploadURL(u *url.URL) bool {
	if u.Scheme == "https" && u.Host != "" {
		return true
	}
	host := u.Hostname()
	return u.Scheme == "http" && (host == "127.0.0.1" || host == "localhost" || host == "::1")
}
func validatedUploadOrigin(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || !safeUploadURL(u) || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
		return "", errors.New("direct upload origin is not configured or invalid")
	}
	return u.Scheme + "://" + u.Host, nil
}
func (s RemoteObjectStore) Boundary() string {
	return "remote-contract-requires-operator-durability-evidence"
}

type RemoteWalletVerifier struct {
	BaseURL, Token string
	Client         *http.Client
}

func (v RemoteWalletVerifier) Verify(ctx context.Context, envelope WalletSessionEnvelope) (CentralSessionClaims, error) {
	if err := validRemote(v.BaseURL, v.Token); err != nil {
		return CentralSessionClaims{}, err
	}
	b, _ := json.Marshal(envelope)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(v.BaseURL, "/")+"/v1/wallet-auth/sessions/verify", bytes.NewReader(b))
	req.Header.Set("Authorization", "Bearer "+v.Token)
	req.Header.Set("Content-Type", "application/json")
	client := v.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return CentralSessionClaims{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return CentralSessionClaims{}, fmt.Errorf("canonical Wallet verifier rejected session with %d", resp.StatusCode)
	}
	var out CentralSessionClaims
	decoder := json.NewDecoder(io.LimitReader(resp.Body, 32<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&out); err != nil {
		return CentralSessionClaims{}, err
	}
	approval := envelope.WalletApproval
	if out.VerifierVersion != "wallet-auth-v1" || out.SessionBinding == "" || out.RequestDigest != approval.RequestDigest || out.Account != approval.Account || out.ProductClientID != approval.ProductClientID || out.BundleID != approval.BundleID || out.ProductDeviceAlgorithm != approval.ProductDeviceAlgorithm || strings.Join(out.Scopes, "\n") != strings.Join(approval.GrantedScopes, "\n") || out.ExpiresAt != approval.ExpiresAt {
		return CentralSessionClaims{}, errors.New("canonical Wallet verifier response binding mismatch")
	}
	return out, nil
}

type RemoteAIProvider struct {
	BaseURL, Token, Model string
	Client                *http.Client
}

func (p RemoteAIProvider) Status(context.Context) (string, string, bool) {
	return "YNX AI Gateway", p.Model, strings.HasPrefix(p.BaseURL, "https://") && p.Token != "" && p.Model != ""
}
func (p RemoteAIProvider) Complete(ctx context.Context, instruction string, contexts []AIContext) (string, error) {
	if err := validRemote(p.BaseURL, p.Token); err != nil {
		return "", err
	}
	payload, _ := json.Marshal(map[string]any{"instruction": instruction, "selectedContexts": contexts, "model": p.Model})
	if len(payload) > 7500 {
		return "", errors.New("selected AI context exceeds gateway request bound")
	}
	u := strings.TrimRight(p.BaseURL, "/") + "/ai/stream"
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(payload))
	req.Header.Set("X-YNX-AI-Key", p.Token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-YNX-Product", "cloud-docs")
	client := p.Client
	if client == nil {
		client = &http.Client{Timeout: 45 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("AI Gateway returned %d", resp.StatusCode)
	}
	var answer strings.Builder
	scan := bufio.NewScanner(io.LimitReader(resp.Body, 1<<20))
	for scan.Scan() {
		line := scan.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		var token struct {
			Text string `json:"text"`
		}
		if json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &token) == nil {
			answer.WriteString(token.Text)
		}
	}
	if err := scan.Err(); err != nil {
		return "", err
	}
	if answer.Len() == 0 {
		return "", errors.New("AI Gateway returned no provider-backed content")
	}
	return answer.String(), nil
}

type TrustEvent struct {
	Actor, Action, ObjectID, Hash string         `json:"actor,omitempty"`
	At                            time.Time      `json:"at"`
	Details                       map[string]any `json:"details,omitempty"`
}
type TrustSink interface {
	Record(context.Context, TrustEvent) error
	Boundary() string
}
type LocalAuditTrustSink struct{}

func (LocalAuditTrustSink) Record(context.Context, TrustEvent) error { return nil }
func (LocalAuditTrustSink) Boundary() string                         { return "local-audit-only-no-public-trust-evidence" }

type RemoteTrustSink struct {
	BaseURL, Token string
	Client         *http.Client
}

func (t RemoteTrustSink) Record(ctx context.Context, e TrustEvent) error {
	if err := validRemote(t.BaseURL, t.Token); err != nil {
		return err
	}
	b, _ := json.Marshal(e)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(t.BaseURL, "/")+"/v1/cloud/evidence", bytes.NewReader(b))
	req.Header.Set("Authorization", "Bearer "+t.Token)
	req.Header.Set("Content-Type", "application/json")
	c := t.Client
	if c == nil {
		c = &http.Client{Timeout: 10 * time.Second}
	}
	resp, err := c.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("Trust service returned %d", resp.StatusCode)
	}
	return nil
}
func (t RemoteTrustSink) Boundary() string { return "remote-trust-evidence-contract" }

func validRemote(base, token string) error {
	u, err := url.Parse(base)
	loopback := u != nil && (u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost")
	if err != nil || (u.Scheme != "https" && !(u.Scheme == "http" && loopback)) || u.Host == "" || u.User != nil {
		return errors.New("remote integration requires HTTPS or loopback HTTP URL")
	}
	if strings.TrimSpace(token) == "" {
		return errors.New("remote integration token is required")
	}
	return nil
}
