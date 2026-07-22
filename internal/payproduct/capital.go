package payproduct

import (
	"sort"
	"time"
)

type EconomicAmount struct {
	Asset   string     `json:"asset"`
	Amount  *int64     `json:"amount"`
	Status  string     `json:"status"`
	Source  string     `json:"source"`
	AsOf    *time.Time `json:"asOf,omitempty"`
	Version string     `json:"version"`
}

type SettlementTransparency struct {
	InvoiceID                   string         `json:"invoiceId"`
	SettlementStatus            string         `json:"settlementStatus"`
	SettlementDelaySeconds      *int64         `json:"settlementDelaySeconds"`
	GrossPayment                EconomicAmount `json:"grossPayment"`
	RefundReserve               EconomicAmount `json:"refundReserve"`
	DisputeReserve              EconomicAmount `json:"disputeReserve"`
	NetworkFee                  EconomicAmount `json:"networkFee"`
	ProviderCost                EconomicAmount `json:"providerCost"`
	ProtocolFee                 EconomicAmount `json:"protocolFee"`
	Burn                        EconomicAmount `json:"burn"`
	TreasuryInsuranceAllocation EconomicAmount `json:"treasuryInsuranceAllocation"`
	MerchantNet                 EconomicAmount `json:"merchantNet"`
	StablecoinYNXTSource        string         `json:"stablecoinYnxtSource"`
	NonGuarantee                string         `json:"nonGuarantee"`
}

type CapitalCapability struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Status       string `json:"status"`
	Provider     string `json:"provider"`
	Cost         string `json:"cost"`
	Risk         string `json:"risk"`
	Term         string `json:"term"`
	NonGuarantee string `json:"nonGuarantee"`
}

type CapitalOverview struct {
	Version      string                   `json:"version"`
	Source       string                   `json:"source"`
	AsOf         time.Time                `json:"asOf"`
	Capabilities []CapitalCapability      `json:"capabilities"`
	Settlements  []SettlementTransparency `json:"settlements"`
}

func (s *Service) CapitalOverview(merchantID string) (CapitalOverview, error) {
	items, err := s.Export(merchantID)
	if err != nil {
		return CapitalOverview{}, err
	}
	now := s.now().UTC()
	overview := CapitalOverview{Version: "capital-v1", Source: "merchant-records-and-authoritative-central-pay-evidence", AsOf: now, Capabilities: capitalCapabilities(), Settlements: make([]SettlementTransparency, 0, len(items))}
	for _, invoice := range items {
		overview.Settlements = append(overview.Settlements, settlementTransparency(invoice))
	}
	sort.Slice(overview.Settlements, func(i, j int) bool { return overview.Settlements[i].InvoiceID < overview.Settlements[j].InvoiceID })
	return overview, nil
}

func settlementTransparency(invoice Invoice) SettlementTransparency {
	unavailable := func() EconomicAmount {
		return EconomicAmount{Asset: invoice.Asset, Amount: nil, Status: "unavailable", Source: "no-authoritative-record", Version: "economic-v1"}
	}
	result := SettlementTransparency{InvoiceID: invoice.ID, SettlementStatus: invoice.Status, GrossPayment: unavailable(), RefundReserve: unavailable(), DisputeReserve: unavailable(), NetworkFee: amountEvidence(invoice.Asset, invoice.Fee, "signed-invoice", invoice.CreatedAt), ProviderCost: unavailable(), ProtocolFee: unavailable(), Burn: unavailable(), TreasuryInsuranceAllocation: unavailable(), MerchantNet: unavailable(), StablecoinYNXTSource: "signed-invoice-and-central-pay-settlement", NonGuarantee: "Testnet settlement timing, provider availability, value and capital access are not guaranteed."}
	if invoice.Settlement == nil {
		return result
	}
	result.GrossPayment = amountEvidence(invoice.Settlement.Asset, invoice.Settlement.Amount, invoice.Settlement.Source, invoice.Settlement.CommittedAt)
	delay := int64(invoice.Settlement.CommittedAt.Sub(invoice.CreatedAt).Seconds())
	if delay < 0 {
		delay = 0
	}
	result.SettlementDelaySeconds = &delay
	return result
}

func amountEvidence(asset string, amount int64, source string, asOf time.Time) EconomicAmount {
	value := amount
	timestamp := asOf.UTC()
	return EconomicAmount{Asset: asset, Amount: &value, Status: "recorded", Source: source, AsOf: &timestamp, Version: "economic-v1"}
}

func capitalCapabilities() []CapitalCapability {
	nonGuarantee := "Availability, settlement time, credit, liquidity, exchange value and returns are not guaranteed. Human approval and an authorized provider are required for every funds action."
	unavailable := func(id, name, risk, term string) CapitalCapability {
		return CapitalCapability{ID: id, Name: name, Status: "unavailable", Provider: "unavailable", Cost: "unavailable until an official provider quote is recorded", Risk: risk, Term: term, NonGuarantee: nonGuarantee}
	}
	return []CapitalCapability{
		unavailable("multi-currency-stable-settlement", "Multi-currency / Stable Settlement", "issuer, depeg, custody, venue, FX and jurisdiction risk", "provider contract and merchant approval required"),
		unavailable("settlement-schedule", "Settlement Schedule", "provider delay, cutoff and liquidity risk", "versioned schedule mandate required"),
		unavailable("instant-testnet-settlement", "Instant Testnet Settlement", "finality, provider and liquidity risk", "Testnet only; separately approved Wallet action required"),
		unavailable("split-payout", "Split Payout", "allocation, rounding, recipient and legal risk", "signed split mandate and recipient verification required"),
		unavailable("platform-submerchant", "Platform / Submerchant", "KYC, KYB, custody and platform liability risk", "official provider onboarding required"),
		unavailable("reserve-account", "Reserve Account", "custody, access and insolvency risk", "explicit reserve mandate and exit terms required"),
		unavailable("refund-reserve", "Refund Reserve", "reserve insufficiency and delayed access risk", "disclosed calculation and release schedule required"),
		unavailable("dispute-reserve", "Dispute Reserve", "chargeback and adjudication risk", "Trust and provider evidence policy required"),
		unavailable("treasury-allocation", "Treasury Allocation", "market, custody, mandate and concentration risk", "human-approved treasury mandate required"),
		unavailable("fee-sharing", "Fee-sharing", "calculation, tax and counterparty risk", "auditable fee agreement required before accrual"),
		{ID: "merchant-analytics", Name: "Merchant Analytics", Status: "available-local", Provider: "YNX Merchant records", Cost: "local operating cost measurement pending", Risk: "incomplete records can produce incomplete analytics", Term: "record-derived analytics only", NonGuarantee: nonGuarantee},
		unavailable("working-capital-adapter-sandbox", "Working-capital Adapter Sandbox", "credit, underwriting, privacy and repayment risk", "sandbox provider and explicit application approval required"),
		{ID: "proof-of-settlement", Name: "Proof of Settlement", Status: "conditional", Provider: "YNX central Pay API", Cost: "1 YNXT invoice network fee is recorded; other costs unavailable", Risk: "chain finality, provider availability and evidence mismatch risk", Term: "available only for matching authoritative committed settlement records", NonGuarantee: nonGuarantee},
		{ID: "proof-of-revenue", Name: "Proof of Revenue", Status: "conditional", Provider: "YNX Merchant records plus central Pay evidence", Cost: "unavailable until the full fee waterfall is recorded", Risk: "gross payment is not net revenue; missing costs prevent margin recognition", Term: "no revenue claim without committed settlement and disclosed fee records", NonGuarantee: nonGuarantee},
	}
}
