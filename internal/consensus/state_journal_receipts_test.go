package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
)

func TestInitialCommittedTraceInventorySurvivesJournalEncoding(t *testing.T) {
	for _, funded := range []bool{false, true} {
		name := "empty"
		if funded {
			name = "nonempty"
		}
		t.Run(name, func(t *testing.T) {
			d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
			if funded {
				if _, err := d.Faucet(mustNativeAddress(t, deterministicPrivateKey(11)), 100); err != nil {
					t.Fatal(err)
				}
			}
			d.ProduceBlock()
			migration, err := d.ExportConsensusMigrationState()
			if err != nil {
				t.Fatal(err)
			}
			initial := initialCommittedState(migration)
			if (len(initial.TraceLots) != 0) != funded {
				t.Fatal("fixture did not exercise the intended source inventory")
			}
			raw, err := json.Marshal(initial)
			if err != nil {
				t.Fatal(err)
			}
			var decoded CommittedState
			if err := json.Unmarshal(raw, &decoded); err != nil {
				t.Fatal(err)
			}
			if err := decoded.Validate(migration); err != nil {
				t.Fatal("original initial checkpoint was rejected after JSON round trip", err)
			}
			roundTrip, err := json.Marshal(decoded)
			if err != nil || !bytes.Equal(raw, roundTrip) || decoded.AppHash != migration.StateHash || decoded.Initialized {
				t.Fatal("initial checkpoint encoding, anchor or initialized state changed", err)
			}
			path := filepath.Join(t.TempDir(), "original.blocks")
			app, err := NewBlockJournaledApplication(migration, path)
			if err != nil || !journalStateEqual(t, app.committed, decoded) {
				t.Fatal("new block journal did not preserve the initial checkpoint", err)
			}
			original, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			cold, err := NewBlockJournaledApplication(migration, path)
			if err != nil || !journalStateEqual(t, cold.committed, decoded) {
				t.Fatal("initial journal could not be reopened", err)
			}
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(original, after) {
				t.Fatal("initial recovery rewrote the original checkpoint", err)
			}
			if funded {
				deleted := decoded
				deleted.TraceLots = nil
				if deleted.Validate(migration) == nil {
					t.Fatal("nonempty source trace inventory was silently discarded")
				}
				changed := decoded
				changed.TraceLots = cloneTraceLots(decoded.TraceLots)
				for id, lot := range changed.TraceLots {
					lot.LastInbound = "unsigned-initial-lineage"
					changed.TraceLots[id] = lot
					break
				}
				if changed.Validate(migration) == nil {
					t.Fatal("initial trace metadata changed under the migration hash")
				}
			}
		})
	}
}

