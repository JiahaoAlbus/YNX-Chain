package productsessionv2

import (
	"bufio"
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRevalidationRealNodeAfterAwait(t *testing.T) {
	source := os.Getenv("YNX_QA_CENTRAL_SOURCE")
	if source == "" {
		t.Skip("actual Node interoperability requires explicit reviewed YNX_QA_CENTRAL_SOURCE; source admission runs with it set")
	}
	public, key, _ := ed25519.GenerateKey(rand.Reader)
	der, _ := x509.MarshalPKIXPublicKey(public)
	publicPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	directory := t.TempDir()
	if err := os.Chmod(directory, 0700); err != nil {
		t.Fatal(err)
	}
	cmd := exec.CommandContext(ctx, "node", "testdata/revalidation-node.mjs")
	cmd.Env = append(os.Environ(), "YNX_QA_PUBLIC_KEY="+string(publicPEM), "YNX_QA_STATE_PATH="+filepath.Join(directory, "authority"))
	var diagnostic bytes.Buffer
	cmd.Stderr = &diagnostic
	pipe, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }()
	var ready struct {
		URL     string  `json:"url"`
		Session Session `json:"session"`
		Initial string  `json:"initial"`
		Revoke  string  `json:"revoke"`
	}
	scanner := bufio.NewScanner(pipe)
	if !scanner.Scan() {
		_ = cmd.Wait()
		t.Fatal("Node QA authority did not initialize", diagnostic.String())
	}
	if json.Unmarshal(scanner.Bytes(), &ready) != nil {
		t.Fatal("invalid QA startup shape")
	}
	transport := roundTrip(func(r *http.Request) (*http.Response, error) {
		copy := r.Clone(r.Context())
		u := *r.URL
		copy.URL = &u
		local, _ := http.NewRequest("POST", ready.URL, nil)
		copy.URL.Scheme = local.URL.Scheme
		copy.URL.Host = local.URL.Host
		return http.DefaultTransport.RoundTrip(copy)
	})
	p := Policy{ProductID: ready.Session.ProductID, ClientID: ready.Session.ClientID, ApplicationID: ready.Session.ApplicationID, Platform: ready.Session.Platform, Origin: ready.Session.Origin, Callback: ready.Session.Callback, AllowedScopes: ready.Session.Scopes}
	client, err := NewClient("https://wallet-auth.ynxweb4.com", p, transport)
	if err != nil {
		t.Fatal(err)
	}
	reader, err := NewRevalidator(client, "qa", key)
	if err != nil {
		t.Fatal(err)
	}
	incoming, _ := http.NewRequest("POST", "https://social.ynxweb4.com/social/v3/matrix/audience/resolve", nil)
	incoming.Header.Set(ProofHeader, ready.Initial)
	incoming.Header.Set("Origin", p.Origin)
	original, err := client.Authorize(ctx, incoming, []string{"social.feed"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = client.Authorize(ctx, incoming, []string{"social.feed"}); err == nil {
		t.Fatal("consumed device proof replay accepted")
	}
	for i := 0; i < 2; i++ {
		current, e := reader.Revalidate(ctx, original, []string{"social.feed"})
		if e != nil || current.SessionBinding != original.SessionBinding || current.ExpiresAt != original.ExpiresAt {
			t.Fatal("fresh backend read changed or refused original authorization", e)
		}
	}
	altered := original
	altered.State = strings.Repeat("A", 43)
	if _, err = reader.Revalidate(ctx, altered, []string{"social.feed"}); err == nil {
		t.Fatal("altered original session accepted")
	}
	revoke, _ := http.NewRequestWithContext(ctx, "POST", ready.URL+"/v2/product-sessions/revoke", strings.NewReader("{}"))
	revoke.Header.Set("Content-Type", "application/json")
	revoke.Header.Set("X-Request-Id", "req_revalidation_qa_revoke")
	revoke.Header.Set("Origin", p.Origin)
	revoke.Header.Set(ProofHeader, ready.Revoke)
	response, err := http.DefaultClient.Do(revoke)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, response.Body)
	response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatal("original HTTP revoke failed")
	}
	_, err = reader.Revalidate(ctx, original, []string{"social.feed"})
	var failure *Error
	if !errors.As(err, &failure) || failure.Code != "SESSION_REVOKED" || failure.Status != 401 {
		t.Fatal("revoked original session remained active or became transient error", err)
	}
}

func TestRevalidationResponseFailClosed(t *testing.T) {
	v := fixture(t)
	original := v.Session
	original.ServiceConsent = nil
	original.ProductID = "social"
	original.ClientID = "ynx-social-v1"
	original.ApplicationID = "com.ynxweb4.social.web"
	original.Origin = "https://social.ynxweb4.com"
	original.Callback = original.Origin + "/wallet-auth/callback"
	original.Scopes = []string{"social.feed"}
	issued, _ := protocolTime(original.IssuedAt)
	now := issued.Add(time.Second)
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	for _, tc := range []struct {
		name, body, code string
		status, expected int
		cache            string
	}{
		{"temporary-clock", `{"error":{"code":"CLOCK_UNAVAILABLE"},"ok":false}`, "AUTHORITY_UNAVAILABLE", 400, 503, "no-store"},
		{"backend-config", `{"error":{"code":"SSO_BACKEND_AUTH_INVALID"},"ok":false}`, "AUTHORITY_UNAVAILABLE", 400, 503, "no-store"},
		{"revoked", `{"error":{"code":"SESSION_REVOKED"},"ok":false}`, "SESSION_REVOKED", 400, 401, "no-store"},
		{"unknown-fields", `{"active":true,"session":{},"extra":true}`, "INVALID_AUTHORITY_RESPONSE", 200, 503, "no-store"},
		{"missing-cache", `{"active":true,"session":{}}`, "INVALID_AUTHORITY_RESPONSE", 200, 503, ""},
		{"trailing-json", `{"active":true,"session":{}}{}`, "INVALID_AUTHORITY_RESPONSE", 200, 503, "no-store"},
		{"drift", `{"active":true,"session":{}}`, "SESSION_BINDING_MISMATCH", 200, 403, "no-store"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, e := NewClient("https://wallet-auth.ynxweb4.com", Policy{ProductID: original.ProductID, ClientID: original.ClientID, ApplicationID: original.ApplicationID, Platform: "web", Origin: original.Origin, Callback: original.Callback, AllowedScopes: original.Scopes}, roundTrip(func(req *http.Request) (*http.Response, error) {
				if req.Header.Get("Origin") != "" || req.Header.Get("Cookie") != "" || req.URL.Path != revalidationPath || req.Header.Get("X-YNX-Backend-Proof") == "" {
					t.Fatal("backend request leaked browser credentials or lacks fixed proof")
				}
				return &http.Response{StatusCode: tc.status, Header: http.Header{"Content-Type": []string{"application/json"}, "Cache-Control": []string{tc.cache}}, Body: io.NopCloser(strings.NewReader(tc.body))}, nil
			}))
			if e != nil {
				t.Fatal(e)
			}
			c.clock = func() time.Time { return now }
			r, e := NewRevalidator(c, "qa", key)
			if e != nil {
				t.Fatal(e)
			}
			_, e = r.Revalidate(context.Background(), original, []string{"social.feed"})
			var failure *Error
			if !errors.As(e, &failure) || failure.Code != tc.code || failure.Status != tc.expected {
				t.Fatal("unexpected safe failure", e)
			}
		})
	}
}
