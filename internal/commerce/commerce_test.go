package commerce

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func actor(t *testing.T, seed byte) (*secp256k1.PrivateKey, string) {
	t.Helper()
	b := make([]byte, 32)
	b[31] = seed
	k := secp256k1.PrivKeyFromBytes(b)
	a, err := consensus.NativeAddress(k.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	return k, a
}
func setupCatalog(t *testing.T, s *Store, owner string, inventory int64) (StoreProfile, Product) {
	t.Helper()
	st, err := s.CreateStore(owner, CreateStoreInput{Name: "Verified goods", Policy: "30 day return policy", IdempotencyKey: "store-key-0001"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.ActivateStore(owner, st.ID); err != nil {
		t.Fatal(err)
	}
	p, err := s.CreateProduct(owner, CreateProductInput{StoreID: st.ID, Title: "Field kit", Description: "Durable test kit", Category: "outdoor", Media: []MediaAsset{{URL: "https://media.example/field-kit.jpg", AltText: "Blue field kit", Kind: "image"}}, IdempotencyKey: "product-key-001", Variants: []Variant{{Name: "Blue", SKU: "KIT-BLU", PriceYNXT: 25, Inventory: inventory}}})
	if err != nil {
		t.Fatal(err)
	}
	p, err = s.PublishProduct(owner, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	return st, p
}
func orderInput(st StoreProfile, p Product, key string) OrderInput {
	return OrderInput{StoreID: st.ID, Items: []CartItem{{ProductID: p.ID, VariantID: p.Variants[0].ID, Quantity: 1}}, Address: Address{Recipient: "Buyer", Line1: "1 Chain Road", City: "Shenzhen", Country: "CN"}, IdempotencyKey: key}
}

func TestConcurrentReservationPreventsOversellingAndRecoversAfterRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "commerce.json")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	_, owner := actor(t, 1)
	_, buyerA := actor(t, 2)
	_, buyerB := actor(t, 3)
	st, p := setupCatalog(t, s, owner, 1)
	var wg sync.WaitGroup
	wg.Add(2)
	errs := make(chan error, 2)
	for i, buyer := range []string{buyerA, buyerB} {
		go func(i int, buyer string) {
			defer wg.Done()
			_, err := s.CreateOrder(buyer, orderInput(st, p, []string{"order-key-0001", "order-key-0002"}[i]))
			errs <- err
		}(i, buyer)
	}
	wg.Wait()
	close(errs)
	success, inventoryFailures := 0, 0
	for err := range errs {
		if err == nil {
			success++
		} else if errors.Is(err, ErrInventory) {
			inventoryFailures++
		} else {
			t.Fatalf("unexpected error: %v", err)
		}
	}
	if success != 1 || inventoryFailures != 1 {
		t.Fatalf("success=%d inventoryFailures=%d", success, inventoryFailures)
	}
	reloaded, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	listed := reloaded.Products("", "")
	if len(listed) != 1 || listed[0].Variants[0].Reserved != 1 || listed[0].Variants[0].Inventory != 1 {
		t.Fatalf("reservation not durable: %+v", listed)
	}
	// Advance beyond reservation TTL and prove restart recovery releases stock.
	reloaded.now = func() time.Time { return time.Now().UTC().Add(time.Hour) }
	if err := reloaded.Recover(); err != nil {
		t.Fatal(err)
	}
	listed = reloaded.Products("", "")
	if listed[0].Variants[0].Reserved != 0 || listed[0].Variants[0].Inventory != 1 {
		t.Fatalf("expired reservation not released: %+v", listed[0].Variants[0])
	}
}

func TestPaidRequiresExactCommittedSettlementEvidence(t *testing.T) {
	s, _ := Open("")
	_, owner := actor(t, 4)
	_, buyer := actor(t, 5)
	st, p := setupCatalog(t, s, owner, 1)
	o, err := s.CreateOrder(buyer, orderInput(st, p, "order-paid-0001"))
	if err != nil {
		t.Fatal(err)
	}
	handoff := PayInvoiceHandoff{IntentID: "intent_123", InvoiceID: "invoice_123", DeepLink: "ynxpay://invoice/invoice_123", Merchant: "merchant_shop", PayoutAddress: owner}
	o, err = s.BindInvoice(buyer, o.ID, handoff)
	if err != nil {
		t.Fatal(err)
	}
	bad := SettlementEvidence{InvoiceID: "invoice_123", IntentID: "intent_123", Merchant: "merchant_shop", PayoutAddress: owner, TransactionHash: "0xdead", Status: "paid", Payer: buyer, Currency: NativeSymbol, AuditHash: strings.Repeat("b", 64), AmountYNXT: 25, BlockHeight: 0, ConfirmedAt: time.Now().UTC()}
	if _, err = s.ConfirmSettlement(o.ID, bad); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("uncommitted settlement accepted: %v", err)
	}
	still, _ := s.Order(buyer, "buyer", o.ID)
	if still.Status != "payment_pending" {
		t.Fatalf("order falsely paid: %s", still.Status)
	}
	good := bad
	good.BlockHeight = 99
	good.TransactionHash = "0x" + strings.Repeat("a", 64)
	good.ConfirmedAt = time.Now().UTC()
	for name, mutate := range map[string]func(*SettlementEvidence){
		"invoice":  func(e *SettlementEvidence) { e.InvoiceID = "invoice_attacker" },
		"intent":   func(e *SettlementEvidence) { e.IntentID = "intent_attacker" },
		"merchant": func(e *SettlementEvidence) { e.Merchant = "merchant_attacker" },
		"payout":   func(e *SettlementEvidence) { e.PayoutAddress = buyer },
		"payer":    func(e *SettlementEvidence) { e.Payer = owner },
		"currency": func(e *SettlementEvidence) { e.Currency = "FAKE" },
		"amount":   func(e *SettlementEvidence) { e.AmountYNXT++ },
		"audit":    func(e *SettlementEvidence) { e.AuditHash = "not-a-committed-audit-hash" },
		"tx":       func(e *SettlementEvidence) { e.TransactionHash = "0xdead" },
	} {
		t.Run("reject_tampered_"+name, func(t *testing.T) {
			candidate := good
			mutate(&candidate)
			if _, err := s.ConfirmSettlement(o.ID, candidate); !errors.Is(err, ErrInvalidState) {
				t.Fatalf("tampered %s evidence accepted: %v", name, err)
			}
		})
	}
	paid, err := s.ConfirmSettlement(o.ID, good)
	if err != nil {
		t.Fatal(err)
	}
	if paid.Status != "paid" || paid.Settlement == nil {
		t.Fatalf("settlement not attached: %+v", paid)
	}
	product, _ := s.Product(p.ID)
	if product.Variants[0].Inventory != 0 || product.Variants[0].Reserved != 0 {
		t.Fatalf("inventory not consumed exactly once: %+v", product.Variants[0])
	}
	replay, err := s.ConfirmSettlement(o.ID, good)
	if err != nil || replay.Status != "paid" {
		t.Fatalf("idempotent settlement replay failed: %v", err)
	}
}

func TestRefundRequiresExactCommittedPayEvidence(t *testing.T) {
	s, _ := Open("")
	_, owner := actor(t, 46)
	_, buyer := actor(t, 47)
	st, product := setupCatalog(t, s, owner, 1)
	o, err := s.CreateOrder(buyer, orderInput(st, product, "refund-order-key-0001"))
	if err != nil {
		t.Fatal(err)
	}
	o, err = s.BindInvoice(buyer, o.ID, PayInvoiceHandoff{IntentID: "intent_refund", InvoiceID: "invoice_refund", Merchant: "merchant_refund", PayoutAddress: owner})
	if err != nil {
		t.Fatal(err)
	}
	o, err = s.ConfirmSettlement(o.ID, SettlementEvidence{InvoiceID: o.InvoiceID, IntentID: o.PayIntentID, Merchant: o.PayMerchant, PayoutAddress: o.PayPayoutAddress, TransactionHash: "0x" + strings.Repeat("a", 64), Status: "paid", Payer: buyer, Currency: NativeSymbol, AuditHash: strings.Repeat("b", 64), AmountYNXT: o.TotalYNXT, BlockHeight: 80, ConfirmedAt: time.Now().UTC()})
	if err != nil {
		t.Fatal(err)
	}
	o, err = s.transition(buyer, "buyer", o.ID, "refund_requested", nil, &Resolution{Kind: "refund", Reason: "approved return"}, nil, "refund-request-key-1")
	if err != nil {
		t.Fatal(err)
	}
	o, err = s.transition(owner, "seller", o.ID, "refund_approved", nil, &Resolution{Kind: "refund"}, nil, "refund-approve-key-1")
	if err != nil {
		t.Fatal(err)
	}
	good := RefundEvidence{ID: "refund_1", Signer: owner, Merchant: o.PayMerchant, IntentID: o.PayIntentID, Currency: NativeSymbol, Reason: "approved return", Status: "recorded", IdempotencyKey: "shop-refund-refund-approve-key-1", RequestHash: strings.Repeat("c", 64), TransactionHash: strings.Repeat("d", 64), AuditHash: strings.Repeat("e", 64), AmountYNXT: o.TotalYNXT, BlockHeight: 81, RecordedAt: time.Now().UTC()}
	bad := good
	bad.AmountYNXT++
	if _, err := s.BindRefundEvidence(owner, o.ID, bad); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("tampered refund evidence accepted: %v", err)
	}
	refunded, err := s.BindRefundEvidence(owner, o.ID, good)
	if err != nil || refunded.Status != "refunded" || refunded.RefundStatus != "recorded_by_authoritative_pay" || refunded.Refund == nil {
		t.Fatalf("committed refund evidence not bound: %+v %v", refunded, err)
	}
}

func TestIdempotencyTamperRejectedAfterRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "commerce.json")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	_, owner := actor(t, 44)
	_, buyer := actor(t, 45)
	st, p := setupCatalog(t, s, owner, 2)
	input := orderInput(st, p, "restart-order-idempotency-1")
	first, err := s.CreateOrder(buyer, input)
	if err != nil {
		t.Fatal(err)
	}
	reloaded, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := reloaded.CreateOrder(buyer, input)
	if err != nil || replay.ID != first.ID {
		t.Fatalf("restart replay changed result: %v %+v", err, replay)
	}
	input.Items[0].Quantity = 2
	if _, err := reloaded.CreateOrder(buyer, input); !errors.Is(err, ErrConflict) {
		t.Fatalf("tampered restart replay accepted: %v", err)
	}
}

func TestStateMigrationDropsLegacyPlaintextSessions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.json")
	legacy := map[string]any{"Version": 1, "Sessions": map[string]any{"plaintext-bearer": map[string]any{"Token": "plaintext-bearer"}}, "Challenges": map[string]any{"legacy": map[string]any{"Nonce": "secret"}}}
	data, _ := json.Marshal(legacy)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(path); err != nil {
		t.Fatal(err)
	}
	sanitized, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(sanitized, []byte("plaintext-bearer")) || bytes.Contains(sanitized, []byte("Challenges")) {
		t.Fatalf("legacy auth material survived migration: %s", sanitized)
	}
}

