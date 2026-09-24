package finance

import "net/http"

const financeCatalogVersion = "finance-product-catalog-v1"

type FinanceProductChannel struct {
	ID               string                 `json:"id"`
	Label            string                 `json:"label"`
	Environment      string                 `json:"environment"`
	Unit             string                 `json:"unit"`
	Settlement       string                 `json:"settlement"`
	Availability     string                 `json:"availability"`
	Custody          string                 `json:"custody"`
	Capabilities     []string               `json:"capabilities"`
	RequiredEvidence []string               `json:"requiredEvidence"`
	RiskNotice       string                 `json:"riskNotice"`
	TestMarket       *FinanceTestMarketGate `json:"testMarket,omitempty"`
}

// TestMarket is source provenance and a fail-closed capability gate, not a
// deployed asset registry. Hardhat's 6423 simulation is not public 6423 state.
type FinanceTestMarketGate struct {
	SourceCommit           string            `json:"sourceCommit"`
	DryRunManifestSHA256   string            `json:"dryRunManifestSha256"`
	ChainID                int               `json:"chainId"`
	Assets                 []string          `json:"assets"`
	SettlementContract     string            `json:"settlementContract"`
	TestOnly               bool              `json:"testOnly"`
	DeploymentVerified     bool              `json:"deploymentVerified"`
	PublicAddresses        map[string]string `json:"publicAddresses"`
	ChainSubmissionEnabled bool              `json:"chainSubmissionEnabled"`
	Reason                 string            `json:"reason"`
}

type FinanceProductCatalog struct {
	SchemaVersion     string                  `json:"schemaVersion"`
	AggregationPolicy string                  `json:"aggregationPolicy"`
	DefaultLocale     string                  `json:"defaultLocale"`
	Channels          []FinanceProductChannel `json:"channels"`
}

func financeProductCatalog() FinanceProductCatalog {
	return FinanceProductCatalog{
		SchemaVersion:     financeCatalogVersion,
		AggregationPolicy: "never-merge-balances-cost-basis-pnl-or-performance-across-channels",
		DefaultLocale:     "en",
		Channels: []FinanceProductChannel{
			{ID: "ynxt-indexed", Label: "YNXT indexed portfolio", Environment: "YNX Chain public testnet", Unit: "YNXT", Settlement: "indexed-chain-evidence", Availability: "source-dependent", Custody: "none", Capabilities: []string{"portfolio.read", "activity.read", "pay-receipts.read", "planning.private"}, RequiredEvidence: []string{"explorer-index", "authorized-account", "source-height"}, RiskNotice: "Indexed testnet records are not fiat, a bank balance, or a mainnet asset."},
			{ID: "ynx-evm-test", Label: "YNX on-chain test markets", Environment: "chain 6423 test market", Unit: "verified-test-assets", Settlement: "owner-product-testnet", Availability: "owner-source-dependent", Custody: "owner-product-contract", Capabilities: []string{"dex.positions.read", "dex.swaps.read", "exchange.orders.read", "quant.lifecycle.read"}, RequiredEvidence: []string{"accepted-owner-contract", "account-bound-envelope", "transaction-or-order-evidence"}, RiskNotice: "Only verified test assets and supported bounded contracts qualify; no mainnet BTC or generic EVM capability is implied.", TestMarket: &FinanceTestMarketGate{
				SourceCommit:         "6663df43e2f973a90a591cc88fc120a540df7f4a",
				DryRunManifestSHA256: "efd4d0c8f372a6a5c94a8687c17321b02144c4b812602a5e672252469a585802",
				ChainID:              6423, Assets: []string{"TEST-AAPL", "tUSD"}, SettlementContract: "TestDvP", TestOnly: true,
				DeploymentVerified: false, PublicAddresses: nil, ChainSubmissionEnabled: false,
				Reason: "Only local Hardhat QA is verified; public 6423 deployment and balances are not verified.",
			}},
			{ID: "broker-sandbox", Label: "Official broker sandbox", Environment: "provider sandbox", Unit: "simulated-USD-and-shares", Settlement: "provider-sandbox", Availability: "credential-and-provider-dependent", Custody: "provider-sandbox-only", Capabilities: []string{"assets.search", "quotes.read", "portfolio.read", "orders.preview", "orders.approve", "orders.execute-when-explicitly-activated"}, RequiredEvidence: []string{"official-provider-response", "owner-account-mapping", "wallet-approved-order", "execution-receipt"}, RiskNotice: "Simulated cash and shares are not real funds, securities ownership, or chain assets."},
			{ID: "future-live", Label: "Future live and mainnet products", Environment: "not enabled", Unit: "none", Settlement: "disabled", Availability: "disabled", Custody: "none", Capabilities: []string{}, RequiredEvidence: []string{"regulatory-approval", "production-signing", "custody-and-risk-review", "explicit-release"}, RiskNotice: "No live brokerage, mainnet custody, lending, yield, or investment product is available."},
		},
	}
}

func (s *Server) productCatalog(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Cache-Control", "public, max-age=60")
	writeJSON(w, http.StatusOK, financeProductCatalog())
}
