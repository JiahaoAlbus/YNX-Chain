package indexer

import (
	"bytes"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAuditTornFinalJournalRecovery(t *testing.T) {
	path := filepath.Join(t.TempDir(), "index.json")
	store := NewStore(path)
	if err := store.Save(Database{Version: 2, Blocks: map[string]chain.Block{}, Transactions: map[string]chain.Transaction{}}); err != nil {
		t.Fatal(err)
	}
	status := Status{Network: "YNX Testnet", ChainID: 6423, NativeCurrencySymbol: "YNXT", Height: 1, LatestBlockHash: "fixture-block-1"}
	if _, err := store.UpsertBlock("https://rpc.example.invalid", status, chain.Block{Height: 1, Hash: "fixture-block-1"}); err != nil {
		t.Fatal(err)
	}
	complete, err := os.ReadFile(path + ".journal")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path+".journal", append(append([]byte{}, complete...), []byte(`{"version":1,"sequence":2`)...), 0600); err != nil {
		t.Fatal(err)
	}
	db, err := NewStore(path).Load()
	if err != nil {
		t.Fatalf("committed frame cannot reload after torn tail: %v", err)
	}
	if db.LastIndexedHeight != 1 || db.JournalSequence != 1 {
		t.Fatalf("recovered height=%d sequence=%d", db.LastIndexedHeight, db.JournalSequence)
	}
	repaired, err := os.ReadFile(path + ".journal")
	if err != nil || !bytes.Equal(complete, repaired) {
		t.Fatalf("tail not repaired: beforeComplete=%d after=%d error=%v", len(complete), len(repaired), err)
	}
}

func TestAuditFailedRollbackPreservesPublishedState(t *testing.T) {
	store := NewStore(filepath.Join(t.TempDir(), "index.json"))
	tx := chain.Transaction{Hash: "fixture-tx", Type: "transfer", BlockNum: 2, BlockHash: "fixture-block-2"}
	before := Database{Version: 2, LastIndexedHeight: 2, LastBlockHash: "fixture-block-2", JournalSequence: 2, Blocks: map[string]chain.Block{"1": {Height: 1, Hash: "fixture-block-1"}, "2": {Height: 2, Hash: "fixture-block-2", ParentHash: "fixture-block-1", Transactions: []chain.Transaction{tx}}}, Transactions: map[string]chain.Transaction{tx.Hash: tx}}
	if err := store.Save(before); err != nil {
		t.Fatal(err)
	}
	store.path = t.TempDir()
	if _, _, _, err := store.RollbackTo(1); err == nil {
		t.Fatal("snapshot rename unexpectedly succeeded")
	}
	after, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if after.LastIndexedHeight != 2 || after.JournalSequence != 2 || after.LastBlockHash != "fixture-block-2" || len(after.Blocks) != 2 || len(after.Transactions) != 1 {
		t.Fatalf("failed durable write changed published state: height=%d sequence=%d blocks=%d txs=%d", after.LastIndexedHeight, after.JournalSequence, len(after.Blocks), len(after.Transactions))
	}
}

func TestAuditOversizedJournalRejectedBeforePublication(t *testing.T) {
	path := filepath.Join(t.TempDir(), "index.json")
	store := NewStore(path)
	block := chain.Block{Height: 1, Hash: "fixture-block-1", Transactions: []chain.Transaction{{Hash: "fixture-tx", Type: strings.Repeat("x", 8<<20)}}}
	_, err := store.UpsertBlock("https://rpc.example.invalid", Status{Height: 1}, block)
	if err == nil {
		db, _ := store.Load()
		stat, _ := os.Stat(path + ".journal")
		var size int64
		if stat != nil {
			size = stat.Size()
		}
		_, restartErr := NewStore(path).Load()
		t.Fatalf("oversized frame committed: height=%d sequence=%d journalBytes=%d restartError=%v", db.LastIndexedHeight, db.JournalSequence, size, restartErr)
	}
	db, loadErr := store.Load()
	if loadErr != nil {
		t.Fatal(loadErr)
	}
	if db.LastIndexedHeight != 0 || db.JournalSequence != 0 || len(db.Blocks) != 0 || len(db.Transactions) != 0 {
		t.Fatalf("rejected write mutated published state: height=%d sequence=%d blocks=%d txs=%d", db.LastIndexedHeight, db.JournalSequence, len(db.Blocks), len(db.Transactions))
	}
}
