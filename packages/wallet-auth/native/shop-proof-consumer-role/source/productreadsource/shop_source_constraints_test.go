package productreadsource

import "testing"

func TestOriginalShopConstraintActualProjection(t *testing.T) {
	original := OriginalCaptureDATA{Scope: ScopeDATA{Account: "original-account", Operations: []string{"readOriginalInvoiceIntent"}, Products: []ProductReference{{ProductID: "shop.order", SourceOrder: "order-one"}}}, Profile: ProfileDATA{Realm: "real-realm", Tenant: "real-tenant", Epoch: 29}, Selections: []ReadScopeDATA{{Realm: "real-realm", Tenant: "real-tenant", Purpose: Purpose, Epoch: 29, Actor: "original-account", Role: "buyer", StoreID: "original-store", ProductID: "shop.order", SourceOrder: "order-one"}}}
	got, err := originalShopConstraintAtObserved(original, 0)
	if err != nil || got != original.Selections[0] {
		t.Fatalf("actual production projection: %v", err)
	}
	for _, tc := range []struct {
		name   string
		change func(*ReadScopeDATA)
	}{
		{"actor", func(s *ReadScopeDATA) { s.Actor = "another-account" }},
		{"realm", func(s *ReadScopeDATA) { s.Realm = "another-realm" }},
		{"epoch-not-session-generation", func(s *ReadScopeDATA) { s.Epoch = 30 }},
		{"role", func(s *ReadScopeDATA) { s.Role = "admin" }},
		{"store", func(s *ReadScopeDATA) { s.StoreID = "" }},
		{"unselected-order", func(s *ReadScopeDATA) { s.SourceOrder = "order-two" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			d := original
			d.Selections = append([]ReadScopeDATA(nil), original.Selections...)
			tc.change(&d.Selections[0])
			if _, err := originalShopConstraintAtObserved(d, 0); err == nil {
				t.Fatal("substitution admitted")
			}
		})
	}
	if _, err := originalShopConstraintAtObserved(original, 1); err == nil {
		t.Fatal("foreign index admitted")
	}
}
