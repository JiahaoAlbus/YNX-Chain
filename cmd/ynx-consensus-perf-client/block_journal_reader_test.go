package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestBlockJournalReaderMatchesLiveStateAcrossCheckpointAndTail(t *testing.T) {
	app, migration, path, raw, height := durableJournalFixture(t, "block-journal")
	r, err := newDurableReader(migration, []string{path})
	if err != nil {
		t.Fatal(err)
	}
	for step := 0; step < 20; step++ {
		evidence, err := r.verify(context.Background(), path, raw, height)
		if err != nil {
			t.Fatal(err)
		}
		if evidence.StoreFormat != "block-journal" || evidence.JournalIncompleteTail || evidence.StoreSHA256 == evidence.SnapshotSHA256 {
			t.Fatal("V2 reconstruction identities wrong")
		}
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		decoded, err := consensus.DecodeBlockJournal(context.Background(), data, migration)
		if err != nil {
			t.Fatal(err)
		}
		query, err := app.Query(context.Background(), &abci.RequestQuery{Path: "/state"})
		if err != nil {
			t.Fatal(err)
		}
		encoded, err := json.Marshal(decoded.State)
		if err != nil || !bytes.Equal(encoded, query.Value) {
			t.Fatal("read-only replay differs from live complete state", err)
		}
		after, _ := os.ReadFile(path)
		if !bytes.Equal(data, after) {
			t.Fatal("read-only replay changed data")
		}
		info, err := app.Info(context.Background(), &abci.RequestInfo{})
		if err != nil {
			t.Fatal(err)
		}
		if err := verifyJournalPublishedState(evidence, &coretypes.ResultABCIInfo{Response: *info}); err != nil {
			t.Fatal(err)
		}
		old := *info
		old.LastBlockHeight = evidence.Height - 1
		if !errors.Is(verifyJournalPublishedState(evidence, &coretypes.ResultABCIInfo{Response: old}), errDurableNotReady) {
			t.Fatal("V2 visible but unpublished record counted")
		}
		_, err = app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: info.LastBlockHeight + 1, Time: time.Unix(1802736001+int64(step), 0)})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, append(append([]byte(nil), data...), []byte("tail")...), 0o600); err != nil {
		t.Fatal(err)
	}
	tail, err := r.verify(context.Background(), path, raw, height)
	if err != nil || !tail.JournalIncompleteTail || tail.JournalCompleteBytes != len(data) {
		t.Fatal("V2 incomplete tail not explicit", err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	data[len(data)-2] ^= 1
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := r.verify(context.Background(), path, raw, height); err == nil {
		t.Fatal("cache hid V2 same-size corruption")
	}
}

func durableBatchFixture(t *testing.T) (*durableReader, string, []cmttypes.Tx, int64) {
	t.Helper()
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	to, _ := consensus.NativeAddress(secp256k1.PrivKeyFromBytes([]byte{220}).PubKey().SerializeCompressed())
	var raws []cmttypes.Tx
	for i := byte(1); i <= 3; i++ {
		key := secp256k1.PrivKeyFromBytes([]byte{i})
		address, _ := consensus.NativeAddress(key.PubKey().SerializeCompressed())
		if _, err := devnet.Faucet(address, 10000); err != nil {
			t.Fatal(err)
		}
		tx, err := consensus.NewSignedTransfer(key, 6423, to, 1, 1)
		if err != nil {
			t.Fatal(err)
		}
		raw, err := consensus.EncodeSignedTransaction(tx)
		if err != nil {
			t.Fatal(err)
		}
		raws = append(raws, raw)
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "batch.blocks")
	app, err := consensus.NewBlockJournaledApplication(migration, path)
	if err != nil {
		t.Fatal(err)
	}
	height := int64(migration.Height) + 1
	txs := make([][]byte, len(raws))
	for i := range raws {
		txs[i] = raws[i]
	}
	r, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: height, Time: time.Unix(1802736000, 0), Txs: txs})
	if err != nil {
		t.Fatal(err)
	}
	for _, result := range r.TxResults {
		if result.Code != 0 {
			t.Fatal("actual batch fixture execution failed")
		}
	}
	if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	reader, err := newDurableReader(migration, []string{path})
	if err != nil {
		t.Fatal(err)
	}
	return reader, path, raws, height
}

