package commerce

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestSellerCheckoutOriginalOrderColdHTTP(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	_, seller := actor(t, 1)
	_, buyer := actor(t, 2)
	_, foreign := actor(t, 3)
	shop, product := setupCatalog(t, store, seller, 5)
	input := orderInput(shop, product, "seller-cold-original-order")
	cart, err := store.SaveCart(buyer, input.Items)
	if err != nil {
		t.Fatal(err)
	}
	input.CartRevision = &cart.Revision
	original, err := store.CreateOrder(buyer, input)
	if err != nil {
		t.Fatal(err)
	}
	read := func(store *Store, account, nonce string) (int, Order) {
		t.Helper()
		server := httptest.NewServer(NewServer(store, ServerConfig{businessV2: controlledBusinessVerifier{account: account, role: "seller"}}).Handler())
		defer server.Close()
		req, err := http.NewRequest(http.MethodGet, server.URL+"/api/seller/orders/"+original.ID, nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("X-QA-Business-Nonce", nonce)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var order Order
		if resp.StatusCode == http.StatusOK {
			if err := json.NewDecoder(resp.Body).Decode(&order); err != nil {
				t.Fatal(err)
			}
		}
		return resp.StatusCode, order
	}
	assertOriginal := func(status int, order Order) {
		t.Helper()
		if status != http.StatusOK || order.ID != original.ID || order.StoreID != shop.ID || order.Buyer != buyer || order.Status != "payment_pending" || order.InvoiceID != "" || order.PayIntentID != "" {
			t.Fatalf("incorrect original Seller order: status=%d order=%+v", status, order)
		}
	}
	status, got := read(store, seller, strings.Repeat("a", 43))
	assertOriginal(status, got)
	cold, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	status, got = read(cold, seller, strings.Repeat("b", 43))
	assertOriginal(status, got)
	status, _ = read(cold, foreign, strings.Repeat("c", 43))
	if status != http.StatusForbidden {
		t.Fatalf("foreign Seller read returned %d", status)
	}
	if len(cold.s.Orders) != 1 || len(cold.Cart(buyer).Items) != 0 {
		t.Fatal("Seller reads created another order or restored the consumed cart")
	}
}
