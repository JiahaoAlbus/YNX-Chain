package indexer

import (
	"bytes"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func mergedStoreBlock(height uint64, hash, parent string) chain.Block {
	return chain.Block{Height: height, Hash: hash, ParentHash: parent, Time: time.Unix(int64(height), 0).UTC()}
}

func mergedStoreStatus(height uint64) Status {
	return Status{Network: "YNX Testnet", ChainID: 6423, NativeCurrencySymbol: "YNXT", Height: height}
}

func TestMergedIndexerBatchPreservesOriginalJournalAndColdReplay(t *testing.T) {
	path := filepath.Join(t.TempDir(), "index.json")
	store := NewStore(path)
	initial := Database{Version: 2, Blocks: map[string]chain.Block{}, Transactions: map[string]chain.Transaction{}}
	if err := store.Save(initial); err != nil {
		t.Fatal(err)
	}
	snapshot, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	blocks := []chain.Block{
		mergedStoreBlock(40, blockHash(40), blockHash(39)),
		mergedStoreBlock(41, blockHash(41), blockHash(40)),
	}
	want, err := store.UpsertBlocks("https://rpc.ynx.invalid", mergedStoreStatus(41), blocks)
	if err != nil {
		t.Fatal(err)
	}
	if want.JournalSequence != 2 {
		t.Fatalf("batch lost original sequence: %d", want.JournalSequence)
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(snapshot, after) {
		t.Fatalf("batch rewrote original checkpoint: %v", err)
	}
	if _, err := os.Stat(path + ".wal"); !os.IsNotExist(err) {
		t.Fatalf("journal batch created a second persistence tail: %v", err)
	}
	blocks[1].Hash = "caller-mutation"
	got, err := NewStore(path).Load()
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatal("journal batch did not cold-replay its complete original result")
	}
	got.Blocks["41"] = chain.Block{}
	again, err := store.Load()
	if err != nil || !reflect.DeepEqual(again, want) {
		t.Fatalf("returned database aliases the durable index: %v", err)
	}
}

func TestMergedIndexerWALRollbackCheckpointCannotResurrectOldFork(t *testing.T) {
	path := filepath.Join(t.TempDir(), "index.json")
	store := NewStore(path)
	old := []chain.Block{
		mergedStoreBlock(40, blockHash(40), blockHash(39)),
		mergedStoreBlock(41, blockHash(41), blockHash(40)),
	}
	if _, err := store.UpsertBlocks("https://rpc.ynx.invalid", mergedStoreStatus(41), old); err != nil {
		t.Fatal(err)
	}
	staleWAL, err := os.ReadFile(path + ".wal")
	if err != nil || len(staleWAL) == 0 {
		t.Fatalf("fresh batch did not use the Perf WAL: %v", err)
	}
	if _, err := os.Stat(path + ".journal"); !os.IsNotExist(err) {
		t.Fatalf("fresh WAL batch dual-wrote a journal: %v", err)
	}
	rolled, removed, _, err := store.RollbackTo(40)
	if err != nil || removed != 1 || rolled.JournalSequence == 0 {
		t.Fatalf("canonical rollback: removed=%d err=%v", removed, err)
	}
	// Model a crash after the canonical checkpoint rename but before removal
	// of the old tail. Its original bytes must never restore the orphaned fork.
	if err := os.WriteFile(path+".wal", staleWAL, 0o600); err != nil {
		t.Fatal(err)
	}
	restarted := NewStore(path)
	got, err := restarted.Load()
	if err != nil || !reflect.DeepEqual(got, rolled) {
		t.Fatalf("stale WAL resurrected a checkpointed rollback: %v", err)
	}
	replacement := mergedStoreBlock(41, strings.Repeat("f", 64), blockHash(40))
	appended, err := restarted.UpsertBlock("https://rpc.ynx.invalid", mergedStoreStatus(41), replacement)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path + ".wal"); !os.IsNotExist(err) {
		t.Fatalf("reconciled pre-switch WAL was not retired: %v", err)
	}
	cold, err := NewStore(path).Load()
	if err != nil || !reflect.DeepEqual(cold, appended) || cold.Blocks["41"].Hash != replacement.Hash {
		t.Fatalf("replacement fork did not persist exactly: %v", err)
	}
}

func TestMergedIndexerAmbiguousUnsequencedTailsFailWithoutRewritingEither(t *testing.T) {
	path := filepath.Join(t.TempDir(), "index.json")
	journal := NewStore(path)
	if err := journal.Save(Database{Version: 2, Blocks: map[string]chain.Block{}, Transactions: map[string]chain.Transaction{}}); err != nil {
		t.Fatal(err)
	}
	block := mergedStoreBlock(40, blockHash(40), blockHash(39))
	if _, err := journal.UpsertBlock("https://rpc.ynx.invalid", mergedStoreStatus(40), block); err != nil {
		t.Fatal(err)
	}
	walPath := filepath.Join(t.TempDir(), "index.json")
	if _, err := NewStore(walPath).UpsertBlock("https://rpc.ynx.invalid", mergedStoreStatus(40), block); err != nil {
		t.Fatal(err)
	}
	wal, err := os.ReadFile(walPath + ".wal")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path+".wal", wal, 0o600); err != nil {
		t.Fatal(err)
	}
	snapshot, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	tail, err := os.ReadFile(path + ".journal")
	if err != nil {
		t.Fatal(err)
	}
	store := NewStore(path)
	if _, err := store.Load(); err == nil || !strings.Contains(err.Error(), "ambiguous") {
		t.Fatalf("ambiguous persistence history accepted: %v", err)
	}
	if store.Ready() {
		t.Fatal("ambiguous history exposed ready state")
	}
	for name, want := range map[string][]byte{path: snapshot, path + ".journal": tail, path + ".wal": wal} {
		got, err := os.ReadFile(name)
		if err != nil || !bytes.Equal(got, want) {
			t.Fatalf("failed reconciliation changed %s: %v", name, err)
		}
	}
}

func TestMergedIndexerJournalSequenceExhaustionRejectsEntireBatch(t *testing.T) {
	path := filepath.Join(t.TempDir(), "index.json")
	store := NewStore(path)
	initial := Database{Version: 2, JournalSequence: ^uint64(0) - 1, Blocks: map[string]chain.Block{}, Transactions: map[string]chain.Transaction{}}
	if err := store.Save(initial); err != nil {
		t.Fatal(err)
	}
	snapshot, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.UpsertBlocks("https://rpc.ynx.invalid", mergedStoreStatus(41), []chain.Block{
		mergedStoreBlock(40, blockHash(40), blockHash(39)),
		mergedStoreBlock(41, blockHash(41), blockHash(40)),
	})
	if err == nil || !strings.Contains(err.Error(), "sequence exhausted") {
		t.Fatalf("overflow batch accepted: %v", err)
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(snapshot, after) {
		t.Fatalf("overflow changed checkpoint: %v", err)
	}
	tail, err := os.ReadFile(path + ".journal")
	if err != nil || len(tail) != 0 {
		t.Fatalf("overflow durably wrote a prefix: %v", err)
	}
	got, err := NewStore(path).Load()
	if err != nil || !reflect.DeepEqual(got, initial) {
		t.Fatalf("overflow changed full state: %v", err)
	}
}
