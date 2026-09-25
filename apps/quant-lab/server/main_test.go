package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/quantlab"
)

func TestQuantHTMLNoStoreAndVersionedAssets(t *testing.T) {
	web := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/wallet-auth/callback" || r.URL.Path == "/wallet-action/callback" {
			http.ServeFile(w, r, "../web/index.html")
			return
		}
		http.FileServer(http.Dir("../web")).ServeHTTP(w, r)
	})
	for _, route := range []string{"/", "/index.html", "/wallet-auth/callback", "/wallet-action/callback"} {
		res := httptest.NewRecorder()
		headers(web).ServeHTTP(res, httptest.NewRequest(http.MethodGet, route, nil))
		if res.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("Quant HTML route %s cache policy=%q", route, res.Header().Get("Cache-Control"))
		}
	}
	for _, name := range []string{"wallet-auth.js", "i18n.js", "app.js", "styles.css"} {
		body, err := os.ReadFile("../web/" + name)
		if err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(body)
		res := httptest.NewRecorder()
		headers(http.FileServer(http.Dir("../web"))).ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/"+name+"?v="+hex.EncodeToString(digest[:]), nil))
		if res.Code != http.StatusOK || !bytes.Equal(res.Body.Bytes(), body) {
			t.Fatalf("versioned Quant asset %s status=%d", name, res.Code)
		}
	}
}

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
