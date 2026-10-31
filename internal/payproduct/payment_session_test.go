package payproduct

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"math"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestOpenPaymentSessionBindsOriginalOrderAliasesAndColdRead(t *testing.T) {
	now := time.Date(2026, 10, 31, 1, 0, 0, 0, time.UTC)
	pay := &fakePay{}
	service, path := testService(t, pay, func() time.Time { return now })
	merchant, _ := onboard(t, service)
	pay.invoice.Merchant, pay.invoice.PayoutAddress, pay.invoice.Amount = merchant.CentralMerchantID, merchant.PayoutAddress, 100
	invoice, err := service.CreateInvoice(context.Background(), merchant, InvoiceInput{Amount: 100, ExpiresInMinutes: 30, IdempotencyKey: "session-invoice-100"})
	if err != nil {
		t.Fatal(err)
	}
	var original PaymentSession
	for _, alias := range []string{invoice.ID, invoice.CentralID, invoice.IntentID} {
		out, err := service.OpenPaymentSession(context.Background(), merchant, PaymentSessionInput{InvoiceID: alias, SourceOrder: "shop-order-100"})
		if err != nil {
			t.Fatal(err)
		}
		if original.ID == "" {
			original = out
		} else if !reflect.DeepEqual(out, original) {
			t.Fatal("alias created a different session")
		}
	}
	if original.ID != invoice.IntentID || original.DeepLink != "ynxpay://invoice/"+invoice.ID || original.Status != "awaiting_wallet" || original.Invoice.Amount != 100 || original.Invoice.Settlement != nil {
		t.Fatal("session lost original terms or claimed a payment")
	}
	payload, err := base64.RawStdEncoding.DecodeString(original.SignedPayload)
	if err != nil {
		t.Fatal(err)
	}
	public, _ := hex.DecodeString(merchant.InvoiceSigningPublicKey)
	signature, _ := hex.DecodeString(original.Signature)
	if !ed25519.Verify(public, payload, signature) {
		t.Fatal("order session descriptor signature invalid")
	}
	if ed25519.Verify(public, []byte(strings.Replace(string(payload), "shop-order-100", "shop-order-001", 1)), signature) {
		t.Fatal("source order could be changed without invalidating signature")
	}
	if _, err = service.OpenPaymentSession(context.Background(), merchant, PaymentSessionInput{InvoiceID: invoice.ID, SourceOrder: "another-order-100"}); err == nil {
		t.Fatal("one invoice bound to two source orders")
	}
	reopened, err := OpenStore(path, service.key)
	if err != nil {
		t.Fatal(err)
	}
	service.store = reopened
	read, err := service.PaymentSession(context.Background(), merchant, "shop-order-100")
	if err != nil || !reflect.DeepEqual(read, original) {
		t.Fatalf("cold read did not recover original order/session: %v", err)
	}
	if _, err = service.PaymentSession(context.Background(), merchant, "missing-order"); err == nil {
		t.Fatal("missing original session invented")
	}
	if pay.intentCalls != 1 || pay.invoiceCalls != 1 {
		t.Fatal("session read or alias replay created another remote intent")
	}
	now = now.Add(time.Hour)
	read, err = service.PaymentSession(context.Background(), merchant, "shop-order-100")
	if err != nil || read.Status != "expired" {
		t.Fatalf("expired session history unreadable %v", err)
	}
}

func TestPaymentSessionHTTPRecoveryAndMerchantIsolation(t *testing.T) {
	service, merchant, verifier, server := merchantBusinessQA(t)
	pay := service.pay.(*fakePay)
	pay.invoice.Merchant, pay.invoice.PayoutAddress, pay.invoice.Amount = merchant.CentralMerchantID, merchant.PayoutAddress, 100
	carrier := merchantQASession(t, server, merchant, "")
	registered := merchantQARequest(server, "POST", "/v1/merchant/invoices", `{"amount":100,"expiresInMinutes":30,"idempotencyKey":"http-session-register"}`, carrier.Token, "")
	var invoice Invoice
	if registered.Code != 201 || json.Unmarshal(registered.Body.Bytes(), &invoice) != nil {
		t.Fatal(registered.Code, registered.Body)
	}
	body := `{"invoiceId":"` + invoice.CentralID + `","sourceOrder":"http-order-100"}`
	w := merchantQARequest(server, "POST", "/v1/merchant/payment-sessions", body, carrier.Token, "")
	if w.Code != 201 {
		t.Fatal(w.Code, w.Body)
	}
	var original PaymentSession
	if err := json.Unmarshal(w.Body.Bytes(), &original); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenStore(service.store.path, service.key)
	if err != nil {
		t.Fatal(err)
	}
	service.store = reopened
	server = newMerchantBusinessServer(service, verifier)
	w = merchantQARequest(server, "GET", "/v1/merchant/payment-sessions/http-order-100", "", carrier.Token, "")
	var read PaymentSession
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &read) != nil || !reflect.DeepEqual(read, original) {
		t.Fatalf("HTTP original session read %d %s", w.Code, w.Body)
	}
	forged := merchant
	forged.ID = "different-merchant"
	if _, err = service.PaymentSession(context.Background(), forged, "http-order-100"); err == nil {
		t.Fatal("wrong merchant read session")
	}
	verifier.active.Store(false)
	w = merchantQARequest(server, "GET", "/v1/merchant/payment-sessions/http-order-100", "", carrier.Token, "")
	if w.Code != 401 || strings.Contains(w.Body.String(), "http-order-100") {
		t.Fatal("revoked authority read order session", w.Code, w.Body)
	}
}

