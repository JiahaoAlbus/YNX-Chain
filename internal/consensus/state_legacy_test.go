package consensus

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

func TestLegacyLineagesPreserveTransferFeeAndNonceOnColdUpgrade(t *testing.T) {
	key := deterministicPrivateKey(231)
	sender, recipient := mustNativeAddress(t, key), mustNativeAddress(t, deterministicPrivateKey(232))
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
	tx, err := NewSignedTransfer(key, 6423, recipient, 10, 1)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := EncodeSignedTransaction(tx)
	if err != nil {
		t.Fatal(err)
	}
	result, err := app.FinalizeBlock(context.Background(), &abcitypes.RequestFinalizeBlock{Height: int64(migration.Height) + 1, Time: time.Unix(1789212000, 0).UTC(), Txs: [][]byte{raw}})
	if err != nil || result.TxResults[0].Code != 0 {
		t.Fatalf("transfer failed: %v %+v", err, result)
	}
	if _, err := app.Commit(context.Background(), &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"full13", "native13", "native14"} {
		t.Run(name, func(t *testing.T) {
			original := app.committed
			original.Version = 13
			if name == "full13" {
				original.NativeTransfers = nil
				original.AppHash, err = original.calculateLegacyFullHash("YNX_ABCI_STATE_V13", 13)
			} else if name == "native14" {
				original.Version = 14
				original.AppHash, err = original.calculateLegacyNativeHash("YNX_ABCI_STATE_V14", 14)
			} else {
				original.AppHash, err = original.calculateLegacyNativeHash("YNX_ABCI_STATE_V13", 13)
			}
			if err != nil {
				t.Fatal(err)
			}
			payload, err := json.Marshal(original)
			if err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(t.TempDir(), "state.json")
			if err := os.WriteFile(path, payload, 0600); err != nil {
				t.Fatal(err)
			}
			restored, err := loadCommittedState(path, migration)
			if err != nil {
				t.Fatal(err)
			}
			if len(restored.FeeEvents) != 1 || restored.Accounts[0].Address == "" {
				t.Fatal("historical fee or accounts lost")
			}
			var expected CommittedState
			if err := json.Unmarshal(payload, &expected); err != nil {
				t.Fatal(err)
			}
			expected.Version = CommittedStateVersion
			expected.AppHash = restored.AppHash
			if !reflect.DeepEqual(expected, restored) {
				t.Fatal("upgrade changed ledger fields beyond version/hash")
			}
			if restored.AppHash == original.AppHash {
				t.Fatal("new schema retained old hash domain")
			}
			if err := saveCommittedState(path, restored, migration); err != nil {
				t.Fatal(err)
			}
			again, err := loadCommittedState(path, migration)
			if err != nil || !reflect.DeepEqual(restored, again) {
				t.Fatalf("v15 cold roundtrip changed state: %v", err)
			}
			// A field outside this family's hash must never be accepted and silently lost.
			tampered := original
			if name == "full13" {
				tampered.NativeTransfers = app.committed.NativeTransfers
			} else {
				tampered.Paymasters = []BFTPaymaster{{}}
			}
			if _, err := upgradeLegacyCommittedState(tampered, migration); err == nil {
				t.Fatal("accepted unbound record from the other lineage")
			}
			var doc map[string]json.RawMessage
			if err := json.Unmarshal(payload, &doc); err != nil {
				t.Fatal(err)
			}
			doc["unrecognizedLedgerModule"] = json.RawMessage(`[{"balance":10}]`)
			bad, err := json.Marshal(doc)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, bad, 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := loadCommittedState(path, migration); err == nil {
				t.Fatal("unknown ledger module silently discarded")
			}
		})
	}
}
