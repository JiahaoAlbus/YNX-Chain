package payproduct

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

type fakeSponsor struct {
	quote   ProviderSponsorQuote
	receipt UserOperationReceipt
	err     error
}

func (f *fakeSponsor) Quote(context.Context, SponsorQuoteRequest) (ProviderSponsorQuote, error) {
	return f.quote, f.err
}
func (f *fakeSponsor) Receipt(context.Context, string) (UserOperationReceipt, error) {
	return f.receipt, f.err
}

func TestSponsorshipBudgetAttributionAndAuthoritativeReceipt(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	pay := &fakePay{}
	service, _ := testService(t, pay, func() time.Time { return now })
	merchant, _ := onboard(t, service)
	pay.invoice.Merchant, pay.invoice.PayoutAddress, pay.invoice.Amount = merchant.ID, merchant.PayoutAddress, 12
	invoice, err := service.CreateInvoice(context.Background(), merchant, InvoiceInput{Amount: 12, ExpiresInMinutes: 30, IdempotencyKey: "sponsor-invoice-01"})
	if err != nil {
		t.Fatal(err)
	}
	callDataHash := strings.Repeat("a", 64)
	userOperationHash := "0x" + strings.Repeat("b", 64)
	provider := &fakeSponsor{quote: ProviderSponsorQuote{ID: "spq_provider_01", ChainID: ChainID, Account: merchant.PayoutAddress, SmartAccount: merchant.PayoutAddress, Paymaster: "0x" + strings.Repeat("c", 40), CallDataHash: callDataHash, MaximumSponsorCost: 2, IssuedAt: now, ExpiresAt: now.Add(4 * time.Minute), Source: "authoritative-testnet-paymaster", SourceVersion: 1}}
	provider.receipt = UserOperationReceipt{UserOperationHash: userOperationHash, TransactionHash: "0x" + strings.Repeat("d", 64), BlockNumber: 88, ChainID: ChainID, Sender: merchant.PayoutAddress, Paymaster: provider.quote.Paymaster, CallDataHash: callDataHash, ActualSponsorCost: 2, Success: true, Finality: "committed", Source: "authoritative-testnet-paymaster", SourceAsOf: now.Add(time.Minute), SourceVersion: 1}
	service.sponsorship = provider
	service.sponsorPolicy = SponsorPolicy{Sponsor: "ynx-testnet-growth", DailyBudget: 10, PerUserDailyBudget: 2, PerMerchantDailyBudget: 10, MaximumQuoteLifetime: 5 * time.Minute}
	session := WalletSession{ID: "wallet-session-01", Account: merchant.PayoutAddress, DeviceID: "device-bound-01"}
	input := SponsorshipInput{SmartAccount: merchant.PayoutAddress, Mode: "first-payment", CallDataHash: callDataHash, IdempotencyKey: "sponsor-request-01"}
	quote, err := service.RequestSponsorship(context.Background(), session, invoice.ID, input)
	if err != nil || quote.Status != "issued" || quote.Account != session.Account || quote.DeviceID != session.DeviceID || quote.Attribution == "" || quote.MaximumSponsorCost != 2 {
		t.Fatalf("sponsorship quote was not safely issued: %+v %v", quote, err)
	}
	replay, err := service.RequestSponsorship(context.Background(), session, invoice.ID, input)
	if err != nil || replay.ID != quote.ID {
		t.Fatalf("idempotent sponsorship replay changed: %+v %v", replay, err)
	}
	_, err = service.RequestSponsorship(context.Background(), session, invoice.ID, SponsorshipInput{SmartAccount: merchant.PayoutAddress, Mode: "merchant-sponsored", CallDataHash: callDataHash, IdempotencyKey: "sponsor-request-02"})
	if err == nil || !strings.Contains(err.Error(), "budget exhausted") {
		t.Fatalf("per-user/device budget did not fail closed: %v", err)
	}
	confirmed, err := service.ConfirmSponsorship(context.Background(), session, quote.ID, userOperationHash)
	if err != nil || confirmed.Status != "confirmed" || confirmed.Receipt == nil || confirmed.Receipt.BlockNumber != 88 {
		t.Fatalf("authoritative UserOperation receipt was not accepted: %+v %v", confirmed, err)
	}
	unchanged, err := service.Invoice(context.Background(), invoice.ID)
	if err != nil || unchanged.Status != "pending" || unchanged.Settlement != nil {
		t.Fatalf("sponsorship receipt improperly created paid state: %+v %v", unchanged, err)
	}
}

func TestSponsorshipFailsClosedWithoutProviderOrOnMismatchedReceipt(t *testing.T) {
	now := time.Date(2026, 7, 22, 13, 0, 0, 0, time.UTC)
	pay := &fakePay{settlementErr: errors.New("not settled")}
	service, _ := testService(t, pay, func() time.Time { return now })
	merchant, _ := onboard(t, service)
	pay.invoice = chain.Invoice{Merchant: merchant.ID, PayoutAddress: merchant.PayoutAddress, Amount: 3}
	invoice, err := service.CreateInvoice(context.Background(), merchant, InvoiceInput{Amount: 3, ExpiresInMinutes: 20, IdempotencyKey: "sponsor-fail-invoice"})
	if err != nil {
		t.Fatal(err)
	}
	session := WalletSession{ID: "wallet-session-02", Account: merchant.PayoutAddress, DeviceID: "device-bound-02"}
	input := SponsorshipInput{SmartAccount: merchant.PayoutAddress, Mode: "first-payment", CallDataHash: strings.Repeat("1", 64), IdempotencyKey: "sponsor-fail-01"}
	if _, err := service.RequestSponsorship(context.Background(), session, invoice.ID, input); err == nil || !strings.Contains(err.Error(), "unavailable") {
		t.Fatalf("missing sponsorship provider did not fail honestly: %v", err)
	}
	provider := &fakeSponsor{quote: ProviderSponsorQuote{ID: "spq_provider_02", ChainID: ChainID, Account: session.Account, SmartAccount: session.Account, Paymaster: "0x" + strings.Repeat("2", 40), CallDataHash: input.CallDataHash, MaximumSponsorCost: 1, IssuedAt: now, ExpiresAt: now.Add(time.Minute), Source: "authoritative-testnet-paymaster", SourceVersion: 1}}
	service.sponsorship = provider
	service.sponsorPolicy = SponsorPolicy{Sponsor: "ynx-testnet-growth", DailyBudget: 5, PerUserDailyBudget: 5, PerMerchantDailyBudget: 5, MaximumQuoteLifetime: 5 * time.Minute}
	quote, err := service.RequestSponsorship(context.Background(), session, invoice.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	provider.receipt = UserOperationReceipt{UserOperationHash: "0x" + strings.Repeat("3", 64), TransactionHash: "0x" + strings.Repeat("4", 64), BlockNumber: 1, ChainID: ChainID, Sender: session.Account, Paymaster: provider.quote.Paymaster, CallDataHash: strings.Repeat("5", 64), Success: true, Finality: "committed", Source: "authoritative-testnet-paymaster", SourceAsOf: now, SourceVersion: 1}
	if _, err := service.ConfirmSponsorship(context.Background(), session, quote.ID, provider.receipt.UserOperationHash); err == nil || !strings.Contains(err.Error(), "mismatched") {
		t.Fatalf("mismatched receipt was accepted: %v", err)
	}
}
