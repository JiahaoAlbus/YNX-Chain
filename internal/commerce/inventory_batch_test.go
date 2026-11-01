package commerce

import (
	"bytes"
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
)

func inventoryBatchFixture(t *testing.T) (*Store, string, InventoryBatchInput) {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	_, owner := actor(t, 231)
	st, p := setupCatalog(t, s, owner, 20)
	second, err := s.CreateProduct(owner, CreateProductInput{StoreID: st.ID, Title: "Second", IdempotencyKey: "batch-second-product", Variants: []Variant{{ID: "two-a", Name: "A", SKU: "second-a", PriceYNXT: 2, Inventory: 30}, {ID: "two-b", Name: "B", SKU: "second-b", PriceYNXT: 3, Inventory: 40}}})
	if err != nil {
		t.Fatal(err)
	}
	return s, owner, InventoryBatchInput{StoreID: st.ID, IdempotencyKey: "original-batch-key", Items: []InventoryBatchItem{
		{p.ID, p.Variants[0].ID, strconv.FormatInt(p.Revision, 10), "21"},
		{second.ID, "two-a", strconv.FormatInt(second.Revision, 10), "31"},
		{second.ID, "two-b", strconv.FormatInt(second.Revision, 10), "41"},
	}}
}

func TestInventoryBatchNormalV2AtomicCommitColdReadbackAndNoReplay(t *testing.T) {
	s, owner, in := inventoryBatchFixture(t)
	in.Items[0].Inventory = strconv.FormatInt(math.MaxInt64, 10)
	beforeProducts, err := cloneSnapshot(s.s)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(in)
	server := NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: owner, role: "seller"}})
	selected := InventorySelectionInput{StoreID: in.StoreID}
	for _, item := range in.Items {
		selected.Items = append(selected.Items, InventorySelectionItem{item.ProductID, item.VariantID})
	}
	selectionBody, _ := json.Marshal(selected)
	observed := businessHTTPRequest(server, "POST", "/api/seller/inventory/read", strings.Repeat("r", 43), string(selectionBody))
	var selection InventorySelectionResult
	if observed.Code != 200 || json.Unmarshal(observed.Body.Bytes(), &selection) != nil || !selection.QueryOnly || len(selection.Products) != 2 || bytes.Contains(observed.Body.Bytes(), []byte("OriginalApplied")) {
		t.Fatal("exact read manufactured batch admission", observed.Code, observed.Body.String())
	}
	w := businessHTTPRequest(server, "POST", "/api/seller/inventory/batch", strings.Repeat("a", 43), string(raw))
	var result InventoryBatchResult
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil || result.QueryOnly || !result.OriginalApplied || len(result.Products) != 2 {
		t.Fatal(w.Code, w.Body.String())
	}
	if result.Products[0].Variants[0].Inventory != in.Items[0].Inventory {
		t.Fatal("int64 count did not survive exact API string roundtrip")
	}
	for _, p := range result.Products {
		if p.Revision != strconv.FormatInt(beforeProducts.Products[p.ID].Revision+1, 10) {
			t.Fatal("revision did not increment once per product")
		}
	}
	for _, item := range in.Items {
		p := s.s.Products[item.ProductID]
		for _, v := range p.Variants {
			if v.ID == item.VariantID && strconv.FormatInt(v.Inventory, 10) != item.Inventory {
				t.Fatal("batch only partly applied")
			}
		}
	}
	// A later valid edit is current DATA; recovery of the prior operation must
	// prove its original admission without applying its old absolute count.
	item := in.Items[0]
	if _, err := s.SetInventory(owner, InventoryInput{StoreID: in.StoreID, ProductID: item.ProductID, VariantID: item.VariantID, Inventory: 99, IdempotencyKey: "later-independent-stock"}); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(s.path)
	if err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(s.path)
	replayed, err := reopened.SetInventoryBatch(owner, in)
	after, _ := os.ReadFile(s.path)
	if err != nil || !replayed.QueryOnly || !bytes.Equal(before, after) || replayed.Products[0].Variants[0].Inventory != "99" {
		t.Fatal("replay overwrote current inventory", err)
	}
	lookup := sellerMutationLookupInput{Method: "POST", Path: "/seller/inventory/batch", OriginalBody: string(raw)}
	lookupRaw, _ := json.Marshal(lookup)
	w = businessHTTPRequest(NewServer(reopened, ServerConfig{businessV2: controlledBusinessVerifier{account: owner, role: "seller"}}), "POST", "/api/seller/mutations/lookup", strings.Repeat("b", 43), string(lookupRaw))
	var wire struct {
		Result         InventoryBatchResult
		IdempotencyKey string
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &wire) != nil || wire.IdempotencyKey != in.IdempotencyKey || !wire.Result.QueryOnly || wire.Result.Products[0].Variants[0].Inventory != "99" {
		t.Fatal("cold original readback", w.Code, w.Body.String())
	}
	changed := in
	changed.Items = append([]InventoryBatchItem(nil), in.Items...)
	changed.Items[0].Inventory = "100"
	if _, err := reopened.SetInventoryBatch(owner, changed); !errors.Is(err, ErrConflict) {
		t.Fatal("same key changed original", err)
	}
	_, foreign := actor(t, 232)
	if _, _, err := reopened.lookupSellerMutation(foreign, lookup); err == nil {
		t.Fatal("foreign original readback")
	}
}

