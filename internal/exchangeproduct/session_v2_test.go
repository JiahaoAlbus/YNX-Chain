package exchangeproduct

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

type exchangeV2RoundTrip func(*http.Request) (*http.Response, error)

func (f exchangeV2RoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// These are explicit product-boundary fixtures with a simulated authority, not
// real signatures or approval evidence. The inherited shared package separately
// executes its unchanged real SDK-generated vector and replay contract tests.
func v2Canonical(t *testing.T, value any) []byte {
	t.Helper()
	b, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var object any
	if err = json.Unmarshal(b, &object); err != nil {
		t.Fatal(err)
	}
	b, err = json.Marshal(object)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
func v2Fixture(t *testing.T, account, scope string) (string, productsessionv2.Session) {
	t.Helper()
	now := time.Now().UTC().Add(-time.Second)
	format := func(v time.Time) string { return v.Format("2006-01-02T15:04:05.000Z") }
	digest := sha256.Sum256(v2Canonical(t, map[string]any{"requiredScopes": []string{scope}}))
	session := productsessionv2.Session{
		Version: "2", SessionBinding: strings.Repeat("a", 64), ChainID: ChainID,
		ProductID: "exchange", ClientID: "ynx-exchange-v1", ApplicationID: "com.ynxweb4.exchange",
		Platform: "web", Origin: exchangeWebOrigin, Callback: exchangeWebOrigin + "/wallet-auth/callback",
		Account: account, DeviceID: "offline-fixture-device", DeviceAlgorithm: "p256-sha256",
		DeviceKey: "offline-fixture-device-public-key-not-a-native-key", DeviceBinding: strings.Repeat("b", 64),
		Nonce: "offline-session-nonce", State: "offline-state", Scopes: []string{scope},
		RequestDigest: strings.Repeat("c", 64), ApprovalDigest: strings.Repeat("d", 64),
		IssuedAt: format(now.Add(-time.Minute)), ExpiresAt: format(now.Add(2 * time.Minute)),
	}
	proof := map[string]any{
		"version": "2", "sessionBinding": session.SessionBinding, "productId": session.ProductID,
		"clientId": session.ClientID, "applicationId": session.ApplicationID, "bundleId": nil, "packageId": nil,
		"origin": session.Origin, "callback": session.Callback, "account": account, "deviceId": session.DeviceID,
		"deviceKey": session.DeviceKey, "method": "POST", "path": "/v2/product-sessions/introspect",
		"bodyDigest": hex.EncodeToString(digest[:]), "nonce": "offline-proof-nonce",
		"issuedAt": format(now), "expiresAt": format(now.Add(45 * time.Second)),
		"signature": "simulated-authority-fixture-not-a-real-signature",
	}
	return base64.RawURLEncoding.EncodeToString(v2Canonical(t, proof)), session
}
func v2Mutate(t *testing.T, header string, mutate func(map[string]any)) string {
	t.Helper()
	b, err := base64.RawURLEncoding.DecodeString(header)
	if err != nil {
		t.Fatal(err)
	}
	var proof map[string]any
	if err = json.Unmarshal(b, &proof); err != nil {
		t.Fatal(err)
	}
	mutate(proof)
	return base64.RawURLEncoding.EncodeToString(v2Canonical(t, proof))
}
func v2Request(method, path, proof, body string) *http.Request {
	r := httptest.NewRequest(method, exchangeWebOrigin+path, strings.NewReader(body))
	r.Header.Set("Origin", exchangeWebOrigin)
	r.Header.Set(productsessionv2.ProofHeader, proof)
	return r
}
func v2Response(t *testing.T, r *http.Request, session productsessionv2.Session, code string) *http.Response {
	t.Helper()
	status := http.StatusOK
	body := map[string]any{"schemaVersion": 2, "requestId": r.Header.Get("X-Request-Id"), "ok": true,
		"result": map[string]any{"active": true, "session": session}}
	if code != "" {
		status = http.StatusUnauthorized
		body = map[string]any{"schemaVersion": 2, "requestId": r.Header.Get("X-Request-Id"), "ok": false,
			"error": map[string]any{"code": code, "message": "untrusted authority detail must not be forwarded"}}
	}
	b := v2Canonical(t, body)
	return &http.Response{StatusCode: status, Header: http.Header{
		"Content-Type": []string{"application/json"}, "Cache-Control": []string{"no-store"},
		"X-Request-Id": []string{r.Header.Get("X-Request-Id")}}, Body: io.NopCloser(bytes.NewReader(b)), ContentLength: int64(len(b))}
}
func v2Server(t *testing.T, rt exchangeV2RoundTrip) (*Service, *Server, string) {
	t.Helper()
	s, _, path := newTestService(t)
	t.Cleanup(func() { _ = s.Close() })
	c, err := newProductSessionV2Client(rt)
	if err != nil {
		t.Fatal(err)
	}
	s.cfg.SessionV2 = c
	return s, NewServer(s), path
}

func TestSessionV2CanonicalAuthorityAndNoCredentialForwarding(t *testing.T) {
	proof, session := v2Fixture(t, alice, "exchange:read")
	var calls int
	s, server, _ := v2Server(t, func(r *http.Request) (*http.Response, error) {
		calls++
		body, _ := io.ReadAll(r.Body)
		if r.URL.String() != exchangeSessionAuthority+"/v2/product-sessions/introspect" || r.Method != "POST" || string(body) != `{"requiredScopes":["exchange:read"]}` || r.Header.Get(productsessionv2.ProofHeader) != proof || r.Header.Get("Cookie") != "" || r.Header.Get("Authorization") != "" || r.Header.Get("X-YNX-Product-Session-Proof") != "" {
			t.Fatal("unexpected canonical authority request")
		}
		if calls > 1 {
			return v2Response(t, r, session, "REPLAY"), nil
		}
		return v2Response(t, r, session, ""), nil
	})
	s.cfg.GatewayURL = "https://legacy-authority.invalid"
	if _, err := s.CreditTestQuote("Bearer "+adminKey, alice, 21*AmountScale, "v2-alice-credit"); err != nil {
		t.Fatal(err)
	}
	for i, status := range []int{200, 401} {
		r := v2Request("GET", "/v1/account", proof, "")
		r.Header.Set("Cookie", "private-user-cookie")
		r.Header.Set("Authorization", "Bearer must-not-forward")
		w := httptest.NewRecorder()
		server.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("attempt %d: %d %s", i, w.Code, w.Body.String())
		}
		if strings.Contains(w.Body.String(), proof) || strings.Contains(w.Body.String(), session.DeviceKey) || strings.Contains(w.Body.String(), "untrusted authority detail") {
			t.Fatal("credential or upstream detail leak")
		}
	}
	if calls != 2 || len(s.state.Sessions) != 0 {
		t.Fatal("introspection cache or local session issuance")
	}
	if s.Integrations().ProductSessionV2 != "configured_not_attested" {
		t.Fatal("configured status overclaim")
	}
}

func TestSessionV2RejectsInvalidBindingBeforeAuthority(t *testing.T) {
	proof, _ := v2Fixture(t, alice, "exchange:read")
	tests := []struct {
		name   string
		status int
		mutate func(*http.Request)
	}{
		{"origin", 403, func(r *http.Request) { r.Header.Set("Origin", "https://attacker.invalid") }},
		{"duplicate", 401, func(r *http.Request) { r.Header.Add(productsessionv2.ProofHeader, proof) }},
		{"empty", 401, func(r *http.Request) { r.Header.Set(productsessionv2.ProofHeader, "") }},
		{"malformed", 401, func(r *http.Request) { r.Header.Set(productsessionv2.ProofHeader, "not+base64") }},
		{"mixed_v1_v2", 400, func(r *http.Request) { r.Header.Set("X-YNX-Product-Session-Proof", "legacy-proof") }},
		{"wrong_scope", 403, func(r *http.Request) { r.Method = "POST"; r.URL.Path = "/v1/orders" }},
		{"expired", 401, func(r *http.Request) {
			r.Header.Set(productsessionv2.ProofHeader, v2Mutate(t, proof, func(p map[string]any) { p["expiresAt"] = "2000-01-01T00:00:00.000Z" }))
		}},
	}
	for _, field := range []string{"productId", "clientId", "applicationId", "origin", "callback"} {
		field := field
		tests = append(tests, struct {
			name   string
			status int
			mutate func(*http.Request)
		}{field, 403, func(r *http.Request) {
			r.Header.Set(productsessionv2.ProofHeader, v2Mutate(t, proof, func(p map[string]any) { p[field] = "other-product" }))
		}})
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, server, _ := v2Server(t, func(*http.Request) (*http.Response, error) { t.Fatal("unexpected authority call"); return nil, nil })
			r := v2Request("GET", "/v1/account", proof, "{}")
			tc.mutate(r)
			w := httptest.NewRecorder()
			server.ServeHTTP(w, r)
			if w.Code != tc.status {
				t.Fatalf("%d %s", w.Code, w.Body.String())
			}
		})
	}
}

