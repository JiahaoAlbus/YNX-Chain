package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestAdmissionSeparatesTrustedForwardedClients(t *testing.T) {
	gate := newAdmission(2, 2, time.Minute)
	handler := gate.wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	for i := 0; i < 3; i++ {
		req := httptest.NewRequest(http.MethodGet, "/health", nil)
		req.RemoteAddr = "127.0.0.1:1234"
		req.Header.Set("X-Forwarded-For", "203.0.113.8")
		out := httptest.NewRecorder()
		handler.ServeHTTP(out, req)
		want := http.StatusNoContent
		if i == 2 {
			want = http.StatusTooManyRequests
		}
		if out.Code != want {
			t.Fatalf("attempt %d: got %d want %d", i, out.Code, want)
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
