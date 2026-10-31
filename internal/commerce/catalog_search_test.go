package commerce

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestP0709CatalogPaginationVisibilityAndCheckoutFlow(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	_, owner := actor(t, 221)
	_, buyer := actor(t, 222)
	store, product := setupCatalog(t, s, owner, 1)
	draft, err := s.CreateProduct(owner, CreateProductInput{StoreID: store.ID, Title: "Field extra", Description: "matching kit", Category: "outdoor", Media: product.Media, IdempotencyKey: "search-catalog-second", Variants: []Variant{{Name: "a", SKU: "extra-a", PriceYNXT: 30, Inventory: 2}, {Name: "b", SKU: "extra-b", PriceYNXT: 40, Inventory: 2}, {Name: "empty", SKU: "extra-empty", PriceYNXT: 50, Inventory: 0}}})
	if err != nil {
		t.Fatal(err)
	}
	page, err := s.SearchCatalog("field", "outdoor", "", 10)
	if err != nil || len(page.Items) != 1 {
		t.Fatal("draft visible", page, err)
	}
	if _, err = s.PublishProduct(owner, draft.ID); err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	cursor := ""
	for {
		page, err = s.SearchCatalog("FIELD", "outdoor", cursor, 1)
		if err != nil || len(page.Items) != 1 {
			t.Fatal(page, err)
		}
		item := page.Items[0]
		key := item.ProductID + "/" + item.VariantID
		if seen[key] || item.Available == "0" || item.ProductID == "" {
			t.Fatal("duplicate or unavailable SKU", item)
		}
		seen[key] = true
		if page.NextCursor == "" {
			break
		}
		cursor = page.NextCursor
		// Continuation survives restart without a hidden cursor/session table.
		s, err = Open(path)
		if err != nil {
			t.Fatal(err)
		}
	}
	if len(seen) != 3 {
		t.Fatal("page boundary dropped a SKU", seen)
	}
	// Search is descriptive. The existing cart CAS/order transaction alone
	// reserves the actual current SKU, consumes the cart and freezes its price.
	in := orderInput(store, product, "search-checkout-order")
	cart, err := s.SaveCartRevision(buyer, in.Items, nil)
	if err != nil {
		t.Fatal(err)
	}
	in.CartRevision = &cart.Revision
	order, err := s.CreateOrder(buyer, in)
	if err != nil {
		t.Fatal(err)
	}
	again, err := s.CreateOrder(buyer, in)
	if err != nil || again.ID != order.ID {
		t.Fatal("checkout replay created order", again, err)
	}
	view, err := s.ReadScopedOrder(buyer, "buyer", order.ID, nil, "")
	if err != nil || view.Data["status"] != "payment_pending" || view.Data["totalYNXT"] != "25" {
		t.Fatal(view, err)
	}
	page, err = s.SearchCatalog("field", "outdoor", "", 10)
	if err != nil || len(page.Items) != 2 {
		t.Fatal("reserved final unit stayed available", page, err)
	}
	if _, err = s.UnpublishProduct(owner, draft.ID); err != nil {
		t.Fatal(err)
	}
	page, err = s.SearchCatalog("field", "outdoor", "", 10)
	if err != nil || len(page.Items) != 0 {
		t.Fatal("unpublished listing visible", page, err)
	}
}

func TestP0709CatalogRejectsChangedQueryAndSnapshot(t *testing.T) {
	s, _ := Open("")
	_, owner := actor(t, 223)
	store, product := setupCatalog(t, s, owner, 5)
	_, err := s.CreateProduct(owner, CreateProductInput{StoreID: store.ID, Title: "Hidden field", IdempotencyKey: "hidden-search-product", Variants: []Variant{{Name: "hidden", SKU: "hidden-sku", PriceYNXT: 1, Inventory: 1}}})
	if err != nil {
		t.Fatal(err)
	}
	// Add a second public SKU using the normal owner catalog update.
	variants := append([]Variant(nil), product.Variants...)
	variants = append(variants, Variant{Name: "second", SKU: "second", PriceYNXT: 35, Inventory: 5})
	product, err = s.UpdateProduct(owner, product.ID, UpdateProductInput{Title: product.Title, Description: product.Description, Category: product.Category, Media: product.Media, Variants: variants, IdempotencyKey: "search-add-second-sku"})
	if err != nil {
		t.Fatal(err)
	}
	page, err := s.SearchCatalog("field", "", "", 1)
	if err != nil || page.NextCursor == "" {
		t.Fatal(page, err)
	}
	if _, err = s.SearchCatalog("other", "", page.NextCursor, 1); !errors.Is(err, ErrConflict) {
		t.Fatal("cursor changed query", err)
	}
	// A reservation changes visibility/stock and must invalidate old pages.
	_, buyer := actor(t, 224)
	if _, err = s.CreateOrder(buyer, orderInput(store, product, "catalog-reservation")); err != nil {
		t.Fatal(err)
	}
	if _, err = s.SearchCatalog("field", "", page.NextCursor, 1); !errors.Is(err, ErrConflict) {
		t.Fatal("mixed snapshot pages", err)
	}
	for _, cursor := range []string{"!", strings.Repeat("x", 2049)} {
		if _, err = s.SearchCatalog("", "", cursor, 1); err == nil {
			t.Fatal("invalid cursor", cursor)
		}
	}
	for _, limit := range []int{0, -1, 101} {
		if _, err = s.SearchCatalog("", "", "", limit); err == nil {
			t.Fatal("unbounded search", limit)
		}
	}
}

func TestP0709CatalogPublicHTTPReturnsNoPrivateHistory(t *testing.T) {
	s, _ := Open("")
	_, owner := actor(t, 225)
	setupCatalog(t, s, owner, 1)
	for _, v2 := range []bool{false, true} {
		cfg := ServerConfig{}
		if v2 {
			cfg.businessV2 = controlledBusinessVerifier{fence: func() error { return ErrUnauthorized }}
		}
		server := NewServer(s, cfg)
		r := httptest.NewRequest("GET", "/api/catalog/search?q=field&limit=1", nil)
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, r)
		var page CatalogPage
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &page) != nil || len(page.Items) != 1 {
			t.Fatal(v2, w.Code, w.Body.String())
		}
		for _, private := range []string{owner, "EditHistory", "Actor", "RequestHash", "SettlementAccount"} {
			if bytes.Contains(w.Body.Bytes(), []byte(private)) {
				t.Fatal("private catalog metadata leaked", private)
			}
		}
	}
}
