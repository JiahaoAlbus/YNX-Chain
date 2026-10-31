package payproduct

import (
	"context"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"strings"
	"sync"
	"testing"
	"time"
)

type refundLostPay struct{ *fakeAuthorizedRefundPay }

func (p *refundLostPay) CreateAuthorizedRefund(_ context.Context, input AuthorizedRefundSubmission) (chain.RefundRecord, error) {
	p.createCalls++
	p.submission = input
	return chain.RefundRecord{}, errors.New("remote accepted; response lost")
}

func TestRefundUnknownColdStoreCannotBeReleasedOrResent(t *testing.T) {
	s, m, invoice, v := settlementClaimFixture(t)
	if _, err := s.acceptSettlement(invoice, m, v); err != nil {
		t.Fatal(err)
	}
	session := WalletSession{Account: v.Payer}
	request, err := s.CreateRefundRequest(session, invoice.ID, 30, "partial original refund", "refund-original-thirty")
	if err != nil {
		t.Fatal(err)
	}
	now := s.now()
	actor := MerchantPrincipal{Merchant: m, Account: m.PayoutAddress, Role: "finance"}
	auth := signedRefundAuthorization(now, request, invoice, actor, secp256k1.PrivKeyFromBytes(bytes32(5)), "0x"+strings.Repeat("c", 64))
	base := s.pay.(*fakePay)
	p := &refundLostPay{&fakeAuthorizedRefundPay{fakePay: base}}
	s.pay = p
	if _, err = s.SubmitRefundAuthorization(context.Background(), actor, request.ID, auth, "original-refund-operation"); err == nil {
		t.Fatal("lost refund response reported success")
	}
	cold, err := OpenStore(s.store.path, s.key)
	if err != nil {
		t.Fatal(err)
	}
	s.store = cold
	if _, err = s.SubmitRefundAuthorization(context.Background(), actor, request.ID, auth, "replacement-refund-key"); err == nil {
		t.Fatal("unknown refund was reopened")
	}
	outcome, err := s.RefreshRefund(context.Background(), actor, request.ID)
	if err != nil || outcome.Status != "unknown" || outcome.RefundTransactionHash != auth.TransactionHash || outcome.Amount != 30 || p.createCalls != 1 {
		t.Fatal("unknown original refund identity lost", err)
	}
	if _, err = s.CreateRefundRequest(session, invoice.ID, 80, "cannot overrefund unknown original", "refund-eighty-after-unknown"); err == nil {
		t.Fatal("unknown refund released remaining principal")
	}
	analytics, err := s.Analytics(m.ID)
	if err != nil || analytics.RefundedYNXT != 0 || analytics.NetYNXT != 100 {
		t.Fatal("unknown refund counted as returned money", err)
	}
}

func TestConcurrentRefundPrincipalReservationUsesIntegerBounds(t *testing.T) {
	s, m, invoice, v := settlementClaimFixture(t)
	if _, err := s.acceptSettlement(invoice, m, v); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, key := range []string{"first-eighty-refund", "second-eighty-refund"} {
		wg.Add(1)
		go func(k string) {
			defer wg.Done()
			_, err := s.CreateRefundRequest(WalletSession{Account: v.Payer}, invoice.ID, 80, "concurrent refund request", k)
			results <- err
		}(key)
	}
	wg.Wait()
	close(results)
	success := 0
	for err := range results {
		if err == nil {
			success++
		}
	}
	if success != 1 {
		t.Fatal("concurrent refunds overreserved principal", success)
	}
}

func TestRefundThirtyColdReadKeepsNetSeventy(t *testing.T) {
	s, m, invoice, v := settlementClaimFixture(t)
	if _, err := s.acceptSettlement(invoice, m, v); err != nil {
		t.Fatal(err)
	}
	request, err := s.CreateRefundRequest(WalletSession{Account: v.Payer}, invoice.ID, 30, "original partial refund", "thirty-original-request")
	if err != nil {
		t.Fatal(err)
	}
	actor := MerchantPrincipal{Merchant: m, Account: m.PayoutAddress, Role: "finance"}
	now := s.now()
	auth := signedRefundAuthorization(now, request, invoice, actor, secp256k1.PrivKeyFromBytes(bytes32(5)), "0x"+strings.Repeat("c", 64))
	p := &fakeAuthorizedRefundPay{fakePay: s.pay.(*fakePay), created: chain.RefundRecord{ID: "central-thirty-refund", IntentID: invoice.IntentID, Amount: 30, Currency: NativeAsset, Status: "submitted", IdempotencyKey: "original-thirty-submit", CreatedAt: now}}
	s.pay = p
	submitted, err := s.SubmitRefundAuthorization(context.Background(), actor, request.ID, auth, "original-thirty-submit")
	if err != nil {
		t.Fatal(err)
	}
	p.evidence = AuthoritativeRefundEvidence{ID: submitted.CentralRefundID, RequestID: request.ID, InvoiceID: invoice.CentralID, IntentID: invoice.IntentID, ChainID: ChainID, MerchantID: m.CentralMerchantID, MerchantAccount: actor.Account, Payer: v.Payer, Amount: 30, Asset: NativeAsset, TransactionHash: auth.TransactionHash, BlockNumber: 101, Finality: "committed", Status: "refunded", ReceiptID: "original-refund-receipt", AuditHash: strings.Repeat("d", 64), CommittedAt: now.Add(time.Second), Source: "authoritative-central-pay-api", SourceAsOf: now.Add(time.Second), SourceVersion: 1, Confidence: "authoritative"}
	wrong := p.evidence
	wrong.Payer = "wrong-destination"
	p.evidence = wrong
	if _, err = s.RefreshRefund(context.Background(), actor, request.ID); err == nil {
		t.Fatal("refund to wrong destination accepted")
	}
	p.evidence.Payer = v.Payer
	if _, err = s.RefreshRefund(context.Background(), actor, request.ID); err != nil {
		t.Fatal(err)
	}
	cold, err := OpenStore(s.store.path, s.key)
	if err != nil {
		t.Fatal(err)
	}
	s.store = cold
	replay, err := s.RefreshRefund(context.Background(), actor, request.ID)
	if err != nil || replay.Status != "refunded" || p.createCalls != 1 {
		t.Fatal("cold refund replay changed original outcome", err)
	}
	a, err := s.Analytics(m.ID)
	if err != nil || a.GrossYNXT != 100 || a.RefundedYNXT != 30 || a.NetYNXT != 70 {
		t.Fatal("100/30/70 readback failed", err, a)
	}
}
