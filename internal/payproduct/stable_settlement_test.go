package payproduct

import (
	"testing"
	"time"
)

func TestSettlementAssetsKeepUnsupportedUSDCUnavailable(t *testing.T) {
	s, _ := testService(t, &fakePay{}, time.Now)
	assets := s.SettlementAssets()
	if len(assets) != 2 || assets[0].Symbol != NativeAsset || assets[0].AssetClass != AssetClassNative || !assets[0].Available {
		t.Fatalf("native asset classification is wrong: %+v", assets)
	}
	if assets[1].Symbol != "USDC_TESTNET" || assets[1].AssetClass != AssetClassTestnetStablecoin || assets[1].Available || assets[1].ContractAddress != "" || assets[1].Failure != "unsupported_chain" {
		t.Fatalf("unsupported stablecoin was misrepresented: %+v", assets[1])
	}
}

func TestStableSettlementApprovalFailsClosed(t *testing.T) {
	now := time.Date(2026, 7, 22, 1, 0, 0, 0, time.UTC)
	a := StableSettlementApproval{Symbol: "USDC_TESTNET", AssetClass: AssetClassTestnetStablecoin, ChainID: EVMChainID, ContractAddress: "0x1111111111111111111111111111111111111111", Decimals: 6, Provider: "reviewed-issuer", ProviderApproved: true, IssuerLegalApproved: true, Health: "healthy", AttestationAvailable: true, LimitsDocumented: true, PauseControl: true, Source: "issuer-registry", SourceAsOf: now, SourceVersion: 1, Confidence: "authoritative", Coverage: "ynx-testnet"}
	s, _ := testService(t, &fakePay{}, func() time.Time { return now })
	s.stableApproval = &a
	asset := s.SettlementAssets()[1]
	if asset.Available || asset.Status != "unavailable" || asset.Failure != "approval_incomplete" {
		t.Fatalf("incomplete approval did not fail closed: %+v", asset)
	}
	a.DepegControl = true
	s, _ = testService(t, &fakePay{}, func() time.Time { return now })
	s.stableApproval = &a
	if asset = s.SettlementAssets()[1]; !asset.Available || asset.Status != "available" {
		t.Fatalf("complete reviewed approval was rejected: %+v", asset)
	}
}

func TestYUSDRequiresIssuerControls(t *testing.T) {
	a := StableSettlementApproval{Symbol: "YUSD", AssetClass: AssetClassTestnetStablecoin, ChainID: EVMChainID, ContractAddress: "0x2222222222222222222222222222222222222222", Decimals: 6, Provider: "reviewed-issuer", ProviderApproved: true, IssuerLegalApproved: true, Health: "healthy", AttestationAvailable: true, LimitsDocumented: true, PauseControl: true, DepegControl: true, Source: "issuer-registry", SourceAsOf: time.Now(), SourceVersion: 1, Confidence: "authoritative", Coverage: "ynx-testnet"}
	if err := validateStableApproval(a); err == nil {
		t.Fatal("YUSD without reserve lifecycle evidence was accepted")
	}
}
