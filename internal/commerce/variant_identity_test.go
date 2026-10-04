package commerce

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestProductVariantIdentityRejectedBeforeAnyStateOrPersistenceChange(t *testing.T) {
	for _, operation := range []string{"create", "update"} {
		for _, duplicate := range []string{"id", "sku"} {
			t.Run(operation+"/"+duplicate, func(t *testing.T) {
				file := filepath.Join(t.TempDir(), "original.json")
				s, err := Open(file)
				if err != nil {
					t.Fatal(err)
				}
				_, owner := actor(t, 1)
				st, product := setupCatalog(t, s, owner, 40)
				variants := []Variant{product.Variants[0], {ID: "variant_second", Name: "Second", SKU: "SECOND", PriceYNXT: 12, Inventory: 0}}
				if duplicate == "id" {
					variants[1].ID = variants[0].ID
				} else {
					variants[1].SKU = variants[0].SKU
				}
				before, _ := json.Marshal(s.s)
				diskBefore, err := os.ReadFile(file)
				if err != nil {
					t.Fatal(err)
				}
				key := "original-rejected-variant-identity"
				if operation == "create" {
					_, err = s.CreateProduct(owner, CreateProductInput{StoreID: st.ID, Title: "Original draft", Media: product.Media, Variants: variants, IdempotencyKey: key})
				} else {
					_, err = s.UpdateProduct(owner, product.ID, UpdateProductInput{Title: product.Title, Description: product.Description, Category: product.Category, Media: product.Media, Variants: variants, IdempotencyKey: key})
				}
				if err == nil {
					t.Fatal("ambiguous product variant accepted")
				}
				after, _ := json.Marshal(s.s)
				diskAfter, err := os.ReadFile(file)
				if err != nil {
					t.Fatal(err)
				}
				if !bytes.Equal(before, after) || !bytes.Equal(diskBefore, diskAfter) {
					t.Fatal("rejection changed original stock, history, audit, request keys or persisted bytes")
				}
				variants[1].ID = "variant_second"
				variants[1].SKU = "SECOND"
				if operation == "create" {
					_, err = s.CreateProduct(owner, CreateProductInput{StoreID: st.ID, Title: "Original draft", Media: product.Media, Variants: variants, IdempotencyKey: key})
				} else {
					_, err = s.UpdateProduct(owner, product.ID, UpdateProductInput{Title: product.Title, Description: product.Description, Category: product.Category, Media: product.Media, Variants: variants, IdempotencyKey: key})
				}
				if err != nil {
					t.Fatalf("rejected request consumed its key: %v", err)
				}
			})
		}
	}
}

func TestHistoricalAmbiguousVariantReceiptRemainsReadbackCompatible(t *testing.T) {
	// Historical receipt fixture only. Do not rewrite old records or make a new
	// business mutation when its already-committed exact request is recovered.
	s, _ := Open("")
	_, owner := actor(t, 1)
	st, product := setupCatalog(t, s, owner, 40)
	original := CreateProductInput{StoreID: st.ID, Title: product.Title, Media: product.Media, Variants: []Variant{product.Variants[0], product.Variants[0]}, IdempotencyKey: "historical-original-product-key"}
	hash, _, err := s.idempotencyLocked(owner, "product.create", original.IdempotencyKey, original)
	if err != nil {
		t.Fatal(err)
	}
	product.Variants = append([]Variant(nil), original.Variants...)
	s.s.Products[product.ID] = product
	s.recordIdempotencyLocked(owner, "product.create", original.IdempotencyKey, hash, product.ID)
	before, _ := json.Marshal(s.s)
	receipt, err := s.CreateProduct(owner, original)
	if err != nil {
		t.Fatal(err)
	}
	after, _ := json.Marshal(s.s)
	if receipt.ID != product.ID || len(receipt.Variants) != 2 || !bytes.Equal(before, after) {
		t.Fatal("exact historical receipt was replaced or original state rewritten")
	}
}
