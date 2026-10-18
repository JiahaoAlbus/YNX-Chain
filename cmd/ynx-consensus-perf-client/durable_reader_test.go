package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abcitypes "github.com/cometbft/cometbft/abci/types"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func durableReaderFixture(t *testing.T) (*consensus.Application, chain.ConsensusMigrationState, string, cmttypes.Tx, int64) {
	t.Helper()
	key := secp256k1.PrivKeyFromBytes([]byte{111})
	sender, _ := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	recipient, _ := consensus.NativeAddress(secp256k1.PrivKeyFromBytes([]byte{112}).PubKey().SerializeCompressed())
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet(sender, 10000); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(t.TempDir(), "state.json")
	app, err := consensus.NewPersistentApplication(migration, file)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := consensus.NewSignedTransfer(key, migration.Network.ChainID, recipient, 3, 1)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := consensus.EncodeSignedTransaction(tx)
	if err != nil {
		t.Fatal(err)
	}
	height := int64(migration.Height) + 1
	result, err := app.FinalizeBlock(context.Background(), &abcitypes.RequestFinalizeBlock{Height: height, Time: time.Unix(1802736000, 0), Txs: [][]byte{raw}})
	if err != nil || result.TxResults[0].Code != 0 {
		t.Fatal("real transfer execution failed", err)
	}
	if _, err := app.Commit(context.Background(), &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	return app, migration, file, raw, height
}

func TestDurableReaderFreshHashTamperDeletionAndAtomicReplacement(t *testing.T) {
	app, migration, file, raw, height := durableReaderFixture(t)
	r, err := newDurableReader(migration, []string{file})
	if err != nil {
		t.Fatal(err)
	}
	old, err := verifyDurableExecution(file, migration, raw, height)
	if err != nil {
		t.Fatal(err)
	}
	first, err := r.verify(context.Background(), file, raw, height)
	if err != nil || first.SnapshotCacheHit || first.Height != old.Height || first.AppHash != old.AppHash {
		t.Fatal("first read differs from original verifier", first, err)
	}
	second, err := r.verify(context.Background(), file, raw, height)
	if err != nil || !second.SnapshotCacheHit || first.SnapshotSHA256 != second.SnapshotSHA256 {
		t.Fatal("identical snapshot was not reused", err)
	}
	bytes, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	if stats := r.stats(); stats.SnapshotValidations != 1 || stats.TransactionVerifications != 2 || stats.BytesHashed != uint64(2*len(bytes)) {
		t.Fatalf("read/verification counters differ: %+v", stats)
	}
	info, err := os.Stat(file)
	if err != nil {
		t.Fatal(err)
	}
	var corrupt consensus.CommittedState
	if err := json.Unmarshal(bytes, &corrupt); err != nil {
		t.Fatal(err)
	}
	for i := range corrupt.Accounts {
		if corrupt.Accounts[i].Balance == 9996 {
			corrupt.Accounts[i].Balance++
			break
		}
	}
	tampered, err := json.MarshalIndent(corrupt, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	tampered = append(tampered, '\n')
	if len(tampered) != len(bytes) || string(tampered) == string(bytes) {
		t.Fatal("same-size tamper fixture failed")
	}
	if err := os.WriteFile(file, tampered, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(file, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	if _, err := r.verify(context.Background(), file, raw, height); err == nil {
		t.Fatal("same-size restored-mtime corruption reused stale success")
	}
	if err := os.Remove(file); err != nil {
		t.Fatal(err)
	}
	if _, err := r.verify(context.Background(), file, raw, height); !errors.Is(err, errDurableNotReady) {
		t.Fatal("missing file reused old state", err)
	}
	if err := os.WriteFile(file, bytes, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := r.verify(context.Background(), file, raw, height+1); !errors.Is(err, errDurableNotReady) {
		t.Fatal("future height accepted", err)
	}
	if _, err := app.FinalizeBlock(context.Background(), &abcitypes.RequestFinalizeBlock{Height: height + 1, Time: time.Unix(1802736001, 0)}); err != nil {
		t.Fatal(err)
	}
	if _, err := app.Commit(context.Background(), &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	newer, err := r.verify(context.Background(), file, raw, height)
	if err != nil || newer.Height != height+1 || newer.SnapshotCacheHit || newer.SnapshotSHA256 == first.SnapshotSHA256 {
		t.Fatal("atomic replacement was not freshly validated", newer, err)
	}
	if _, err := r.verify(context.Background(), file, raw, height+1); err == nil {
		t.Fatal("fee inclusion at wrong height accepted")
	}
}

func TestDurableReaderScopeConcurrencyAndCancellation(t *testing.T) {
	_, migration, file, raw, height := durableReaderFixture(t)
	r, err := newDurableReader(migration, []string{file})
	if err != nil {
		t.Fatal(err)
	}
	// The verifier owns its migration anchor rather than the caller's maps.
	migration.Accounts[0].Balance++
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := r.verify(context.Background(), file, raw, height); err != nil {
				t.Errorf("concurrent reader failed: %v", err)
			}
		}()
	}
	wg.Wait()
	if stats := r.stats(); stats.SnapshotValidations != 1 || stats.SnapshotCacheHits != 7 || stats.TransactionVerifications != 8 {
		t.Fatalf("concurrent parse was repeated or signature skipped: %+v", stats)
	}
	tx, err := consensus.DecodeSignedTransaction(raw)
	if err != nil {
		t.Fatal(err)
	}
	tx.Signature = "00"
	bad, err := json.Marshal(tx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := r.verify(context.Background(), file, bad, height); err == nil || !strings.Contains(err.Error(), "signature") {
		t.Fatal("snapshot hit bypassed transaction signature verification", err)
	}
	if _, err := r.verify(context.Background(), file+"outside", raw, height); err == nil {
		t.Fatal("unregistered path accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if evidence, err := r.verify(ctx, file, raw, height); !errors.Is(err, context.Canceled) || evidence.SnapshotSHA256 != "" {
		t.Fatal("cancelled read published success", err)
	}
	if _, err := newDurableReader(r.migration, []string{file, file}); err == nil {
		t.Fatal("duplicate paths accepted")
	}
	if _, err := newDurableReader(r.migration, []string{"1", "2", "3", "4", "5"}); err == nil {
		t.Fatal("unbounded snapshot slots accepted")
	}
}

func BenchmarkDurableSnapshotReadback(b *testing.B) {
	root := os.Getenv("YNX_CHAIN_DURABLE_BENCH_DIR")
	if root == "" {
		b.Skip("set isolated existing performance fixture directory")
	}
	data, err := os.ReadFile(filepath.Join(root, "local-performance-migration.json"))
	if err != nil {
		b.Fatal(err)
	}
	var migration chain.ConsensusMigrationState
	if err := json.Unmarshal(data, &migration); err != nil {
		b.Fatal(err)
	}
	file := filepath.Join(root, "abci-run-1234288681/state.json")
	data, err = os.ReadFile(file)
	if err != nil {
		b.Fatal(err)
	}
	var state consensus.CommittedState
	if err := strictJSON(data, &state); err != nil {
		b.Fatal(err)
	}
	if len(state.FeeEvents) != 1024 {
		b.Fatal("real1024-transfer fixture required")
	}
	seed := sha256.Sum256([]byte("YNX_LOCAL_PERFORMANCE_TEST_ONLY_0"))
	recipientSeed := sha256.Sum256([]byte("YNX_LOCAL_PERFORMANCE_TEST_ONLY_64"))
	key := secp256k1.PrivKeyFromBytes(seed[:])
	to, _ := consensus.NativeAddress(secp256k1.PrivKeyFromBytes(recipientSeed[:]).PubKey().SerializeCompressed())
	tx, err := consensus.NewSignedTransfer(key, migration.Network.ChainID, to, 1, 1)
	if err != nil {
		b.Fatal(err)
	}
	raw, err := consensus.EncodeSignedTransaction(tx)
	if err != nil {
		b.Fatal(err)
	}
	height := int64(migration.Height) + 1
	for _, method := range []string{"original", "fresh_hash_reuse"} {
		b.Run(method, func(b *testing.B) {
			var r *durableReader
			if method == "fresh_hash_reuse" {
				r, err = newDurableReader(migration, []string{file})
				if err != nil {
					b.Fatal(err)
				}
				if _, err := r.verify(context.Background(), file, raw, height); err != nil {
					b.Fatal(err)
				}
			} else if _, err := verifyDurableExecution(file, migration, raw, height); err != nil {
				b.Fatal(err)
			}
			b.ReportAllocs()
			b.SetBytes(int64(len(data)))
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if method == "original" {
					_, err = verifyDurableExecution(file, migration, raw, height)
				} else {
					_, err = r.verify(context.Background(), file, raw, height)
				}
				if err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
