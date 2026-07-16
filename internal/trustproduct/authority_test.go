package trustproduct

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCentralWalletAndAuthoritativeTrustLifecycle(t *testing.T) {
	now := time.Date(2026, 7, 16, 1, 0, 0, 0, time.UTC)
	token := "central-secret-session-token"
	device := "trust-device-1"
	seen := []string{}
	central := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Method+" "+r.URL.Path)
		if r.Header.Get("X-YNX-Client") != "ynx-trust-center-v1" {
			t.Errorf("client binding=%q", r.Header.Get("X-YNX-Client"))
		}
		switch {
		case r.URL.Path == "/app/session/challenges":
			writeJSON(w, 201, map[string]any{"challengeId": "challenge-1", "walletUrl": "ynxwallet://authorize?request=test"})
		case r.URL.Path == "/app/session/challenges/challenge-1/verify":
			writeJSON(w, 201, map[string]any{"sessionId": "central-session-1", "token": token, "account": "ynx1subject", "deviceId": device, "scopes": []string{"trust:evidence:write", "trust:evidence:read", "trust:appeal", "trust:transparency"}, "expiresAt": now.Add(time.Hour)})
		default:
			if r.Header.Get("X-YNX-App-Session") != token || r.Header.Get("X-YNX-Device-ID") != device {
				t.Errorf("authority session binding missing")
			}
			switch r.URL.Path {
			case "/app/trust/evidence":
				writeJSON(w, 201, map[string]any{"id": "evidence-authority-1", "riskSummary": map[string]any{"assetEffect": "none", "appealPath": "/trust/appeals"}})
			case "/app/trust/evidence/evidence-authority-1":
				writeJSON(w, 200, map[string]any{"id": "evidence-authority-1", "source": "authority"})
			case "/app/governance/requests":
				writeJSON(w, 201, map[string]any{"id": "governance-1", "classification": "REQUIRES_GOVERNANCE_REVIEW", "status": "pending"})
			case "/app/governance/requests/governance-1/review":
				writeJSON(w, 200, map[string]any{"id": "governance-1", "status": "reviewed"})
			case "/app/trust/appeals":
				writeJSON(w, 201, map[string]any{"id": "appeal-1", "status": "open"})
			case "/app/governance/transparency":
				writeJSON(w, 200, map[string]any{"entries": []any{}, "source": "authoritative"})
			default:
				writeJSON(w, 404, map[string]string{"error": "not found"})
			}
		}
	}))
	defer central.Close()
	path := filepath.Join(t.TempDir(), "state.json")
	svc, err := New(Config{StorePath: path, CentralGatewayURL: central.URL, CentralClientID: "ynx-trust-center-v1", Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(svc.Handler(http.NotFoundHandler()))
	defer server.Close()
	post := func(path string, body any, auth bool) *http.Response {
		raw, _ := json.Marshal(body)
		req, _ := http.NewRequest(http.MethodPost, server.URL+path, bytes.NewReader(raw))
		req.Header.Set("Content-Type", "application/json")
		if auth {
			req.Header.Set("Authorization", "Bearer "+token)
			req.Header.Set("X-YNX-Device-ID", device)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return resp
	}
	resp := post("/api/auth/challenges", map[string]any{"account": "ynx1subject", "deviceId": device}, false)
	if resp.StatusCode != 201 {
		t.Fatalf("challenge=%d", resp.StatusCode)
	}
	resp.Body.Close()
	resp = post("/api/auth/challenges/challenge-1/verify", map[string]string{"walletApproval": "signed", "deviceSignature": "signed"}, false)
	if resp.StatusCode != 201 {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("verify=%d %s", resp.StatusCode, b)
	}
	resp.Body.Close()
	resp = post("/api/authority/evidence", map[string]any{"subject": "ynx1subject", "source": "signed-record", "digest": "sha256:evidence", "summary": "bounded evidence"}, true)
	if resp.StatusCode != 201 {
		t.Fatalf("evidence=%d", resp.StatusCode)
	}
	resp.Body.Close()
	req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/authority/evidence/evidence-authority-1", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-YNX-Device-ID", device)
	resp, _ = http.DefaultClient.Do(req)
	if resp.StatusCode != 200 {
		t.Fatalf("lookup=%d", resp.StatusCode)
	}
	resp.Body.Close()
	resp = post("/api/authority/governance/requests", map[string]any{"subject": "ynx1subject", "scope": "single evidence packet", "evidence": []string{"evidence-authority-1"}}, true)
	if resp.StatusCode != 201 {
		t.Fatalf("request=%d", resp.StatusCode)
	}
	resp.Body.Close()
	resp = post("/api/authority/governance/requests/governance-1/review", map[string]string{"decision": "reviewed", "reason": "human evidence review"}, true)
	if resp.StatusCode != 200 {
		t.Fatalf("review=%d", resp.StatusCode)
	}
	resp.Body.Close()
	resp = post("/api/authority/appeals", map[string]string{"requestId": "governance-1", "reason": "classification disputed"}, true)
	if resp.StatusCode != 201 {
		t.Fatalf("appeal=%d", resp.StatusCode)
	}
	resp.Body.Close()
	bad, _ := http.NewRequest(http.MethodGet, server.URL+"/api/authority/transparency", nil)
	bad.Header.Set("Authorization", "Bearer "+token)
	bad.Header.Set("X-YNX-Device-ID", "substituted-device")
	resp, _ = http.DefaultClient.Do(bad)
	if resp.StatusCode != 401 {
		t.Fatalf("device substitution=%d", resp.StatusCode)
	}
	resp.Body.Close()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte(token)) {
		t.Fatal("central session token persisted in plaintext")
	}
	if !bytes.Contains(raw, []byte("tokenHash")) || len(svc.data.AuthorityAudit) < 4 {
		t.Fatalf("missing session hash or authority audit")
	}
	restarted, err := New(Config{StorePath: path, CentralGatewayURL: central.URL, CentralClientID: "ynx-trust-center-v1", Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := restarted.authenticateCentral("Bearer "+token, device); err != nil {
		t.Fatalf("restart session recovery: %v", err)
	}
	stateReq, _ := http.NewRequest(http.MethodGet, server.URL+"/api/state", nil)
	stateReq.Header.Set("Authorization", "Bearer "+token)
	stateReq.Header.Set("X-YNX-Device-ID", device)
	stateResp, _ := http.DefaultClient.Do(stateReq)
	if stateResp.StatusCode != http.StatusOK {
		t.Fatalf("central session not accepted by local product read: %d", stateResp.StatusCode)
	}
	stateResp.Body.Close()
	if !strings.Contains(strings.Join(seen, "|"), "POST /app/trust/evidence") {
		t.Fatalf("authoritative Trust path not called: %v", seen)
	}
}

func TestTrustAuthorityUnavailableDoesNotCreateConclusion(t *testing.T) {
	svc, _ := New(Config{StorePath: filepath.Join(t.TempDir(), "s.json"), CentralGatewayURL: "http://127.0.0.1:1", CentralClientID: "ynx-trust-center-v1"})
	ts := httptest.NewServer(svc.Handler(nil))
	defer ts.Close()
	resp, err := http.Post(ts.URL+"/api/auth/challenges", "application/json", strings.NewReader(`{"account":"ynx1x"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 503 {
		t.Fatalf("status=%d", resp.StatusCode)
	}
	b, _ := io.ReadAll(resp.Body)
	if !bytes.Contains(b, []byte(`"state":"unavailable"`)) || !bytes.Contains(b, []byte(`"retry":"safe"`)) {
		t.Fatalf("unavailable response=%s", b)
	}
}
