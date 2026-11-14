package payproduct

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	secpECDSA "github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

type fakeAuthorizedRefundPay struct {
	*fakePay
	created     chain.RefundRecord
	evidence    AuthoritativeRefundEvidence
	submission  AuthorizedRefundSubmission
	createCalls int
	evidenceErr error
}

func (f *fakeAuthorizedRefundPay) CreateAuthorizedRefund(_ context.Context, input AuthorizedRefundSubmission) (chain.RefundRecord, error) {
	f.submission = input
	f.createCalls++
	return f.created, nil
}
func (f *fakeAuthorizedRefundPay) RefundEvidence(context.Context, string) (AuthoritativeRefundEvidence, error) {
	return f.evidence, f.evidenceErr
}

func TestRefundRequiresMerchantWalletAndAuthoritativeCommittedEvidence(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Millisecond)
	clock := now
	base := &fakePay{}
	pay := &fakeAuthorizedRefundPay{fakePay: base}
	path := t.TempDir() + "/state.json"
	service, err := New(Config{StorePath: path, IntegrityKey: bytes32(7), GatewayKey: bytes32(8), BootstrapKey: strings.Repeat("b", 24), PublicBaseURL: "https://pay.example", PayAPI: pay, Now: func() time.Time { return clock }})
	if err != nil {
		t.Fatal(err)
	}
	merchant, _ := onboard(t, service)
	base.invoice.Merchant, base.invoice.PayoutAddress, base.invoice.Amount = merchant.ID, merchant.PayoutAddress, 11
	invoice, err := service.CreateInvoice(context.Background(), merchant, InvoiceInput{Amount: 11, ExpiresInMinutes: 30, IdempotencyKey: "refund-invoice-01"})
	if err != nil {
		t.Fatal(err)
	}
	payerKey := secp256k1.PrivKeyFromBytes(bytes32(9))
	payerHex, _ := consensus.NativeAddress(payerKey.PubKey().SerializeCompressed())
	payer, _ := accountaddress.Encode(payerHex)
	base.settlement = chain.PaySettlement{ID: "pay-settlement-0123456789", IntentID: invoice.IntentID, InvoiceID: invoice.CentralID, Merchant: merchant.ID, PayoutAddress: merchant.PayoutAddress, Payer: payer, Amount: invoice.Amount, Currency: NativeAsset, TransactionHash: "0x" + strings.Repeat("a", 64), BlockNumber: 77, Status: "paid", IdempotencyKey: "refund-payment-settle", AuditHash: strings.Repeat("b", 64), CreatedAt: now}
	invoice, err = service.SubmitSettlement(context.Background(), invoice.ID, payer, base.settlement.TransactionHash, "refund-payment-submit")
	if err != nil {
		t.Fatal(err)
	}
	payerSession := WalletSession{ID: "payer-session-01", Account: payer, DeviceID: "payer-device-01"}
	request, err := service.CreateRefundRequest(payerSession, invoice.ID, 5, "item was not delivered", "refund-request-01")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.CreateRefundRequest(payerSession, invoice.ID, 7, "second partial request", "refund-request-02"); err == nil || !strings.Contains(err.Error(), "exceed") {
		t.Fatalf("aggregate partial refunds exceeded payment: %v", err)
	}
	merchantKey := secp256k1.PrivKeyFromBytes(bytes32(5))
	actor := MerchantPrincipal{Merchant: merchant, Account: merchant.PayoutAddress, Role: "finance", Session: "merchant-session-01"}
	authorization := signedRefundAuthorization(now, request, invoice, actor, merchantKey, "0x"+strings.Repeat("c", 64))
	pay.created = chain.RefundRecord{ID: "central-refund-012345", IntentID: invoice.IntentID, Amount: request.Amount, Currency: invoice.Asset, Status: "submitted", CreatedAt: now, IdempotencyKey: "refund-submit-01"}
	tampered := authorization
	tampered.Amount++
	if _, err := service.SubmitRefundAuthorization(context.Background(), actor, request.ID, tampered, "refund-submit-01"); err == nil {
		t.Fatal("tampered merchant Wallet refund authorization was accepted")
	}
	submitted, err := service.SubmitRefundAuthorization(context.Background(), actor, request.ID, authorization, "refund-submit-01")
	if err != nil || submitted.Status != "submitted" || submitted.AuthorizationDigest == "" || submitted.CentralRefundID != pay.created.ID || pay.createCalls != 1 {
		t.Fatalf("refund was not submitted with exact Wallet authority: %+v %v", submitted, err)
	}
	replay, err := service.SubmitRefundAuthorization(context.Background(), actor, request.ID, authorization, "refund-submit-01")
	if err != nil || replay.Status != "submitted" || pay.createCalls != 1 {
		t.Fatalf("refund idempotent replay called central API again: %+v %v calls=%d", replay, err, pay.createCalls)
	}
	pay.evidence = AuthoritativeRefundEvidence{ID: submitted.CentralRefundID, RequestID: request.ID, InvoiceID: invoice.CentralID, IntentID: invoice.IntentID, ChainID: ChainID, MerchantID: merchant.CentralMerchantID, MerchantAccount: actor.Account, Payer: payer, Amount: request.Amount, Asset: invoice.Asset, TransactionHash: authorization.TransactionHash, BlockNumber: 88, Finality: "committed", Status: "refunded", ReceiptID: "refund-receipt-012345", AuditHash: strings.Repeat("d", 64), CommittedAt: now.Add(time.Minute), Source: "authoritative-central-pay-api", SourceAsOf: now.Add(time.Minute), SourceVersion: 1, Confidence: "authoritative"}
	clock = now.Add(time.Minute)
	mismatched := pay.evidence
	mismatched.Amount++
	pay.evidence = mismatched
	if _, err := service.RefreshRefund(context.Background(), actor, request.ID); err == nil || !strings.Contains(err.Error(), "mismatched") {
		t.Fatalf("mismatched refund evidence was accepted: %v", err)
	}
	pay.evidence = AuthoritativeRefundEvidence{ID: submitted.CentralRefundID, RequestID: request.ID, InvoiceID: invoice.CentralID, IntentID: invoice.IntentID, ChainID: ChainID, MerchantID: merchant.CentralMerchantID, MerchantAccount: actor.Account, Payer: payer, Amount: request.Amount, Asset: invoice.Asset, TransactionHash: authorization.TransactionHash, BlockNumber: 88, Finality: "committed", Status: "refunded", ReceiptID: "refund-receipt-012345", AuditHash: strings.Repeat("d", 64), CommittedAt: now.Add(time.Minute), Source: "authoritative-central-pay-api", SourceAsOf: now.Add(time.Minute), SourceVersion: 1, Confidence: "authoritative"}
	refunded, err := service.RefreshRefund(context.Background(), actor, request.ID)
	if err != nil || refunded.Status != "refunded" || refunded.Evidence == nil || refunded.Evidence.BlockNumber != 88 {
		t.Fatalf("authoritative refund was not committed: %+v %v", refunded, err)
	}
	unchanged, err := service.Invoice(context.Background(), invoice.ID)
	if err != nil || unchanged.Status != "committed" {
		t.Fatalf("refund rewrote original payment truth: %+v %v", unchanged, err)
	}
	analytics, err := service.Analytics(merchant.ID)
	if err != nil || analytics.GrossYNXT != 11 || analytics.RefundedYNXT != 5 || analytics.NetYNXT != 6 || analytics.Source == "" || analytics.AsOf.IsZero() || analytics.Version != 1 {
		t.Fatalf("refund economics did not reconcile: %+v %v", analytics, err)
	}
}

