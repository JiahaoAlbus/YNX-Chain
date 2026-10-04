package main

import (
	"github.com/JiahaoAlbus/YNX-Chain/internal/commerce"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestActualShopdOriginalPublicEngineAndClosedRoles(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{"buyer", "seller", "merchant"} {
		if e := os.Mkdir(filepath.Join(dir, name), 0700); e != nil {
			t.Fatal(e)
		}
		if e := os.WriteFile(filepath.Join(dir, name, "index.html"), []byte("original "+name), 0600); e != nil {
			t.Fatal(e)
		}
	}
	store, e := commerce.Open(filepath.Join(dir, "state.json"))
	if e != nil {
		t.Fatal(e)
	}
	original := commerce.NewServer(store, commerce.ServerConfig{}).Handler()
	h, e := composeOriginalCommerceWeb(filepath.Join(dir, "buyer"), filepath.Join(dir, "seller"), filepath.Join(dir, "merchant"), original, nil, nil, nil, nil, nil, nil)
	if e != nil {
		t.Fatal(e)
	}
	for _, item := range []struct {
		method, url string
		status      int
	}{{"GET", "https://shop.ynxweb4.com/", 200}, {"GET", "https://shop.ynxweb4.com/seller/", 200}, {"GET", "https://pay.ynxweb4.com/merchant/", 200}, {"GET", "https://shop.ynxweb4.com/api/products", 200}, {"POST", "https://shop.ynxweb4.com/api/orders/id/transition-intent-lookup", 503}, {"GET", "https://shop.ynxweb4.com/api/profile", 503}, {"GET", "https://shop.ynxweb4.com/api/seller/stores", 503}, {"POST", "https://pay.ynxweb4.com/v1/merchant/sessions", 503}, {"GET", "https://shop.ynxweb4.com/api/sso/account", 503}} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(item.method, item.url, strings.NewReader("{}")))
		if w.Code != item.status {
			t.Fatalf("%s %s: %d %s", item.method, item.url, w.Code, w.Body.String())
		}
	}
}
