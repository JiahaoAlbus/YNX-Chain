package indexer

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestIndexerRestartRecoversCanonicalFork(t *testing.T) {
	orphan := reorgTransaction("0x"+strings.Repeat("a", 64), 102)
	canonical := reorgTransaction("0x"+strings.Repeat("b", 64), 103)
	source := newMigrationSource(100, 103, map[uint64][]chain.Transaction{102: {orphan}})
	rpc := httptest.NewServer(source)
	defer rpc.Close()
	storePath := t.TempDir() + "/reorg-index.json"

	initial, err := New(Config{RPCURL: rpc.URL, StorePath: storePath, MaxReorgDepth: 8})
	if err != nil {
		t.Fatal(err)
	}
	if result, err := initial.SyncOnce(context.Background()); err != nil || result.LastIndexedHeight != 103 || result.IndexedTxCount != 1 {
		t.Fatalf("initial sync failed: result=%+v err=%v", result, err)
	}
	old102 := source.block(102)
	old103 := source.block(103)

	source.reorg(102, 104, map[uint64][]chain.Transaction{103: {canonical}})
	restarted, err := New(Config{RPCURL: rpc.URL, StorePath: storePath, MaxReorgDepth: 8})
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(restarted)
	result, err := server.SyncOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !result.ReorgDetected || result.RecoveryMode != "fork-rollback-and-reindex" || result.CommonAncestorHeight != 101 || result.RollbackFromHeight != 102 {
		t.Fatalf("unexpected recovery identity: %+v", result)
	}
	if result.RolledBackBlockCount != 2 || result.RolledBackTxCount != 1 || result.NewBlocksThisRun != 3 {
		t.Fatalf("unexpected recovery counts: %+v", result)
	}
	if result.LastIndexedHeight != 104 || result.IndexedBlockCount != 5 || result.IndexedTxCount != 1 || result.MaxReorgDepth != 8 {
		t.Fatalf("unexpected recovered index state: %+v", result)
	}

	db, err := restarted.Store().Load()
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := db.Transactions[orphan.Hash]; exists {
		t.Fatal("orphan transaction survived canonical rollback")
	}
	if _, exists := db.Transactions[canonical.Hash]; !exists {
		t.Fatal("canonical replacement transaction was not indexed")
	}
	if db.Blocks["102"].Hash == old102.Hash || db.Blocks["103"].Hash == old103.Hash {
		t.Fatal("orphan block hash survived canonical re-indexing")
	}
	assertCanonicalBlockChain(t, db, 100, 104)

	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()
	var health map[string]any
	getJSONForReorgTest(t, httpServer.URL+"/health", &health)
	if health["lastRecoveryMode"] != "fork-rollback-and-reindex" || health["lastReorgDetected"] != true || health["reorgRecoveryCount"].(float64) != 1 {
		t.Fatalf("health did not expose recovery truth: %+v", health)
	}
	metrics := getBodyForReorgTest(t, httpServer.URL+"/metrics")
	for _, expected := range []string{
		"ynx_indexer_reorg_recoveries_total",
		"ynx_indexer_last_common_ancestor_height",
		"ynx_indexer_last_rolled_back_blocks",
		"ynx_indexer_last_rolled_back_transactions",
	} {
		if !strings.Contains(metrics, expected) {
			t.Fatalf("metrics missing %s: %s", expected, metrics)
		}
	}

	stable, err := server.SyncOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if stable.ReorgDetected || stable.RecoveryMode != "none" || stable.NewBlocksThisRun != 0 || stable.IndexedBlockCount != 5 || stable.IndexedTxCount != 1 {
		t.Fatalf("post-recovery restart state was not stable: %+v", stable)
	}
}

func TestIndexerRecoversSourceHeightRollback(t *testing.T) {
	source := newMigrationSource(100, 103, nil)
	rpc := httptest.NewServer(source)
	defer rpc.Close()
	storePath := t.TempDir() + "/height-rollback.json"
	idx, err := New(Config{RPCURL: rpc.URL, StorePath: storePath, MaxReorgDepth: 8})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := idx.SyncOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	source.truncate(101)

	restarted, err := New(Config{RPCURL: rpc.URL, StorePath: storePath, MaxReorgDepth: 8})
	if err != nil {
		t.Fatal(err)
	}
	result, err := restarted.SyncOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !result.ReorgDetected || result.RecoveryMode != "source-height-rollback" || result.CommonAncestorHeight != 101 || result.RolledBackBlockCount != 2 || result.NewBlocksThisRun != 0 {
		t.Fatalf("source-height rollback was not recovered truthfully: %+v", result)
	}
	db, _ := restarted.Store().Load()
	if db.LastIndexedHeight != 101 || len(db.Blocks) != 2 {
		t.Fatalf("source-height rollback left stale blocks: %+v", db)
	}
}

