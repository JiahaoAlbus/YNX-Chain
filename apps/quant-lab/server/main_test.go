package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/quantlab"
)

func TestFinanceOwnerReadRoutePreservesCanonicalSignedPath(t *testing.T) {
	mux := http.NewServeMux()
	registerFinanceOwnerRead(mux, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != quantlab.FinanceReadRoute {
			t.Fatalf("route was rewritten to %q", r.URL.Path)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, quantlab.FinanceReadRoute, nil))
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status=%d", recorder.Code)
	}
}
