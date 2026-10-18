package consensus

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
)

// These fixtures describe the original performance runtime, which never wrote
// protocol lineage/receipt fields. Merely changing a modern version is invalid.
func historicalPerformanceStateJSON(t *testing.T, state CommittedState) []byte {
	t.Helper()
	if state.AccountPolicy != nil || state.ValidatorRegistry != nil || state.PQEngineSchedule != nil || len(state.PQHistory)+len(state.PQBatches) != 0 {
		t.Fatal("a protocol-authorized state cannot be relabeled as a legacy fixture")
	}
	raw, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	var doc map[string]json.RawMessage
	if err = json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"validatorRegistry", "pqEngineSchedule", "legacyContracts", "legacyResourceMarket", "legacyResourceSponsor", "traceLots", "accountPolicy", "pqHistory", "pqBatches", "nativeTransfers", "paySettlements"} {
		delete(doc, field)
	}
	raw, err = json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestProtocolUpgradeRetainsOriginalCheckpointUntilActualCommit(t *testing.T) {
	key := deterministicPrivateKey(231)
	sender := mustNativeAddress(t, key)
	recipient := mustNativeAddress(t, deterministicPrivateKey(232))
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := d.Faucet(sender, 100); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	migration, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	original, err := NewApplication(migration)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := NewSignedTransfer(key, 6423, recipient, 7, 1)
	if err != nil {
		t.Fatal(err)
	}
	wire, err := EncodeSignedTransaction(tx)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	height := int64(migration.Height) + 1
	result, err := original.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: height, Time: time.Unix(height, 0).UTC(), Txs: [][]byte{wire}})
	if err != nil || len(result.TxResults) != 1 || result.TxResults[0].Code != 0 {
		t.Fatal("actual original transfer failed", err, result)
	}
	if _, err = original.Commit(ctx, &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	for _, version := range []int{12, 13} {
		t.Run(strconv.Itoa(version), func(t *testing.T) {
			old := original.committed
			old.Version = version
			old.AppHash, err = old.calculateHashFor("YNX_ABCI_STATE_V"+strconv.Itoa(version), version)
			if err != nil {
				t.Fatal(err)
			}
			raw := historicalPerformanceStateJSON(t, old)
			path := filepath.Join(t.TempDir(), "original.json")
			if err = os.WriteFile(path, raw, 0600); err != nil {
				t.Fatal(err)
			}
			before, err := os.Stat(path)
			if err != nil {
				t.Fatal(err)
			}
			restored, err := NewPersistentApplication(migration, path)
			if err != nil {
				t.Fatal(err)
			}
			info, err := restored.Info(ctx, &abci.RequestInfo{})
			expected, _ := hex.DecodeString(old.AppHash)
			after, statErr := os.Stat(path)
			actual, readErr := os.ReadFile(path)
			if err != nil || statErr != nil || readErr != nil || !bytes.Equal(info.LastBlockAppHash, expected) || info.LastBlockHeight != old.Height || !os.SameFile(before, after) || !before.ModTime().Equal(after.ModTime()) || !bytes.Equal(raw, actual) {
				t.Fatal("startup changed original checkpoint, file identity, hash or height", err, statErr, readErr)
			}
			if !reflect.DeepEqual(restored.committed.Accounts, old.Accounts) || !reflect.DeepEqual(restored.committed.FeeEvents, old.FeeEvents) {
				t.Fatal("startup changed accounts or fee history")
			}
			next, err := restored.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: height + 1, Time: time.Unix(height+1, 0).UTC()})
			if err != nil {
				t.Fatal(err)
			}
			if bytes.Equal(next.AppHash, expected) {
				t.Fatal("actual upgraded block omitted new state domain")
			}
			stillOld, _ := restored.Info(ctx, &abci.RequestInfo{})
			if !bytes.Equal(stillOld.LastBlockAppHash, expected) {
				t.Fatal("Finalize published pending checkpoint before durable Commit")
			}
			if _, err = restored.Commit(ctx, &abci.RequestCommit{}); err != nil {
				t.Fatal(err)
			}
			cold, err := NewPersistentApplication(migration, path)
			if err != nil {
				t.Fatal(err)
			}
			if cold.committed.Version != CommittedStateVersion || !reflect.DeepEqual(cold.committed.Accounts, old.Accounts) || !reflect.DeepEqual(cold.committed.FeeEvents, old.FeeEvents) {
				t.Fatal("actual upgrade or cold restart lost original state", err)
			}
		})
	}
}

func TestHistoricalDomainRejectsUncommittedAuthorizationAndLineage(t *testing.T) {
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := d.Faucet(mustNativeAddress(t, deterministicPrivateKey(233)), 10); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	migration, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	state := initialCommittedState(migration)
	state.Version = 13
	state.TraceLots = nil
	state.Initialized = true
	state.Height++
	state.AppHash = migration.StateHash
	raw := historicalPerformanceStateJSON(t, state)
	var forged CommittedState
	if err = json.Unmarshal(raw, &forged); err != nil {
		t.Fatal(err)
	}
	forged.TraceLots = migrationTraceLots(migration)
	forged.AppHash, err = forged.calculateHash()
	if err != nil {
		t.Fatal(err)
	}
	if err = forged.Validate(migration); err == nil {
		t.Fatal("an independently ignored historical field acquired authorization by resealing")
	}
}
