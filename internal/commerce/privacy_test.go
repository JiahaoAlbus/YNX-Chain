package commerce

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestBuyerDataExportAndDeletionPseudonymizeRetainedRecords(t *testing.T) {
	path := t.TempDir() + "/commerce.json"
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	_, owner := actor(t, 71)
	_, buyer := actor(t, 72)
	shop, product := setupCatalog(t, store, owner, 2)
	if _, err := store.SaveProfile(buyer, "Private Buyer", []Address{{Recipient: "Private Buyer", Line1: "1 Privacy Road", City: "Lisbon", Country: "PT"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveCart(buyer, []CartItem{{ProductID: product.ID, VariantID: product.Variants[0].ID, Quantity: 1}}); err != nil {
		t.Fatal(err)
	}
	order, err := store.CreateOrder(buyer, orderInput(shop, product, "privacy-order-0001"))
	if err != nil {
		t.Fatal(err)
	}

	before := store.ExportBuyerData(buyer)
	if before.SchemaVersion != 1 || before.Account != buyer || before.Profile.DisplayName != "Private Buyer" || len(before.Profile.Addresses) != 1 || len(before.Cart.Items) != 1 || len(before.Orders) != 1 {
		t.Fatalf("incomplete buyer export: %+v", before)
	}
	if _, err := store.DeleteBuyerData(buyer); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("active order deletion should fail closed, got %v", err)
	}
	if _, err := store.transition(buyer, "buyer", order.ID, "cancelled", nil, nil, nil, "privacy-cancel-0001"); err != nil {
		t.Fatal(err)
	}

	receipt, err := store.DeleteBuyerData(buyer)
	if err != nil {
		t.Fatal(err)
	}
	if !receipt.ProfileDeleted || !receipt.CartDeleted || receipt.OrdersPseudonymized != 1 || receipt.IdempotencyDeleted == 0 || receipt.ReceiptID == "" {
		t.Fatalf("unexpected deletion receipt: %+v", receipt)
	}

	reloaded, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if profile := reloaded.Profile(buyer); profile.DisplayName != "" || len(profile.Addresses) != 0 {
		t.Fatalf("profile retained after deletion: %+v", profile)
	}
	if cart := reloaded.Cart(buyer); len(cart.Items) != 0 {
		t.Fatalf("cart retained after deletion: %+v", cart)
	}
	if orders := reloaded.Orders(buyer, "buyer"); len(orders) != 0 {
		t.Fatalf("deleted account still owns orders: %+v", orders)
	}
	retained, err := reloaded.Order(owner, "seller", order.ID)
	if err != nil {
		t.Fatal(err)
	}
	if retained.Buyer == buyer || retained.Buyer == "" || retained.Address.Recipient != "" || retained.Address.Line1 != "" {
		t.Fatalf("retained order was not pseudonymized: %+v", retained)
	}
	for _, event := range retained.Timeline {
		if event.Actor == buyer {
			t.Fatalf("buyer identity retained in order timeline: %+v", event)
		}
	}
	for _, event := range reloaded.s.Audits {
		if event.Role == "buyer" && event.Actor == buyer {
			t.Fatalf("buyer identity retained in audit: %+v", event)
		}
	}
}

func TestPrivacyHTTPRequiresBuyerAndExactConfirmation(t *testing.T) {
	store, err := Open("")
	if err != nil {
		t.Fatal(err)
	}
	_, buyer := actor(t, 73)
	_, seller := actor(t, 74)
	if _, err := store.SaveProfile(buyer, "Export Me", nil); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServer(store, ServerConfig{Auth: testAuth{principals: map[string]Principal{
		"buyer-token":  principal(buyer, "buyer"),
		"seller-token": principal(seller, "seller"),
	}}}).Handler())
	defer server.Close()

	var exported BuyerDataExport
	requestJSON(t, server.Client(), http.MethodGet, server.URL+"/api/privacy/export", "buyer-token", nil, http.StatusOK, &exported)
	if exported.Account != buyer || exported.Profile.DisplayName != "Export Me" {
		t.Fatalf("bad HTTP export: %+v", exported)
	}
	requestJSON(t, server.Client(), http.MethodGet, server.URL+"/api/privacy/export", "seller-token", nil, http.StatusForbidden, nil)
	requestJSON(t, server.Client(), http.MethodPost, server.URL+"/api/privacy/delete", "buyer-token", map[string]string{"confirmation": "delete"}, http.StatusBadRequest, nil)

	var receipt BuyerDataDeletionReceipt
	requestJSON(t, server.Client(), http.MethodPost, server.URL+"/api/privacy/delete", "buyer-token", map[string]string{"confirmation": "DELETE_MY_SHOP_DATA"}, http.StatusOK, &receipt)
	if !receipt.ProfileDeleted || receipt.ReceiptID == "" {
		t.Fatalf("bad HTTP deletion receipt: %+v", receipt)
	}
}