func TestOpenPaymentSessionConcurrentAndTamperedInvoice(t *testing.T) {
	now := time.Date(2026, 10, 31, 1, 0, 0, 0, time.UTC)
	pay := &fakePay{}
	service, _ := testService(t, pay, func() time.Time { return now })
	merchant, _ := onboard(t, service)
	pay.invoice.Merchant, pay.invoice.PayoutAddress, pay.invoice.Amount = merchant.CentralMerchantID, merchant.PayoutAddress, 100
	invoice, err := service.CreateInvoice(context.Background(), merchant, InvoiceInput{Amount: 100, ExpiresInMinutes: 30, IdempotencyKey: "concurrent-session-register"})
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 8)
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := service.OpenPaymentSession(context.Background(), merchant, PaymentSessionInput{InvoiceID: invoice.ID, SourceOrder: "same-source-order"})
			results <- err
		}()
	}
	wg.Wait()
	close(results)
	for err := range results {
		if err != nil {
			t.Fatal(err)
		}
	}
	if err := service.store.Update(func(data *Snapshot) error {
		v := data.Invoices[invoice.ID]
		v.Amount = 1
		data.Invoices[v.ID] = v
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.PaymentSession(context.Background(), merchant, "same-source-order"); err == nil {
		t.Fatal("tampered invoice obtained a new session signature")
	}
}

func TestPaymentReviewRejectsPrincipalFeeOverflow(t *testing.T) {
	err := validatePaymentIntent(SignedPaymentIntent{}, Invoice{Amount: math.MaxInt64, Fee: 1}, WalletSession{}, time.Now())
	if err == nil || !strings.Contains(err.Error(), "integer units") {
		t.Fatal("principal plus fee overflow not rejected", err)
	}
}

func TestOpenPaymentSessionRejectsHistoricalInvalidAliases(t *testing.T) {
	now := time.Date(2026, 10, 31, 1, 0, 0, 0, time.UTC)
	for _, field := range []string{"intent", "central"} {
		t.Run(field, func(t *testing.T) {
			pay := &fakePay{}
			service, _ := testService(t, pay, func() time.Time { return now })
			merchant, _ := onboard(t, service)
			pay.invoice.Merchant, pay.invoice.PayoutAddress, pay.invoice.Amount = merchant.CentralMerchantID, merchant.PayoutAddress, 100
			invoice, err := service.CreateInvoice(context.Background(), merchant, InvoiceInput{Amount: 100, ExpiresInMinutes: 30, IdempotencyKey: "historical-invalid-alias"})
			if err != nil {
				t.Fatal(err)
			}
			if field == "intent" {
				invoice.IntentID = ""
			} else {
				invoice.CentralID = ""
			}
			text, err := service.open(merchant.InvoiceSigningPrivateCipher)
			if err != nil {
				t.Fatal(err)
			}
			private, err := base64.RawStdEncoding.DecodeString(text)
			if err != nil {
				t.Fatal(err)
			}
			invoice.Signature = hex.EncodeToString(ed25519.Sign(ed25519.PrivateKey(private), invoiceSigningMaterial(invoice)))
			clear(private)
			if err = service.store.Update(func(data *Snapshot) error { data.Invoices[invoice.ID] = invoice; return nil }); err != nil {
				t.Fatal(err)
			}
			if _, err = service.OpenPaymentSession(context.Background(), merchant, PaymentSessionInput{InvoiceID: invoice.ID, SourceOrder: "historical-order"}); err == nil {
				t.Fatal("historical unbound terms activated a session")
			}
			read, err := service.Invoice(context.Background(), invoice.ID)
			if err != nil || read.ID != invoice.ID {
				t.Fatal("historical invoice was removed from read path", err)
			}
		})
	}
}
