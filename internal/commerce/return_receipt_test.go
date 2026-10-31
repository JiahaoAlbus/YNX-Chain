package commerce

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// Financial evidence and Auth are controlled fixtures throughout this file.
// These tests prove Shop's warehouse state machine, not actual funds/approval.
func returnedOrder(t *testing.T, s *Store, owner, buyer string, st StoreProfile, p Product, quantity int64, key string, approve bool, items ...CartItem) (Order, string) {
	t.Helper()
	in := orderInput(st, p, key)
	in.Items[0].Quantity = quantity
	if len(items) != 0 {
		in.Items = append([]CartItem(nil), items...)
	}
	o, err := s.CreateOrder(buyer, in)
	if err != nil {
		t.Fatal(err)
	}
	o, err = s.BindInvoice(buyer, o.ID, PayInvoiceHandoff{InvoiceID: "inv_" + key, IntentID: "intent_" + key, Merchant: "return_merchant", PayoutAddress: owner})
	if err != nil {
		t.Fatal(err)
	}
	o, err = s.ConfirmSettlement(o.ID, SettlementEvidence{InvoiceID: o.InvoiceID, IntentID: o.PayIntentID, Merchant: o.PayMerchant, PayoutAddress: owner, TransactionHash: "0x" + requestHash(o.ID), AuditHash: requestHash(o.PayIntentID), Status: "paid", Payer: buyer, Currency: NativeSymbol, AmountYNXT: o.TotalYNXT, BlockHeight: 81, ConfirmedAt: s.now()})
	if err != nil {
		t.Fatal(err)
	}
	o, err = s.transition(owner, "seller", o.ID, "shipped", &Shipment{Carrier: "Carrier", TrackingNumber: "TRACK-" + key}, nil, nil, key+"-ship")
	if err != nil {
		t.Fatal(err)
	}
	o, err = s.transition(buyer, "buyer", o.ID, "delivered", nil, nil, nil, key+"-deliver")
	if err != nil {
		t.Fatal(err)
	}
	o, err = s.transition(buyer, "buyer", o.ID, "return_requested", nil, &Resolution{Kind: "return", Reason: "returned goods"}, nil, key+"-return")
	if err != nil {
		t.Fatal(err)
	}
	returnID := o.Timeline[len(o.Timeline)-1].ID
	if approve {
		o, err = s.transition(owner, "seller", o.ID, "return_approved", nil, &Resolution{Kind: "return"}, nil, key+"-approve")
		if err != nil {
			t.Fatal(err)
		}
	}
	return o, returnID
}

func returnFixture(t *testing.T, approve bool, clock ...time.Time) (*Store, Order, string, string, string) {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(clock) != 0 {
		s.now = func() time.Time { return clock[0] }
	}
	_, owner := actor(t, 251)
	_, buyer := actor(t, 252)
	st, p := setupCatalog(t, s, owner, 5)
	o, id := returnedOrder(t, s, owner, buyer, st, p, 2, "original-return-order", approve)
	return s, o, owner, buyer, id
}
func receiveInput(order Order, returnID, reference, key string, qty int64) ReceiveReturnInput {
	return ReceiveReturnInput{ReturnID: returnID, EvidenceReference: reference, IdempotencyKey: key, Items: []ReturnItem{{ProductID: order.Lines[0].ProductID, VariantID: order.Lines[0].VariantID, Quantity: strconv.FormatInt(qty, 10)}}}
}

