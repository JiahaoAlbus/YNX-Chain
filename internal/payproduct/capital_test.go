package payproduct

import (
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestSettlementTransparencyNeverInventsCostsOrMerchantNet(t *testing.T) {
	now := time.Date(2026, 7, 22, 4, 0, 0, 0, time.UTC)
	invoice := Invoice{ID: "inv_local", Amount: 25, Asset: NativeAsset, Fee: 1, Status: "pending", CreatedAt: now}
	pending := settlementTransparency(invoice)
	if pending.GrossPayment.Amount != nil || pending.MerchantNet.Amount != nil || pending.ProviderCost.Amount != nil || pending.NetworkFee.Amount == nil || *pending.NetworkFee.Amount != 1 {
		t.Fatalf("pending settlement transparency invented or lost economic values: %+v", pending)
	}
	invoice.Status = "committed"
	invoice.Settlement = &SettlementEvidence{Amount: 25, Asset: NativeAsset, Source: "authoritative-central-pay-api", CommittedAt: now.Add(2 * time.Minute)}
	committed := settlementTransparency(invoice)
	if committed.GrossPayment.Amount == nil || *committed.GrossPayment.Amount != 25 || committed.MerchantNet.Amount != nil || committed.ProviderCost.Amount != nil || committed.SettlementDelaySeconds == nil || *committed.SettlementDelaySeconds != 120 {
		t.Fatalf("committed settlement transparency is not evidence-bound: %+v", committed)
	}
}

func TestCapitalCatalogDisclosesProviderCostRiskTermAndNonGuarantee(t *testing.T) {
	capabilities := capitalCapabilities()
	wanted := []string{"multi-currency-stable-settlement", "settlement-schedule", "instant-testnet-settlement", "split-payout", "platform-submerchant", "reserve-account", "refund-reserve", "dispute-reserve", "treasury-allocation", "fee-sharing", "merchant-analytics", "working-capital-adapter-sandbox", "proof-of-settlement", "proof-of-revenue"}
	seen := map[string]bool{}
	for _, capability := range capabilities {
		seen[capability.ID] = true
		if capability.Provider == "" || capability.Cost == "" || capability.Risk == "" || capability.Term == "" || capability.NonGuarantee == "" {
			t.Fatalf("capital capability lacks mandatory disclosure: %+v", capability)
		}
		if strings.Contains(strings.ToLower(capability.NonGuarantee), "guaranteed return") {
			t.Fatalf("capital capability contains a guarantee: %+v", capability)
		}
	}
	for _, id := range wanted {
		if !seen[id] {
			t.Fatalf("capital capability %q is missing", id)
		}
	}
}

func TestCapitalOverviewUsesAuthoritativeSettlementOnly(t *testing.T) {
	now := time.Date(2026, 7, 22, 5, 0, 0, 0, time.UTC)
	pay := &fakePay{}
	service, _ := testService(t, pay, func() time.Time { return now })
	merchant, _ := onboard(t, service)
	pay.invoice.Merchant, pay.invoice.PayoutAddress, pay.invoice.Amount = merchant.ID, merchant.PayoutAddress, 12
	invoice, err := service.CreateInvoice(t.Context(), merchant, InvoiceInput{Amount: 12, ExpiresInMinutes: 30, IdempotencyKey: "capital-invoice-01"})
	if err != nil {
		t.Fatal(err)
	}
	pay.settlement = chain.PaySettlement{ID: "settlement-capital", InvoiceID: invoice.CentralID, IntentID: invoice.IntentID, Merchant: merchant.CentralMerchantID, PayoutAddress: invoice.PayoutAddress, Payer: invoice.PayoutAddress, Amount: invoice.Amount, Currency: NativeAsset, Status: "paid", TransactionHash: "0x" + strings.Repeat("a", 64), BlockNumber: 7, AuditHash: strings.Repeat("b", 64), CreatedAt: now.Add(time.Minute)}
	if _, err := service.SubmitSettlement(t.Context(), invoice.ID, invoice.PayoutAddress, pay.settlement.TransactionHash, "capital-settlement-01"); err != nil {
		t.Fatal(err)
	}
	overview, err := service.CapitalOverview(merchant.ID)
	if err != nil || len(overview.Settlements) != 1 || overview.Settlements[0].GrossPayment.Amount == nil || overview.Settlements[0].MerchantNet.Amount != nil {
		t.Fatalf("capital overview fabricated or omitted evidence: %+v %v", overview, err)
	}
}