func TestSessionV2ReadDoesNotAuthorizeLegacyWriteScopes(t *testing.T) {
	proof, _ := v2Fixture(t, alice, "exchange:read")
	_, server, path := v2Server(t, func(*http.Request) (*http.Response, error) {
		t.Fatal("no authority call for undeclared write scope")
		return nil, nil
	})
	before, _ := os.ReadFile(path)
	for _, route := range []struct{ method, path string }{{"PUT", "/v1/security"}, {"POST", "/v1/support"}} {
		w := httptest.NewRecorder()
		server.ServeHTTP(w, v2Request(route.method, route.path, proof, `{"requiredScopes":["exchange:trade"]}`))
		if w.Code != 403 || !strings.Contains(w.Body.String(), "EXPLICIT_WRITE_SCOPE_UNAVAILABLE") {
			t.Fatalf("unexpected write gate %d %s", w.Code, w.Body.String())
		}
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) {
		t.Fatal("read proof mutated disk")
	}
}

func TestSessionV2NeverBecomesNativeOrderSignature(t *testing.T) {
	proof, session := v2Fixture(t, alice, "exchange:trade")
	s, server, path := v2Server(t, func(r *http.Request) (*http.Response, error) { return v2Response(t, r, session, ""), nil })
	r := v2Request("POST", "/v1/orders", proof, `{"market":"YNXT-YUSD_TEST","side":"buy","type":"limit","priceMicro":1000000,"amountMicro":1000000,"idempotencyKey":"v2-unsigned-order","walletPublicKey":"offline-fixture-device-public-key-not-a-native-key","walletSignature":"device-proof-is-not-order-approval"}`)
	validated, ok := server.authorizeSessionV2(httptest.NewRecorder(), r)
	if !ok {
		t.Fatal("fixture authorization rejected")
	}
	auth := validated.Context().Value(exchangeSessionV2ContextKey{}).(exchangeSessionV2Authorization)
	if auth.session.WalletPublicKey != "" || auth.session.TokenHash != "" || auth.session.Account != alice || auth.session.ProductDeviceKey != session.DeviceKey {
		t.Fatal("native and device credentials conflated")
	}
	before, _ := os.ReadFile(path)
	snapshot, _ := json.Marshal(s.state)
	w := httptest.NewRecorder()
	server.ServeHTTP(w, r)
	if w.Code != 401 {
		t.Fatalf("unsigned order result %d %s", w.Code, w.Body.String())
	}
	after, _ := os.ReadFile(path)
	updated, _ := json.Marshal(s.state)
	if !bytes.Equal(before, after) || !bytes.Equal(snapshot, updated) {
		t.Fatal("unsigned v2 order mutated venue")
	}
}

