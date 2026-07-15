package commerce

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
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
	p, err := s.CreateProduct(owner, CreateProductInput{StoreID: st.ID, Title: "Field kit", Description: "Durable test kit", Category: "outdoor", IdempotencyKey: "product-key-001", Variants: []Variant{{Name: "Blue", SKU: "KIT-BLU", PriceYNXT: 25, Inventory: inventory}}})
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
	o, err = s.BindInvoice(buyer, o.ID, "invoice_123")
	if err != nil {
		t.Fatal(err)
	}
	bad := SettlementEvidence{InvoiceID: "invoice_123", TransactionHash: "0xdead", Status: "paid", AmountYNXT: 25, BlockHeight: 0}
	if _, err = s.ConfirmSettlement(o.ID, bad); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("uncommitted settlement accepted: %v", err)
	}
	still, _ := s.Order(buyer, "buyer", o.ID)
	if still.Status != "payment_pending" {
		t.Fatalf("order falsely paid: %s", still.Status)
	}
	good := bad
	good.BlockHeight = 99
	good.ConfirmedAt = time.Now().UTC()
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

func TestWalletChallengeBindsAccountCallbackScopeExpiryAndRejectsReplay(t *testing.T) {
	s, _ := Open("")
	key, account := actor(t, 6)
	cfg := AuthConfig{AllowedCallbacks: map[string]bool{"ynxshop://auth/callback": true}}
	c, err := s.CreateChallenge(ChallengeInput{Account: account, Callback: "ynxshop://auth/callback", DeviceID: "device-A", Purpose: "Sign in to YNX Shop", Scopes: []string{"shop.profile", "shop.orders"}}, cfg)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(challengeSignBytes(c))
	sig := ecdsa.Sign(key, digest[:]).Serialize()
	in := SessionInput{ChallengeID: c.ID, PublicKey: hex.EncodeToString(key.PubKey().SerializeCompressed()), Signature: hex.EncodeToString(sig), Role: "buyer"}
	sess, err := s.CompleteSession(in, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if sess.Account != account || sess.Role != "buyer" {
		t.Fatalf("wrong session: %+v", sess)
	}
	if _, err = s.CompleteSession(in, cfg); err == nil {
		t.Fatal("wallet challenge replay accepted")
	}
	if _, err = s.CreateChallenge(ChallengeInput{Account: account, Callback: "https://attacker.invalid", DeviceID: "device-A", Purpose: "Sign in", Scopes: []string{"shop.profile"}}, cfg); err == nil {
		t.Fatal("callback substitution accepted")
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