func TestRefundProviderAbsenceAndRoleFailClosed(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Millisecond)
	base := &fakePay{settlementErr: errors.New("not found")}
	service, _ := testService(t, base, func() time.Time { return now })
	merchant, _ := onboard(t, service)
	actor := MerchantPrincipal{Merchant: merchant, Account: merchant.PayoutAddress, Role: "support"}
	if _, err := service.SubmitRefundAuthorization(context.Background(), actor, "missing-refund", RefundAuthorization{}, "refund-submit-02"); err == nil || !strings.Contains(err.Error(), "owner or finance") {
		t.Fatalf("support role could submit refund: %v", err)
	}
	actor.Role = "finance"
	if _, err := service.SubmitRefundAuthorization(context.Background(), actor, "missing-refund", RefundAuthorization{}, "refund-submit-02"); err == nil || !strings.Contains(err.Error(), "unavailable") {
		t.Fatalf("missing authoritative refund API did not fail honestly: %v", err)
	}
}

func signedRefundAuthorization(now time.Time, request RefundRequest, invoice Invoice, actor MerchantPrincipal, key *secp256k1.PrivateKey, tx string) RefundAuthorization {
	authorization := RefundAuthorization{Version: "1", RequestID: "refund_authorization_abcdefghijklmnop", InvoiceID: invoice.ID, ChainID: ChainID, MerchantID: actor.Merchant.ID, Account: actor.Account, AccountPublicKey: hex.EncodeToString(key.PubKey().SerializeCompressed()), Payer: request.Payer, Amount: request.Amount, Asset: invoice.Asset, TransactionHash: tx, IssuedAt: now.Format("2006-01-02T15:04:05.000Z")}
	unsigned := map[string]any{"version": authorization.Version, "requestId": authorization.RequestID, "invoiceId": authorization.InvoiceID, "chainId": authorization.ChainID, "merchantId": authorization.MerchantID, "account": authorization.Account, "accountPublicKey": authorization.AccountPublicKey, "payer": authorization.Payer, "amount": authorization.Amount, "asset": authorization.Asset, "transactionHash": authorization.TransactionHash, "issuedAt": authorization.IssuedAt}
	digest := sha256.Sum256([]byte(refundAuthorizationDomain + "\n" + string(mustCanonical(unsigned))))
	authorization.WalletSignature = hex.EncodeToString(secpECDSA.SignCompact(key, digest[:], true)[1:])
	return authorization
}
