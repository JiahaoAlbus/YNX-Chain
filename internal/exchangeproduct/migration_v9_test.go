package exchangeproduct

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestSchemaV9IntegrityMigratesToRiskSchemaWithoutDroppingState(t *testing.T) {
	path := filepath.Join(t.TempDir(), "exchange-v9.json")
	state := newState()
	state.SchemaVersion = 9
	state.Balances[balanceKey(alice, NativeAsset)] = Balance{Account: alice, Asset: NativeAsset, AvailableMicro: 7 * AmountScale, ReservedMicro: AmountScale}
	state.QuantStrategyKills["alice|nonce"] = QuantStrategyKill{Subaccount: alice, Market: DefaultMarket, NonceDomain: "nonce", Status: "killed"}
	legacy := legacyStateV9(state)
	hash, err := legacyStateIntegrityV9(legacy)
	if err != nil {
		t.Fatal(err)
	}
	legacy.IntegrityHash = hash
	payload, _ := json.MarshalIndent(legacy, "", "  ")
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatal(err)
	}

	service, err := New(Config{StatePath: path, APIKey: adminKey, WalletCallback: "ynxexchange://wallet/callback"})
	if err != nil {
		t.Fatal(err)
	}
	if service.state.SchemaVersion != currentStateSchemaVersion || service.state.Balances[balanceKey(alice, NativeAsset)].AvailableMicro != 7*AmountScale || service.state.QuantStrategyKills["alice|nonce"].Status != "killed" {
		t.Fatalf("migration dropped prior state: %+v", service.state)
	}
	if service.state.RiskOracle == nil || service.state.RiskMarkets == nil || service.state.MarginAccounts == nil || service.state.PerpetualPositions == nil || service.state.PerpetualOrders == nil || service.state.PerpetualTrades == nil || service.state.FundingSettlements == nil || service.state.Liquidations == nil || service.state.InsuranceFund.Asset != QuoteAsset {
		t.Fatalf("risk state not initialized: %+v", service.state)
	}
	restarted, err := New(service.cfg)
	if err != nil || restarted.state.SchemaVersion != currentStateSchemaVersion || restarted.state.IntegrityHash != service.state.IntegrityHash {
		t.Fatalf("restart=%+v err=%v", restarted, err)
	}
}

func TestSchemaV9TamperIsRejectedBeforeRiskMigration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "exchange-v9-tampered.json")
	state := newState()
	state.SchemaVersion = 9
	legacy := legacyStateV9(state)
	hash, _ := legacyStateIntegrityV9(legacy)
	legacy.IntegrityHash = hash
	payload, _ := json.Marshal(legacy)
	var decoded map[string]any
	_ = json.Unmarshal(payload, &decoded)
	decoded["sequence"] = float64(99)
	tampered, _ := json.Marshal(decoded)
	if err := os.WriteFile(path, tampered, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := New(Config{StatePath: path, APIKey: adminKey, WalletCallback: "ynxexchange://wallet/callback"}); err == nil {
		t.Fatal("tampered schema v9 state migrated")
	}
}
