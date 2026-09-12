package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

type testAuthorizer struct {
	calls   [][]string
	err     error
	account string
}

func (a *testAuthorizer) Authorize(_ context.Context, _ *http.Request, scopes []string) (productsessionv2.Session, error) {
	a.calls = append(a.calls, append([]string(nil), scopes...))
	if a.err != nil {
		return productsessionv2.Session{}, a.err
	}
	return productsessionv2.Session{SessionBinding: "remote-session", Account: a.account, DeviceID: "remote-device", ClientID: FormalProductClientID, Scopes: FormalScopes, IssuedAt: time.Now().Add(-time.Minute).Format(time.RFC3339Nano), ExpiresAt: time.Now().Add(time.Minute).Format(time.RFC3339Nano)}, nil
}
func canonicalTestServer(t *testing.T) (*Server, *Store, *testAuthorizer) {
	t.Helper()
	store, err := NewStore(filepath.Join(t.TempDir(), "state.json"), bytes.Repeat([]byte{7}, 32))
	if err != nil {
		t.Fatal(err)
	}
	server, err := NewServer(Config{GatewayURL: "http://127.0.0.1:6429", GatewayKey: testGatewayKey, ExactWalletCallback: FormalCallback}, store, nil)
	if err != nil {
		t.Fatal(err)
	}
	verifier := &testAuthorizer{account: newTestIdentity(t).account}
	server.wallet = verifier
	return server, store, verifier
}
func TestCanonicalAIReadbackUsesFreshAuthorityAndIssuesNoLocalToken(t *testing.T) {
	s, store, verifier := canonicalTestServer(t)
	for i := 0; i < 2; i++ {
		r := httptest.NewRequest(http.MethodGet, "/api/auth/session", nil)
		r.Header.Set(productsessionv2.ProofHeader, "opaque-test-proof")
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		if w.Code != 200 {
			t.Fatalf("readback failed: %d %s", w.Code, w.Body.String())
		}
		var result map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if result["account"] != verifier.account || result["authority"] != "canonical-wallet-v2" || result["token"] != nil {
			t.Fatalf("wrong identity or local token: %v", result)
		}
	}
	if len(verifier.calls) != 2 || !reflect.DeepEqual(verifier.calls[0], []string{"ai:conversations"}) {
		t.Fatalf("authority was cached or used client policy: %v", verifier.calls)
	}
	if len(store.state.Sessions) != 0 {
		t.Fatal("canonical readback minted local session")
	}
	verifier.err = &productsessionv2.Error{Code: "SESSION_REVOKED", Status: 401}
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/auth/session", nil))
	if w.Code != 401 {
		t.Fatalf("revocation not enforced: %d", w.Code)
	}
}
func TestCanonicalAIFailuresNeverFallBackToLegacyCredentials(t *testing.T) {
	s, _, verifier := canonicalTestServer(t)
	r := httptest.NewRequest(http.MethodGet, "/api/conversations", nil)
	r.Header.Set("Authorization", "Bearer fixture")
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	if w.Code != 401 || len(verifier.calls) != 0 {
		t.Fatal("fixture credential entered canonical flow")
	}
	verifier.err = &productsessionv2.Error{Code: "AUTHORITY_UNAVAILABLE", Status: 503}
	w = httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/conversations", nil))
	if w.Code != 503 {
		t.Fatalf("authority outage became login failure: %d", w.Code)
	}
}
func TestCanonicalAIRouteScopesAreChosenByServer(t *testing.T) {
	s, _, verifier := canonicalTestServer(t)
	verifier.err = &productsessionv2.Error{Code: "PROOF_REQUIRED", Status: 401}
	for _, item := range []struct{ path, scope string }{{"/api/usage", "ai:data-control"}, {"/api/permissions", "ai:permissions"}, {"/api/provider", "ai:generate"}} {
		r := httptest.NewRequest(http.MethodGet, item.path+"?requiredScopes=account:read", nil)
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		if !reflect.DeepEqual(verifier.calls[len(verifier.calls)-1], []string{item.scope}) {
			t.Fatal("request changed route policy")
		}
	}
}
func TestCanonicalAIConfigurationRejectsFixtureMixAndUnsafeAuthority(t *testing.T) {
	for _, cfg := range []Config{
		{CanonicalWalletGatewayOrigin: "https://wallet.example", AllowLocalFixtureAuth: true},
		{CanonicalWalletGatewayOrigin: "http://wallet.example"},
	} {
		cfg.GatewayURL = "http://127.0.0.1:6429"
		cfg.GatewayKey = testGatewayKey
		cfg.ExactWalletCallback = FormalCallback
		if _, err := NewServer(cfg, nil, nil); err == nil {
			t.Fatal("unsafe canonical configuration accepted")
		}
	}
}

func TestAIWalletConfigDisclosesConfigurationWithoutPromotingAcceptance(t *testing.T) {
	s, store, _ := canonicalTestServer(t)
	s.wallet = nil
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/wallet/config", nil))
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if w.Code != 200 || out["canonicalConfigured"] != false || out["integratedCentral"] != false || out["callback"] != AIWebCallback || out["proofHeader"] != productsessionv2.ProofHeader || len(store.state.Sessions) != 0 {
		t.Fatalf("invalid public configuration boundary: %v", out)
	}
}
