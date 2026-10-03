package commerce

import (
	"encoding/json"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func settlementFixture(t *testing.T) (*Store, string, Order, SettlementEvidence) {
	t.Helper()
	s, buyer, order := effectOrderFixture(t, filepath.Join(t.TempDir(), "state.json"))
	order, err := s.BindInvoice(buyer, order.ID, PayInvoiceHandoff{InvoiceID: "observed-invoice", IntentID: "observed-intent", Merchant: "observed-merchant", PayoutAddress: buyer})
	if err != nil {
		t.Fatal(err)
	}
	native, err := accountaddress.Encode(buyer)
	if err != nil {
		t.Fatal(err)
	}
	evidence := SettlementEvidence{InvoiceID: order.InvoiceID, IntentID: order.PayIntentID, Merchant: order.PayMerchant, PayoutAddress: native, Payer: native, Status: "paid", Currency: NativeSymbol, TransactionHash: "0x" + strings.Repeat("a", 64), AuditHash: strings.Repeat("b", 64), AmountYNXT: order.TotalYNXT, BlockHeight: 42, ConfirmedAt: time.Now().UTC()}
	return s, buyer, order, evidence
}

func TestBusinessSettlementPendingOrInvalidObservationCanBeQueriedWithNewProof(t *testing.T) {
	for _, first := range []string{"pending", "wrong amount", "unavailable", "malformed"} {
		t.Run(first, func(t *testing.T) {
			s, buyer, order, evidence := settlementFixture(t)
			var calls atomic.Int32
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "GET" || r.URL.Path != "/pay/invoices/observed-invoice/settlement" {
					t.Error("query changed into side effect", r.Method, r.URL.Path)
				}
				count := calls.Add(1)
				current := evidence
				if count == 1 {
					switch first {
					case "pending":
						w.WriteHeader(404)
						w.Write([]byte(`{"error":"not yet paid"}`))
						return
					case "unavailable":
						w.WriteHeader(503)
						w.Write([]byte(`{"error":"unavailable"}`))
						return
					case "wrong amount":
						current.AmountYNXT++
					case "malformed":
						w.Write([]byte(`{"invalid":`))
						return
					}
				}
				json.NewEncoder(w).Encode(current)
			}))
			defer provider.Close()
			cfg := ServerConfig{businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}, Pay: HTTPPayVerifier{BaseURL: provider.URL, APIKey: "qa"}}
			server := NewServer(s, cfg)
			route := "/api/orders/" + order.ID + "/confirm-payment"
			w := businessHTTPRequest(server, "POST", route, strings.Repeat("b", 43), `{}`)
			if w.Code < 400 || calls.Load() != 1 {
				t.Fatal("invalid receipt committed", w.Code)
			}
			got, _ := s.Order(buyer, "buyer", order.ID)
			if got.Status != "payment_pending" || got.Settlement != nil {
				t.Fatal("bad observation changed order")
			}
			if w := businessHTTPRequest(server, "POST", route, strings.Repeat("b", 43), `{}`); w.Code != 409 || calls.Load() != 1 {
				t.Fatal("one action queried twice")
			}
			r, err := Open(s.path)
			if err != nil {
				t.Fatal(err)
			}
			w = businessHTTPRequest(NewServer(r, cfg), "POST", route, strings.Repeat("c", 43), `{}`)
			if w.Code != 200 || calls.Load() != 2 {
				t.Fatal("fresh observation blocked", w.Code, w.Body.String())
			}
			got, _ = r.Order(buyer, "buyer", order.ID)
			if got.Status != "paid" || got.Settlement == nil || got.Settlement.Payer != evidence.Payer || got.Settlement.PayoutAddress != evidence.PayoutAddress {
				t.Fatal("authoritative native receipt rewritten or not applied")
			}
			product := r.s.Products[order.Lines[0].ProductID]
			if product.Variants[0].Inventory != 5-order.Lines[0].Quantity || product.Variants[0].Reserved != 0 {
				t.Fatal("payment inventory not finalized once")
			}
			if len(r.s.BusinessEffects) != 2 {
				t.Fatal("prior observation lost")
			}
		})
	}
}

func TestConcurrentBusinessSettlementObservationsDeductInventoryOnce(t *testing.T) {
	s, buyer, order, evidence := settlementFixture(t)
	var calls atomic.Int32
	release := make(chan struct{})
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 2 {
			close(release)
		}
		<-release
		json.NewEncoder(w).Encode(evidence)
	}))
	defer provider.Close()
	server := NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}, Pay: HTTPPayVerifier{BaseURL: provider.URL, APIKey: "qa"}})
	done := make(chan *httptest.ResponseRecorder, 2)
	for _, nonce := range []string{strings.Repeat("b", 43), strings.Repeat("c", 43)} {
		go func(nonce string) {
			done <- businessHTTPRequest(server, "POST", "/api/orders/"+order.ID+"/confirm-payment", nonce, `{}`)
		}(nonce)
	}
	for i := 0; i < 2; i++ {
		if w := <-done; w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	product := s.s.Products[order.Lines[0].ProductID]
	if product.Variants[0].Inventory != 5-order.Lines[0].Quantity || product.Variants[0].Reserved != 0 {
		t.Fatal("concurrent reads deducted inventory twice")
	}
	if calls.Load() != 2 || len(s.s.BusinessNonces) != 2 || len(s.s.BusinessEffects) != 2 {
		t.Fatal("separate signed observation evidence lost")
	}
}

