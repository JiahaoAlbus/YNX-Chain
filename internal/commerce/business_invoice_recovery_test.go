package commerce

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func invoiceRecoveryFixture(t *testing.T) (*Store, Order, string, string) {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	_, owner := actor(t, 201)
	_, buyer := actor(t, 202)
	st, p := setupCatalog(t, s, owner, 8)
	o, err := s.CreateOrder(buyer, orderInput(st, p, "invoice-recovery-order"))
	if err != nil {
		t.Fatal(err)
	}
	o, err = s.BindInvoice(buyer, o.ID, PayInvoiceHandoff{InvoiceID: "inv_original", IntentID: "intent_original", Merchant: "merchant_original", PayoutAddress: owner})
	if err != nil {
		t.Fatal(err)
	}
	return s, o, buyer, owner
}
func TestV2BoundInvoiceRecoveryNeverCreatesAnotherPayIntent(t *testing.T) {
	s, o, buyer, _ := invoiceRecoveryFixture(t)
	calls := 0
	pay := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(500) }))
	defer pay.Close()
	server := NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}, Pay: HTTPPayVerifier{BaseURL: pay.URL, APIKey: "original-key", MerchantID: "merchant_original", PayoutAddress: "original-payout"}})
	audit := len(s.s.Audits)
	events := len(o.Timeline)
	nonce := strings.Repeat("b", 43)
	w := businessHTTPRequest(server, "POST", "/api/orders/"+o.ID+"/pay-handoff", nonce, `{"IdempotencyKey":"new-click-original-invoice"}`)
	if w.Code != 201 || !bytes.Contains(w.Body.Bytes(), []byte(`"deepLink":"ynxpay://invoice/inv_original"`)) || calls != 0 {
		t.Fatal(w.Code, w.Body.String(), calls)
	}
	if len(s.s.BusinessNonces) != 1 || len(s.s.Audits) != audit || len(s.s.Orders[o.ID].Timeline) != events {
		t.Fatal("recovery changed business or skipped action admission")
	}
	w = businessHTTPRequest(server, "POST", "/api/orders/"+o.ID+"/pay-handoff", nonce, `{"IdempotencyKey":"new-click-original-invoice"}`)
	if w.Code != 409 || calls != 0 {
		t.Fatal("action replay bypassed original nonce", w.Code, calls)
	}
}
func TestV2BoundInvoiceRecoveryRequiresCurrentOriginalBuyer(t *testing.T) {
	for _, foreign := range []bool{false, true} {
		s, o, buyer, owner := invoiceRecoveryFixture(t)
		account := buyer
		var fence func() error
		if foreign {
			account = owner
		} else {
			checks := 0
			fence = func() error {
				checks++
				if checks >= 4 {
					return ErrUnauthorized
				}
				return nil
			}
		}
		server := NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: account, role: "buyer", fence: fence}})
		w := businessHTTPRequest(server, "POST", "/api/orders/"+o.ID+"/pay-handoff", strings.Repeat("c", 43), `{"IdempotencyKey":"original-invoice-key"}`)
		if w.Code != 403 || len(s.s.BusinessNonces) != 0 || bytes.Contains(w.Body.Bytes(), []byte("inv_original")) {
			t.Fatal("foreign/replaced actor received invoice", foreign, w.Code, w.Body.String())
		}
	}
}
func TestV2UnboundInvoiceRecoveryLeavesOriginalEffectAdmissionUntouched(t *testing.T) {
	s, _ := Open("")
	_, owner := actor(t, 203)
	_, buyer := actor(t, 204)
	st, p := setupCatalog(t, s, owner, 8)
	o, err := s.CreateOrder(buyer, orderInput(st, p, "unbound-original-order"))
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}})
	w := businessHTTPRequest(server, "POST", "/api/orders/"+o.ID+"/pay-handoff", strings.Repeat("d", 43), `{"IdempotencyKey":"original-unbound-key"}`)
	if w.Code != 503 || len(s.s.BusinessNonces) != 0 || len(s.s.BusinessEffects) != 0 {
		t.Fatal("unconfigured original effect consumed nonce", w.Code, w.Body.String())
	}
}
func TestBoundInvoiceRecoveryRejectsIncompleteOrUnsafeOriginalBinding(t *testing.T) {
	_, o, _, _ := invoiceRecoveryFixture(t)
	for i := 0; i < 3; i++ {
		bad := o
		if i == 0 {
			bad.PayIntentID = ""
		}
		if i == 1 {
			bad.InvoiceID = "unsafe/invoice"
		}
		if i == 2 {
			bad.Status = "paid"
		}
		if _, err := boundInvoiceHandoff(bad); err != ErrInvalidState {
			t.Fatal("invalid original receipt exposed", i, err)
		}
	}
}

func TestV2BoundInvoiceRecoveryAfterRestartUsesStoredInvoiceAndNonce(t *testing.T) {
	original, o, buyer, _ := invoiceRecoveryFixture(t)
	reopened, err := Open(original.path)
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(reopened, ServerConfig{businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}})
	nonce := strings.Repeat("e", 43)
	w := businessHTTPRequest(server, "POST", "/api/orders/"+o.ID+"/pay-handoff", nonce, `{"IdempotencyKey":"restart-review-original-invoice"}`)
	if w.Code != 201 || !bytes.Contains(w.Body.Bytes(), []byte("inv_original")) {
		t.Fatal(w.Code, w.Body.String())
	}
	again, err := Open(original.path)
	if err != nil {
		t.Fatal(err)
	}
	if again.s.Orders[o.ID].InvoiceID != o.InvoiceID || len(again.s.BusinessNonces) != 1 || len(again.s.BusinessEffects) != 0 {
		t.Fatal("recovery did not preserve original bound invoice and action nonce")
	}
	server = NewServer(again, ServerConfig{businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}})
	w = businessHTTPRequest(server, "POST", "/api/orders/"+o.ID+"/pay-handoff", nonce, `{"IdempotencyKey":"restart-review-original-invoice"}`)
	if w.Code != 409 {
		t.Fatal("restarted action nonce was replayed", w.Code)
	}
}
