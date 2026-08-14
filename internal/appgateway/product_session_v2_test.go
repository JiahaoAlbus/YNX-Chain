package appgateway

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestProductSessionV2RoutesPrecedeFallbackAndPreserveExactBoundary(t *testing.T) {
	_, chatServer := startUpstream(t, "chat", "X-YNX-Chat-Key", testChatKey)
	_, squareServer := startUpstream(t, "square", "X-YNX-Square-Key", testSquareKey)
	var calls int
	walletServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		body, _ := io.ReadAll(r.Body)
		if r.Method != http.MethodPost || r.URL.Path != "/v2/product-sessions/challenge" || string(body) != `{}` || r.Header.Get("X-Request-ID") != "req_product_session_123" || r.Header.Get("X-YNX-Product-Session-Proof-V2") != "proof-v2" {
			t.Fatalf("substituted v2 request: method=%s path=%s body=%q request=%q proof=%q", r.Method, r.URL.Path, body, r.Header.Get("X-Request-ID"), r.Header.Get("X-YNX-Product-Session-Proof-V2"))
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("X-Request-ID", "req_product_session_123")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"ok":false,"requestId":"req_product_session_123","schemaVersion":2}`))
	}))
	t.Cleanup(walletServer.Close)
	cfg := testConfig(t, chatServer.URL, squareServer.URL, 20)
	cfg.WalletURL = walletServer.URL
	gateway, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServer(gateway).Handler())
	t.Cleanup(server.Close)
	version, err := http.Get(server.URL + "/app/version")
	if err != nil {
		t.Fatal(err)
	}
	version.Body.Close()
	if version.StatusCode != http.StatusOK {
		t.Fatalf("version status=%d", version.StatusCode)
	}

	request, _ := http.NewRequest(http.MethodPost, server.URL+"/v2/product-sessions/challenge", strings.NewReader(`{}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Request-ID", "req_product_session_123")
	request.Header.Set("X-YNX-Product-Session-Proof-V2", "proof-v2")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusBadRequest || response.Header.Get("X-Request-ID") != "req_product_session_123" {
		t.Fatalf("v2 response status=%d request=%q", response.StatusCode, response.Header.Get("X-Request-ID"))
	}

	unknown, _ := http.Post(server.URL+"/v2/product-sessions/unknown", "application/json", strings.NewReader(`{}`))
	unknown.Body.Close()
	if unknown.StatusCode != http.StatusNotFound || calls != 1 {
		t.Fatalf("unknown route status=%d upstream calls=%d", unknown.StatusCode, calls)
	}
}