func TestReturnReceiptPartialWarehouseFlowKeepsRefundSeparate(t *testing.T) {
	s, o, owner, buyer, returnID := returnFixture(t, true)
	_, receiver := actor(t, 253)
	_, inventory := actor(t, 254)
	acceptSellerRole(t, s, owner, o.StoreID, receiver, SellerRoleFulfillment)
	acceptSellerRole(t, s, owner, o.StoreID, inventory, SellerRoleInventory)
	receive := receiveInput(o, returnID, "warehouse-original-1", "receive-original-1", 1)
	if _, err := s.ReceiveReturn(inventory, o.ID, receive); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("inventory role fabricated receipt", err)
	}
	view, err := s.ReadScopedOrder(buyer, "buyer", o.ID, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(receive)
	server := NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: receiver, role: "seller"}})
	w := businessHTTPRequest(server, "POST", "/api/orders/"+o.ID+"/return-receipts", strings.Repeat("t", 43), string(body))
	var received Order
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &received) != nil || len(received.ReturnReceipts) != 1 {
		t.Fatal(w.Code, w.Body.String())
	}
	if received.Status != o.Status || received.RefundStatus != o.RefundStatus || received.Refund != nil || s.s.Products[o.Lines[0].ProductID].Variants[0].Inventory != 3 {
		t.Fatal("receipt inferred refund or restock")
	}
	if _, err = s.ReadScopedOrder(buyer, "buyer", o.ID, nil, view.Snapshot); !errors.Is(err, ErrConflict) {
		t.Fatal("receipt did not invalidate order snapshot", err)
	}
	if _, err = s.RestockReturn(receiver, o.ID, RestockReturnInput{received.ReturnReceipts[0].ID, "restock-original-1"}); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("fulfillment role acquired inventory authority", err)
	}
	s, err = Open(s.path)
	if err != nil {
		t.Fatal(err)
	}
	server = NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: inventory, role: "seller"}})
	restock := RestockReturnInput{received.ReturnReceipts[0].ID, "restock-original-1"}
	stockBody, _ := json.Marshal(restock)
	w = businessHTTPRequest(server, "POST", "/api/orders/"+o.ID+"/return-restock", strings.Repeat("u", 43), string(stockBody))
	var stocked Order
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &stocked) != nil {
		t.Fatal(w.Code, w.Body.String())
	}
	if s.s.Products[o.Lines[0].ProductID].Variants[0].Inventory != 4 || stocked.Status != o.Status || stocked.RefundStatus != o.RefundStatus || stocked.Refund != nil {
		t.Fatal("partial receipt restocked whole order or changed funds")
	}
	// Pure original-result lookup is available after a lost response; it does
	// not repeat receipt recording or stock mutation.
	before := transitionDomainSnapshot(t, s)
	if _, _, err = s.lookupSellerMutation(inventory, sellerMutationLookupInput{"POST", "/orders/" + o.ID + "/return-restock", string(stockBody)}); err != nil {
		t.Fatal(err)
	}
	if string(before) != string(transitionDomainSnapshot(t, s)) {
		t.Fatal("result lookup restocked again")
	}
	if _, err = s.RestockReturn(inventory, o.ID, restock); err != nil {
		t.Fatal(err)
	}
	second := receiveInput(o, returnID, "warehouse-original-2", "receive-original-2", 1)
	got, err := s.ReceiveReturn(receiver, o.ID, second)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.RestockReturn(inventory, o.ID, RestockReturnInput{got.ReturnReceipts[1].ID, "restock-original-2"}); err != nil {
		t.Fatal(err)
	}
	if s.s.Products[o.Lines[0].ProductID].Variants[0].Inventory != 5 {
		t.Fatal("partial return quantities lost")
	}
	third := receiveInput(o, returnID, "warehouse-original-3", "receive-original-3", 1)
	if _, err = s.ReceiveReturn(receiver, o.ID, third); !errors.Is(err, ErrInvalidState) {
		t.Fatal("returned more than sold", err)
	}
	// Returned mutable slices/timestamps never expose original stock authority.
	stocked.ReturnReceipts[0].Items[0].Quantity = "1000"
	*stocked.ReturnReceipts[0].RestockedAt = time.Time{}
	read, err := s.Order(buyer, "buyer", o.ID)
	if err != nil || read.ReturnReceipts[0].Items[0].Quantity != "1" || read.ReturnReceipts[0].RestockedAt.IsZero() {
		t.Fatal("response modified original receipt", err)
	}
}

