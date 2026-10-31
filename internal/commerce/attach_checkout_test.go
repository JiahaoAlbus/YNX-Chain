package commerce

import (
	"bytes"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
)

func TestP0703AttachCheckoutRetryPreservesOriginalBinding(t *testing.T) {
	s, original, buyer, _ := invoiceRecoveryFixture(t)
	before, err := os.ReadFile(s.path)
	if err != nil {
		t.Fatal(err)
	}
	handoff, err := boundInvoiceHandoff(original)
	if err != nil {
		t.Fatal(err)
	}
	audits := len(s.s.Audits)
	again, err := s.BindInvoice(buyer, original.ID, handoff)
	if err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(s.path)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(again, original) || !bytes.Equal(before, after) || len(s.s.Audits) != audits {
		t.Fatal("same original binding must not change timestamps, timeline, audit or persisted bytes")
	}
}

func TestP0703AttachCheckoutRejectsOriginalBindingReplacement(t *testing.T) {
	s, original, buyer, _ := invoiceRecoveryFixture(t)
	handoff, _ := boundInvoiceHandoff(original)
	for _, field := range []string{"invoice", "intent", "merchant", "payout"} {
		t.Run(field, func(t *testing.T) {
			changed := handoff
			switch field {
			case "invoice":
				changed.InvoiceID += "_other"
			case "intent":
				changed.IntentID += "_other"
			case "merchant":
				changed.Merchant += "_other"
			case "payout":
				changed.PayoutAddress += "_other"
			}
			if _, err := s.BindInvoice(buyer, original.ID, changed); !errors.Is(err, ErrConflict) {
				t.Fatal("replacement accepted", err)
			}
			if !reflect.DeepEqual(s.s.Orders[original.ID], original) {
				t.Fatal("rejected replacement changed original order")
			}
		})
	}
}

func attachmentOrders(t *testing.T) (*Store, Order, Order, string, PayInvoiceHandoff) {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	_, owner := actor(t, 211)
	_, buyer := actor(t, 212)
	store, product := setupCatalog(t, s, owner, 8)
	first, err := s.CreateOrder(buyer, orderInput(store, product, "attach-first-order"))
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.CreateOrder(buyer, orderInput(store, product, "attach-second-order"))
	if err != nil {
		t.Fatal(err)
	}
	return s, first, second, buyer, PayInvoiceHandoff{InvoiceID: "invoice_original", IntentID: "intent_original", Merchant: "merchant_original", PayoutAddress: owner}
}

func TestP0703AttachCheckoutRejectsCrossOrderInvoiceOrIntentAfterRestart(t *testing.T) {
	for _, reused := range []string{"invoice", "intent"} {
		t.Run(reused, func(t *testing.T) {
			s, first, second, buyer, handoff := attachmentOrders(t)
			if _, err := s.BindInvoice(buyer, first.ID, handoff); err != nil {
				t.Fatal(err)
			}
			reopened, err := Open(s.path)
			if err != nil {
				t.Fatal(err)
			}
			changed := handoff
			if reused == "invoice" {
				changed.IntentID = "another_intent"
			} else {
				changed.InvoiceID = "another_invoice"
			}
			before, _ := os.ReadFile(s.path)
			if _, err := reopened.BindInvoice(buyer, second.ID, changed); !errors.Is(err, ErrConflict) {
				t.Fatal("same-amount second order reused original "+reused, err)
			}
			after, _ := os.ReadFile(s.path)
			if !bytes.Equal(before, after) || reopened.s.Orders[second.ID].InvoiceID != "" {
				t.Fatal("rejected cross-order attachment changed storage")
			}
		})
	}
}

