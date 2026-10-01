package aiproduct

import (
	"bytes"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"testing"
)

func TestAIBrowserSSOExactIdentityOnlyRegistration(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "state.json"), bytes.Repeat([]byte{7}, 32))
	if err != nil {
		t.Fatal(err)
	}
	s, err := NewServer(Config{CanonicalWalletGatewayOrigin: "https://wallet-auth.ynxweb4.com", GatewayURL: "http://127.0.0.1:6429", GatewayKey: testGatewayKey, ExactWalletCallback: FormalCallback}, store, nil)
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest("GET", "/sso/start?target=chat", nil))
	if w.Code != 303 {
		t.Fatalf("start: %d %s", w.Code, w.Body.String())
	}
	destination, err := url.Parse(w.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	query := destination.Query()
	if destination.Host != "wallet-auth.ynxweb4.com" || query.Get("clientId") != "ynx-ai-v1-sso-v1" || query.Get("origin") != AIWebOrigin || query.Get("redirectUri") != AIWebOrigin+"/sso/callback" || query.Get("codeChallengeMethod") != "S256" {
		t.Fatal("wrong SSO binding", destination)
	}
	for _, cookie := range w.Result().Cookies() {
		if !cookie.Secure || !cookie.HttpOnly || cookie.Path != "/" || cookie.SameSite != http.SameSiteLaxMode {
			t.Fatal("insecure SSO cookie")
		}
	}
	w = httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest("GET", "/api/account", nil))
	if w.Code != 401 {
		t.Fatalf("anonymous identity: %d", w.Code)
	}
	// Even an identity cookie cannot substitute for a fresh AI-scope proof.
	verifier := &testAuthorizer{err: &productsessionv2.Error{Code: "PROOF_REQUIRED", Status: 401}}
	s.wallet = verifier
	r := httptest.NewRequest("GET", "/api/conversations", nil)
	r.AddCookie(&http.Cookie{Name: "__Host-ynx-ai-identity", Value: "identity-is-not-private-permission"})
	w = httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	if w.Code != 401 || len(verifier.calls) != 1 || verifier.calls[0][0] != "ai:conversations" {
		t.Fatal("identity escalated private permission")
	}
}
func TestAIBrowserCookieKeyStableAcrossRestartAndDifferentFromContentKey(t *testing.T) {
	key := bytes.Repeat([]byte{9}, 32)
	path := filepath.Join(t.TempDir(), "state.json")
	a, err := NewStore(path, key)
	if err != nil {
		t.Fatal(err)
	}
	b, err := NewStore(path, key)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(a.browserCookieKey, key) || !bytes.Equal(a.browserCookieKey, b.browserCookieKey) {
		t.Fatal("SSO key separation/recovery failed")
	}
}
