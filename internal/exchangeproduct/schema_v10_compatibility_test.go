package exchangeproduct

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

// Export is opt-in and only for the isolated old/new binary startup check.
// Refusing an existing destination prevents accidental overwrite of a state
// file; the fixture itself contains no account secret or production data.
func TestExportSyntheticSchemaV10ForBinaryCompatibility(t *testing.T) {
	path := os.Getenv("YNX_EXCHANGE_SYNTHETIC_V10_EXPORT")
	if path == "" {
		t.Skip("isolated fixture export path is not configured")
	}
	if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("fixture export target must be absent: %v", err)
	}
	state := syntheticSchemaV10State(t)
	if err := saveState(path, &state); err != nil {
		t.Fatal(err)
	}
}

// This synthetic fixture uses no production state or real account. Every
// schema-v10 collection is populated so a future field-set regression cannot
// silently discard conditional, margin, risk, execution or audit records.
func syntheticSchemaV10State(t *testing.T) persistentState {
	t.Helper()
	now := time.Date(2026, 9, 25, 12, 0, 0, 0, time.UTC)
	s := newState()
	s.Sequence, s.EventSequence = 31, 1
	s.CustodyAddress = "fixture-custody"
	s.Challenges["fixture"] = WalletChallenge{ID: "fixture"}
	s.Sessions["fixture"] = WalletSession{TokenHash: "fixture"}
	s.Balances["fixture"] = Balance{Account: "fixture", Asset: NativeAsset, AvailableMicro: 9}
	s.Ledger = []LedgerEntry{{ID: "fixture"}}
	s.DepositIntents["fixture"] = DepositIntent{ID: "fixture"}
	s.Deposits["fixture"] = Deposit{ID: "fixture"}
	s.Withdrawals["fixture"] = Withdrawal{ID: "fixture"}
	s.Orders["fixture"] = Order{ID: "fixture", Market: DefaultMarket}
	s.ConditionalOrders["fixture"] = ConditionalOrder{ID: "fixture"}
	s.OCOGroups["fixture"] = OCOGroup{ID: "fixture"}
	s.TWAPOrders["fixture"] = TWAPOrder{ID: "fixture"}
	s.ScaleOrders["fixture"] = ScaleOrder{ID: "fixture"}
	s.DeadMan["fixture"] = DeadManSwitch{Account: "fixture"}
	s.QuantStrategyKills["fixture"] = QuantStrategyKill{Subaccount: "fixture"}
	s.RiskOracle["fixture"] = RiskOracleSnapshot{Market: DefaultPerpetualMarket}
	s.RiskMarkets["fixture"] = RiskMarketState{Market: DefaultPerpetualMarket}
	s.MarginAccounts["fixture"] = MarginAccount{Account: "fixture", CollateralMicro: 7}
	s.PerpetualPositions["fixture"] = PerpetualPosition{Account: "fixture", Market: DefaultPerpetualMarket, SizeMicro: 3}
	s.PerpetualOrders["fixture"] = PerpetualOrder{ID: "fixture"}
	s.PerpetualTrades = []PerpetualTrade{{ID: "fixture"}}
	s.FundingSettlements = []FundingSettlement{{ID: "fixture"}}
	s.Liquidations = []LiquidationEvent{{ID: "fixture"}}
	s.InsuranceFund = InsuranceFund{Asset: QuoteAsset, BalanceMicro: 5, Status: "fixture"}
	event := ExecutionEvent{Sequence: 1, Stream: "fixture", Type: "fixture", Market: DefaultMarket, ObjectID: "fixture", Payload: json.RawMessage(`{}`), AsOf: now}
	event.Hash = digest(event)
	s.ExecutionEvents = []ExecutionEvent{event}
	s.Trades = []Trade{{ID: "fixture"}}
	s.Fees = []FeeRecord{{ID: "fixture"}}
	s.Security["fixture"] = SecuritySettings{Account: "fixture"}
	s.Support["fixture"] = SupportCase{ID: "fixture"}
	s.AI["fixture"] = AIRecord{ID: "fixture"}
	s.Idempotency["fixture"] = idempotencyRecord{Action: "fixture"}
	audit := AuditEvent{ID: "fixture", Action: "fixture", CreatedAt: now}
	audit.Hash = digest(audit)
	s.Audit = []AuditEvent{audit}
	return s
}

func TestSchemaV10AllFieldsRoundTripAndTamperReject(t *testing.T) {
	path := filepath.Join(t.TempDir(), "synthetic-schema-v10.json")
	state := syntheticSchemaV10State(t)
	if err := saveState(path, &state); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var keys map[string]json.RawMessage
	if err := json.Unmarshal(before, &keys); err != nil {
		t.Fatal(err)
	}
	if len(keys) != 36 {
		t.Fatalf("schema-v10 top-level field count=%d want=36", len(keys))
	}
	for _, field := range []string{"conditionalOrders", "ocoGroups", "twapOrders", "scaleOrders", "deadMan", "quantStrategyKills", "riskOracle", "riskMarkets", "marginAccounts", "perpetualPositions", "perpetualOrders", "perpetualTrades", "fundingSettlements", "liquidations", "executionEvents"} {
		if len(keys[field]) <= 2 {
			t.Fatalf("schema-v10 field %s is absent or empty", field)
		}
	}
	loaded, exists, err := loadState(path)
	if err != nil || !exists || !reflect.DeepEqual(state, loaded) {
		a, b := reflect.ValueOf(state), reflect.ValueOf(loaded)
		for i := 0; i < a.NumField(); i++ {
			if !reflect.DeepEqual(a.Field(i).Interface(), b.Field(i).Interface()) {
				t.Logf("round-trip field differs: %s", a.Type().Field(i).Name)
			}
		}
		t.Fatalf("schema-v10 load exists=%t err=%v equal=%t", exists, err, reflect.DeepEqual(state, loaded))
	}
	service, err := New(Config{StatePath: path, APIKey: "fixture-only-api-key-123456", WalletCallback: "ynxexchange://wallet/callback"})
	if err != nil {
		t.Fatalf("schema-v10 startup: %v", err)
	}
	if service.state.SchemaVersion != 10 || !reflect.DeepEqual(service.state, loaded) {
		t.Fatal("schema-v10 startup discarded a field")
	}
	afterStartup, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, afterStartup) {
		t.Fatal("read-only schema-v10 startup rewrote state")
	}
	state.Sequence++
	if err := saveState(path, &state); err != nil {
		t.Fatal(err)
	}
	reread, exists, err := loadState(path)
	if err != nil || !exists || !reflect.DeepEqual(state, reread) {
		t.Fatalf("schema-v10 save/read exists=%t err=%v equal=%t", exists, err, reflect.DeepEqual(state, reread))
	}
	var tampered map[string]any
	updated, _ := os.ReadFile(path)
	if err := json.Unmarshal(updated, &tampered); err != nil {
		t.Fatal(err)
	}
	tampered["sequence"] = float64(9000)
	corrupt, _ := json.Marshal(tampered)
	if err := os.WriteFile(path, corrupt, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := loadState(path); err == nil {
		t.Fatal("tampered schema-v10 state passed integrity verification")
	}
}