func TestBusinessSettlementRejectsForeignOwnershipAndNonObjectBodyBeforeQuery(t *testing.T) {
	s, buyer, order, _ := settlementFixture(t)
	_, foreign := actor(t, 3)
	var calls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { calls.Add(1) }))
	defer provider.Close()
	for _, test := range []struct {
		account, role, body string
		status              int
	}{{buyer, "buyer", "null", 400}, {foreign, "buyer", "{}", 403}, {buyer, "seller", "{}", 403}} {
		server := NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: test.account, role: test.role}, Pay: HTTPPayVerifier{BaseURL: provider.URL, APIKey: "qa"}})
		w := businessHTTPRequest(server, "POST", "/api/orders/"+order.ID+"/confirm-payment", strings.Repeat("b", 43), test.body)
		if w.Code != test.status || calls.Load() != 0 || len(s.s.BusinessNonces) != 0 || len(s.s.BusinessEffects) != 0 {
			t.Fatal("rejected read queried provider or consumed action", w.Code, test.status)
		}
	}
}

func TestBusinessSettlementAwaitReplacementOrOrderCancellationNeverAppliesLateReceipt(t *testing.T) {
	for _, action := range []string{"actor", "cancel", "expiry"} {
		t.Run(action, func(t *testing.T) {
			s, buyer, order, evidence := settlementFixture(t)
			var active atomic.Bool
			active.Store(true)
			started, release := make(chan struct{}), make(chan struct{})
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				close(started)
				<-release
				json.NewEncoder(w).Encode(evidence)
			}))
			defer provider.Close()
			cfg := ServerConfig{businessV2: controlledBusinessVerifier{account: buyer, role: "buyer", fence: func() error {
				if !active.Load() {
					return ErrUnauthorized
				}
				return nil
			}}, Pay: HTTPPayVerifier{BaseURL: provider.URL, APIKey: "qa"}}
			done := make(chan *httptest.ResponseRecorder, 1)
			go func() {
				done <- businessHTTPRequest(NewServer(s, cfg), "POST", "/api/orders/"+order.ID+"/confirm-payment", strings.Repeat("b", 43), `{}`)
			}()
			<-started
			switch action {
			case "actor":
				active.Store(false)
			case "cancel":
				if _, err := s.transition(buyer, "buyer", order.ID, "cancelled", nil, nil, nil, "cancel-during-read"); err != nil {
					close(release)
					<-done
					t.Fatal(err)
				}
			case "expiry":
				s.mu.Lock()
				current := s.s.Orders[order.ID]
				current.ReservationExpiresAt = time.Now().Add(-time.Second)
				s.s.Orders[order.ID] = current
				err := s.persistLocked()
				s.mu.Unlock()
				if err != nil {
					close(release)
					<-done
					t.Fatal(err)
				}
			}
			close(release)
			w := <-done
			if w.Code < 400 || strings.Contains(w.Body.String(), "0x"+strings.Repeat("a", 64)) {
				t.Fatal("late private payment response released", w.Code)
			}
			r, err := Open(s.path)
			if err != nil {
				t.Fatal(err)
			}
			got, _ := r.Order(buyer, "buyer", order.ID)
			if got.Settlement != nil || got.Status == "paid" {
				t.Fatal("stale receipt applied")
			}
			for _, record := range r.s.BusinessEffects {
				if record.Phase != "observed" || len(record.Steps) != 1 || record.Steps[0].Phase != "received" {
					t.Fatal("real late receipt lost")
				}
			}
		})
	}
}

func TestPaidSettlementReplayStillValidatesOriginalReceiptBinding(t *testing.T) {
	s, buyer, order, evidence := settlementFixture(t)
	if _, err := s.ConfirmSettlement(order.ID, evidence); err != nil {
		t.Fatal(err)
	}
	for _, alter := range []string{"payer", "invoice", "amount", "audit", "transaction"} {
		t.Run(alter, func(t *testing.T) {
			bad := evidence
			switch alter {
			case "payer":
				_, bad.Payer = actor(t, 3)
			case "invoice":
				bad.InvoiceID = "foreign-invoice"
			case "amount":
				bad.AmountYNXT++
			case "audit":
				bad.AuditHash = strings.Repeat("z", 64)
			case "transaction":
				bad.TransactionHash = "0x" + strings.Repeat("z", 64)
			}
			if _, err := s.ConfirmSettlement(order.ID, bad); !errors.Is(err, ErrInvalidState) {
				t.Fatal("same-tx paid shortcut bypassed binding", err)
			}
		})
	}
	got, _ := s.Order(buyer, "buyer", order.ID)
	if got.Settlement.Payer != evidence.Payer {
		t.Fatal("raw payer modified")
	}
}