func TestP0703AttachCheckoutConcurrentClaimHasOneOwner(t *testing.T) {
	s, first, second, buyer, handoff := attachmentOrders(t)
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, id := range []string{first.ID, second.ID} {
		wg.Add(1)
		go func(id string) { defer wg.Done(); _, err := s.BindInvoice(buyer, id, handoff); results <- err }(id)
	}
	wg.Wait()
	close(results)
	winners, conflicts := 0, 0
	for err := range results {
		if err == nil {
			winners++
		} else if errors.Is(err, ErrConflict) {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if winners != 1 || conflicts != 1 {
		t.Fatalf("one invoice/intent claimed by %d orders; conflicts=%d", winners, conflicts)
	}
}

func TestP0703AttachCheckoutPersistenceFailureDoesNotCreateMemoryOnlySuccess(t *testing.T) {
	s, first, _, buyer, handoff := attachmentOrders(t)
	before, err := cloneSnapshot(s.s)
	if err != nil {
		t.Fatal(err)
	}
	blocked := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(blocked, []byte("blocked"), 0600); err != nil {
		t.Fatal(err)
	}
	s.path = filepath.Join(blocked, "state.json")
	if _, err := s.BindInvoice(buyer, first.ID, handoff); err == nil {
		t.Fatal("failed durable write reported success")
	}
	if !reflect.DeepEqual(before, s.s) {
		t.Fatal("failed durable binding left a memory-only invoice or audit")
	}
}

func TestP0703AttachCheckoutIncompleteLegacyBindingStaysReadableAndNeverDispatches(t *testing.T) {
	s, first, _, buyer, handoff := attachmentOrders(t)
	legacy := s.s.Orders[first.ID]
	legacy.PayIntentID = handoff.IntentID
	s.s.Orders[first.ID] = legacy
	if err := s.persistLocked(); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(s.path)
	calls := 0
	pay := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(500) }))
	defer pay.Close()
	server := NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}, Pay: HTTPPayVerifier{BaseURL: pay.URL, APIKey: "isolated-test-key", MerchantID: handoff.Merchant, PayoutAddress: handoff.PayoutAddress}})
	w := businessHTTPRequest(server, "POST", "/api/orders/"+first.ID+"/pay-handoff", strings.Repeat("g", 43), `{"IdempotencyKey":"legacy-no-new-session"}`)
	if calls != 0 || w.Code == http.StatusCreated || len(s.s.BusinessEffects) != 0 || len(s.s.BusinessNonces) != 0 {
		t.Fatalf("historical_unverified binding dispatched or consumed admission: calls=%d status=%d", calls, w.Code)
	}
	after, _ := os.ReadFile(s.path)
	read, err := s.Order(buyer, "buyer", first.ID)
	if err != nil || !reflect.DeepEqual(read, legacy) {
		t.Fatal("historical_unverified order changed or became unreadable", err)
	}
	var beforeState, afterState Snapshot
	if err := decodePersisted(before, nil, &beforeState); err != nil {
		t.Fatal(err)
	}
	if err := decodePersisted(after, nil, &afterState); err != nil {
		t.Fatal(err)
	}
	// The original HTTP security middleware must retain its request-rate accounting.
	// Every other persisted field, including orders/stock/audits/effects, is unchanged.
	if len(afterState.RequestWindow) <= len(beforeState.RequestWindow) {
		t.Fatal("normal HTTP rate accounting was skipped")
	}
	afterState.RequestWindow = beforeState.RequestWindow
	if !reflect.DeepEqual(beforeState, afterState) {
		t.Fatal("rejected legacy attachment changed persisted business state")
	}
	if _, err := s.BindInvoice(buyer, first.ID, handoff); !errors.Is(err, ErrConflict) {
		t.Fatal("legacy partial binding was silently promoted", err)
	}
}

func TestP0703AttachCheckoutRejectsRedirectedDeepLinkWithoutMutation(t *testing.T) {
	s, original, buyer, _ := invoiceRecoveryFixture(t)
	handoff, _ := boundInvoiceHandoff(original)
	handoff.DeepLink = "ynxpay://invoice/another_order_invoice"
	if _, err := s.BindInvoice(buyer, original.ID, handoff); !errors.Is(err, ErrInvalidState) {
		t.Fatal("redirected invoice link accepted", err)
	}
	if !reflect.DeepEqual(s.s.Orders[original.ID], original) {
		t.Fatal("invalid link changed original order")
	}
}
