package payproduct

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type paymentLossPay struct {
	*fakePay
	writes int
	ready  bool
}

func (p *paymentLossPay) Settle(context.Context, string, string, string, string) (chain.PaySettlement, error) {
	p.writes++
	return chain.PaySettlement{}, errors.New("response lost after original operation")
}
func (p *paymentLossPay) Settlement(context.Context, string) (chain.PaySettlement, error) {
	if !p.ready {
		return chain.PaySettlement{}, errors.New("original receipt unavailable")
	}
	return p.settlement, nil
}

func TestPaymentFlowUnknownColdReadNeverResubmitsAndLateFundsNeedReview(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Millisecond)
	base := &fakePay{}
	s, path := testService(t, base, func() time.Time { return now })
	m, _ := onboard(t, s)
	base.invoice.Merchant, base.invoice.PayoutAddress, base.invoice.Amount = m.CentralMerchantID, m.PayoutAddress, 100
	invoice, err := s.CreateInvoice(context.Background(), m, InvoiceInput{Amount: 100, ExpiresInMinutes: 10, IdempotencyKey: "original-hundred-invoice"})
	if err != nil {
		t.Fatal(err)
	}
	key := secp256k1.PrivKeyFromBytes(bytes32(9))
	hexAddress, _ := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	account, _ := accountaddress.Encode(hexAddress)
	session := WalletSession{ID: "original-payer-session", Account: account, ProductClientID: walletProductClientID, BundleID: walletBundleID, ProductDeviceAlgorithm: walletDeviceAlgorithm, SessionBinding: strings.Repeat("a", 64), Scopes: append([]string(nil), walletScopes...), ExpiresAt: now.Add(3 * time.Minute)}
	intent, result := signedPaymentFixture(t, now, invoice, session, key)
	p := &paymentLossPay{fakePay: base}
	s.pay = p
	if _, err = s.SubmitSignedSettlement(context.Background(), session, invoice.ID, intent, result, "original-payment-operation"); err == nil {
		t.Fatal("lost response reported success")
	}
	if p.writes != 1 {
		t.Fatal("original dispatch not sent once")
	}
	cold, err := OpenStore(path, s.key)
	if err != nil {
		t.Fatal(err)
	}
	s.store = cold
	if _, err = s.SubmitSignedSettlement(context.Background(), session, invoice.ID, intent, result, "different-transport-key"); err == nil {
		t.Fatal("unknown operation reported paid")
	}
	second := session
	second.SessionBinding = strings.Repeat("b", 64)
	otherIntent, otherResult := signedPaymentFixture(t, now, invoice, second, key)
	if _, err = s.SubmitSignedSettlement(context.Background(), second, invoice.ID, otherIntent, otherResult, "different-window-key"); err == nil {
		t.Fatal("second window replaced unknown operation")
	}
	if p.writes != 1 {
		t.Fatal("unknown original operation was submitted again")
	}
	now = now.Add(11 * time.Minute)
	session.ExpiresAt = now.Add(time.Minute)
	outcome, err := s.ReconcilePaymentOutcome(context.Background(), session, invoice.ID)
	if err != nil || outcome.Status != "unknown" {
		t.Fatal("unknown original identity not preserved", err)
	}
	p.ready = true
	p.settlement = chain.PaySettlement{ID: "original-settlement-receipt", IntentID: invoice.IntentID, InvoiceID: invoice.CentralID, Merchant: m.CentralMerchantID, PayoutAddress: m.PayoutAddress, Payer: account, Amount: 100, Currency: NativeAsset, TransactionHash: result.TransactionHash, BlockNumber: 100, Status: "paid", IdempotencyKey: "original-payment-operation", AuditHash: strings.Repeat("a", 64), CreatedAt: now}
	outcome, err = s.ReconcilePaymentOutcome(context.Background(), session, invoice.ID)
	if err != nil || outcome.Status != "late_payment_review" || outcome.Invoice.Settlement == nil || p.writes != 1 {
		t.Fatal("late money was resubmitted or silently fulfilled", err, outcome.Status)
	}
	if outcome.Invoice.Settlement.IntentDigest != result.IntentDigest || outcome.Invoice.Settlement.RequestNonce != result.RequestID {
		t.Fatal("original Wallet proof lost on recovery")
	}
	wrong := session
	wrong.Account = m.PayoutAddress
	if _, err = s.ReconcilePaymentOutcome(context.Background(), wrong, invoice.ID); err == nil {
		t.Fatal("different payer read original outcome")
	}
}

