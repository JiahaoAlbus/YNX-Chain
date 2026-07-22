package consensus

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestCommittedStateMigratesVersion7WithoutInventingFeeHistory(t *testing.T) {
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	legacy := initialCommittedState(migration)
	legacy.Version = 7
	legacy.FeeEvents = nil
	legacy.AppHash = migration.StateHash
	payload, err := json.MarshalIndent(legacy, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "state.json")
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	migrated, err := loadCommittedState(path, migration)
	if err != nil {
		t.Fatal(err)
	}
	if migrated.Version != CommittedStateVersion || len(migrated.FeeEvents) != 0 || migrated.AppHash != migration.StateHash {
		t.Fatalf("legacy state migration changed history or anchor: %+v", migrated)
	}
}

func TestFeeEventRejectsTamperedAllocation(t *testing.T) {
	event := newCurrentFeeEvent("0xabc", "transfer", mustNativeAddress(t, deterministicPrivateKey(31)), "ynx_validator_primary", 1, 2, time.Unix(2, 0))
	event.TreasuryYNXT = 1
	if err := validateFeeEvents([]BFTFeeEvent{event}); err == nil {
		t.Fatal("tampered fee allocation was accepted")
	}
}
