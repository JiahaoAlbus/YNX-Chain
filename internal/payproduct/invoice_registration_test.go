package payproduct

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"reflect"
	"testing"
	"time"
)

// T-P06-01: a remote alias is an immutable invoice slot, even when transport
// identities differ. A one-unit request cannot replace a registered 100 invoice.
func TestRegisterInvoiceRejectsCanonicalAliasOverwrite(t *testing.T) {
	for _, amount := range []int64{1, 100} {
		t.Run(fmt.Sprint(amount), func(t *testing.T) {
			now := time.Date(2026, 10, 31, 1, 0, 0, 0, time.UTC)
			pay := &fakePay{}
			service, path := testService(t, pay, func() time.Time { return now })
			merchant, _ := onboard(t, service)
			pay.invoice.Merchant, pay.invoice.PayoutAddress, pay.invoice.Amount = merchant.CentralMerchantID, merchant.PayoutAddress, 100
			original, err := service.CreateInvoice(context.Background(), merchant, InvoiceInput{Amount: 100, ExpiresInMinutes: 30, IdempotencyKey: "invoice-original-100"})
			if err != nil {
				t.Fatal(err)
			}
			pay.invoice.Amount = amount
			if _, err = service.CreateInvoice(context.Background(), merchant, InvoiceInput{Amount: amount, ExpiresInMinutes: 30, IdempotencyKey: "different-transport-key"}); err == nil {
				t.Fatal("canonical invoice alias was accepted under a second registration")
			}
			reopened, err := OpenStore(path, service.key)
			if err != nil {
				t.Fatal(err)
			}
			if err = reopened.View(func(data Snapshot) error {
				if !reflect.DeepEqual(data.Invoices[original.ID], original) {
					t.Fatal("original immutable invoice changed")
				}
				if len(data.Invoices) != 1 {
					t.Fatalf("invoice count %d", len(data.Invoices))
				}
				if _, ok := data.Idempotency["invoice:"+merchant.ID+":different-transport-key"]; ok {
					t.Fatal("conflicting alias committed an idempotency receipt")
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestRegisterInvoiceRejectsForgedMerchantIdentity(t *testing.T) {
	now := time.Date(2026, 10, 31, 1, 0, 0, 0, time.UTC)
	pay := &fakePay{}
	service, _ := testService(t, pay, func() time.Time { return now })
	merchant, _ := onboard(t, service)
	forged := merchant
	forged.CentralMerchantID = "other-merchant"
	pay.invoice.Merchant, pay.invoice.PayoutAddress, pay.invoice.Amount = forged.CentralMerchantID, forged.PayoutAddress, 100
	if _, err := service.CreateInvoice(context.Background(), forged, InvoiceInput{Amount: 100, ExpiresInMinutes: 30, IdempotencyKey: "forged-merchant-invoice"}); err == nil {
		t.Fatal("caller merchant identity replaced authoritative registration")
	}
	if pay.intentCalls != 0 || pay.invoiceCalls != 0 {
		t.Fatal("forged merchant reached upstream")
	}
}

type changedRegistrationPay struct {
	*fakePay
	changeIntent  func(*chain.PayIntent)
	changeInvoice func(*chain.Invoice)
}

func (p changedRegistrationPay) CreateIntent(ctx context.Context, m, r string, a int64, k string) (chain.PayIntent, error) {
	out, err := p.fakePay.CreateIntent(ctx, m, r, a, k)
	if p.changeIntent != nil {
		p.changeIntent(&out)
	}
	return out, err
}
func (p changedRegistrationPay) CreateInvoice(ctx context.Context, i string, h int64, k string) (chain.Invoice, error) {
	out, err := p.fakePay.CreateInvoice(ctx, i, h, k)
	if p.changeInvoice != nil {
		p.changeInvoice(&out)
	}
	return out, err
}

func TestRegisterInvoiceRejectsChangedAuthoritativeTerms(t *testing.T) {
	cases := []struct {
		name    string
		intent  func(*chain.PayIntent)
		invoice func(*chain.Invoice)
	}{
		{name: "wrong-intent-asset", intent: func(v *chain.PayIntent) { v.Currency = "OTHER" }},
		{name: "wrong-intent-recipient", intent: func(v *chain.PayIntent) { v.PayoutAddress = "other" }},
		{name: "wrong-invoice-asset", invoice: func(v *chain.Invoice) { v.Currency = "OTHER" }},
		{name: "wrong-intent-alias", invoice: func(v *chain.Invoice) { v.IntentID = "another-intent" }},
		{name: "empty-invoice-alias", invoice: func(v *chain.Invoice) { v.ID = "" }},
		{name: "expired-invoice", invoice: func(v *chain.Invoice) { v.DueAt = time.Time{} }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			now := time.Date(2026, 10, 31, 1, 0, 0, 0, time.UTC)
			pay := &fakePay{}
			service, _ := testService(t, pay, func() time.Time { return now })
			merchant, _ := onboard(t, service)
			pay.invoice.Merchant, pay.invoice.PayoutAddress, pay.invoice.Amount = merchant.CentralMerchantID, merchant.PayoutAddress, 100
			service.pay = changedRegistrationPay{pay, tc.intent, tc.invoice}
			if _, err := service.CreateInvoice(context.Background(), merchant, InvoiceInput{Amount: 100, ExpiresInMinutes: 30, IdempotencyKey: "changed-terms-invoice"}); err == nil {
				t.Fatal("changed authority terms accepted")
			}
			if err := service.store.View(func(data Snapshot) error {
				if len(data.Invoices) != 0 {
					t.Fatal("rejected terms persisted")
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestRegisterInvoiceRechecksMerchantAfterProviderAwait(t *testing.T) {
	now := time.Date(2026, 10, 31, 1, 0, 0, 0, time.UTC)
	pay := &fakePay{}
	service, _ := testService(t, pay, func() time.Time { return now })
	merchant, _ := onboard(t, service)
	pay.invoice.Merchant, pay.invoice.PayoutAddress, pay.invoice.Amount = merchant.CentralMerchantID, merchant.PayoutAddress, 100
	service.pay = changedRegistrationPay{fakePay: pay, changeInvoice: func(*chain.Invoice) {
		if err := service.store.Update(func(data *Snapshot) error {
			m := data.Merchants[merchant.ID]
			m.Status = "revoked"
			data.Merchants[m.ID] = m
			return nil
		}); err != nil {
			t.Fatal(err)
		}
	}}
	if _, err := service.CreateInvoice(context.Background(), merchant, InvoiceInput{Amount: 100, ExpiresInMinutes: 30, IdempotencyKey: "revoked-during-register"}); err == nil {
		t.Fatal("revoked merchant committed an invoice")
	}
	if err := service.store.View(func(data Snapshot) error {
		if len(data.Invoices) != 0 {
			t.Fatal("revoked invoice persisted")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestRegisterInvoiceMissingOriginalReceiptRequiresRecovery(t *testing.T) {
	now := time.Date(2026, 10, 31, 1, 0, 0, 0, time.UTC)
	pay := &fakePay{}
	service, _ := testService(t, pay, func() time.Time { return now })
	merchant, _ := onboard(t, service)
	input := InvoiceInput{Amount: 100, ExpiresInMinutes: 30, IdempotencyKey: "missing-original-invoice"}
	if err := service.store.Update(func(data *Snapshot) error {
		data.Idempotency["invoice:"+merchant.ID+":"+input.IdempotencyKey] = IdempotencyRecord{RequestHash: invoiceRequestHash(input, nil), ObjectID: "inv_missing"}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.CreateInvoice(context.Background(), merchant, input); err == nil {
		t.Fatal("missing original receipt reissued")
	}
	if pay.intentCalls != 0 || pay.invoiceCalls != 0 {
		t.Fatal("unresolved original operation was sent again")
	}
}

func TestRegisterInvoiceHTTPKeepsOriginalSlot(t *testing.T) {
	service, merchant, _, server := merchantBusinessQA(t)
	pay := service.pay.(*fakePay)
	pay.invoice.Merchant, pay.invoice.PayoutAddress, pay.invoice.Amount = merchant.CentralMerchantID, merchant.PayoutAddress, 100
	carrier := merchantQASession(t, server, merchant, "")
	w := merchantQARequest(server, "POST", "/v1/merchant/invoices", `{"amount":100,"expiresInMinutes":30,"idempotencyKey":"http-original-invoice"}`, carrier.Token, "")
	if w.Code != 201 {
		t.Fatalf("original HTTP registration %d %s", w.Code, w.Body)
	}
	var original Invoice
	if err := json.Unmarshal(w.Body.Bytes(), &original); err != nil {
		t.Fatal(err)
	}
	pay.invoice.Amount = 1
	w = merchantQARequest(server, "POST", "/v1/merchant/invoices", `{"amount":1,"expiresInMinutes":30,"idempotencyKey":"http-small-claim"}`, carrier.Token, "")
	if w.Code < 400 {
		t.Fatalf("HTTP alias conflict %d %s", w.Code, w.Body)
	}
	if err := service.store.View(func(data Snapshot) error {
		if !reflect.DeepEqual(data.Invoices[original.ID], original) {
			t.Fatal("HTTP route overwrote original invoice")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestRegisterInvoiceRejectsCrossKindAliasAndPreservesColdSession(t *testing.T) {
	now := time.Date(2026, 10, 31, 1, 0, 0, 0, time.UTC)
	pay := &fakePay{}
	service, path := testService(t, pay, func() time.Time { return now })
	merchant, _ := onboard(t, service)
	pay.invoice.Merchant, pay.invoice.PayoutAddress, pay.invoice.Amount = merchant.CentralMerchantID, merchant.PayoutAddress, 100
	original, err := service.CreateInvoice(context.Background(), merchant, InvoiceInput{Amount: 100, ExpiresInMinutes: 30, IdempotencyKey: "cross-kind-original"})
	if err != nil {
		t.Fatal(err)
	}
	session, err := service.OpenPaymentSession(context.Background(), merchant, PaymentSessionInput{InvoiceID: original.ID, SourceOrder: "original-shop-order"})
	if err != nil {
		t.Fatal(err)
	}
	service.pay = changedRegistrationPay{fakePay: pay, changeIntent: func(v *chain.PayIntent) { v.ID = "different-unique-intent" }, changeInvoice: func(v *chain.Invoice) { v.ID = original.ID }}
	if _, err := service.CreateInvoice(context.Background(), merchant, InvoiceInput{Amount: 100, ExpiresInMinutes: 30, IdempotencyKey: "cross-kind-new-request"}); err == nil {
		t.Fatal("new central ID shadowed existing product invoice ID")
	}
	reopened, err := OpenStore(path, service.key)
	if err != nil {
		t.Fatal(err)
	}
	service.store = reopened
	read, err := service.PaymentSession(context.Background(), merchant, "original-shop-order")
	if err != nil || !reflect.DeepEqual(read, session) {
		t.Fatalf("old session lost after rejected alias: %v", err)
	}
	readInvoice, err := service.Invoice(context.Background(), original.ID)
	if err != nil || readInvoice.ID != original.ID || readInvoice.Amount != 100 {
		t.Fatal("old invoice unreadable after alias collision", err)
	}
	replay, err := service.OpenPaymentSession(context.Background(), merchant, PaymentSessionInput{InvoiceID: original.ID, SourceOrder: "original-shop-order"})
	if err != nil || replay.ID != session.ID {
		t.Fatal("original alias no longer resolves to same session", err)
	}
}
