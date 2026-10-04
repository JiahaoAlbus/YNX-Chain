package commerce

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestLegacyInvalidSelectedVariantCannotCreateNewOrder(t *testing.T) {
	for _, kind := range []string{"duplicate_id", "zero_price", "negative_price", "negative_reserved", "over_reserved", "negative_inventory"} {
		t.Run(kind, func(t *testing.T) {
			file := filepath.Join(t.TempDir(), "original.json")
			s, err := Open(file)
			if err != nil {
				t.Fatal(err)
			}
			_, owner := actor(t, 1)
			_, buyer := actor(t, 2)
			st, original := setupCatalog(t, s, owner, 40)
			legacy := cloneProduct(original)
			switch kind {
			case "duplicate_id":
				legacy.Variants = append(legacy.Variants, legacy.Variants[0])
			case "zero_price":
				legacy.Variants[0].PriceYNXT = 0
			case "negative_price":
				legacy.Variants[0].PriceYNXT = -1
			case "negative_reserved":
				legacy.Variants[0].Reserved = -1
			case "over_reserved":
				legacy.Variants[0].Reserved = legacy.Variants[0].Inventory + 1
			case "negative_inventory":
				legacy.Variants[0].Inventory = -1
			}
			// Retained historical-state fixture only; never alter production records.
			s.s.Products[legacy.ID] = legacy
			if err = s.persistLocked(); err != nil {
				t.Fatal(err)
			}
			before, _ := json.Marshal(s.s)
			diskBefore, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			input := orderInput(st, legacy, "legacy-selected-variant-request")
			if _, err = s.CreateOrder(buyer, input); err == nil {
				t.Fatal("invalid selected legacy variant accepted for new order")
			}
			after, _ := json.Marshal(s.s)
			diskAfter, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(before, after) || !bytes.Equal(diskBefore, diskAfter) {
				t.Fatal("rejection changed original inventory, orders, audit, cart, request keys or disk")
			}
			// A corrected catalog can retry the same unconsumed request key.
			s.s.Products[original.ID] = original
			if _, err = s.CreateOrder(buyer, input); err != nil {
				t.Fatalf("rejected request consumed original key: %v", err)
			}
		})
	}
}

func TestCommittedOrderReplaySurvivesInvalidLegacyCatalog(t *testing.T) {
	s, err := Open("")
	if err != nil {
		t.Fatal(err)
	}
	_, owner := actor(t, 1)
	_, buyer := actor(t, 2)
	st, product := setupCatalog(t, s, owner, 40)
	input := orderInput(st, product, "committed-original-order-key")
	original, err := s.CreateOrder(buyer, input)
	if err != nil {
		t.Fatal(err)
	}
	legacy := s.s.Products[product.ID]
	legacy.Variants = append(legacy.Variants, legacy.Variants[0])
	legacy.Variants[0].PriceYNXT = -1
	s.s.Products[product.ID] = legacy
	before, _ := json.Marshal(s.s)
	replay, err := s.CreateOrder(buyer, input)
	if err != nil {
		t.Fatal(err)
	}
	after, _ := json.Marshal(s.s)
	a, _ := json.Marshal(original)
	b, _ := json.Marshal(replay)
	if !bytes.Equal(a, b) || !bytes.Equal(before, after) {
		t.Fatal("existing exact order receipt or original unknown state changed during readback")
	}
}
