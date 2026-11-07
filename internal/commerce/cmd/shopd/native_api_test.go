package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/commerce"
)

func TestShopNativeAPINotificationOnlyUsesOriginalReceiverWithoutBuyerFallback(t *testing.T) {
	store, err := commerce.Open("")
	if err != nil {
		t.Fatal(err)
	}
	secret := []byte(strings.Repeat("PUBLIC-", 8))
	cfg := commerce.ServerConfig{NativePayNotificationReceivers: []commerce.NativePayNotificationReceiver{{MerchantID: "mer_original", StoreID: "store_original", SecretVersion: 1, Secret: secret}}}
	buyerCalls := 0
	buyer := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { buyerCalls++; w.WriteHeader(418) })
	h := composeOriginalNativeShopAPI(commerce.NewServer(store, cfg).Handler(), buyer, nil)
	body := `{"event":"native.invoice.invoice_settle","objectId":"0x` + strings.Repeat("a", 64) + `","merchantId":"mer_original","occurredAt":"2026-01-01T00:00:00Z"}`
	hash := sha256.Sum256([]byte(body))
	digest := hex.EncodeToString(hash[:])
	stamp := time.Now().UTC().Format(time.RFC3339Nano)
	event := "whd_" + strings.Repeat("a", 20)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(strings.Join([]string{"YNX_PAY_WEBHOOK_V1", event, stamp, digest}, "\n")))
	r := httptest.NewRequest("POST", "https://shop-api.ynxweb4.com/api/pay/notifications/native", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-YNX-Event-ID", event)
	r.Header.Set("X-YNX-Delivery-ID", event)
	r.Header.Set("X-YNX-Timestamp", stamp)
	r.Header.Set("X-YNX-Payload-SHA256", digest)
	r.Header.Set("X-YNX-Signature-Version", "1")
	r.Header.Set("X-YNX-Signature", "v1="+hex.EncodeToString(mac.Sum(nil)))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 202 || buyerCalls != 0 {
		t.Fatal(w.Code, w.Body.String(), buyerCalls)
	}
	r = httptest.NewRequest("POST", "https://shop-api.ynxweb4.com/api/pay/notifications/native", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 401 || buyerCalls != 0 {
		t.Fatal("bad MAC fell through to Buyer", w.Code, buyerCalls)
	}
}

func TestShopNativeAPIOriginalCatalogWithoutWebOrPrivateAuthority(t *testing.T) {
	store, err := commerce.Open("")
	if err != nil {
		t.Fatal(err)
	}
	h := composeOriginalNativeShopAPI(commerce.NewServer(store, commerce.ServerConfig{}).Handler(), nil, nil)
	for _, item := range []struct {
		method, path string
		status       int
	}{{"GET", "/api/products", 200}, {"GET", "/health", 200}, {"GET", "/api/orders/id/native-pay-intent", 503}, {"GET", "/api/profile", 503}, {"POST", "/api/orders", 503}, {"GET", "/api/seller/stores", 503}, {"GET", "/api/auth/config", 404}, {"GET", "/", 404}} {
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
	h := composeOriginalNativeShopAPI(nil, buyer, nil)
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

func TestShopNativeAPIFixedInventorySellerNeverFallsBackToBuyer(t *testing.T) {
	buyerCalls, sellerCalls := 0, 0
	buyer := http.HandlerFunc(func(http.ResponseWriter, *http.Request) { buyerCalls++ })
	seller := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sellerCalls++
		if r.Header.Get("X-Original-Proof") != "held" || r.Host != "shop-api.ynxweb4.com" {
			t.Fatal("original protected request changed")
		}
		w.WriteHeader(403)
	})
	h := composeOriginalNativeShopAPI(nil, buyer, seller)
	for _, p := range []string{"/api/seller/products/product_original/native-listing", "/api/seller/listing/read", "/api/seller/inventory/batch", "/api/seller/mutations/lookup", "/api/seller/inventory/read", "/api/orders/order_original/return-receipts", "/api/orders/order_original/return-restock", "/api/seller/orders/order_original/warehouse"} {
		r := httptest.NewRequest("POST", "https://shop-api.ynxweb4.com"+p, strings.NewReader(`{"original":"DATA"}`))
		r.Header.Set("X-Original-Proof", "held")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 403 || buyerCalls != 0 {
			t.Fatal("seller denial fell through", w.Code, buyerCalls)
		}
	}
	if sellerCalls != 8 {
		t.Fatal(sellerCalls)
	}
	for _, p := range []string{"/api/seller/products/product_original/native-listing", "/api/seller/listing/read", "/api/seller/inventory/batch", "/api/seller/mutations/lookup", "/api/seller/inventory/read", "/api/orders/order_original/return-receipts", "/api/orders/order_original/return-restock", "/api/seller/orders/order_original/warehouse"} {
		method := "POST"
		w := httptest.NewRecorder()
		composeOriginalNativeShopAPI(nil, buyer, nil).ServeHTTP(w, httptest.NewRequest(method, "https://shop-api.ynxweb4.com"+p, nil))
		if w.Code != 503 || buyerCalls != 0 {
			t.Fatal("absent Seller authority fallback", w.Code, buyerCalls)
		}
	}
}

func TestShopNativeAPICompleteSellerSurfaceKeepsExactRoleAndNoFallback(t *testing.T) {
	buyerCalls, sellerCalls := 0, 0
	buyer := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { buyerCalls++; w.WriteHeader(418) })
	seller := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sellerCalls++
		if r.Header.Get("X-Original-Proof") != "held" || r.RequestURI != "https://shop-api.ynxweb4.com"+r.URL.Path {
			t.Fatal("signed original request changed", r.RequestURI)
		}
		w.WriteHeader(403)
	})
	h := composeOriginalNativeShopAPI(nil, buyer, seller)
	entries := []struct{ method, path string }{
		{"GET", "/api/seller/stores"}, {"GET", "/api/seller/products"}, {"GET", "/api/seller/orders"}, {"GET", "/api/seller/orders/order_original"}, {"GET", "/api/seller/audit"}, {"GET", "/api/seller/settlements"}, {"GET", "/api/seller/invitations"}, {"GET", "/api/seller/stores/store_original/roles"},
		{"POST", "/api/seller/stores"}, {"POST", "/api/seller/products"}, {"POST", "/api/seller/stores/store_original/native-activate"}, {"POST", "/api/seller/stores/store_original/native-profile"}, {"POST", "/api/seller/stores/store_original/native-invitations"}, {"POST", "/api/seller/stores/store_original/roles/account_original/native-revoke"}, {"POST", "/api/seller/stores/store_original/invitations/invitation_original/native-accept"}, {"POST", "/api/seller/stores/store_original/invitations/invitation_original/native-cancel"}, {"POST", "/api/seller/orders/order_original/transition"},
	}
	for _, item := range entries {
		r := httptest.NewRequest(item.method, "https://shop-api.ynxweb4.com"+item.path, strings.NewReader(""))
		r.Header.Set("X-Original-Proof", "held")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 403 || buyerCalls != 0 {
			t.Fatal("seller denial fell back to buyer", item, w.Code, buyerCalls)
		}
		w = httptest.NewRecorder()
		composeOriginalNativeShopAPI(nil, buyer, nil).ServeHTTP(w, r)
		if w.Code != 503 || buyerCalls != 0 {
			t.Fatal("missing Seller authority fell back", item, w.Code, buyerCalls)
		}
	}
	if sellerCalls != len(entries) {
		t.Fatal(sellerCalls)
	}
	// The unambiguous Buyer path still belongs to the original Buyer verifier.
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "https://shop-api.ynxweb4.com/api/orders", nil))
	if w.Code != 418 || buyerCalls != 1 {
		t.Fatal(w.Code, buyerCalls)
	}
}
