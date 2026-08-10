package quantlab

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestHTTPWriteBoundaryAndStrictSchema(t *testing.T) {
	s, _ := New(Config{StatePath: filepath.Join(t.TempDir(), "s.json")})
	server := httptest.NewServer(NewServer(s))
	defer server.Close()
	body := `{"reason":"operator test"}`
	r, _ := http.Post(server.URL+"/v1/risk/kill", "application/json", strings.NewReader(body))
	if r.StatusCode != 403 {
		t.Fatalf("missing boundary=%d", r.StatusCode)
	}
	req, _ := http.NewRequest("POST", server.URL+"/v1/risk/kill", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-YNX-Preview-Mode", "local-paper")
	r, _ = server.Client().Do(req)
	if r.StatusCode != 200 {
		t.Fatalf("local boundary=%d", r.StatusCode)
	}
	req, _ = http.NewRequest("POST", server.URL+"/v1/risk/kill", strings.NewReader(`{"reason":"operator test","unknown":true}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-YNX-Preview-Mode", "local-paper")
	r, _ = server.Client().Do(req)
	if r.StatusCode != 400 {
		t.Fatalf("unknown field=%d", r.StatusCode)
	}
}

func TestSigningPayloadEndpointsReturnCanonicalBytes(t *testing.T) {
	s, err := New(Config{StatePath: filepath.Join(t.TempDir(), "state.json")})
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(s)
	strategy := strings.Repeat("a", 64)
	mandateBody := `{"Account":"ynx1test","StrategyHash":"` + strategy + `","Market":"YNXT-YUSD_TEST","Methods":["read","submit"],"CapitalMicro":1000000,"Leverage":1,"NonceDomain":"quant:` + strategy + `","ExpiresAt":"` + time.Now().UTC().Add(time.Hour).Format(time.RFC3339) + `"}`
	mandate := localJSONRequest(t, server, "/v1/testnet/signing-payloads/mandate", mandateBody)
	if mandate["domain"] != "ynx-quant-execution-adapter-v1" || !strings.Contains(mandate["payload"], "quant:"+strategy) || len(mandate["digest"]) != 64 {
		t.Fatalf("bad mandate payload: %#v", mandate)
	}
	order := localJSONRequest(t, server, "/v1/testnet/signing-payloads/order", `{"account":"ynx1test","market":"YNXT-YUSD_TEST","side":"buy","price":1000000,"amount":2000000,"idempotencyKey":"payload-order-1"}`)
	if order["domain"] != "ynx-exchange-order-v1" || !strings.Contains(order["payload"], "payload-order-1") || len(order["digest"]) != 64 {
		t.Fatalf("bad order payload: %#v", order)
	}
}

func TestHTTPTestnetUsesRequestScopedExchangeSession(t *testing.T) {
	now := time.Date(2026, 8, 10, 0, 0, 0, 0, time.UTC)
	statePath := filepath.Join(t.TempDir(), "state.json")
	s, err := New(Config{StatePath: statePath, Now: func() time.Time { return now }, MandateVerifier: allowMandate{}, TestnetBroker: testBroker{}})
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(s)
	strategy := strings.Repeat("a", 64)
	mandate := Mandate{Account: "ynx1test", StrategyHash: strategy, Market: "YNXT-YUSD_TEST", Methods: []string{"read", "submit"}, CapitalMicro: 2_000_000, Leverage: 1, NonceDomain: "quant:" + strategy, MaxNotional: 2_000_000, MaxPosition: 2_000_000, MaxDailyLoss: 500_000, ExpiresAt: now.Add(time.Hour), WalletSignature: "wallet-proof", TestnetOnly: true}
	payload, _ := json.Marshal(mandate)
	recorder := localRequestWithSession(t, server, "/v1/testnet/mandates", string(payload), "user-session")
	if recorder.Code != http.StatusCreated {
		t.Fatalf("mandate: %d %s", recorder.Code, recorder.Body.String())
	}
	var registered Mandate
	if json.NewDecoder(recorder.Body).Decode(&registered) != nil || registered.Digest == "" {
		t.Fatal("registered mandate response missing digest")
	}
	orderBody := `{"mandateDigest":"` + registered.Digest + `","side":"buy","price":1000000,"amount":1000000,"idempotencyKey":"http-order-1","walletSignature":"order-wallet-proof"}`
	recorder = localRequestWithSession(t, server, "/v1/testnet/orders", orderBody, "user-session")
	if recorder.Code != http.StatusCreated {
		t.Fatalf("order: %d %s", recorder.Code, recorder.Body.String())
	}
	stored, _ := os.ReadFile(statePath)
	if strings.Contains(string(stored), "user-session") {
		t.Fatal("request-scoped Exchange session leaked to persistent state")
	}
}

func localJSONRequest(t *testing.T, server http.Handler, path, body string) map[string]string {
	t.Helper()
	recorder := localRequest(t, server, path, body)
	if recorder.Code != http.StatusOK {
		t.Fatalf("%s: %d %s", path, recorder.Code, recorder.Body.String())
	}
	var result map[string]string
	if err := json.NewDecoder(recorder.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	return result
}

func localRequest(t *testing.T, server http.Handler, path, body string) *httptest.ResponseRecorder {
	return localRequestWithSession(t, server, path, body, "")
}

func localRequestWithSession(t *testing.T, server http.Handler, path, body, session string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "http://quant.local"+path, strings.NewReader(body))
	req.RemoteAddr = "127.0.0.1:42000"
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-YNX-Preview-Mode", "local-paper")
	if session != "" {
		req.Header.Set("X-YNX-Exchange-Session", session)
	}
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, req)
	return recorder
}
