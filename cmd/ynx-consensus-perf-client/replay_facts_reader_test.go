package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
)

func TestDurableReaderSharesOnlyReplayCryptoFactsAcrossIndependentStores(t *testing.T) {
	app, migration, path, raw, height := durableJournalFixture(t, "block-journal")
	otherPath := filepath.Join(t.TempDir(), "other.blocks")
	other, err := consensus.NewBlockJournaledApplication(migration, otherPath)
	if err != nil {
		t.Fatal(err)
	}
	response, err := other.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: height, Time: time.Unix(1802736000, 0), Txs: [][]byte{raw}})
	if err != nil || response.TxResults[0].Code != 0 {
		t.Fatal("independent actual store execution failed", err)
	}
	if _, err = other.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	r, err := newDurableReader(migration, []string{path, otherPath})
	if err != nil {
		t.Fatal(err)
	}
	first, err := r.verify(context.Background(), path, raw, height)
	if err != nil {
		t.Fatal(err)
	}
	second, err := r.verify(context.Background(), otherPath, raw, height)
	if err != nil || first.SnapshotSHA256 != second.SnapshotSHA256 {
		t.Fatal("independent store state mismatch", err)
	}
	stats := r.stats()
	if stats.SnapshotValidations != 2 || stats.TransactionVerifications != 2 || stats.BlockReplayTxInputs != 2 || stats.ReplayNativeFacts.SuccessfulVerifications != 1 || stats.ReplayNativeFacts.Hits != 1 {
		t.Fatal("facts reused mutable state or skipped observed signatures", stats)
	}
	if _, err = app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: height + 1, Time: time.Unix(1802736001, 0)}); err != nil {
		t.Fatal(err)
	}
	if _, err = app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	changed, err := r.verify(context.Background(), path, raw, height)
	if err != nil || changed.Height != height+1 || changed.StoreSHA256 == first.StoreSHA256 {
		t.Fatal("changed file was not fully reconstructed", err)
	}
	stats = r.stats()
	if stats.SnapshotValidations != 3 || stats.BlockReplayTxInputs != 3 || stats.TransactionVerifications != 3 || stats.ReplayNativeFacts.SuccessfulVerifications != 1 || stats.ReplayNativeFacts.Hits != 2 {
		t.Fatal("changed bytes bypassed replay or crypto facts not reused", stats)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	data[len(data)-2] ^= 1
	if err = os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err = r.verify(context.Background(), path, raw, height); err == nil {
		t.Fatal("warm native facts hid current same-size corruption")
	}
}
