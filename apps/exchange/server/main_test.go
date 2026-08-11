package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestWalletGatewayProxyAllowsOnlyCanonicalSessionCompletion(t *testing.T) {
	if got := httptest.NewRecorder(); func() bool {
		handler := walletGatewayProxy("")
		handler.ServeHTTP(got, httptest.NewRequest(http.MethodPost, "/wallet-gateway/v1/wallet/sessions/complete", nil))
		return got.Code == http.StatusServiceUnavailable
	}() == false {
		t.Fatal("unconfigured Gateway proxy must fail closed")
	}

	recorder := httptest.NewRecorder()
	handler := walletGatewayProxy("https://wallet-auth.example.invalid")
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/wallet-gateway/health", nil))
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("unexpected disallowed proxy result: status=%d", recorder.Code)
	}
}

func TestAdmissionRateLimitAndTrustedForwardedClient(t *testing.T) {
	gate := newAdmission(2, 2, time.Minute)
	handler := gate.wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	for attempt := 0; attempt < 3; attempt++ {
		req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
		req.RemoteAddr = "127.0.0.1:1234"
		req.Header.Set("X-Forwarded-For", "203.0.113.8")
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		want := http.StatusNoContent
		if attempt == 2 {
			want = http.StatusTooManyRequests
		}
		if res.Code != want {
			t.Fatalf("attempt %d: got %d want %d", attempt, res.Code, want)
		}
	}
}

func TestRequestClientIgnoresUntrustedForwardedHeader(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "198.51.100.9:4321"
	req.Header.Set("X-Forwarded-For", "203.0.113.10")
	if got := requestClient(req); got != "198.51.100.9" {
		t.Fatalf("got %q", got)
	}
}

func TestRequestClientUsesRightmostAddressFromTrustedProxy(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "127.0.0.1:4321"
	req.Header.Set("X-Forwarded-For", "203.0.113.10, 198.51.100.9")
	if got := requestClient(req); got != "198.51.100.9" {
		t.Fatalf("trusted proxy must use its appended direct client address, got %q", got)
	}

	req.Header.Set("X-Forwarded-For", "203.0.113.10, not-an-address")
	if got := requestClient(req); got != "127.0.0.1" {
		t.Fatalf("malformed authoritative hop must fail closed to the proxy address, got %q", got)
	}
}
