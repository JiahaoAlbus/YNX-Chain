package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/commerce"
)

func TestShopNativeAPIOriginalCatalogWithoutWebOrPrivateAuthority(t *testing.T) {
	store, err := commerce.Open("")
	if err != nil {
		t.Fatal(err)
	}
	h := composeOriginalNativeShopAPI(commerce.NewServer(store, commerce.ServerConfig{}).Handler(), nil)
	for _, item := range []struct {
		method, path string
		status       int
	}{{"GET", "/api/products", 200}, {"GET", "/health", 200}, {"GET", "/api/orders/id/native-pay-intent", 503}, {"GET", "/api/profile", 503}, {"POST", "/api/orders", 503}, {"GET", "/api/seller/stores", 404}, {"GET", "/api/auth/config", 404}, {"GET", "/", 404}} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(item.method, "https://shop-api.ynxweb4.com"+item.path, nil))
		if w.Code != item.status {
			t.Fatal(item, w.Code, w.Body.String())
		}
	}
}

func TestShopNativeAPIOnlyDispatchesExactOriginalBuyer(t *testing.T) {
	calls := 0
	buyer := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Host != "shop-api.ynxweb4.com" || r.Header.Get("X-Original-Proof") != "held" {
			t.Fatal("original request changed")
		}
		w.WriteHeader(418)
	})
	h := composeOriginalNativeShopAPI(nil, buyer)
	request := httptest.NewRequest("GET", "https://shop-api.ynxweb4.com/api/orders/original/native-pay-intent", nil)
	request.Header.Set("X-Original-Proof", "held")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, request)
	if calls != 1 || w.Code != 418 {
		t.Fatal(calls, w.Code)
	}
	for _, u := range []string{"https://foreign.invalid/api/orders", "http://shop-api.ynxweb4.com/api/orders", "https://shop-api.ynxweb4.com/api/orders/../profile", "https://shop-api.ynxweb4.com/api/orders%2foriginal"} {
		w = httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", u, strings.NewReader("")))
		if w.Code != 400 || calls != 1 {
			t.Fatal(u, w.Code, calls)
		}
	}
}