func TestNativeReceiptInsertionPreservesCommittedCheckpointAcrossLayouts(t *testing.T) {
	for _, layout := range []string{"atomic-json", "snapshot-journal", "block-journal"} {
		t.Run(layout, func(t *testing.T) {
			migration, path := journalFixture(t)
			open := func() (*Application, error) {
				switch layout {
				case "snapshot-journal":
					return NewJournaledApplication(migration, path)
				case "block-journal":
					return NewBlockJournaledApplication(migration, path)
				default:
					return NewPersistentApplication(migration, path)
				}
			}
			app, err := open()
			if err != nil {
				t.Fatal(err)
			}
			for nonce := uint64(1); nonce <= 3; nonce++ {
				commitJournalBlock(t, app, nonce)
			}
			app, err = open()
			if err != nil || len(app.committed.NativeTransfers) != 3 {
				t.Fatal("three actual receipts did not survive cold restore", err)
			}
			// Decoders may leave spare capacity. Reproduce that valid allocation
			// deterministically without changing any serialized state or receipt.
			spare := make([]BFTNativeTransfer, 3, 8)
			copy(spare, app.committed.NativeTransfers)
			app.committed.NativeTransfers = spare
			before, err := json.Marshal(app.committed)
			if err != nil {
				t.Fatal(err)
			}
			oldReceipts := append([]BFTNativeTransfer(nil), spare...)
			// A next-nonce signature whose hash inserts before an existing record
			// forces the overlapping copy that used to corrupt the borrowed slice.
			var wire []byte
			var tx SignedTransaction
			for amount := int64(1); amount <= 256; amount++ {
				tx, err = NewSignedTransfer(deterministicPrivateKey(11), migration.Network.ChainID, mustNativeAddress(t, deterministicPrivateKey(13)), amount, 4)
				if err != nil {
					t.Fatal(err)
				}
				wire, err = EncodeSignedTransaction(tx)
				if err != nil {
					t.Fatal(err)
				}
				if SignedTransactionHash(wire) < oldReceipts[len(oldReceipts)-1].TransactionHash {
					break
				}
			}
			if SignedTransactionHash(wire) >= oldReceipts[len(oldReceipts)-1].TransactionHash {
				t.Fatal("fixture did not force insertion into the original receipt prefix")
			}
			assertOriginal := func(stage string) {
				t.Helper()
				after, err := json.Marshal(app.committed)
				if err != nil || !bytes.Equal(before, after) || !reflect.DeepEqual(spare, oldReceipts) {
					t.Fatal(stage+" mutated the prior committed receipt backing array", err)
				}
			}
			for attempt := 0; attempt < 2; attempt++ {
				check, err := app.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: wire})
				if err != nil || check.Code != 0 {
					t.Fatal("valid next nonce rejected", err)
				}
				assertOriginal("CheckTx")
			}
			at := time.Unix(1802736004, 0).UTC()
			response, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: app.committed.Height + 1, Time: at, Txs: [][]byte{wire, wire}})
			if err != nil || len(response.TxResults) != 2 || response.TxResults[0].Code != 0 || response.TxResults[1].Code != CodeInvalidNonce {
				t.Fatal("original signed transfer or duplicate semantics changed", err)
			}
			assertOriginal("FinalizeBlock")
			if len(app.pending.NativeTransfers) != 4 {
				t.Fatal("pending checkpoint lost or duplicated a receipt")
			}
			expected, err := json.Marshal(app.pending)
			if err != nil {
				t.Fatal(err)
			}
			fired := false
			fault := func(stage string) error {
				if stage == "append_synced" {
					fired = true
					return errors.New("injected UNKNOWN after syncing actual receipt checkpoint")
				}
				return nil
			}
			if app.journal != nil {
				app.journal.fault = fault
			}
			if app.blockJournal != nil {
				app.blockJournal.io.fault = fault
			}
			_, err = app.Commit(context.Background(), &abci.RequestCommit{})
			if layout == "atomic-json" {
				if err != nil {
					t.Fatal(err)
				}
			} else {
				if err == nil || !fired || app.pending == nil {
					t.Fatal("journal did not preserve UNKNOWN pending intent", err)
				}
				assertOriginal("UNKNOWN Commit")
			}
			cold, err := open()
			if err != nil {
				t.Fatal("original complete checkpoint did not reconcile", err)
			}
			got, err := json.Marshal(cold.committed)
			if err != nil || !bytes.Equal(expected, got) {
				t.Fatal("cold recovery lost or changed the complete receipt checkpoint", err)
			}
			_, receipt, ok := findPayRecord(cold.committed.NativeTransfers, SignedTransactionHash(wire), func(v BFTNativeTransfer) string { return v.TransactionHash })
			want := BFTNativeTransfer{TransactionHash: SignedTransactionHash(wire), From: tx.From, To: tx.To, Amount: tx.Amount, Fee: tx.Fee, BlockHeight: cold.committed.Height, CommittedAt: at}
			if !ok || !reflect.DeepEqual(receipt, want) || !reflect.DeepEqual(spare, oldReceipts) {
				t.Fatal("receipt execution fields or original memory checkpoint changed")
			}
			check, err := cold.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: wire})
			if err != nil || check.Code != CodeInvalidNonce {
				t.Fatal("UNKNOWN reconciliation lost the original nonce fence", err)
			}
		})
	}
}
