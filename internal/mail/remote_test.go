package mail

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestRemoteWalletVerifierUsesCentralContractAndRejectsTamper(t *testing.T) {
	expires := time.Now().UTC().Add(time.Minute).Format(time.RFC3339Nano)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.Path != "/v1/wallet-auth/verify-session" {
			t.Fatalf("unexpected route %s %s", r.Method, r.URL.Path)
		}
		var in CentralWalletProof
		if json.NewDecoder(r.Body).Decode(&in) != nil || len(in.AuthorizationRequest) == 0 || len(in.WalletApproval) == 0 || len(in.GatewayCompletion) == 0 {
			t.Fatal("incomplete central verifier input")
		}
		_ = json.NewEncoder(w).Encode(VerifiedWalletSession{VerifierVersion: "wallet-auth-v1", SessionBinding: "binding", ProductClientID: "ynx-mail-v1", BundleID: "com.ynxweb4.mail", Account: "ynx1account", Scopes: []string{RequiredScope}, ExpiresAt: expires})
	}))
	defer server.Close()
	proof := WalletProof{Account: "ynx1account", Scopes: []string{RequiredScope}, Central: &CentralWalletProof{RegistryEntry: json.RawMessage(`{"schemaVersion":2}`), AuthorizationRequest: json.RawMessage(`{"version":"1"}`), WalletApproval: json.RawMessage(`{"version":"1"}`), GatewayCompletion: json.RawMessage(`{"deviceSignature":"proof"}`)}}
	if err := (RemoteWalletVerifier{BaseURL: server.URL}).Verify(context.Background(), proof); err != nil {
		t.Fatal(err)
	}
	proof.Account = "tampered"
	if err := (RemoteWalletVerifier{BaseURL: server.URL}).Verify(context.Background(), proof); err == nil {
		t.Fatal("tampered account accepted")
	}
}
