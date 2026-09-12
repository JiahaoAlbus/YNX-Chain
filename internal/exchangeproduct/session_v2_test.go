package exchangeproduct

import (
	"bytes"
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
	c, err := newProductSessionV2Client(rt)
	if err != nil {
		t.Fatal(err)
	}
	s.cfg.SessionV2 = c
	return s, NewServer(s), path
}

// The real public venue is schema 10, not the divergent schema-1 candidate.
// These isolated fixtures never copy, inspect or modify private production data.
func TestBrowserV2PreservesSchema10BytesAcrossTwoUsersAndRestart(t *testing.T) {
	var mu sync.Mutex
	seen := map[string]bool{}
	s, api, path := v2Server(t, func(r *http.Request) (*http.Response, error) {
		p, _ := base64.RawURLEncoding.DecodeString(r.Header.Get(productsessionv2.ProofHeader))
		var proof map[string]any
		if err := json.Unmarshal(p, &proof); err != nil {
			t.Fatal(err)
		}
		_, session := v2Fixture(t, proof["account"].(string), "exchange:read")
		mu.Lock()
		replay := seen[proof["nonce"].(string)]
		seen[proof["nonce"].(string)] = true
		mu.Unlock()
		if replay {
			return v2Response(t, r, session, "REPLAY"), nil
		}
		if r.URL.String() != exchangeSessionAuthority+"/v2/product-sessions/introspect" || r.Header.Get("Cookie") != "" || r.Header.Get("Authorization") != "" {
			t.Error("authority or header injection")
		}
		return v2Response(t, r, session, ""), nil
	})
	for i, account := range []string{alice, bob} {
		if _, err := s.CreditTestQuote("Bearer "+adminKey, account, int64(i+1)*17*AmountScale, "isolated-v2-credit-"+account); err != nil {
			t.Fatal(err)
		}
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(before, []byte(`"schemaVersion": 10`)) {
		t.Fatal("test did not use production schema")
	}
	httpServer := httptest.NewServer(api)
	defer httpServer.Close()
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			account := []string{alice, bob}[i%2]
			proof, _ := v2Fixture(t, account, "exchange:read")
			proof = v2Mutate(t, proof, func(p map[string]any) { p["nonce"] = strings.Repeat("n", 20) + string(rune('a'+i)) })
			req, _ := http.NewRequest("GET", httpServer.URL+"/v1/account", nil)
			req.Header.Set("Origin", exchangeWebOrigin)
			req.Header.Set(productsessionv2.ProofHeader, proof)
			req.Header.Set("Cookie", "not-an-authority")
			req.Header.Set("Authorization", "not-an-authority")
			resp, err := httpServer.Client().Do(req)
			if err != nil {
				t.Error(err)
				return
			}
			defer resp.Body.Close()
			raw, _ := io.ReadAll(resp.Body)
			var snapshot AccountSnapshot
			if resp.StatusCode != 200 || json.Unmarshal(raw, &snapshot) != nil {
				t.Errorf("account failed: %d", resp.StatusCode)
				return
			}
			for _, balance := range snapshot.Balances {
				if balance.Account != account {
					t.Error("cross-account balance")
				}
			}
			for _, entry := range snapshot.Ledger {
				if entry.Account != account {
					t.Error("cross-account ledger")
				}
			}
			if bytes.Contains(raw, []byte("offline-fixture-device-public-key")) {
				t.Error("device proof identity leaked")
			}
		}(i)
	}
	wg.Wait()
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) {
		t.Fatal("read route rewrote persisted schema-10 state")
	}
	restarted, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	if restarted.state.SchemaVersion != 10 || restarted.state.IntegrityHash != s.state.IntegrityHash {
		t.Fatal("restart lost current state")
	}
	reread, _ := os.ReadFile(path)
	if !bytes.Equal(before, reread) {
		t.Fatal("second startup mutated current state")
	}
}

func TestBrowserV2FailClosedWithoutLegacyOrWriteFallback(t *testing.T) {
	calls := 0
	_, api, _ := v2Server(t, func(r *http.Request) (*http.Response, error) {
		calls++
		return nil, errors.New("private authority unavailable; do not echo")
	})
	proof, _ := v2Fixture(t, alice, "exchange:read")
	for _, tc := range []struct {
		method, path string
		status       int
	}{
		{"POST", "/v1/orders", 403}, {"PUT", "/v1/security", 403}, {"POST", "/v1/quant-adapter/account", 403},
		{"GET", "/v1/ws/user", 403}, {"GET", "/v1/unknown", 403},
	} {
		w := httptest.NewRecorder()
		api.ServeHTTP(w, v2Request(tc.method, tc.path, proof, ""))
		if w.Code != tc.status {
			t.Fatalf("%s %s: %d", tc.method, tc.path, w.Code)
		}
	}
	if calls != 0 {
		t.Fatal("unsupported route reached authority")
	}
	w := httptest.NewRecorder()
	r := v2Request("GET", "/v1/account", proof, "")
	r.Header.Set("X-YNX-Product-Session-Proof", "legacy")
	api.ServeHTTP(w, r)
	if w.Code != 400 || calls != 0 {
		t.Fatal("ambiguous proof accepted")
	}
	for _, mutate := range []func(*http.Request){
		func(r *http.Request) { r.Header.Set("Origin", "https://attacker.invalid") },
		func(r *http.Request) { r.Header.Add(productsessionv2.ProofHeader, proof) },
		func(r *http.Request) { r.Header.Set(productsessionv2.ProofHeader, "malformed") },
		func(r *http.Request) {
			r.Header.Set(productsessionv2.ProofHeader, v2Mutate(t, proof, func(p map[string]any) { p["expiresAt"] = "2000-01-01T00:00:00.000Z" }))
		},
	} {
		w = httptest.NewRecorder()
		r = v2Request("GET", "/v1/account", proof, "")
		mutate(r)
		api.ServeHTTP(w, r)
		if w.Code < 400 || calls != 0 {
			t.Fatal("invalid binding reached authority")
		}
	}
	w = httptest.NewRecorder()
	api.ServeHTTP(w, v2Request("GET", "/v1/account", proof, ""))
	if w.Code != 503 || !strings.Contains(w.Body.String(), "degraded") || strings.Contains(w.Body.String(), "do not echo") {
		t.Fatal("private failure contract")
	}
	guest := httptest.NewRecorder()
	api.ServeHTTP(guest, httptest.NewRequest("GET", "/v1/orderbook", nil))
	if guest.Code != 200 {
		t.Fatal("private failure broke guest data")
	}
}

func TestBrowserV2ReplayDelegatedAndNoLocalSessionIssuance(t *testing.T) {
	proof, session := v2Fixture(t, alice, "exchange:read")
	calls := 0
	s, api, path := v2Server(t, func(r *http.Request) (*http.Response, error) {
		calls++
		code := ""
		if calls > 1 {
			code = "REPLAY"
		}
		return v2Response(t, r, session, code), nil
	})
	before, _ := os.ReadFile(path)
	for _, status := range []int{200, 401} {
		w := httptest.NewRecorder()
		api.ServeHTTP(w, v2Request("GET", "/v1/account", proof, ""))
		if w.Code != status {
			t.Fatalf("got %d want %d", w.Code, status)
		}
	}
	after, _ := os.ReadFile(path)
	if calls != 2 || len(s.state.Sessions) != 0 || !bytes.Equal(before, after) {
		t.Fatal("cached proof or persisted local authority")
	}
}