func TestIndexerFailsClosedWhenForkExceedsRecoveryDepth(t *testing.T) {
	source := newMigrationSource(100, 104, nil)
	rpc := httptest.NewServer(source)
	defer rpc.Close()
	storePath := t.TempDir() + "/bounded-reorg.json"
	idx, err := New(Config{RPCURL: rpc.URL, StorePath: storePath, MaxReorgDepth: 2})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := idx.SyncOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	before, _ := idx.Store().Load()
	source.reorg(101, 104, nil)

	if _, err := idx.SyncOnce(context.Background()); err == nil || !strings.Contains(err.Error(), "no common ancestor") || !strings.Contains(err.Error(), "max reorg depth 2") || !strings.Contains(err.Error(), "rebuild required") {
		t.Fatalf("deep fork did not fail closed: %v", err)
	}
	after, _ := idx.Store().Load()
	if after.LastIndexedHeight != before.LastIndexedHeight || after.LastBlockHash != before.LastBlockHash || len(after.Blocks) != len(before.Blocks) {
		t.Fatalf("deep fork mutated canonical state before failing closed: before=%+v after=%+v", before, after)
	}
}

func (s *migrationSource) block(height uint64) chain.Block {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.blocks[height]
}

func (s *migrationSource) reorg(from, latest uint64, transactions map[uint64][]chain.Transaction) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for height := range s.blocks {
		if height >= from {
			delete(s.blocks, height)
		}
	}
	parent := s.blocks[from-1].Hash
	for height := from; height <= latest; height++ {
		hash := forkBlockHash(height)
		txs := append([]chain.Transaction(nil), transactions[height]...)
		for index := range txs {
			txs[index].BlockNum = height
			txs[index].BlockHash = hash
		}
		s.blocks[height] = chain.Block{
			Height:       height,
			Hash:         hash,
			ParentHash:   parent,
			Time:         time.Date(2026, 7, 29, 2, 0, 0, 0, time.UTC).Add(time.Duration(height-from) * time.Second),
			Transactions: txs,
		}
		parent = hash
	}
	s.updateStatus(s.status.EarliestBlockHeight, latest)
}

func (s *migrationSource) truncate(latest uint64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for height := range s.blocks {
		if height > latest {
			delete(s.blocks, height)
		}
	}
	s.updateStatus(s.status.EarliestBlockHeight, latest)
}

func reorgTransaction(hash string, height uint64) chain.Transaction {
	return chain.Transaction{
		Hash:      hash,
		Type:      "transfer",
		From:      "0x" + strings.Repeat("1", 40),
		To:        "0x" + strings.Repeat("2", 40),
		Amount:    7,
		Fee:       1,
		Nonce:     height,
		BlockNum:  height,
		Timestamp: time.Date(2026, 7, 29, 2, 0, 0, 0, time.UTC),
	}
}

func forkBlockHash(height uint64) string {
	return fmt.Sprintf("%064x", 1_000_000+height)
}

func assertCanonicalBlockChain(t *testing.T, db Database, first, last uint64) {
	t.Helper()
	for height := first + 1; height <= last; height++ {
		block := db.Blocks[fmt.Sprint(height)]
		parent := db.Blocks[fmt.Sprint(height-1)]
		if block.ParentHash != parent.Hash {
			t.Fatalf("indexed chain is not canonical at height %d: parent=%s expected=%s", height, block.ParentHash, parent.Hash)
		}
	}
}

func getJSONForReorgTest(t *testing.T, url string, target any) {
	t.Helper()
	response, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("GET %s returned %d", url, response.StatusCode)
	}
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		t.Fatal(err)
	}
}

func getBodyForReorgTest(t *testing.T, url string) string {
	t.Helper()
	response, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(payload)
}
