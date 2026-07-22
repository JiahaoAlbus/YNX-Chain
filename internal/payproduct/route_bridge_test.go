package payproduct

import (
	"context"
	"strings"
	"testing"
	"time"
)

type fakeBridge struct {
	quote  ProviderBridgeQuote
	status ProviderBridgeStatus
	err    error
}

func (f *fakeBridge) Quote(context.Context, BridgeQuoteRequest) (ProviderBridgeQuote, error) {
	return f.quote, f.err
}
func (f *fakeBridge) Status(context.Context, string) (ProviderBridgeStatus, error) {
	return f.status, f.err
}

func TestExplainableRoutesAndBridgeEvidenceLifecycle(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	clock := now
	pay := &fakePay{}
	service, _ := testService(t, pay, func() time.Time { return clock })
	merchant, _ := onboard(t, service)
	pay.invoice.Merchant, pay.invoice.PayoutAddress, pay.invoice.Amount = merchant.ID, merchant.PayoutAddress, 20
	invoice, err := service.CreateInvoice(context.Background(), merchant, InvoiceInput{Amount: 20, ExpiresInMinutes: 30, IdempotencyKey: "route-invoice-01"})
	if err != nil {
		t.Fatal(err)
	}
	provider := &fakeBridge{quote: ProviderBridgeQuote{ID: "brq_provider_01", Provider: "official-interop-testnet", SourceChain: "ethereum-sepolia", SourceAsset: "USDC_TESTNET", SourceAmount: 25, SourceContract: "0x-source-usdc-testnet", DestinationChain: ChainID, DestinationAsset: NativeAsset, DestinationAmount: 21, DestinationContract: "ynx-native-ledger", BridgeFee: 2, NetworkFee: 1, TotalCostYNXTEquivalent: 24, FXRate: "1 USDC_TESTNET = 1 YNXT estimate", RiskBPS: 150, EstimatedSeconds: 120, Finality: "source-finalized-and-destination-committed", ProviderHealth: "healthy", IssuedAt: now, ExpiresAt: now.Add(4 * time.Minute), Source: "official-interop-testnet-api", SourceVersion: 1, Confidence: "provider-quoted", Coverage: "source-to-destination"}}
	service.bridge = provider
	session := WalletSession{ID: "route-session-01", Account: merchant.PayoutAddress, DeviceID: "route-device-01"}
	input := RouteQuoteInput{SourceChain: "ethereum-sepolia", SourceAsset: "USDC_TESTNET", SourceAmount: 25, MaxTotalCostYNXT: 30, MaxSettlementSeconds: 300, AcceptBridgeRiskBPS: 200, IdempotencyKey: "route-request-01"}
	quote, err := service.CreateRouteQuote(context.Background(), session, invoice.ID, input)
	if err != nil || quote.Status != "issued" || len(quote.Options) != 3 || quote.RecommendedID != "native-ynxt" {
		t.Fatalf("route quote was not complete or explainable: %+v %v", quote, err)
	}
	var bridgeOption RouteOption
	for _, option := range quote.Options {
		if option.Kind == "bridge" {
			bridgeOption = option
		}
	}
	if !bridgeOption.Available || bridgeOption.BridgeTransferID != provider.quote.ID || bridgeOption.FXRate == "" || len(bridgeOption.Explanation) < 3 {
		t.Fatalf("bridge option lacks disclosed evidence: %+v", bridgeOption)
	}
	selected, err := service.SelectRoute(session, quote.ID, bridgeOption.ID)
	if err != nil || selected.Status != "selected" || selected.SelectedID != bridgeOption.ID {
		t.Fatalf("Wallet route selection was not recorded: %+v %v", selected, err)
	}
	sourceTx := "0x" + strings.Repeat("1", 64)
	destinationTx := "0x" + strings.Repeat("2", 64)
	provider.status = ProviderBridgeStatus{QuoteID: provider.quote.ID, Stage: "source_accepted", SourceTransactionHash: sourceTx, AsOf: now.Add(time.Minute), Source: provider.quote.Source, SourceVersion: 1}
	clock = now.Add(time.Minute)
	transfer, err := service.RefreshBridge(context.Background(), session, provider.quote.ID)
	if err != nil || transfer.Status != "source_accepted" {
		t.Fatalf("source acceptance failed: %+v %v", transfer, err)
	}
	provider.status = ProviderBridgeStatus{QuoteID: provider.quote.ID, Stage: "source_finalized", SourceTransactionHash: sourceTx, SourceBlock: 101, SourceFinality: "finalized", AsOf: now.Add(2 * time.Minute), Source: provider.quote.Source, SourceVersion: 1}
	clock = now.Add(2 * time.Minute)
	transfer, err = service.RefreshBridge(context.Background(), session, provider.quote.ID)
	if err != nil || transfer.Status != "source_finalized" {
		t.Fatalf("source finality failed: %+v %v", transfer, err)
	}
	provider.status = ProviderBridgeStatus{QuoteID: provider.quote.ID, Stage: "attested", SourceTransactionHash: sourceTx, SourceBlock: 101, SourceFinality: "finalized", Attestation: "attestation-proof-1234567890", AsOf: now.Add(3 * time.Minute), Source: provider.quote.Source, SourceVersion: 1}
	clock = now.Add(3 * time.Minute)
	transfer, err = service.RefreshBridge(context.Background(), session, provider.quote.ID)
	if err != nil || transfer.Status != "attested" {
		t.Fatalf("attestation failed: %+v %v", transfer, err)
	}
	provider.status = ProviderBridgeStatus{QuoteID: provider.quote.ID, Stage: "destination_confirmed", SourceTransactionHash: sourceTx, SourceBlock: 101, SourceFinality: "finalized", Attestation: "attestation-proof-1234567890", DestinationTransactionHash: destinationTx, DestinationBlock: 202, DestinationFinality: "committed", AsOf: now.Add(4 * time.Minute), Source: provider.quote.Source, SourceVersion: 1}
	clock = now.Add(4 * time.Minute)
	transfer, err = service.RefreshBridge(context.Background(), session, provider.quote.ID)
	if err != nil || transfer.Status != "destination_confirmed" || len(transfer.History) != 5 {
		t.Fatalf("destination confirmation failed: %+v %v", transfer, err)
	}
	unchanged, err := service.Invoice(context.Background(), invoice.ID)
	if err != nil || unchanged.Status != "pending" || unchanged.Settlement != nil {
		t.Fatalf("bridge arrival improperly marked invoice paid: %+v %v", unchanged, err)
	}
	provider.status = ProviderBridgeStatus{QuoteID: provider.quote.ID, Stage: "source_finalized", SourceTransactionHash: sourceTx, SourceBlock: 101, SourceFinality: "finalized", AsOf: now.Add(5 * time.Minute), Source: provider.quote.Source, SourceVersion: 1}
	clock = now.Add(5 * time.Minute)
	if _, err := service.RefreshBridge(context.Background(), session, provider.quote.ID); err == nil || !strings.Contains(err.Error(), "regressive") {
		t.Fatalf("regressive bridge state was accepted: %v", err)
	}
}

