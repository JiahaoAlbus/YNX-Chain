package mail

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
	"strings"
	"time"
)

type RemoteWalletVerifier struct {
	BaseURL string
	Client  *http.Client
}

func (v RemoteWalletVerifier) Verify(ctx context.Context, proof WalletProof) error {
	if strings.TrimSpace(v.BaseURL) == "" {
		return errors.New("YNX Wallet verification endpoint is not configured")
	}
	if proof.Central == nil {
		return errors.New("central Wallet Auth v1 proof is required")
	}
	body, _ := json.Marshal(proof.Central)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(v.BaseURL, "/")+"/v1/wallet-auth/verify-session", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	client := v.Client
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("wallet verification rejected with status %d", resp.StatusCode)
	}
	var session VerifiedWalletSession
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&session); err != nil {
		return fmt.Errorf("decode central wallet session: %w", err)
	}
	if session.VerifierVersion != "wallet-auth-v1" || session.ProductClientID != ProductClientID || session.BundleID != BundleID || session.Account != proof.Account || !exactScopes(session.Scopes, proof.Scopes) {
		return errors.New("central wallet session binding mismatch")
	}
	expires, err := time.Parse(time.RFC3339Nano, session.ExpiresAt)
	if err != nil || !expires.After(time.Now().UTC()) {
		return errors.New("central wallet session expired")
	}
	return nil
}

func exactScopes(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

type RemoteAI struct {
	BaseURL string
	Token   string
	Client  *http.Client
}

func (a RemoteAI) Status(ctx context.Context) (string, string, string, error) {
	if a.BaseURL == "" {
		return "", "", "", errors.New("YNX AI Gateway endpoint is not configured")
	}
	var out struct {
		ProviderConfigured bool   `json:"providerConfigured"`
		Model              string `json:"model"`
	}
	if err := a.get(ctx, "/health", &out); err != nil {
		return "", "", "", err
	}
	if !out.ProviderConfigured || out.Model == "" {
		return "", "", "", errors.New("AI provider reports no active model")
	}
	return "ynx-ai-gateway", out.Model, "authoritative estimate unavailable", nil
}
func (a RemoteAI) Generate(ctx context.Context, kind string, messages []Message) (string, error) {
	selected := make([]map[string]string, 0, len(messages))
	for _, m := range messages {
		selected = append(selected, map[string]string{"id": m.ID, "subject": m.Subject, "body": m.Body, "sender": m.SenderHandle})
	}
	prompt, _ := json.Marshal(map[string]any{"product": ProductID, "workflow": kind, "selected_messages": selected})
	u := strings.TrimRight(a.BaseURL, "/") + "/ai/stream?session=mail-approved-context&q=" + url.QueryEscape(string(prompt))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("X-YNX-AI-Key", a.Token)
	client := a.Client
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("AI Gateway returned status %d", resp.StatusCode)
	}
	var result strings.Builder
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
			result.WriteString(token.Text)
		}
	}
	if err := scan.Err(); err != nil {
		return "", err
	}
	if strings.TrimSpace(result.String()) == "" {
		return "", errors.New("AI Gateway returned an empty result")
	}
	return result.String(), nil
}
func (a RemoteAI) get(ctx context.Context, path string, out any) error {
	req, e := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(a.BaseURL, "/")+path, nil)
	if e != nil {
		return e
	}
	if a.Token != "" {
		req.Header.Set("X-YNX-AI-Key", a.Token)
	}
	client := a.Client
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	resp, e := client.Do(req)
	if e != nil {
		return e
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("AI Gateway returned status %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}
func (a RemoteAI) do(ctx context.Context, path string, in, out any) error {
	body, _ := json.Marshal(in)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(a.BaseURL, "/")+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if a.Token != "" {
		req.Header.Set("Authorization", "Bearer "+a.Token)
	}
	client := a.Client
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("AI Gateway returned status %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}
