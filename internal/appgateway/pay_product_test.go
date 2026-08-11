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

func TestPayMerchantProxyExchangesCanonicalProofAndBoundsBearerRoutes(t *testing.T) {
	_, chatServer := startUpstream(t, "chat", "X-YNX-Chat-Key", testChatKey)
	_, squareServer := startUpstream(t, "square", "X-YNX-Square-Key", testSquareKey)
	now := time.Date(2026, 8, 11, 10, 0, 0, 0, time.UTC)
	fixture := newOwnershipFixture(t, 0x97, 0x98, "pay-merchant-device")
	assertionKey := []byte("pay-merchant-gateway-assertion-key-123456")
	walletServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "service": "ynx-wallet-gateway", "remoteDeployed": false})
			return
		}
		if r.Method != http.MethodPost || r.URL.Path != "/v1/wallet/sessions/introspect" || r.Header.Get("X-YNX-Product-Session-Proof") != "merchant-once" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "result": map[string]any{"active": true, "session": map[string]any{
			"requestingProduct": "pay-merchant", "productClientId": "ynx-merchant-console-v1", "bundleId": "com.ynxweb4.merchant-console",
			"account": fixture.account, "productDeviceKey": strings.Repeat("C", 44), "sessionBinding": strings.Repeat("d", 64), "requestDigest": strings.Repeat("e", 64),
			"scopes": payMerchantScopes, "issuedAt": now.Add(-time.Minute).Format(time.RFC3339Nano), "expiresAt": now.Add(4 * time.Minute).Format(time.RFC3339Nano),
		}}})
	}))
	t.Cleanup(walletServer.Close)
	payProductServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		switch r.URL.Path {
		case "/v1/merchant/sessions":
			if !validProductAssertion(r, body, assertionKey, "pay-merchant", "ynx-merchant-console-v1", "com.ynxweb4.merchant-console", "https://pay.ynxweb4.com/merchant/wallet-auth/callback", payMerchantScopes) || r.Header.Get("X-YNX-Product-Session-Proof") != "" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			w.WriteHeader(http.StatusCreated)
			_, _ = io.WriteString(w, `{"token":"mcs_session.token","role":"owner"}`)
		case "/v1/merchant/state":
			if r.Header.Get("Authorization") != "Bearer mcs_session.token" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			_, _ = io.WriteString(w, `{"ok":true}`)
		default:
			http.NotFound(w, r)
		}
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

	exchange := mustRequest(t, http.MethodPost, server.URL+"/app/pay-merchant/v1/merchant/sessions", []byte(`{"merchantId":"mrc_aaaaaaaaaaaaaaaaaaaa"}`), testOrigin)
	exchange.Header.Set("X-YNX-Product-Session-Proof", "merchant-once")
	response, err := http.DefaultClient.Do(exchange)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("merchant exchange status=%d body=%s", response.StatusCode, readAll(response.Body))
	}
	state := mustRequest(t, http.MethodGet, server.URL+"/app/pay-merchant/v1/merchant/state", nil, testOrigin)
	state.Header.Set("Authorization", "Bearer mcs_session.token")
	stateResponse, err := http.DefaultClient.Do(state)
	if err != nil {
		t.Fatal(err)
	}
	defer stateResponse.Body.Close()
	if stateResponse.StatusCode != http.StatusOK {
		t.Fatalf("merchant state status=%d", stateResponse.StatusCode)
	}
	for _, path := range []string{"/app/pay-merchant/v1/merchants/onboard", "/app/pay-merchant/v1/operator/merchant-data-holds"} {
		request := mustRequest(t, http.MethodPost, server.URL+path, []byte(`{}`), testOrigin)
		request.Header.Set("Authorization", "Bearer mcs_session.token")
		blocked, requestErr := http.DefaultClient.Do(request)
		if requestErr != nil {
			t.Fatal(requestErr)
		}
		blocked.Body.Close()
		if blocked.StatusCode != http.StatusNotFound {
			t.Fatalf("operator route %s escaped merchant boundary: %d", path, blocked.StatusCode)
		}
	}
}

func validPayAssertion(r *http.Request, body, key []byte) bool {
	return validProductAssertion(r, body, key, "pay", "ynx-pay-v1", "com.ynxweb4.pay", "ynxpay://wallet-auth/callback", payProductScopes)
}

func validProductAssertion(r *http.Request, body, key []byte, product, clientID, bundleID, callback string, scopes []string) bool {
	bodyHash := sha256.Sum256(body)
	fields := []string{
		"YNX_PRODUCT_GATEWAY_ASSERTION_V1", r.Method, r.URL.EscapedPath(), hex.EncodeToString(bodyHash[:]),
		r.Header.Get("X-YNX-Account"), r.Header.Get("X-YNX-Session-ID"), r.Header.Get("X-YNX-Device-ID"),
		r.Header.Get("X-YNX-Product"), r.Header.Get("X-YNX-Client"), r.Header.Get("X-YNX-Bundle"), r.Header.Get("X-YNX-Callback"), r.Header.Get("X-YNX-Chain"), r.Header.Get("X-YNX-Scopes"),
		r.Header.Get("X-YNX-Session-Binding"), r.Header.Get("X-YNX-Request-Digest"), r.Header.Get("X-YNX-Issued-At"), r.Header.Get("X-YNX-Expires-At"), r.Header.Get("X-YNX-Nonce"),
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(strings.Join(fields, "\n")))
	return r.Header.Get("X-YNX-Account") != "" && r.Header.Get("X-YNX-Product") == product && r.Header.Get("X-YNX-Client") == clientID && r.Header.Get("X-YNX-Bundle") == bundleID && r.Header.Get("X-YNX-Callback") == callback && r.Header.Get("X-YNX-Scopes") == strings.Join(scopes, " ") && hmac.Equal([]byte(r.Header.Get("X-YNX-Gateway-Signature")), []byte(hex.EncodeToString(mac.Sum(nil))))
}