func TestSessionV2ExpiryRecheckedAfterVenueLockWait(t *testing.T) {
	s, _, _ := newTestService(t)
	defer s.Close()
	server := NewServer(s)
	r := httptest.NewRequest("GET", "/v1/account", nil)
	r = r.WithContext(context.WithValue(r.Context(), exchangeSessionV2ContextKey{}, exchangeSessionV2Authorization{
		scope: "exchange:read", session: WalletSession{Account: alice, ExpiresAt: time.Now().Add(-time.Second)},
	}))
	w := httptest.NewRecorder()
	if _, ok := server.auth(w, r, "exchange:read"); ok || w.Code != 401 {
		t.Fatal("expired queued session authorized")
	}
}

func TestSessionV2AuthorityFailureLeavesGuestReadAndStateAvailable(t *testing.T) {
	proof, _ := v2Fixture(t, alice, "exchange:read")
	var calls atomic.Int32
	_, server, path := v2Server(t, func(*http.Request) (*http.Response, error) {
		calls.Add(1)
		return nil, errors.New("internal transport credential detail")
	})
	before, _ := os.ReadFile(path)
	w := httptest.NewRecorder()
	server.ServeHTTP(w, v2Request("GET", "/v1/account", proof, ""))
	if w.Code != 503 || !strings.Contains(w.Body.String(), `"privateService":"degraded"`) || strings.Contains(w.Body.String(), "credential detail") {
		t.Fatalf("private failure %d %s", w.Code, w.Body.String())
	}
	guest := httptest.NewRecorder()
	server.ServeHTTP(guest, httptest.NewRequest("GET", "/v1/market-data/snapshot", nil))
	if guest.Code != 200 || calls.Load() != 1 {
		t.Fatal("guest coupled to private authority or retry occurred")
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) {
		t.Fatal("authority failure mutated venue")
	}
}