func TestInventoryBatchAllValidationAndCommitFailuresAreAtomic(t *testing.T) {
	for _, fault := range []string{"stale-last", "duplicate", "reserved-last", "foreign-last", "overflow-revision", "overflow-count", "noncanonical", "disk", "late-current", "wrong-role"} {
		t.Run(fault, func(t *testing.T) {
			s, owner, in := inventoryBatchFixture(t)
			last := &in.Items[len(in.Items)-1]
			cfg := ServerConfig{businessV2: controlledBusinessVerifier{account: owner, role: "seller"}}
			switch fault {
			case "stale-last":
				last.ExpectedRevision = "999"
			case "duplicate":
				in.Items = append(in.Items, in.Items[0])
			case "reserved-last":
				p := s.s.Products[last.ProductID]
				p.Variants[1].Reserved = 3
				s.s.Products[p.ID] = p
				last.Inventory = "2"
			case "foreign-last":
				p := s.s.Products[last.ProductID]
				p.StoreID = "other-store"
				s.s.Products[p.ID] = p
			case "overflow-revision":
				p := s.s.Products[last.ProductID]
				p.Revision = math.MaxInt64
				s.s.Products[p.ID] = p
				in.Items[1].ExpectedRevision = strconv.FormatInt(math.MaxInt64, 10)
				last.ExpectedRevision = in.Items[1].ExpectedRevision
			case "noncanonical":
				last.Inventory = "031"
			case "overflow-count":
				last.Inventory = "9223372036854775808"
			case "disk":
				if err := os.Mkdir(s.path+".tmp", 0700); err != nil {
					t.Fatal(err)
				}
			case "late-current":
				checks := 0
				cfg.businessV2 = controlledBusinessVerifier{account: owner, role: "seller", fence: func() error {
					checks++
					if checks >= 4 {
						return ErrUnauthorized
					}
					return nil
				}}
			case "wrong-role":
				cfg.businessV2 = controlledBusinessVerifier{account: owner, role: "buyer"}
			}
			if fault != "disk" {
				if err := s.persistLocked(); err != nil {
					t.Fatal(err)
				}
			}
			before := transitionDomainSnapshot(t, s)
			raw, _ := json.Marshal(in)
			w := businessHTTPRequest(NewServer(s, cfg), "POST", "/api/seller/inventory/batch", strings.Repeat("c", 43), string(raw))
			diskAfter, _ := os.ReadFile(s.path)
			after := transitionDomainSnapshot(t, s)
			var persisted Snapshot
			if err := decodePersisted(diskAfter, nil, &persisted); err != nil {
				t.Fatal(err)
			}
			// The normal HTTP limiter durably counts denied mutations too.
			// Exclude only that window in BOTH memory and original file checks.
			persisted.RequestWindow = nil
			diskBusiness, err := json.Marshal(persisted)
			if err != nil {
				t.Fatal(err)
			}
			if w.Code < 400 || !bytes.Equal(before, after) || !bytes.Equal(before, diskBusiness) {
				t.Fatal("failed batch committed partial products/proof/audit", w.Code, w.Body.String())
			}
		})
	}
}

func TestInventoryBatchCurrentInventoryRoleRequiredForMutationAndRecovery(t *testing.T) {
	s, owner, in := inventoryBatchFixture(t)
	_, operator := actor(t, 233)
	acceptSellerRole(t, s, owner, in.StoreID, operator, SellerRoleInventory)
	if _, err := s.SetInventoryBatch(operator, in); err != nil {
		t.Fatal("original inventory role cannot batch", err)
	}
	raw, _ := json.Marshal(in)
	lookup := sellerMutationLookupInput{Method: "POST", Path: "/seller/inventory/batch", OriginalBody: string(raw)}
	if _, _, err := s.lookupSellerMutation(operator, lookup); err != nil {
		t.Fatal("current role cannot read original", err)
	}
	if _, _, err := s.RevokeSellerRole(owner, in.StoreID, operator, "PUBLIC revoke inventory role"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetInventoryBatch(operator, in); err == nil {
		t.Fatal("revoked role replayed original batch")
	}
	if _, _, err := s.lookupSellerMutation(operator, lookup); err == nil {
		t.Fatal("revoked role read original batch")
	}
}

func TestInventoryBatchConcurrentRevisionHasOneWholeWinner(t *testing.T) {
	s, owner, in := inventoryBatchFixture(t)
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, key := range []string{"batch-concurrent-one", "batch-concurrent-two"} {
		copy := in
		copy.IdempotencyKey = key
		wg.Add(1)
		go func() { defer wg.Done(); _, err := s.SetInventoryBatch(owner, copy); results <- err }()
	}
	wg.Wait()
	close(results)
	wins, conflicts := 0, 0
	for err := range results {
		if err == nil {
			wins++
		} else if errors.Is(err, ErrConflict) {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if wins != 1 || conflicts != 1 {
		t.Fatal(wins, conflicts)
	}
	if _, err := Open(s.path); err != nil {
		t.Fatal("whole winner not cold readable", err)
	}
}