func TestBridgeUnsupportedAndRegressiveEvidenceFailClosed(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	pay := &fakePay{}
	service, _ := testService(t, pay, func() time.Time { return now })
	merchant, _ := onboard(t, service)
	pay.invoice.Merchant, pay.invoice.PayoutAddress, pay.invoice.Amount = merchant.ID, merchant.PayoutAddress, 5
	invoice, err := service.CreateInvoice(context.Background(), merchant, InvoiceInput{Amount: 5, ExpiresInMinutes: 30, IdempotencyKey: "route-invoice-02"})
	if err != nil {
		t.Fatal(err)
	}
	session := WalletSession{ID: "route-session-02", Account: merchant.PayoutAddress, DeviceID: "route-device-02"}
	quote, err := service.CreateRouteQuote(context.Background(), session, invoice.ID, RouteQuoteInput{SourceChain: "unsupported-testnet", SourceAsset: "USDC_TESTNET", SourceAmount: 8, AcceptBridgeRiskBPS: 100, IdempotencyKey: "route-request-02"})
	if err != nil {
		t.Fatal(err)
	}
	foundUnavailable := false
	for _, option := range quote.Options {
		if option.Kind == "bridge" && !option.Available && strings.Contains(option.UnavailableReason, "unavailable") {
			foundUnavailable = true
		}
	}
	if !foundUnavailable {
		t.Fatalf("unsupported YNX bridge did not remain explicitly unavailable: %+v", quote.Options)
	}
	if _, err := service.SelectRoute(session, quote.ID, "bridge-unavailable"); err == nil {
		t.Fatal("unavailable bridge route was selectable")
	}
}