func TestReturnReceiptExactOrderBoundsAndCurrentRoles(t *testing.T) {
	s, o, owner, _, returnID := returnFixture(t, false)
	in := receiveInput(o, returnID, "warehouse-bounds", "receive-bounds-1", 1)
	if _, err := s.ReceiveReturn(owner, o.ID, in); !errors.Is(err, ErrInvalidState) {
		t.Fatal("unapproved return admitted", err)
	}
	var err error
	o, err = s.transition(owner, "seller", o.ID, "return_approved", nil, &Resolution{Kind: "return"}, nil, "approve-bounds-return")
	if err != nil {
		t.Fatal(err)
	}
	for _, qty := range []string{"0", "-1", "01", "1.0", "9223372036854775808", "3"} {
		bad := in
		bad.Items = append([]ReturnItem(nil), in.Items...)
		bad.Items[0].Quantity = qty
		if _, err = s.ReceiveReturn(owner, o.ID, bad); !errors.Is(err, ErrInvalidState) {
			t.Fatal(qty, err)
		}
	}
	bad := in
	bad.ReturnID = "unrelated-return"
	if _, err = s.ReceiveReturn(owner, o.ID, bad); !errors.Is(err, ErrInvalidState) {
		t.Fatal("wrong return ID", err)
	}
	bad = in
	bad.Items = append(append([]ReturnItem(nil), in.Items...), in.Items[0])
	if _, err = s.ReceiveReturn(owner, o.ID, bad); !errors.Is(err, ErrInvalidState) {
		t.Fatal("duplicate item", err)
	}
	got, err := s.ReceiveReturn(owner, o.ID, in)
	if err != nil {
		t.Fatal(err)
	}
	st := s.s.Stores[o.StoreID]
	p := s.s.Products[o.Lines[0].ProductID]
	_, otherBuyer := actor(t, 255)
	other, otherReturn := returnedOrder(t, s, owner, otherBuyer, st, p, 1, "other-return-order", true)
	cross := receiveInput(other, otherReturn, in.EvidenceReference, "receive-cross-order", 1)
	if _, err = s.ReceiveReturn(owner, other.ID, cross); !errors.Is(err, ErrConflict) {
		t.Fatal("warehouse receipt reused across orders", err)
	}
	if _, err = s.RestockReturn(owner, other.ID, RestockReturnInput{got.ReturnReceipts[0].ID, "restock-cross-order"}); !errors.Is(err, ErrNotFound) {
		t.Fatal("cross order restock", err)
	}
	_, receiver := actor(t, 240)
	acceptSellerRole(t, s, owner, o.StoreID, receiver, SellerRoleFulfillment)
	in.EvidenceReference = "warehouse-revoked"
	in.IdempotencyKey = "receive-revoked"
	if _, err = s.ReceiveReturn(receiver, o.ID, in); err != nil {
		t.Fatal(err)
	}
	if _, _, err = s.RevokeSellerRole(owner, o.StoreID, receiver, "membership ended"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.ReceiveReturn(receiver, o.ID, in); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("old key bypassed current receiver role", err)
	}
}

func TestReturnReceiptPersistenceRecoveryAndNoOldSnapshotReplay(t *testing.T) {
	for _, action := range []string{"receive", "restock"} {
		t.Run(action, func(t *testing.T) {
			s, o, owner, _, returnID := returnFixture(t, true)
			old, err := os.ReadFile(s.path)
			if err != nil {
				t.Fatal(err)
			}
			in := receiveInput(o, returnID, "warehouse-durable", "receive-durable", 1)
			var received Order
			if action == "restock" {
				received, err = s.ReceiveReturn(owner, o.ID, in)
				if err != nil {
					t.Fatal(err)
				}
			}
			apply := func() (Order, error) {
				if action == "receive" {
					return s.ReceiveReturn(owner, o.ID, in)
				}
				return s.RestockReturn(owner, o.ID, RestockReturnInput{received.ReturnReceipts[0].ID, "restock-durable"})
			}
			before, err := cloneSnapshot(s.s)
			if err != nil {
				t.Fatal(err)
			}
			if err = os.Mkdir(s.path+".tmp", 0700); err != nil {
				t.Fatal(err)
			}
			if _, err = apply(); err == nil || !reflect.DeepEqual(s.s, before) {
				t.Fatal("failed persistence changed receipt, stock or replay protection", err)
			}
			if err = os.Remove(s.path + ".tmp"); err != nil {
				t.Fatal(err)
			}
			if _, err = apply(); err != nil {
				t.Fatal(err)
			}
			s, err = Open(s.path)
			if err != nil {
				t.Fatal(err)
			}
			committed, err := cloneSnapshot(s.s)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = apply(); err != nil || !reflect.DeepEqual(s.s, committed) {
				t.Fatal("original replay duplicated warehouse effect", err)
			}
			if err = s.ExportRollbackSnapshot(filepath.Join(t.TempDir(), "old-v15.json"), 15); !errors.Is(err, ErrConflict) {
				t.Fatal("old schema erased receipt dedup", err)
			}
			if err = os.WriteFile(s.path+".bak", old, 0600); err != nil {
				t.Fatal(err)
			}
			if err = RestoreCommerceBackup(s.path, nil); !errors.Is(err, ErrConflict) {
				t.Fatal("old backup can replay physical receipt", err)
			}
		})
	}
}