func TestPaymentOutcomeHTTPRequiresFreshOriginalPayerProof(t *testing.T) {
	s, m, invoice, v := settlementClaimFixture(t)
	key := secp256k1.PrivKeyFromBytes(bytes32(9))
	hexAddress, _ := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	account, _ := accountaddress.Encode(hexAddress)
	now := s.now()
	session := WalletSession{Account: account, ProductClientID: walletProductClientID, BundleID: walletBundleID, SessionBinding: strings.Repeat("b", 64), Scopes: append([]string(nil), walletScopes...), ExpiresAt: now.Add(time.Minute)}
	intent, result := signedPaymentFixture(t, now, invoice, session, key)
	p := &paymentLossPay{fakePay: s.pay.(*fakePay)}
	s.pay = p
	if _, err := s.SubmitSignedSettlement(context.Background(), session, invoice.ID, intent, result, "http-original-operation"); err == nil {
		t.Fatal("lost response reported paid")
	}
	server := NewServer(s)
	req := httptest.NewRequest("GET", "/v1/invoices/"+invoice.ID+"/payment-outcome", nil)
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, req)
	if w.Code != 401 {
		t.Fatal("anonymous outcome query accepted", w.Code)
	}
	req = httptest.NewRequest("GET", "/v1/invoices/"+invoice.ID+"/payment-outcome", nil)
	signPayGatewayRequest(t, req, nil, account, now, "fresh-http-outcome-nonce")
	w = httptest.NewRecorder()
	server.Handler().ServeHTTP(w, req)
	var outcome PaymentOutcome
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &outcome) != nil || outcome.Status != "unknown" {
		t.Fatal("original unknown not readable via normal HTTP", w.Code, w.Body)
	}
	v.Payer = account
	v.TransactionHash = result.TransactionHash
	v.Merchant = m.CentralMerchantID
	p.settlement = v
	p.ready = true
	req = httptest.NewRequest("GET", "/v1/invoices/"+invoice.ID+"/payment-outcome", nil)
	signPayGatewayRequest(t, req, nil, account, now, "fresh-second-outcome-nonce")
	w = httptest.NewRecorder()
	server.Handler().ServeHTTP(w, req)
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &outcome) != nil || outcome.Status != "committed" || p.writes != 1 {
		t.Fatal("HTTP original readback failed or resubmitted", w.Code, w.Body)
	}
	refund, err := s.CreateRefundRequest(WalletSession{Account: account}, invoice.ID, 30, "original partial refund", "original-http-refund")
	if err != nil {
		t.Fatal(err)
	}
	actor := MerchantPrincipal{Merchant: m, Account: m.PayoutAddress, Role: "finance"}
	auth := signedRefundAuthorization(now, refund, invoice, actor, secp256k1.PrivKeyFromBytes(bytes32(5)), "0x"+strings.Repeat("c", 64))
	lost := &refundLostPay{&fakeAuthorizedRefundPay{fakePay: p.fakePay}}
	s.pay = lost
	if _, err = s.SubmitRefundAuthorization(context.Background(), actor, refund.ID, auth, "original-http-refund-submit"); err == nil {
		t.Fatal("lost refund acknowledgement reported success")
	}
	cold, err := OpenStore(s.store.path, s.key)
	if err != nil {
		t.Fatal(err)
	}
	s.store = cold
	req = httptest.NewRequest("GET", "/v1/invoices/"+invoice.ID+"/payment-outcome", nil)
	signPayGatewayRequest(t, req, nil, account, now, "fresh-refund-outcome-nonce")
	w = httptest.NewRecorder()
	server.Handler().ServeHTTP(w, req)
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &outcome) != nil || outcome.InvoiceID != invoice.ID || outcome.TransactionHash != result.TransactionHash || outcome.Financials.RefundStatus != "unknown" || outcome.Financials.RefundedPrincipal != 0 || outcome.Financials.NetPrincipal != 100 || lost.createCalls != 1 {
		t.Fatal("original HTTP payment outcome hid unknown refund or changed money", w.Code, w.Body)
	}
}
