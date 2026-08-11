package appgateway

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestPayProductProxyConsumesCanonicalProofAndEmitsBoundedAssertion(t *testing.T) {
	_, chatServer := startUpstream(t, "chat", "X-YNX-Chat-Key", testChatKey)
	_, squareServer := startUpstream(t, "square", "X-YNX-Square-Key", testSquareKey)
	now := time.Date(2026, 8, 11, 9, 0, 0, 0, time.UTC)
	fixture := newOwnershipFixture(t, 0x95, 0x96, "pay-web-device")
	assertionKey := []byte("pay-product-gateway-assertion-key-1234567890")
	consumed := map[string]bool{}
	walletServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "service": "ynx-wallet-gateway", "remoteDeployed": false, "truthfulStatus": "local-test"})
			return
		}
		if r.Method != http.MethodPost || r.URL.Path != "/v1/wallet/sessions/introspect" {
			http.NotFound(w, r)
			return
		}
		proof := r.Header.Get("X-YNX-Product-Session-Proof")
		var input struct {
			RequiredScopes []string `json:"requiredScopes"`
		}
		if json.NewDecoder(r.Body).Decode(&input) != nil || len(input.RequiredScopes) != 1 || proof == "" || consumed[proof] {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		consumed[proof] = true
		product := "pay"
		if proof == "wrong-product" {
			product = "shop"
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "result": map[string]any{"active": true, "session": map[string]any{
			"requestingProduct": product, "productClientId": "ynx-pay-v1", "bundleId": "com.ynxweb4.pay",
			"account": fixture.account, "productDeviceKey": strings.Repeat("B", 44), "sessionBinding": strings.Repeat("a", 64), "requestDigest": strings.Repeat("c", 64),
			"scopes": payProductScopes, "issuedAt": now.Add(-time.Minute).Format(time.RFC3339Nano), "expiresAt": now.Add(4 * time.Minute).Format(time.RFC3339Nano),
		}}})
	}))
	t.Cleanup(walletServer.Close)
	payProductServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "service": "ynx-pay-product", "remoteDeployed": false, "truthfulStatus": "local-test"})
			return
		}
		body, _ := io.ReadAll(r.Body)
		if r.URL.Path != "/v1/invoices/inv_aaaaaaaaaaaaaaaaaaaa/refund-requests" || !validPayAssertion(r, body, assertionKey) || r.Header.Get("Authorization") != "" || r.Header.Get("X-YNX-Product-Session-Proof") != "" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusCreated)
		_, _ = io.WriteString(w, `{"ok":true}`)
	}))
	t.Cleanup(payProductServer.Close)
	cfg := testConfig(t, chatServer.URL, squareServer.URL, 100)
	cfg.WalletURL, cfg.PayProductURL, cfg.PayProductAssertionKey, cfg.Now = walletServer.URL, payProductServer.URL, assertionKey, func() time.Time { return now }
	gateway, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServer(gateway).Handler())
	defer server.Close()

	request := func(proof string) *httptest.ResponseRecorder {
		req := mustRequest(t, http.MethodPost, server.URL+"/app/pay-product/v1/invoices/inv_aaaaaaaaaaaaaaaaaaaa/refund-requests", []byte(`{"amount":1,"reason":"not delivered","idempotencyKey":"refund-once"}`), testOrigin)
		req.Header.Set("X-YNX-Product-Session-Proof", proof)
		req.Header.Set("Authorization", "Bearer must-not-forward")
		response, requestErr := http.DefaultClient.Do(req)
		if requestErr != nil {
			t.Fatal(requestErr)
		}
		defer response.Body.Close()
		recorder := httptest.NewRecorder()
		recorder.Code, recorder.HeaderMap = response.StatusCode, response.Header.Clone()
		_, _ = recorder.Body.ReadFrom(response.Body)
		return recorder
	}
	if got := request("refund-once"); got.Code != http.StatusCreated {
		t.Fatalf("Pay refund status=%d body=%s", got.Code, got.Body.String())
	}
	if got := request("refund-once"); got.Code != http.StatusUnauthorized {
		t.Fatalf("replayed Pay proof status=%d", got.Code)
	}
	if got := request("wrong-product"); got.Code != http.StatusUnauthorized {
		t.Fatalf("wrong Pay product status=%d", got.Code)
	}
	publicRequest := mustRequest(t, http.MethodGet, server.URL+"/app/pay-product/health", nil, testOrigin)
	publicResponse, err := http.DefaultClient.Do(publicRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer publicResponse.Body.Close()
	if publicResponse.StatusCode != http.StatusOK {
		t.Fatalf("Pay public health status=%d body=%s", publicResponse.StatusCode, readAll(publicResponse.Body))
	}
	unknown := mustRequest(t, http.MethodPost, server.URL+"/app/pay-product/v1/merchant/invoices", []byte(`{}`), testOrigin)
	if response, err := http.DefaultClient.Do(unknown); err != nil {
		t.Fatal(err)
	} else {
		defer response.Body.Close()
		if response.StatusCode != http.StatusNotFound {
			t.Fatalf("merchant route escaped consumer boundary: %d", response.StatusCode)
		}
	}
}

func validPayAssertion(r *http.Request, body, key []byte) bool {
	bodyHash := sha256.Sum256(body)
	fields := []string{
		"YNX_PRODUCT_GATEWAY_ASSERTION_V1", r.Method, r.URL.EscapedPath(), hex.EncodeToString(bodyHash[:]),
		r.Header.Get("X-YNX-Account"), r.Header.Get("X-YNX-Session-ID"), r.Header.Get("X-YNX-Device-ID"),
		r.Header.Get("X-YNX-Product"), r.Header.Get("X-YNX-Client"), r.Header.Get("X-YNX-Bundle"), r.Header.Get("X-YNX-Callback"), r.Header.Get("X-YNX-Chain"), r.Header.Get("X-YNX-Scopes"),
		r.Header.Get("X-YNX-Session-Binding"), r.Header.Get("X-YNX-Request-Digest"), r.Header.Get("X-YNX-Issued-At"), r.Header.Get("X-YNX-Expires-At"), r.Header.Get("X-YNX-Nonce"),
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(strings.Join(fields, "\n")))
	return r.Header.Get("X-YNX-Account") != "" && r.Header.Get("X-YNX-Product") == "pay" && r.Header.Get("X-YNX-Client") == "ynx-pay-v1" && r.Header.Get("X-YNX-Scopes") == strings.Join(payProductScopes, " ") && hmac.Equal([]byte(r.Header.Get("X-YNX-Gateway-Signature")), []byte(hex.EncodeToString(mac.Sum(nil))))
}
