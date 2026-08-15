package indexer

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestStoreUpsertUsesDurableJournalWithoutRewritingSnapshot(t *testing.T) {
	path := filepath.Join(t.TempDir(), "index.json")
	store := NewStore(path)
	initial := Database{
		Version:      2,
		Network:      "YNX Testnet",
		ChainID:      6423,
		NativeSymbol: "YNXT",
		Blocks: map[string]chain.Block{
			"40": {Height: 40, Hash: blockHash(40), ParentHash: blockHash(39)},
		},
		Transactions:      map[string]chain.Transaction{},
		LastIndexedHeight: 40,
		LastSourceHeight:  40,
		LastBlockHash:     blockHash(40),
	}
	if err := store.Save(initial); err != nil {
		t.Fatal(err)
	}
	snapshotBefore, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	status := Status{Network: "YNX Testnet", ChainID: 6423, NativeCurrencySymbol: "YNXT", Height: 41, LatestBlockHash: blockHash(41)}
	block := chain.Block{Height: 41, Hash: blockHash(41), ParentHash: blockHash(40), Time: time.Now().UTC()}
	if _, err := store.UpsertBlock("http://127.0.0.1:6420", status, block); err != nil {
		t.Fatal(err)
	}
	snapshotAfter, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(snapshotBefore, snapshotAfter) {
		t.Fatal("ordinary block upsert rewrote the full snapshot instead of appending the journal")
	}
	journal, err := os.ReadFile(path + ".journal")
	if err != nil || len(journal) == 0 {
		t.Fatalf("durable journal was not written: bytes=%d err=%v", len(journal), err)
	}

	restarted := NewStore(path)
	db, err := restarted.Load()
	if err != nil {
		t.Fatal(err)
	}
	if db.LastIndexedHeight != 41 || db.LastBlockHash != block.Hash || db.JournalSequence != 1 || db.Blocks["41"].Hash != block.Hash {
		t.Fatalf("journal replay did not restore the committed block: %+v", db)
	}
}

func TestStoreRejectsJournalSequenceGap(t *testing.T) {
	path := filepath.Join(t.TempDir(), "index.json")
	store := NewStore(path)
	if err := store.Save(Database{Version: 2, Blocks: map[string]chain.Block{}, Transactions: map[string]chain.Transaction{}}); err != nil {
		t.Fatal(err)
	}
	record := `{"version":1,"sequence":2,"operation":"upsert-block","sourceUrl":"http://127.0.0.1:6420","status":{"network":"YNX Testnet","chainId":6423,"nativeCurrencySymbol":"YNXT","height":1},"block":{"height":1,"hash":"` + blockHash(1) + `"},"recordedAt":"2026-08-01T00:00:00Z"}` + "\n"
	if err := os.WriteFile(path+".journal", []byte(record), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewStore(path).Load(); err == nil {
		t.Fatal("journal sequence gap was accepted")
	}
}

func TestStoreRepairsIncompleteFinalJournalFrame(t *testing.T) {
	path := filepath.Join(t.TempDir(), "index.json")
	store := NewStore(path)
	if err := store.Save(Database{Version: 2, Blocks: map[string]chain.Block{}, Transactions: map[string]chain.Transaction{}}); err != nil {
		t.Fatal(err)
	}
	status := Status{Network: "YNX Testnet", ChainID: 6423, NativeCurrencySymbol: "YNXT", Height: 1, LatestBlockHash: blockHash(1)}
	if _, err := store.UpsertBlock("https://rpc.ynx.invalid", status, chain.Block{Height: 1, Hash: blockHash(1)}); err != nil {
		t.Fatal(err)
	}
	journalPath := path + ".journal"
	complete, err := os.ReadFile(journalPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(journalPath, append(append([]byte{}, complete...), []byte(`{"version":1,"sequence":2`)...), 0o600); err != nil {
		t.Fatal(err)
	}
	db, err := NewStore(path).Load()
	if err != nil || db.LastIndexedHeight != 1 || db.JournalSequence != 1 {
		t.Fatalf("torn final frame prevented recovery: db=%+v err=%v", db, err)
	}
	repaired, err := os.ReadFile(journalPath)
	if err != nil || !bytes.Equal(repaired, complete) {
		t.Fatalf("torn final frame was not truncated: got=%d want=%d err=%v", len(repaired), len(complete), err)
	}
}

func TestStoreBackupRestoresSnapshotAndJournalInIsolation(t *testing.T) {
	sourcePath := filepath.Join(t.TempDir(), "index.json")
	store := NewStore(sourcePath)
	initial := Database{
		Version:           2,
		Network:           "YNX Testnet",
		ChainID:           6423,
		NativeSymbol:      "YNXT",
		Blocks:            map[string]chain.Block{"40": {Height: 40, Hash: blockHash(40), ParentHash: blockHash(39)}},
		Transactions:      map[string]chain.Transaction{},
		LastIndexedHeight: 40,
		LastSourceHeight:  40,
		LastBlockHash:     blockHash(40),
	}
	if err := store.Save(initial); err != nil {
		t.Fatal(err)
	}
	status := Status{Network: "YNX Testnet", ChainID: 6423, NativeCurrencySymbol: "YNXT", Height: 42, LatestBlockHash: blockHash(42)}
	for height := uint64(41); height <= 42; height++ {
		block := chain.Block{Height: height, Hash: blockHash(height), ParentHash: blockHash(height - 1), Time: time.Now().UTC()}
		if _, err := store.UpsertBlock("https://rpc.ynx.invalid", status, block); err != nil {
			t.Fatal(err)
		}
	}

	backupSnapshot, err := os.ReadFile(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	backupJournal, err := os.ReadFile(sourcePath + ".journal")
	if err != nil {
		t.Fatal(err)
	}
	restorePath := filepath.Join(t.TempDir(), "restored", "index.json")
	if err := os.MkdirAll(filepath.Dir(restorePath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(restorePath, backupSnapshot, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(restorePath+".journal", backupJournal, 0o600); err != nil {
		t.Fatal(err)
	}

	restored, err := NewStore(restorePath).Load()
	if err != nil {
		t.Fatal(err)
	}
	if restored.LastIndexedHeight != 42 || restored.LastBlockHash != blockHash(42) || restored.JournalSequence != 2 || restored.Blocks["41"].Hash != blockHash(41) || restored.Blocks["42"].Hash != blockHash(42) {
		t.Fatalf("isolated backup restore lost canonical snapshot or WAL state: %+v", restored)
	}

	if err := os.WriteFile(restorePath+".journal", append(backupJournal, []byte("corrupt-record\n")...), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewStore(restorePath).Load(); err == nil {
		t.Fatal("corrupted restored journal was accepted")
	}
}
