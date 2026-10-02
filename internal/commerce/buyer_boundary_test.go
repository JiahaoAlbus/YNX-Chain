package commerce

import (
	"errors"
	"math"
	"path/filepath"
	"testing"
)

func TestBuyerProfileAndCartAreDetachedFromInputsAndReadbacks(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	_, owner := actor(t, 1)
	_, buyer := actor(t, 2)
	_, other := actor(t, 3)
	_, p := setupCatalog(t, s, owner, 40)
	addresses := []Address{{Recipient: "Buyer", Line1: "Original", Country: "CN"}}
	saved, err := s.SaveProfile(buyer, "Buyer", addresses)
	if err != nil {
		t.Fatal(err)
	}
	addresses[0].Line1 = "input changed"
	saved.Addresses[0].Line1 = "response changed"
	view := s.Profile(buyer)
	view.Addresses[0].Line1 = "readback changed"
	if got := s.Profile(buyer).Addresses[0].Line1; got != "Original" {
		t.Fatal(got)
	}
	items := []CartItem{{ProductID: p.ID, VariantID: p.Variants[0].ID, Quantity: 2}}
	cart, err := s.SaveCart(buyer, items)
	if err != nil {
		t.Fatal(err)
	}
	items[0].Quantity = 9
	cart.Items[0].Quantity = 8
	viewCart := s.Cart(buyer)
	viewCart.Items[0].Quantity = 7
	if got := s.Cart(buyer).Items[0].Quantity; got != 2 {
		t.Fatal(got)
	}
	if len(s.Profile(other).Addresses) != 0 || len(s.Cart(other).Items) != 0 {
		t.Fatal("buyer records leaked")
	}
	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if reopened.Profile(buyer).Addresses[0].Line1 != "Original" || reopened.Cart(buyer).Items[0].Quantity != 2 {
		t.Fatal("stored records changed")
	}
}

func TestInvalidCartCannotReplacePreviouslySavedCart(t *testing.T) {
	s, _ := Open("")
	_, owner := actor(t, 1)
	_, buyer := actor(t, 2)
	_, another := actor(t, 3)
	_, p := setupCatalog(t, s, owner, 40)
	_, q := setupCatalog(t, s, another, 40)
	item := CartItem{ProductID: p.ID, VariantID: p.Variants[0].ID, Quantity: 2}
	if _, err := s.SaveCart(buyer, []CartItem{item}); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range [][]CartItem{{item, item}, {item, {ProductID: q.ID, VariantID: q.Variants[0].ID, Quantity: 1}}} {
		if _, err := s.SaveCart(buyer, invalid); err == nil {
			t.Fatal("invalid cart accepted")
		}
		got := s.Cart(buyer)
		if len(got.Items) != 1 || got.Items[0] != item {
			t.Fatal("invalid request changed original cart")
		}
	}
}

func TestOrderAccumulationOverflowDoesNotReserveOrCreateOrder(t *testing.T) {
	s, _ := Open("")
	_, owner := actor(t, 1)
	_, buyer := actor(t, 2)
	st, p := setupCatalog(t, s, owner, 40)
	// Legacy or imported records may have large integer prices. Every line fits
	// the original per-line bound while their sum exceeds the chain amount type.
	p.Variants = []Variant{{ID: "large-a", Name: "A", SKU: "A", PriceYNXT: math.MaxInt64 / 3, Inventory: 10}, {ID: "large-b", Name: "B", SKU: "B", PriceYNXT: math.MaxInt64 / 3, Inventory: 10}, {ID: "large-c", Name: "C", SKU: "C", PriceYNXT: math.MaxInt64 / 3, Inventory: 10}, {ID: "large-d", Name: "D", SKU: "D", PriceYNXT: math.MaxInt64 / 3, Inventory: 10}}
	s.s.Products[p.ID] = p
	items := []CartItem{}
	for _, v := range p.Variants {
		items = append(items, CartItem{ProductID: p.ID, VariantID: v.ID, Quantity: 1})
	}
	_, err := s.CreateOrder(buyer, OrderInput{StoreID: st.ID, Items: items, Address: Address{Recipient: "Buyer", Line1: "Address", Country: "CN"}, IdempotencyKey: "overflow-order-0001"})
	if err == nil {
		t.Fatal("overflowing order accepted")
	}
	if len(s.s.Orders) != 0 {
		t.Fatal("failed order created records")
	}
	for _, v := range s.s.Products[p.ID].Variants {
		if v.Reserved != 0 {
			t.Fatal("failed order reserved inventory")
		}
	}
}

