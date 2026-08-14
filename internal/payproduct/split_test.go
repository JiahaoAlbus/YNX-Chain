package payproduct

import (
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestSplitPaymentCreatesSignedSharesAndBindsClaimedPayer(t *testing.T) {
	now := time.Date(2026, 7, 27, 10, 0, 0, 0, time.UTC)
	pay := &fakePay{now: func() time.Time { return now }}
	service, _ := testService(t, pay, func() time.Time { return now })
	merchant, _ := onboard(t, service)

	input := SplitPaymentInput{
		Description:      "Team lunch",
		Shares:           []SplitShareInput{{Label: "Alice", Amount: 12}, {Label: "Bob", Amount: 8}},
		ExpiresInMinutes: 30,
		IdempotencyKey:   "split-lunch-01",
	}
	split, err := service.CreateSplitPayment(merchant, input)
	if err != nil {
		t.Fatal(err)
	}
	if split.Status != "open" || split.TotalAmount != 20 || len(split.Shares) != 2 {
		t.Fatalf("unexpected split payment: %+v", split)
	}
	publicKey, _ := hex.DecodeString(split.SigningPublicKey)
	signature, _ := hex.DecodeString(split.Signature)
	if !ed25519.Verify(publicKey, splitSigningMaterial(split), signature) {
		t.Fatal("split payment signature did not verify")
	}
	tampered := split
	tampered.Shares = append([]SplitShare(nil), split.Shares...)
	tampered.Shares[0].Amount++
	if ed25519.Verify(publicKey, splitSigningMaterial(tampered), signature) {
		t.Fatal("tampered split share retained a valid signature")
	}
	replay, err := service.CreateSplitPayment(merchant, input)
	if err != nil || replay.ID != split.ID {
		t.Fatalf("split idempotent replay failed: %+v %v", replay, err)
	}

	payer := merchant.PayoutAddress
	pay.invoice.Merchant = merchant.ID
	pay.invoice.PayoutAddress = merchant.PayoutAddress
	pay.invoice.Amount = 12
	session := WalletSession{Account: payer, Scopes: []string{"account:read", "pay:settlement:submit"}}
	claimed, err := service.ClaimSplitShare(context.Background(), session, split.ID, split.Shares[0].ID, "claim-alice-01")
	if err != nil {
		t.Fatal(err)
	}
	if claimed.Status != "partially_claimed" || claimed.Shares[0].InvoiceID == "" || claimed.Shares[0].PayerAccount != payer {
		t.Fatalf("split share was not claimed: %+v", claimed)
	}
	invoice, err := service.Invoice(context.Background(), claimed.Shares[0].InvoiceID)
	if err != nil {
		t.Fatal(err)
	}
	if invoice.Version != 4 || invoice.SplitPaymentID != split.ID || invoice.SplitShareID != split.Shares[0].ID || invoice.ExpectedPayer != payer || invoice.ExpectedPayerHash != hashString("YNX_PAY_EXPECTED_PAYER_V1", payer) || invoice.Amount != 12 {
		t.Fatalf("split child invoice is not fully bound: %+v", invoice)
	}
	publicChild := publicInvoice(invoice)
	if publicSplitPayment(claimed).Shares[0].PayerAccount != "" || publicChild.ExpectedPayer != "" || publicChild.ExpectedPayerHash == "" {
		t.Fatal("public split response leaked the claimed payer account or lost its verification hash")
	}
	merchantState, err := service.SnapshotForMerchant(merchant.ID)
	if err != nil || merchantState.SplitPayments[split.ID].Shares[0].PayerAccount != payer {
		t.Fatalf("merchant split audit view lost the payer binding: %+v %v", merchantState.SplitPayments[split.ID], err)
	}
	invoicePublicKey, _ := hex.DecodeString(invoice.SigningPublicKey)
	invoiceSignature, _ := hex.DecodeString(invoice.Signature)
	if !ed25519.Verify(invoicePublicKey, invoiceSigningMaterial(invoice), invoiceSignature) {
		t.Fatal("split child invoice signature did not verify")
	}
	if !ed25519.Verify(invoicePublicKey, invoiceSigningMaterial(publicChild), invoiceSignature) {
		t.Fatal("publicly redacted split child invoice is not independently verifiable")
	}

	pay.settlement = chain.PaySettlement{ID: "fedcba9876543210fedcba98", IntentID: invoice.IntentID, InvoiceID: invoice.CentralID, Merchant: merchant.ID, PayoutAddress: merchant.PayoutAddress, Payer: "ynx1wrongpayer000000000000000000000000000", Amount: 12, Currency: NativeAsset, TransactionHash: "0x" + strings.Repeat("a", 64), BlockNumber: 101, Status: "paid", IdempotencyKey: "split-settle-01", AuditHash: strings.Repeat("b", 64), CreatedAt: now.Add(time.Minute)}
	if _, err := service.SubmitSettlement(context.Background(), invoice.ID, pay.settlement.Payer, pay.settlement.TransactionHash, "split-settle-01"); err == nil {
		t.Fatal("settlement from the wrong split payer was accepted")
	}
	pay.settlement.Payer = payer
	if _, err := service.SubmitSettlement(context.Background(), invoice.ID, payer, pay.settlement.TransactionHash, "split-settle-01"); err != nil {
		t.Fatal(err)
	}
	refreshed, err := service.SplitPayment(context.Background(), split.ID)
	if err != nil {
		t.Fatal(err)
	}
	if refreshed.Status != "partially_paid" || refreshed.Shares[0].Status != "committed" || refreshed.Shares[1].Status != "open" {
		t.Fatalf("split aggregate state is incorrect: %+v", refreshed)
	}
}

func TestSplitPaymentValidationFailsClosed(t *testing.T) {
	now := time.Date(2026, 7, 27, 10, 0, 0, 0, time.UTC)
	service, _ := testService(t, &fakePay{}, func() time.Time { return now })
	merchant, _ := onboard(t, service)

	cases := []SplitPaymentInput{
		{Description: "one share", Shares: []SplitShareInput{{Label: "only", Amount: 1}}, ExpiresInMinutes: 30, IdempotencyKey: "split-invalid-01"},
		{Description: "duplicate labels", Shares: []SplitShareInput{{Label: "Alice", Amount: 1}, {Label: "alice", Amount: 1}}, ExpiresInMinutes: 30, IdempotencyKey: "split-invalid-02"},
		{Description: "zero amount", Shares: []SplitShareInput{{Label: "Alice", Amount: 1}, {Label: "Bob", Amount: 0}}, ExpiresInMinutes: 30, IdempotencyKey: "split-invalid-03"},
	}
	for _, input := range cases {
		if _, err := service.CreateSplitPayment(merchant, input); err == nil {
			t.Fatalf("invalid split payment was accepted: %+v", input)
		}
	}
	split, err := service.CreateSplitPayment(merchant, SplitPaymentInput{Description: "valid", Shares: []SplitShareInput{{Label: "Alice", Amount: 1}, {Label: "Bob", Amount: 1}}, ExpiresInMinutes: 30, IdempotencyKey: "split-valid-001"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.ClaimSplitShare(context.Background(), WalletSession{Account: merchant.PayoutAddress, Scopes: []string{"account:read"}}, split.ID, split.Shares[0].ID, "claim-invalid-01"); err == nil {
		t.Fatal("split claim without settlement scope was accepted")
	}
}