func TestAuthenticatedStateFailsClosedAndRestoresVerifiedBackup(t *testing.T) {
	path := filepath.Join(t.TempDir(), "commerce-authenticated.json")
	key := bytes.Repeat([]byte{0x42}, 32)
	s, err := OpenWithIntegrity(path, key)
	if err != nil {
		t.Fatal(err)
	}
	_, owner := actor(t, 55)
	if _, err = s.CreateStore(owner, CreateStoreInput{Name: "Integrity store", Policy: "Verified returns", IdempotencyKey: "integrity-store-1"}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.CreateStore(owner, CreateStoreInput{Name: "Backup trigger", Policy: "Verified returns", IdempotencyKey: "integrity-store-2"}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	data[len(data)/2] ^= 1
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenWithIntegrity(path, key); err == nil || !strings.Contains(err.Error(), "HMAC mismatch") {
		t.Fatalf("tampered state did not fail closed: %v", err)
	}
	if err := RestoreCommerceBackup(path, key); err != nil {
		t.Fatal(err)
	}
	restored, err := OpenWithIntegrity(path, key)
	if err != nil {
		t.Fatal(err)
	}
	if len(restored.SellerStores(owner)) != 1 {
		t.Fatalf("verified backup was not restored: %+v", restored.SellerStores(owner))
	}
	wrongKey := bytes.Repeat([]byte{0x24}, 32)
	if _, err := OpenWithIntegrity(path, wrongKey); err == nil {
		t.Fatal("state opened with wrong integrity key")
	}
}

type fakeAI struct {
	result string
	err    error
}

func (f fakeAI) Generate(context.Context, AIJob) (string, error) { return f.result, f.err }
func TestAIRequiresPermissionProviderAndHumanReview(t *testing.T) {
	s, _ := Open("")
	_, user := actor(t, 7)
	base := AIInput{Workflow: "catalog_creation", ContextClasses: []string{"seller_catalog_draft"}, ContextSummary: "title and description only", EstimateUnits: 10, IdempotencyKey: "ai-job-key-0001"}
	if _, err := s.CreateAIJob(user, base); err == nil {
		t.Fatal("AI job accepted without permission")
	}
	base.PermissionGranted = true
	j, err := s.CreateAIJob(user, base)
	if err != nil {
		t.Fatal(err)
	}
	j, err = s.RunAIJob(context.Background(), user, j.ID, fakeAI{err: ErrUnavailable})
	if !errors.Is(err, ErrUnavailable) || j.Status != "failed" {
		t.Fatalf("provider failure disguised: %+v %v", j, err)
	}
	j, err = s.RunAIJob(context.Background(), user, j.ID, fakeAI{result: "Recovered draft"})
	if err != nil || j.Status != "review_required" {
		t.Fatalf("AI retry did not recover: %+v %v", j, err)
	}
	if _, err = s.DecideAIJob(user, j.ID, "reject"); err != nil {
		t.Fatal(err)
	}
	if err = s.DeleteAIJob(user, j.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.AIJob(user, j.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("AI deletion failed: %v", err)
	}
	base.IdempotencyKey = "ai-job-key-0002"
	j, err = s.CreateAIJob(user, base)
	if err != nil {
		t.Fatal(err)
	}
	j, err = s.RunAIJob(context.Background(), user, j.ID, fakeAI{result: "Draft title"})
	if err != nil || j.Status != "review_required" || j.Applied {
		t.Fatalf("AI auto-applied: %+v %v", j, err)
	}
	j, err = s.DecideAIJob(user, j.ID, "apply")
	if err != nil || j.Status != "applied_draft" {
		t.Fatalf("explicit draft apply failed: %+v %v", j, err)
	}
	for _, action := range j.AllowedActions {
		if action == "publish_product" || action == "change_price" {
			t.Fatalf("protected action exposed to AI: %s", action)
		}
	}
}

func TestOrderAuthorizationAndLifecycle(t *testing.T) {
	s, _ := Open("")
	_, owner := actor(t, 8)
	_, buyer := actor(t, 9)
	_, attacker := actor(t, 10)
	st, p := setupCatalog(t, s, owner, 2)
	o, err := s.CreateOrder(buyer, orderInput(st, p, "order-life-0001"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Order(attacker, "buyer", o.ID); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("cross-account order read accepted: %v", err)
	}
	if _, err = s.transition(owner, "seller", o.ID, "shipped", &Shipment{Carrier: "external", TrackingNumber: "fake"}, nil, nil); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("unpaid order shipped: %v", err)
	}
	if _, err = s.transition(buyer, "buyer", o.ID, "cancelled", nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	product, _ := s.Product(p.ID)
	if product.Variants[0].Reserved != 0 {
		t.Fatal("cancel did not release inventory")
	}
}

func TestCatalogRevisionHistoryAndViewerReadOnlyRole(t *testing.T) {
	s, _ := Open("")
	_, owner := actor(t, 70)
	_, viewer := actor(t, 71)
	st, product := setupCatalog(t, s, owner, 3)
	if err := s.SetSellerRole(owner, st.ID, viewer, "viewer"); err != nil {
		t.Fatal(err)
	}
	if rows, err := s.SellerProducts(viewer, st.ID); err != nil || len(rows) != 1 {
		t.Fatalf("viewer could not read catalog: %v %+v", err, rows)
	}
	if _, err := s.SetInventory(viewer, InventoryInput{StoreID: st.ID, ProductID: product.ID, VariantID: product.Variants[0].ID, Inventory: 4, IdempotencyKey: "viewer-inventory-1"}); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("viewer mutated inventory: %v", err)
	}
	in := UpdateProductInput{Title: "Field kit v2", Description: "Documented edit", Category: "outdoor", Media: product.Media, Variants: product.Variants, IdempotencyKey: "catalog-update-1"}
	updated, err := s.UpdateProduct(owner, product.ID, in)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Revision < 3 || len(updated.EditHistory) < 3 || updated.EditHistory[len(updated.EditHistory)-1].Action != "updated" {
		t.Fatalf("catalog edit history missing: %+v", updated)
	}
	in.Title = "tampered retry"
	if _, err := s.UpdateProduct(owner, product.ID, in); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed catalog replay accepted: %v", err)
	}
}