func TestSessionV2SlowAuthorityDoesNotLockGuestSnapshot(t *testing.T) {
	proof, session := v2Fixture(t, alice, "exchange:read")
	started, release := make(chan struct{}), make(chan struct{})
	_, server, _ := v2Server(t, func(r *http.Request) (*http.Response, error) {
		close(started)
		<-release
		return v2Response(t, r, session, ""), nil
	})
	privateDone := make(chan struct{})
	go func() {
		defer close(privateDone)
		server.ServeHTTP(httptest.NewRecorder(), v2Request("GET", "/v1/account", proof, ""))
	}()
	<-started
	guestDone := make(chan int, 1)
	go func() {
		w := httptest.NewRecorder()
		server.ServeHTTP(w, httptest.NewRequest("GET", "/v1/market-data/snapshot", nil))
		guestDone <- w.Code
	}()
	select {
	case code := <-guestDone:
		if code != 200 {
			t.Error("guest unavailable")
		}
	case <-time.After(time.Second):
		t.Error("private introspection holds venue lock")
	}
	close(release)
	<-privateDone
}

func TestSessionV2IndependentUsersConcurrentReadsAndRestart(t *testing.T) {
	proofA, sessionA := v2Fixture(t, alice, "exchange:read")
	proofB, sessionB := v2Fixture(t, bob, "exchange:read")
	var calls atomic.Int32
	s, server, path := v2Server(t, func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		session := sessionA
		if r.Header.Get(productsessionv2.ProofHeader) == proofB {
			session = sessionB
		} else if r.Header.Get(productsessionv2.ProofHeader) != proofA {
			t.Error("unknown proof")
		}
		return v2Response(t, r, session, ""), nil
	})
	for i, account := range []string{alice, bob} {
		if _, err := s.CreditTestQuote("Bearer "+adminKey, account, int64(i+1)*AmountScale, "v2-credit-"+account); err != nil {
			t.Fatal(err)
		}
	}
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			proof, own, foreign := proofA, alice, bob
			if i%2 != 0 {
				proof, own, foreign = proofB, bob, alice
			}
			w := httptest.NewRecorder()
			server.ServeHTTP(w, v2Request("GET", "/v1/account", proof, ""))
			if w.Code != 200 || !strings.Contains(w.Body.String(), own) || strings.Contains(w.Body.String(), foreign) {
				t.Errorf("account isolation failed status %d", w.Code)
			}
		}(i)
	}
	wg.Wait()
	if calls.Load() != 20 {
		t.Fatal("per-request authority call missing")
	}
	before, _ := os.ReadFile(path)
	restarted, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	w := httptest.NewRecorder()
	NewServer(restarted).ServeHTTP(w, v2Request("GET", "/v1/account", proofB, ""))
	if w.Code != 200 || calls.Load() != 21 || strings.Contains(w.Body.String(), alice) {
		t.Fatal("restart reused private authority or account")
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) {
		t.Fatal("account reads persisted authority session")
	}
}

func TestSessionV2RouteScopesAreServerOwned(t *testing.T) {
	s, _, _ := newTestService(t)
	defer s.Close()
	server := NewServer(s)
	expected := map[string]string{
		"GET /v1/account": "exchange:read", "POST /v1/deposit-intents": "exchange:deposit", "POST /v1/deposits": "exchange:deposit",
		"POST /v1/deposits/{id}/refresh": "exchange:deposit", "POST /v1/withdrawals/review": "exchange:withdrawal-review",
		"POST /v1/orders": "exchange:trade", "POST /v1/orders/{id}/cancel": "exchange:trade", "PUT /v1/security": "exchange:read",
		"POST /v1/support": "exchange:read", "POST /v1/ai/drafts": "exchange:ai", "POST /v1/ai/drafts/{id}/actions": "exchange:ai",
	}
	if !bytes.Equal(v2Canonical(t, expected), v2Canonical(t, server.privateScopes)) {
		t.Fatal("private route policy drift")
	}
	proof, _ := v2Fixture(t, alice, "exchange:read")
	w := httptest.NewRecorder()
	server.ServeHTTP(w, v2Request("GET", "/v1/account", proof, ""))
	if w.Code != 503 || !strings.Contains(w.Body.String(), "PRIVATE_SERVICE_UNCONFIGURED") {
		t.Fatal("v2 silently fell back to legacy")
	}
}
