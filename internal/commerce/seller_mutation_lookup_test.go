package commerce

import (
	"bytes"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

func sellerLookupBody(method, path, raw string) string {
	v, _ := json.Marshal(sellerMutationLookupInput{method, path, raw})
	return string(v)
}
func TestSellerMutationLookupOriginalStoreColdReadAndActorIsolation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "store.json")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	_, owner := actor(t, 1)
	_, other := actor(t, 2)
	raw := `{"Name":"Original store","Policy":"Returns accepted","IdempotencyKey":"original-store-key"}`
	server := NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: owner, role: "seller"}})
	if w := businessHTTPRequest(server, "POST", "/api/seller/stores", strings.Repeat("a", 43), raw); w.Code != 201 {
		t.Fatal(w.Code, w.Body)
	}
	s, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	server = NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: owner, role: "seller"}})
	before := len(s.s.Stores)
	w := businessHTTPRequest(server, "POST", "/api/seller/mutations/lookup", strings.Repeat("b", 43), sellerLookupBody("POST", "/seller/stores", raw))
	if w.Code != 200 || !strings.Contains(w.Body.String(), "Original store") {
		t.Fatal(w.Code, w.Body)
	}
	if len(s.s.Stores) != before || len(s.s.Idempotency) != 1 {
		t.Fatal("lookup created a replacement")
	}
	for i, bad := range []string{strings.Replace(raw, "Original store", "Changed store", 1), strings.Replace(raw, "original-store-key", "missing-store-key", 1)} {
		w = businessHTTPRequest(server, "POST", "/api/seller/mutations/lookup", strings.Repeat(string(rune('c'+i)), 43), sellerLookupBody("POST", "/seller/stores", bad))
		if w.Code != 409 || strings.Contains(w.Body.String(), "Original store") {
			t.Fatal(w.Code, w.Body)
		}
	}
	server = NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: other, role: "seller"}})
	w = businessHTTPRequest(server, "POST", "/api/seller/mutations/lookup", strings.Repeat("e", 43), sellerLookupBody("POST", "/seller/stores", raw))
	if w.Code != 409 || strings.Contains(w.Body.String(), "Original store") {
		t.Fatal("cross actor", w.Code, w.Body)
	}
	server = NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: owner, role: "buyer"}})
	w = businessHTTPRequest(server, "POST", "/api/seller/mutations/lookup", strings.Repeat("f", 43), sellerLookupBody("POST", "/seller/stores", raw))
	if w.Code < 400 {
		t.Fatal("buyer grant borrowed")
	}
}
func TestSellerMutationLookupInventoryIsPureAndRechecksMembership(t *testing.T) {
	s, _ := Open("")
	_, owner := actor(t, 1)
	_, member := actor(t, 2)
	st, p := setupCatalog(t, s, owner, 3)
	input := InventoryInput{StoreID: st.ID, ProductID: p.ID, VariantID: p.Variants[0].ID, Inventory: 6, IdempotencyKey: "inventory-original-key"}
	if _, err := s.SetInventory(owner, input); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(input)
	before := transitionDomainSnapshot(t, s)
	result, key, err := s.lookupSellerMutation(owner, sellerMutationLookupInput{"POST", "/seller/inventory", string(raw)})
	if err != nil || result == nil || key != input.IdempotencyKey {
		t.Fatal(result, key, err)
	}
	after := transitionDomainSnapshot(t, s)
	if !bytes.Equal(before, after) {
		t.Fatal("lookup changed inventory or nonce")
	}
	if _, _, err := s.lookupSellerMutation(member, sellerMutationLookupInput{"POST", "/seller/inventory", string(raw)}); err == nil {
		t.Fatal("foreign membership")
	}
	s.mu.Lock()
	rec := s.s.Idempotency[idemMapKey(owner, "inventory.set", input.IdempotencyKey)]
	s.s.Idempotency[idemMapKey(member, "inventory.set", input.IdempotencyKey)] = rec
	s.mu.Unlock()
	if _, _, err := s.lookupSellerMutation(member, sellerMutationLookupInput{"POST", "/seller/inventory", string(raw)}); err == nil {
		t.Fatal("copied identity")
	}
}
func TestSellerMutationLookupTransitionReadsLaterStateWithoutAnotherTransition(t *testing.T) {
	s, buyer, order, evidence := settlementFixture(t)
	_, owner := actor(t, 1)
	if _, err := s.ConfirmSettlement(order.ID, evidence); err != nil {
		t.Fatal(err)
	}
	input := orderTransitionInput{Action: "shipped", Carrier: "C", TrackingNumber: "T", IdempotencyKey: "original-shipment-key"}
	ship, res, review := input.parts()
	if _, err := s.transition(owner, "seller", order.ID, input.Action, ship, res, review, input.IdempotencyKey); err != nil {
		t.Fatal(err)
	}
	if _, err := s.transition(buyer, "buyer", order.ID, "delivered", nil, nil, nil, "original-delivered-key"); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(input)
	before := transitionDomainSnapshot(t, s)
	result, _, err := s.lookupSellerMutation(owner, sellerMutationLookupInput{"POST", "/orders/" + order.ID + "/transition", string(raw)})
	if err != nil {
		t.Fatal(err)
	}
	text, _ := json.Marshal(result)
	if !strings.Contains(string(text), "delivered") {
		t.Fatal("stale state", string(text))
	}
	if !bytes.Equal(before, transitionDomainSnapshot(t, s)) {
		t.Fatal("second transition")
	}
	input.Action = "refund_approved"
	raw, _ = json.Marshal(input)
	if _, _, err = s.lookupSellerMutation(owner, sellerMutationLookupInput{"POST", "/orders/" + order.ID + "/transition", string(raw)}); err == nil {
		t.Fatal("sensitive operation confirmed")
	}
}
