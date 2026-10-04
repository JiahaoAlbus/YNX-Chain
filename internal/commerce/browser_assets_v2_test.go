//go:build commerce_v2

package commerce

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	v2 "github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
)

// Controlled static delivery checks. No Wallet approval, Host, key registration,
// external network request, real account mapping or production acceptance.
func TestCommerceBuyerStaticGatewayPolicy(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "commerce.json"))
	if err != nil {
		t.Fatal(err)
	}
	assets := http.FS(fstest.MapFS{"index.html": {Data: []byte(`<!doctype html><base href="/shop/"><script src="app.js"></script>`)}, "app.js": {Data: []byte("export const staticAsset = true;")}})
	cfg := ServerConfig{BuyerAssets: assets}
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	web, err := NewCommerceCombinedWebV2Server(store, cfg, "controlled", key, bytes.Repeat([]byte{7}, 32), nil, func(_ *http.Request, _ v2.Session, _ v2.BrowserGrant, _ string) (func() error, error) {
		return nil, ErrUnauthorized
	})
	if err != nil {
		t.Fatal(err)
	}
	legacy := NewServer(store, cfg)
	native, err := NewCommerceNativeBuyerV2Server(store, cfg, "android", "controlled", key, nil, func(_ context.Context, _ v2.Session) (func() error, error) { return nil, ErrUnauthorized })
	if err != nil {
		t.Fatal(err)
	}
	policies := map[string]string{}
	for name, server := range map[string]*Server{"combined-web": web, "legacy": legacy, "native": native} {
		t.Run(name, func(t *testing.T) {
			response := httptest.NewRecorder()
			server.Handler().ServeHTTP(response, httptest.NewRequest("GET", "https://shop.ynxweb4.com/shop/", nil))
			if response.Code != 200 {
				t.Fatal(response.Code, response.Body.String())
			}
			if !strings.Contains(response.Body.String(), "/shop/") {
				t.Fatal("static Buyer shell missing")
			}
			want := "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'"
			if name == "combined-web" {
				want += " https://wallet-auth.ynxweb4.com"
			}
			want += "; img-src 'self' data: https:"
			if got := response.Header().Get("Content-Security-Policy"); got != want {
				t.Fatalf("unexpected browser connection policy: %q", got)
			}
			policies[name] = response.Header().Get("Content-Security-Policy")
			if response.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("private response caching policy changed")
			}
			asset := httptest.NewRecorder()
			server.Handler().ServeHTTP(asset, httptest.NewRequest("GET", "https://shop.ynxweb4.com/shop/app.js", nil))
			if asset.Code != 200 || !strings.Contains(asset.Body.String(), "staticAsset") {
				t.Fatal("original mounted script unavailable")
			}
		})
	}
	if path := os.Getenv("YNX_COMMERCE_CSP_READBACK"); path != "" && !t.Failed() {
		raw, err := json.Marshal(policies)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
}
