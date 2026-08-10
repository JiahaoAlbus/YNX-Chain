package exchangeproduct

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestStateSchemaV8MigratesToV9AndRejectsTamper(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "legacy-v8.json")
	legacy := legacyStateV8(newState())
	legacy.SchemaVersion = 8
	var err error
	legacy.IntegrityHash, err = legacyStateIntegrityV8(legacy)
	if err != nil {
		t.Fatal(err)
	}
	legacyJSON, err := json.MarshalIndent(legacy, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, legacyJSON, 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := New(Config{StatePath: path, APIKey: adminKey, WalletCallback: "ynxexchange://wallet/callback"})
	if err != nil {
		t.Fatal(err)
	}
	if s.state.SchemaVersion != currentStateSchemaVersion || s.state.QuantStrategyKills == nil || s.state.RiskMarkets == nil || s.state.PerpetualOrders == nil {
		t.Fatalf("migration state schema=%d quantStrategyKills=%v", s.state.SchemaVersion, s.state.QuantStrategyKills)
	}
	persistedJSON, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var persisted persistentState
	if json.Unmarshal(persistedJSON, &persisted) != nil || persisted.SchemaVersion != currentStateSchemaVersion || persisted.IntegrityHash == "" {
		t.Fatalf("persisted current migration=%+v", persisted)
	}

	tamperedPath := filepath.Join(dir, "legacy-v8-tampered.json")
	tampered := legacy
	tampered.Sequence++
	tamperedJSON, err := json.MarshalIndent(tampered, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(tamperedPath, tamperedJSON, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := New(Config{StatePath: tamperedPath, APIKey: adminKey, WalletCallback: "ynxexchange://wallet/callback"}); err == nil {
		t.Fatal("tampered schema-v8 state was accepted")
	}
}