func TestDurableBlockBatchChecksEveryTransactionWithOneFreshRead(t *testing.T) {
	r, path, raws, height := durableBatchFixture(t)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	first, err := r.verifyBlockBatch(context.Background(), path, raws, height)
	if err != nil || first.Transactions != 3 || first.Evidence.StoreFormat != "block-journal" || first.ObservedAt.IsZero() {
		t.Fatal("batch readback failed", err)
	}
	stats := r.stats()
	if stats.Attempts != 1 || stats.BytesHashed != uint64(len(data)) || stats.SnapshotValidations != 1 || stats.TransactionVerifications != 3 {
		t.Fatal("batch weakened checks or reread per transaction", stats)
	}
	for _, raw := range raws {
		single, err := r.verify(context.Background(), path, raw, height)
		if err != nil || single.SnapshotSHA256 != first.Evidence.SnapshotSHA256 || single.StoreSHA256 != first.Evidence.StoreSHA256 {
			t.Fatal("single/batch evidence differs", err)
		}
	}
	for _, mode := range []string{"empty", "duplicate", "bad_signature", "wrong_height", "future_height", "canceled"} {
		t.Run(mode, func(t *testing.T) {
			input := append([]cmttypes.Tx(nil), raws...)
			h := height
			ctx := context.Background()
			switch mode {
			case "empty":
				input = nil
			case "duplicate":
				input[2] = input[1]
			case "bad_signature":
				var tx consensus.SignedTransaction
				if err := json.Unmarshal(raws[2], &tx); err != nil {
					t.Fatal(err)
				}
				tx.Signature = "00"
				input[2], _ = json.Marshal(tx)
			case "wrong_height":
				h--
			case "future_height":
				h++
			case "canceled":
				c, cancel := context.WithCancel(ctx)
				cancel()
				ctx = c
			}
			batch, err := r.verifyBlockBatch(ctx, path, input, h)
			if err == nil || batch.Transactions != 0 || batch.Evidence.SnapshotSHA256 != "" {
				t.Fatal("invalid batch published partial success")
			}
		})
	}
	corrupt := append([]byte(nil), data...)
	corrupt[len(corrupt)-2] ^= 1
	if err := os.WriteFile(path, corrupt, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := r.verifyBlockBatch(context.Background(), path, raws, height); err == nil {
		t.Fatal("batch cache hid changed current bytes")
	}
}

func BenchmarkDurableBlockBatch(b *testing.B) {
	statePath, migrationPath := os.Getenv("YNX_CHAIN_BATCH_STATE"), os.Getenv("YNX_CHAIN_BATCH_MIGRATION")
	if statePath == "" || migrationPath == "" {
		b.Skip("requires retained real1024 32x32 V2 state and its exact migration")
	}
	data, err := os.ReadFile(migrationPath)
	if err != nil {
		b.Fatal(err)
	}
	var migration chain.ConsensusMigrationState
	if err := json.Unmarshal(data, &migration); err != nil {
		b.Fatal(err)
	}
	var addresses []string
	var keys []*secp256k1.PrivateKey
	for i := 0; i < 64; i++ {
		seed := sha256.Sum256([]byte(fmt.Sprintf("YNX_LOCAL_PERFORMANCE_TEST_ONLY_%d", i)))
		key := secp256k1.PrivKeyFromBytes(seed[:])
		address, _ := consensus.NativeAddress(key.PubKey().SerializeCompressed())
		keys = append(keys, key)
		addresses = append(addresses, address)
	}
	var raws []cmttypes.Tx
	for i := 0; i < 32; i++ {
		tx, err := consensus.NewSignedTransfer(keys[i], 6423, addresses[32+i], 1, 32)
		if err != nil {
			b.Fatal(err)
		}
		raw, err := consensus.EncodeSignedTransaction(tx)
		if err != nil {
			b.Fatal(err)
		}
		raws = append(raws, raw)
	}
	height := int64(migration.Height) + 32
	for _, mode := range []string{"single_reads_32", "one_block_batch_32"} {
		b.Run(mode, func(b *testing.B) {
			r, err := newDurableReader(migration, []string{statePath})
			if err != nil {
				b.Fatal(err)
			}
			if _, err := r.verifyBlockBatch(context.Background(), statePath, raws, height); err != nil {
				b.Fatal("fixture does not match real final block", err)
			}
			before := r.stats()
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if mode == "single_reads_32" {
					for _, raw := range raws {
						if _, err := r.verify(context.Background(), statePath, raw, height); err != nil {
							b.Fatal(err)
						}
					}
				} else {
					if _, err := r.verifyBlockBatch(context.Background(), statePath, raws, height); err != nil {
						b.Fatal(err)
					}
				}
			}
			b.StopTimer()
			after := r.stats()
			b.ReportMetric(float64(after.BytesHashed-before.BytesHashed)/float64(b.N), "store-B/batch")
			b.ReportMetric(float64(after.TransactionVerifications-before.TransactionVerifications)/float64(b.N), "signatures/batch")
		})
	}
}
