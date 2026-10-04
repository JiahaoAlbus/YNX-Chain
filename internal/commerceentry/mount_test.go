package commerceentry

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestOriginalThreeStaticEntriesAndCallback(t *testing.T) {
	files := fstest.MapFS{"index.html": {Data: []byte(`<base href="/shop/">original`)}, "app.js": {Data: []byte("original app")}}
	h, e := New(Inputs{BuyerAssets: files, SellerAssets: files, MerchantAssets: files})
	if e != nil {
		t.Fatal(e)
	}
	for _, u := range []string{"https://shop.ynxweb4.com/", "https://shop.ynxweb4.com/shop/", "https://shop.ynxweb4.com/shop/app.js", "https://shop.ynxweb4.com/seller/", "https://shop.ynxweb4.com/wallet-auth/callback?state=original&response=opaque", "https://pay.ynxweb4.com/merchant/", "https://pay.ynxweb4.com/merchant/wallet-auth/callback?state=original"} {
		r := httptest.NewRequest("GET", u, nil)
		before := r.URL.String()
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 200 || r.URL.String() != before {
			t.Fatalf("%s code%d url%s", u, w.Code, r.URL)
		}
	}
}
func TestOriginalRoleHandlersNeverBorrowBuyer(t *testing.T) {
	files := fstest.MapFS{"index.html": {Data: []byte("original")}}
	calls := 0
	buyer := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(418) })
	h, _ := New(Inputs{BuyerAssets: files, SellerAssets: files, Buyer: buyer})
	for _, u := range []string{"https://shop.ynxweb4.com/api/seller/stores", "https://pay.ynxweb4.com/v1/merchant/state"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("POST", u, strings.NewReader("{}")))
		if w.Code != 503 {
			t.Fatal(w.Code)
		}
	}
	if calls != 0 {
		t.Fatal("role borrowed Buyer")
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "https://shop.ynxweb4.com/api/orders/x/transition-intent-lookup", strings.NewReader("{}")))
	if calls != 1 || w.Code != 418 {
		t.Fatal("original Buyer route lost")
	}
}
func TestStaticCannotBecomeGrantAndExactAliasesReject(t *testing.T) {
	files := fstest.MapFS{"index.html": {Data: []byte("original")}}
	h, _ := New(Inputs{BuyerAssets: files, SellerAssets: files})
	for _, u := range []string{"https://shop.ynxweb4.com/api/profile", "https://shop.ynxweb4.com/api/sso/account"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", u, nil))
		if w.Code != 503 {
			t.Fatal(w.Code)
		}
	}
	for _, u := range []string{"https://foreign.example/shop/", "http://shop.ynxweb4.com/shop/", "https://shop.ynxweb4.com/wallet-auth/%63allback", "https://shop.ynxweb4.com/shop/../secret", "https://shop.ynxweb4.com/shop/.env"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", u, nil))
		if w.Code == 200 {
			t.Fatal("alias accepted", u)
		}
	}
}
