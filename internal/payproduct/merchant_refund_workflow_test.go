package payproduct

import (
	"encoding/json"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"strings"
	"testing"
	"time"
)

// Real original Merchant router/controller/Store/provider-wrapper flow with an
// isolated authoritative-provider fixture. This does not assert chain funds.
func TestMerchantHTTPPartialRefundUsesScopedProviderAndColdSeventyReadback(t *testing.T) {
	s, m, invoice, payment := settlementClaimFixture(t)
	if _, err := s.acceptSettlement(invoice, m, payment); err != nil {
		t.Fatal(err)
	}
	request, err := s.CreateRefundRequest(WalletSession{Account: payment.Payer}, invoice.ID, 30, "original thirty partial refund", "merchant-flow-refund-thirty")
	if err != nil {
		t.Fatal(err)
	}
	provider := &fakeAuthorizedRefundPay{fakePay: s.pay.(*fakePay), created: chain.RefundRecord{ID: "original-central-refund", IntentID: invoice.IntentID, Amount: 30, Currency: NativeAsset, Status: "submitted", CreatedAt: s.now(), IdempotencyKey: "merchant-flow-submit-thirty"}}
	s.pay = provider
	verifier := &controlledMerchantVerifier{account: m.PayoutAddress, binding: strings.Repeat("c", 64), now: s.now, deadline: s.now().Add(time.Minute)}
	verifier.active.Store(true)
	server := newMerchantBusinessServer(s, verifier)
	carrier := merchantQASession(t, server, m, "")
	actor := MerchantPrincipal{Merchant: m, Account: m.PayoutAddress, Role: "owner"}
	auth := signedRefundAuthorization(s.now(), request, invoice, actor, secp256k1.PrivKeyFromBytes(bytes32(5)), "0x"+strings.Repeat("c", 64))
	raw, _ := json.Marshal(map[string]any{"authorization": auth, "idempotencyKey": "merchant-flow-submit-thirty"})
	w := merchantQARequest(server, "POST", "/v1/merchant/refunds/"+request.ID+"/submit", string(raw), carrier.Token, "")
	var submitted RefundRequest
	if w.Code != 201 || json.Unmarshal(w.Body.Bytes(), &submitted) != nil || submitted.Status != "submitted" || provider.createCalls != 1 {
		t.Fatal("normal scoped refund callee unavailable or wrong outcome", w.Code, w.Body)
	}
	provider.evidence = AuthoritativeRefundEvidence{ID: submitted.CentralRefundID, RequestID: request.ID, InvoiceID: invoice.CentralID, IntentID: invoice.IntentID, ChainID: ChainID, MerchantID: m.CentralMerchantID, MerchantAccount: m.PayoutAddress, Payer: payment.Payer, Amount: 30, Asset: NativeAsset, TransactionHash: auth.TransactionHash, BlockNumber: 101, Finality: "committed", Status: "refunded", ReceiptID: "merchant-thirty-receipt", AuditHash: strings.Repeat("d", 64), CommittedAt: s.now(), Source: "authoritative-central-pay-api", SourceAsOf: s.now(), SourceVersion: 1, Confidence: "authoritative"}
	w = merchantQARequest(server, "POST", "/v1/merchant/refunds/"+request.ID+"/refresh", `{}`, carrier.Token, "")
	if w.Code != 200 {
		t.Fatal("normal refund reconciliation unavailable", w.Code, w.Body)
	}
	cold, err := OpenStore(s.store.path, s.key)
	if err != nil {
		t.Fatal(err)
	}
	s.store = cold
	server = newMerchantBusinessServer(s, verifier)
	w = merchantQARequest(server, "GET", "/v1/merchant/state", "", carrier.Token, "")
	var state Snapshot
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &state) != nil || state.Refunds[request.ID].Status != "refunded" || state.Invoices[invoice.ID].Status != "committed" {
		t.Fatal("cold merchant state lost original money facts", w.Code, w.Body)
	}
	totals, err := paymentFinancials(state, state.Invoices[invoice.ID])
	if err != nil || totals.PaidPrincipal != 100 || totals.RefundedPrincipal != 30 || totals.NetPrincipal != 70 || totals.RefundStatus != "partial_refund" || totals.ActualFeeKnown {
		t.Fatal("partial principal/fee accounting failed", err, totals)
	}
	if _, err = s.CreateRefundRequest(WalletSession{Account: payment.Payer}, invoice.ID, 80, "exceeds remaining seventy", "merchant-flow-refund-eighty"); err == nil {
		t.Fatal("refund exceeded original remaining principal")
	}
	verifier.active.Store(false)
	w = merchantQARequest(server, "GET", "/v1/merchant/state", "", carrier.Token, "")
	if w.Code != 401 || strings.Contains(w.Body.String(), invoice.ID) {
		t.Fatal("revoked authority read private receipt", w.Code)
	}
}
