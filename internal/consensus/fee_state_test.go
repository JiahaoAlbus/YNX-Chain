package consensus

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
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

func TestCommittedStateMigratesVersion8AndPreservesFeeLedger(t *testing.T) {
	key := deterministicPrivateKey(32)
	sender := mustNativeAddress(t, key)
	recipient := mustNativeAddress(t, deterministicPrivateKey(33))
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet(sender, 100); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	app, err := NewApplication(migration)
	if err != nil {
		t.Fatal(err)
	}
	tx, _ := NewSignedTransfer(key, 6423, recipient, 10, 1)
	raw, _ := EncodeSignedTransaction(tx)
	height := int64(migration.Height) + 1
	if _, err := app.FinalizeBlock(context.Background(), &abcitypes.RequestFinalizeBlock{Height: height, Time: time.Unix(height, 0), Txs: [][]byte{raw}}); err != nil {
		t.Fatal(err)
	}
	if _, err := app.Commit(context.Background(), &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	legacy := app.committed
	legacy.Version = 8
	legacy.StakeDelegations, legacy.Unbondings = nil, nil
	legacy.AppHash, err = legacy.calculateHashFor("YNX_ABCI_STATE_V8", 8)
	if err != nil {
		t.Fatal(err)
	}
	legacyHash := legacy.AppHash
	payload, _ := json.MarshalIndent(legacy, "", "  ")
	path := filepath.Join(t.TempDir(), "state-v8.json")
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	migrated, err := loadCommittedState(path, migration)
	if err != nil {
		t.Fatal(err)
	}
	if migrated.Version != CommittedStateVersion || len(migrated.FeeEvents) != 1 || migrated.AppHash == legacyHash {
		t.Fatalf("version 8 migration lost fee evidence or hash domain: %+v", migrated)
	}
}

func TestFeeEventRejectsTamperedAllocation(t *testing.T) {
	event := newCurrentFeeEvent("0xabc", "transfer", mustNativeAddress(t, deterministicPrivateKey(31)), "ynx_validator_primary", 1, 2, time.Unix(2, 0))
	event.TreasuryYNXT = 1
	if err := validateFeeEvents([]BFTFeeEvent{event}); err == nil {
		t.Fatal("tampered fee allocation was accepted")
	}
}
