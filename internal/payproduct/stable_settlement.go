package payproduct

import (
	"errors"
	"regexp"
	"strings"
	"time"
)

var stableContractRE = regexp.MustCompile(`^0x[0-9a-fA-F]{40}$`)

const (
	AssetClassNative            = "testnet_native"
	AssetClassTestnetStablecoin = "testnet_stablecoin"
	AssetClassFiat              = "fiat"
)

type StableSettlementApproval struct {
	Symbol               string    `json:"symbol"`
	AssetClass           string    `json:"assetClass"`
	ChainID              int       `json:"chainId"`
	ContractAddress      string    `json:"contractAddress"`
	Decimals             int       `json:"decimals"`
	Provider             string    `json:"provider"`
	ProviderApproved     bool      `json:"providerApproved"`
	IssuerLegalApproved  bool      `json:"issuerLegalApproved"`
	Health               string    `json:"health"`
	AttestationAvailable bool      `json:"attestationAvailable"`
	LimitsDocumented     bool      `json:"limitsDocumented"`
	PauseControl         bool      `json:"pauseControl"`
	DepegControl         bool      `json:"depegControl"`
	Source               string    `json:"source"`
	SourceAsOf           time.Time `json:"sourceAsOf"`
	SourceVersion        int       `json:"sourceVersion"`
	Confidence           string    `json:"confidence"`
	Coverage             string    `json:"coverage"`
	Failure              string    `json:"failure,omitempty"`
	ReserveEvidence      bool      `json:"reserveEvidence,omitempty"`
	MintBurnControl      bool      `json:"mintBurnControl,omitempty"`
	RedemptionEvidence   bool      `json:"redemptionEvidence,omitempty"`
	SupplyReconciliation bool      `json:"supplyReconciliation,omitempty"`
}

type SettlementAsset struct {
	Symbol            string    `json:"symbol"`
	AssetClass        string    `json:"assetClass"`
	Network           string    `json:"network"`
	ChainID           int       `json:"chainId,omitempty"`
	ContractAddress   string    `json:"contractAddress,omitempty"`
	Decimals          int       `json:"decimals"`
	Available         bool      `json:"available"`
	Status            string    `json:"status"`
	UnavailableReason string    `json:"unavailableReason,omitempty"`
	Source            string    `json:"source"`
	SourceAsOf        time.Time `json:"sourceAsOf"`
	SourceVersion     int       `json:"sourceVersion"`
	Confidence        string    `json:"confidence"`
	Coverage          string    `json:"coverage"`
	Failure           string    `json:"failure,omitempty"`
}

func (s *Service) SettlementAssets() []SettlementAsset {
	now := s.now()
	assets := []SettlementAsset{{Symbol: NativeAsset, AssetClass: AssetClassNative, Network: ChainID, ChainID: EVMChainID, Decimals: 18, Available: true, Status: "available", Source: "ynx-chain-native-ledger", SourceAsOf: now, SourceVersion: 1, Confidence: "authoritative", Coverage: "native-testnet-ledger"}}
	if s.stableApproval == nil {
		return append(assets, SettlementAsset{Symbol: "USDC_TESTNET", AssetClass: AssetClassTestnetStablecoin, Network: ChainID, ChainID: EVMChainID, Available: false, Status: "unavailable", UnavailableReason: "no issuer-approved USDC contract or CCTP domain exists for YNX Testnet", Source: "circle-official-supported-chain-lists", SourceAsOf: time.Date(2026, 7, 22, 0, 0, 0, 0, time.UTC), SourceVersion: 1, Confidence: "official-list-negative-match", Coverage: "USDC contracts and CCTP domains", Failure: "unsupported_chain"})
	}
	a := *s.stableApproval
	asset := SettlementAsset{Symbol: a.Symbol, AssetClass: a.AssetClass, Network: ChainID, ChainID: a.ChainID, ContractAddress: a.ContractAddress, Decimals: a.Decimals, Source: a.Source, SourceAsOf: a.SourceAsOf, SourceVersion: a.SourceVersion, Confidence: a.Confidence, Coverage: a.Coverage, Failure: a.Failure}
	if err := validateStableApproval(a); err != nil {
		asset.Status = "unavailable"
		asset.UnavailableReason = err.Error()
		asset.Failure = "approval_incomplete"
		return append(assets, asset)
	}
	asset.Available = true
	asset.Status = "available"
	return append(assets, asset)
}

func validateStableApproval(a StableSettlementApproval) error {
	if a.AssetClass != AssetClassTestnetStablecoin {
		return errors.New("asset must be explicitly classified as testnet_stablecoin")
	}
	if strings.TrimSpace(a.Symbol) == "" || a.ChainID != EVMChainID || !stableContractRE.MatchString(a.ContractAddress) || a.ContractAddress == "0x0000000000000000000000000000000000000000" || a.Decimals <= 0 {
		return errors.New("exact YNX chain, contract address, and decimals are required")
	}
	if strings.TrimSpace(a.Provider) == "" || !a.ProviderApproved || !a.IssuerLegalApproved || a.Health != "healthy" || !a.AttestationAvailable || !a.LimitsDocumented || !a.PauseControl || !a.DepegControl {
		return errors.New("provider approval, legal review, health, attestation, limits, pause, and depeg controls are required")
	}
	if strings.TrimSpace(a.Source) == "" || a.SourceAsOf.IsZero() || a.SourceVersion <= 0 || strings.TrimSpace(a.Confidence) == "" || strings.TrimSpace(a.Coverage) == "" {
		return errors.New("complete provenance is required")
	}
	if strings.EqualFold(a.Symbol, "YUSD") && (!a.ReserveEvidence || !a.MintBurnControl || !a.RedemptionEvidence || !a.SupplyReconciliation) {
		return errors.New("YUSD reserve, mint/burn, redemption, and supply reconciliation evidence are required")
	}
	return nil
}