func TestCatalogEditsCannotBypassInventoryAuthority(t *testing.T) {
	s, _ := Open("")
	_, owner := actor(t, 1)
	_, catalog := actor(t, 2)
	st, p := setupCatalog(t, s, owner, 40)
	acceptSellerRole(t, s, owner, st.ID, catalog, SellerRoleCatalog)
	variants := append([]Variant(nil), p.Variants...)
	variants[0].Inventory = 99
	in := UpdateProductInput{Title: p.Title, Description: p.Description, Category: p.Category, Media: p.Media, Variants: variants, IdempotencyKey: "catalog-inventory-bypass"}
	if _, err := s.UpdateProduct(catalog, p.ID, in); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("catalog inventory bypass accepted: %v", err)
	}
	got, _ := s.Product(p.ID)
	if got.Variants[0].Inventory != 40 {
		t.Fatal("denied edit changed stock")
	}
	create := CreateProductInput{StoreID: st.ID, Title: p.Title, Media: p.Media, Variants: []Variant{{Name: "New", SKU: "NEW", PriceYNXT: 25, Inventory: 1}}, IdempotencyKey: "catalog-create-inventory-bypass"}
	if _, err := s.CreateProduct(catalog, create); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("catalog created inventory: %v", err)
	}
	create.Variants[0].Inventory = 0
	if _, err := s.CreateProduct(catalog, create); err != nil {
		t.Fatalf("catalog zero-stock draft rejected: %v", err)
	}
	if got := s.SellerAccess(catalog)[st.ID]; got.Role != SellerRoleCatalog || len(got.Permissions) != 2 {
		t.Fatalf("wrong current role metadata: %+v", got)
	}
}

func TestProductCreateAndNewVariantRetriesUseOriginalIntent(t *testing.T) {
	s, _ := Open("")
	_, owner := actor(t, 1)
	st, p := setupCatalog(t, s, owner, 40)
	in := CreateProductInput{StoreID: st.ID, Title: "Second product", Media: p.Media, Variants: []Variant{{Name: "One", SKU: "SECOND", PriceYNXT: 10, Inventory: 1}}, IdempotencyKey: "stable-create-with-generated-variant"}
	first, err := s.CreateProduct(owner, in)
	if err != nil {
		t.Fatal(err)
	}
	if in.Variants[0].ID != "" {
		t.Fatal("creation mutated caller intent")
	}
	retry, err := s.CreateProduct(owner, in)
	if err != nil || retry.ID != first.ID {
		t.Fatalf("creation retry duplicated or conflicted: %v", err)
	}
	update := UpdateProductInput{Title: first.Title, Media: first.Media, Variants: append(append([]Variant(nil), first.Variants...), Variant{Name: "Two", SKU: "SECOND-TWO", PriceYNXT: 12, Inventory: 0}), IdempotencyKey: "stable-update-with-new-variant"}
	changed, err := s.UpdateProduct(owner, first.ID, update)
	if err != nil {
		t.Fatal(err)
	}
	again, err := s.UpdateProduct(owner, first.ID, update)
	if err != nil || again.Revision != changed.Revision || again.Variants[1].ID != changed.Variants[1].ID {
		t.Fatalf("update retry regenerated variant: %v", err)
	}
}

func TestReturnedProductCannotModifyStockOrImmutableHistory(t *testing.T) {
	s, _ := Open("")
	_, owner := actor(t, 1)
	st, p := setupCatalog(t, s, owner, 40)
	p.Variants[0].Inventory = 999
	p.Media[0].AltText = "changed"
	p.EditHistory[0].Variants[0].Inventory = 999
	got, _ := s.Product(p.ID)
	if got.Variants[0].Inventory != 40 || got.Media[0].AltText == "changed" || got.EditHistory[0].Variants[0].Inventory == 999 {
		t.Fatal("response mutated stored catalog")
	}
	public := s.Products("", "")
	public[0].Variants[0].Inventory = 888
	private, err := s.SellerProducts(owner, st.ID)
	if err != nil {
		t.Fatal(err)
	}
	private[0].Variants[0].Inventory = 777
	got, _ = s.Product(p.ID)
	if got.Variants[0].Inventory != 40 {
		t.Fatal("catalog list aliases live stock")
	}
}
