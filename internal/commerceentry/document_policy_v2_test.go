//go:build commerce_v2

package commerceentry

import (
	"bytes"
	"crypto/ed25519"
	"github.com/JiahaoAlbus/YNX-Chain/internal/commerce"
	v2 "github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
)

func TestActualOriginalDocumentPolicyForEntryAndCallback(t *testing.T) {
	store, e := commerce.Open(filepath.Join(t.TempDir(), "state.json"))
	if e != nil {
		t.Fatal(e)
	}
	// Public local constructor/header check only. The actor seam is never called;
	// no request receives a private session, proof, backend role or effect.
	bind := func(*http.Request, v2.Session, v2.BrowserGrant, string) (func() error, error) {
		t.Fatal("actor must not be used for document policy")
		return nil, nil
	}
	key := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{7}, 32))
	buyer, e := commerce.NewCommerceCombinedWebV2Server(store, commerce.ServerConfig{}, "source-only-csp", key, bytes.Repeat([]byte{9}, 32), nil, bind)
	if e != nil {
		t.Fatal(e)
	}
	seller, e := commerce.NewCommerceCombinedSellerWebV2Server(store, commerce.ServerConfig{}, "source-only-csp", key, bytes.Repeat([]byte{9}, 32), nil, bind)
	if e != nil {
		t.Fatal(e)
	}
	files := fstest.MapFS{"index.html": {Data: []byte("original")}}
	h, e := New(Inputs{BuyerAssets: files, SellerAssets: files, BuyerDocuments: buyer, SellerDocuments: seller})
	if e != nil {
		t.Fatal(e)
	}
	for _, u := range []string{"https://shop.ynxweb4.com/", "https://shop.ynxweb4.com/wallet-auth/callback?state=original", "https://shop.ynxweb4.com/seller/"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", u, nil))
		policy := w.Header().Get("Content-Security-Policy")
		if w.Code != 200 || policy != buyer.OriginalCommerceDocumentPolicy() || strings.Count(policy, "https://wallet-auth.ynxweb4.com") != 1 {
			t.Fatal(w.Code, policy)
		}
	}
	legacy := commerce.NewServer(store, commerce.ServerConfig{})
	h, _ = New(Inputs{BuyerAssets: files, SellerAssets: files, BuyerDocuments: legacy})
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "https://shop.ynxweb4.com/", nil))
	if strings.Contains(w.Header().Get("Content-Security-Policy"), "wallet-auth") {
		t.Fatal("legacy document widened")
	}
}