func TestReturnReceiptConcurrentRestockAndDamagedReceiptFailClosed(t *testing.T) {
	s, o, owner, _, returnID := returnFixture(t, true)
	got, err := s.ReceiveReturn(owner, o.ID, receiveInput(o, returnID, "warehouse-concurrent", "receive-concurrent", 1))
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, key := range []string{"stock-concurrent-a", "stock-concurrent-b"} {
		wg.Add(1)
		go func(key string) {
			defer wg.Done()
			_, err := s.RestockReturn(owner, o.ID, RestockReturnInput{got.ReturnReceipts[0].ID, key})
			results <- err
		}(key)
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
	if wins != 1 || conflicts != 1 || s.s.Products[o.Lines[0].ProductID].Variants[0].Inventory != 4 {
		t.Fatal("concurrent restock duplicated stock", wins, conflicts)
	}
	// A corrupt historical receipt must remain readable, but may not add goods.
	s, o, owner, _, returnID = returnFixture(t, true)
	got, err = s.ReceiveReturn(owner, o.ID, receiveInput(o, returnID, "warehouse-corrupt", "receive-corrupt", 1))
	if err != nil {
		t.Fatal(err)
	}
	bad := s.s.Orders[o.ID]
	bad.ReturnReceipts[0].Items[0].Quantity = "3"
	s.s.Orders[o.ID] = bad
	before, err := cloneSnapshot(s.s)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.RestockReturn(owner, o.ID, RestockReturnInput{got.ReturnReceipts[0].ID, "restock-corrupt"}); !errors.Is(err, ErrInvalidState) || !reflect.DeepEqual(s.s, before) {
		t.Fatal("corrupt receipt overstocked original SKU", err)
	}
}

func TestReturnReceiptMultiSKURecoveryNeverPartiallyRestocks(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	_, owner := actor(t, 243)
	_, buyer := actor(t, 244)
	st, p := setupCatalog(t, s, owner, 5)
	variants := append(append([]Variant(nil), p.Variants...), Variant{ID: "return-second-variant", Name: "second", SKU: "RETURN-SECOND", PriceYNXT: 30, Inventory: 1})
	p, err = s.UpdateProduct(owner, p.ID, UpdateProductInput{Title: p.Title, Description: p.Description, Category: p.Category, Media: p.Media, Variants: variants, IdempotencyKey: "return-add-second-variant"})
	if err != nil {
		t.Fatal(err)
	}
	o, returnID := returnedOrder(t, s, owner, buyer, st, p, 1, "multi-sku-return", true, CartItem{p.ID, p.Variants[0].ID, 1}, CartItem{p.ID, p.Variants[1].ID, 1})
	in := receiveInput(o, returnID, "warehouse-multi-sku", "receive-multi-sku", 1)
	in.Items = append(in.Items, ReturnItem{p.ID, p.Variants[1].ID, "1"})
	got, err := s.ReceiveReturn(owner, o.ID, in)
	if err != nil {
		t.Fatal(err)
	}
	// The depleted variant can be retired from the current catalog. Returning
	// goods must not silently recreate it or partially add the other SKU.
	current, err := s.Product(p.ID)
	if err != nil {
		t.Fatal(err)
	}
	removed := UpdateProductInput{Title: current.Title, Description: current.Description, Category: current.Category, Media: current.Media, Variants: append([]Variant(nil), current.Variants[:1]...), IdempotencyKey: "return-retire-empty-variant"}
	current, err = s.UpdateProduct(owner, p.ID, removed)
	if err != nil {
		t.Fatal(err)
	}
	before, err := cloneSnapshot(s.s)
	if err != nil {
		t.Fatal(err)
	}
	restock := RestockReturnInput{got.ReturnReceipts[0].ID, "restock-multi-sku"}
	if _, err = s.RestockReturn(owner, o.ID, restock); !errors.Is(err, ErrInventory) || !reflect.DeepEqual(s.s, before) {
		t.Fatal("missing second SKU partially restocked first", err)
	}
	// Restore that exact original SKU through normal owner catalog authority,
	// then recover the same original receipt/key rather than recording goods twice.
	removed.Variants = append(removed.Variants, Variant{ID: p.Variants[1].ID, Name: "second", SKU: "RETURN-SECOND", PriceYNXT: 30, Inventory: 0})
	removed.IdempotencyKey = "return-restore-original-variant"
	if _, err = s.UpdateProduct(owner, p.ID, removed); err != nil {
		t.Fatal(err)
	}
	result, err := s.RestockReturn(owner, o.ID, restock)
	if err != nil {
		t.Fatal(err)
	}
	current, err = s.Product(p.ID)
	if err != nil || current.Variants[0].Inventory != 5 || current.Variants[1].Inventory != 1 || result.Refund != nil || result.Status != o.Status {
		t.Fatal("original multi-SKU recovery changed goods or funds", err)
	}
}

func TestReturnReceiptLatePaymentObservationKeepsFulfillmentAndRestock(t *testing.T) {
	// The original sale/return happened in the past. Observe it now under a
	// fresh current action, not a proof expired by an artificial future clock.
	s, o, owner, buyer, returnID := returnFixture(t, true, time.Now().UTC().Add(-2*time.Hour))
	got, err := s.ReceiveReturn(owner, o.ID, receiveInput(o, returnID, "warehouse-paid-replay", "receive-paid-replay", 2))
	if err != nil {
		t.Fatal(err)
	}
	got, err = s.RestockReturn(owner, o.ID, RestockReturnInput{got.ReturnReceipts[0].ID, "restock-paid-replay"})
	if err != nil {
		t.Fatal(err)
	}
	s.now = func() time.Time { return time.Now().UTC() }
	before, err := cloneSnapshot(s.s)
	if err != nil {
		t.Fatal(err)
	}
	if again, err := s.ConfirmSettlement(o.ID, *o.Settlement); err != nil || !reflect.DeepEqual(again, got) || !reflect.DeepEqual(s.s, before) {
		t.Fatal("exact old payment observation failed or rewound fulfilled return", err)
	}
	changed := *o.Settlement
	changed.AuditHash = strings.Repeat("f", 64)
	if _, err = s.ConfirmSettlement(o.ID, changed); !errors.Is(err, ErrConflict) || !reflect.DeepEqual(s.s, before) {
		t.Fatal("changed old payment receipt accepted", err)
	}
	calls := 0
	pay := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != "GET" || r.URL.Path != "/pay/invoices/"+o.InvoiceID+"/settlement" {
			t.Error("unexpected Pay effect", r.Method, r.URL.Path)
			w.WriteHeader(500)
			return
		}
		_ = json.NewEncoder(w).Encode(o.Settlement)
	}))
	defer pay.Close()
	server := NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}, Pay: HTTPPayVerifier{BaseURL: pay.URL, APIKey: "controlled-test-pay-key"}})
	w := businessHTTPRequest(server, "POST", "/api/orders/"+o.ID+"/confirm-payment", strings.Repeat("w", 43), `{}`)
	var observed Order
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &observed) != nil || observed.Status != got.Status || len(observed.ReturnReceipts) != 1 || observed.Refund != nil || calls != 1 || s.s.Products[o.Lines[0].ProductID].Variants[0].Inventory != 5 {
		t.Fatal("normal observation lost original paid/returned facts or touched stock", w.Code, w.Body.String(), calls)
	}
}

func TestReturnReceiptSchema15MigrationKeepsOriginalOrder(t *testing.T) {
	s, o, _, buyer, _ := returnFixture(t, true)
	s.s.Version = 15
	if err := s.persistLocked(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(s.path)
	if err != nil {
		t.Fatal(err)
	}
	read, err := reopened.Order(buyer, "buyer", o.ID)
	if err != nil || !reflect.DeepEqual(read, o) || reopened.s.Version != 16 {
		t.Fatal("legacy order migration changed business data", err)
	}
	// No new warehouse fact appears merely because the schema was upgraded.
	request := httptest.NewRequest("GET", "/health", nil)
	response := httptest.NewRecorder()
	NewServer(reopened, ServerConfig{}).Handler().ServeHTTP(response, request)
	if response.Code != 200 || len(read.ReturnReceipts) != 0 {
		t.Fatal("upgrade manufactured a goods receipt")
	}
}
