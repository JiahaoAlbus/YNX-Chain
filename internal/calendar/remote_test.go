package calendar

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestRemoteWalletVerifierUsesCentralContractAndRejectsTamper(t *testing.T) {
	issued := time.Now().UTC().Add(-time.Second).Format(time.RFC3339Nano)
	expires := time.Now().UTC().Add(time.Minute).Format(time.RFC3339Nano)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.Path != "/v1/wallet-auth/verify-session" {
			t.Fatalf("unexpected route")
		}
		var in CentralWalletProof
		if json.NewDecoder(r.Body).Decode(&in) != nil || len(in.AuthorizationRequest) == 0 || len(in.WalletApproval) == 0 || len(in.GatewayCompletion) == 0 {
			t.Fatal("incomplete central verifier input")
		}
		_ = json.NewEncoder(w).Encode(VerifiedWalletSession{VerifierVersion: "wallet-auth-v1", SessionBinding: "binding", RequestDigest: "digest", ProductClientID: "ynx-calendar-v1", BundleID: "com.ynxweb4.calendar", Account: "ynx1account", Scopes: []string{RequiredScope}, IssuedAt: issued, ExpiresAt: expires})
	}))
	defer server.Close()
	proof := WalletProof{Account: "ynx1account", Scopes: []string{RequiredScope}, Central: &CentralWalletProof{RegistryEntry: json.RawMessage(`{"schemaVersion":2}`), AuthorizationRequest: json.RawMessage(`{"version":"1"}`), WalletApproval: json.RawMessage(`{"version":"1"}`), GatewayCompletion: json.RawMessage(`{"deviceSignature":"proof"}`)}}
	if e := (RemoteWalletVerifier{BaseURL: server.URL}).Verify(context.Background(), proof); e != nil {
		t.Fatal(e)
	}
	proof.Scopes = []string{RecoveryScope}
	if e := (RemoteWalletVerifier{BaseURL: server.URL}).Verify(context.Background(), proof); e == nil {
		t.Fatal("tampered scope accepted")
	}
}

func TestRemoteAIUsesPrivatePostBodyAndParsesSSE(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/ai/stream" || r.URL.RawQuery != "" || r.Header.Get("X-YNX-AI-Key") != "server-only" {
			t.Fatalf("unsafe AI transport: %s %s?%s", r.Method, r.URL.Path, r.URL.RawQuery)
		}
		var body struct {
			Session        string           `json:"session"`
			Product        string           `json:"product"`
			Workflow       string           `json:"workflow"`
			SelectedEvents []map[string]any `json:"selected_events"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Session != "calendar-approved-context" || body.Product != ProductID || body.Workflow != "draft_agenda" || len(body.SelectedEvents) != 1 {
			t.Fatalf("invalid private AI body: %v %+v", err, body)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("event: token\ndata: {\"text\":\"safe agenda\"}\n\n"))
	}))
	defer server.Close()
	out, err := (RemoteAI{BaseURL: server.URL, Token: "server-only"}).Generate(context.Background(), "draft_agenda", []Event{{ID: "e1", Title: "private", TimeZone: "UTC"}})
	if err != nil || out != "safe agenda" {
		t.Fatalf("AI SSE failed: %v %q", err, out)
	}
}
