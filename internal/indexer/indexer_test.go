package indexer

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/api"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestIndexerSyncsAndResumesFromRPC(t *testing.T) {
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	rpc := httptest.NewServer(api.NewServer(devnet))
	defer rpc.Close()

	if _, err := devnet.Faucet("ynx_indexer_alice", 1000); err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.Transfer("ynx_indexer_alice", "ynx_indexer_bob", 125); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()

	idx, err := New(Config{RPCURL: rpc.URL, StorePath: t.TempDir() + "/indexer-db.json"})
	if err != nil {
		t.Fatal(err)
	}
	result, err := idx.SyncOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.LastIndexedHeight != 1 || result.IndexedBlockCount != 2 || result.IndexedTxCount != 2 {
		t.Fatalf("unexpected first sync result: %+v", result)
	}

	if _, err := devnet.Faucet("ynx_indexer_carol", 50); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	result, err = idx.SyncOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.ResumeFromHeight != 2 || result.LastIndexedHeight != 2 || result.NewBlocksThisRun != 1 {
		t.Fatalf("expected resume from height 2: %+v", result)
	}
	db, err := idx.Store().Load()
	if err != nil {
		t.Fatal(err)
	}
	if db.NativeSymbol != "YNXT" || len(db.Transactions) != 3 {
		t.Fatalf("unexpected stored db: %+v", db)
	}
}

func TestIndexerBootstrapsAtMigrationHeightAndResumesWithFaucetTransaction(t *testing.T) {
	transaction := chain.Transaction{Hash: "0x" + strings.Repeat("1", 64), Type: "transfer", From: "0x" + strings.Repeat("2", 40), To: "0x" + strings.Repeat("3", 40), Amount: 25, Fee: 1, Nonce: 1, BlockNum: 101, Timestamp: time.Date(2026, 7, 12, 1, 0, 1, 0, time.UTC)}
	source := newMigrationSource(100, 102, map[uint64][]chain.Transaction{101: {transaction}})
	server := httptest.NewServer(source)
	defer server.Close()
	storePath := t.TempDir() + "/migration-index.json"

	idx, err := New(Config{RPCURL: server.URL, StorePath: storePath})
	if err != nil {
		t.Fatal(err)
	}
	result, err := idx.SyncOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.ResumeFromHeight != 100 || result.SourceEarliestHeight != 100 || result.LastIndexedHeight != 102 || result.IndexedBlockCount != 3 || result.IndexedTxCount != 1 || result.NewBlocksThisRun != 3 {
		t.Fatalf("unexpected migration bootstrap: %+v", result)
	}
	db, err := idx.Store().Load()
	if err != nil {
		t.Fatal(err)
	}
	if db.SourceEarliestHeight != 100 || db.SourceEarliestHash != blockHash(100) || db.Transactions[transaction.Hash].BlockNum != 101 {
		t.Fatalf("migration boundary or transaction was not persisted: %+v", db)
	}

	source.advance(103, nil)
	restarted, err := New(Config{RPCURL: server.URL, StorePath: storePath})
	if err != nil {
		t.Fatal(err)
	}
	result, err = restarted.SyncOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.ResumeFromHeight != 103 || result.LastIndexedHeight != 103 || result.NewBlocksThisRun != 1 || result.IndexedBlockCount != 4 || result.IndexedTxCount != 1 {
		t.Fatalf("unexpected migration restart: %+v", result)
	}
}

func TestIndexerFailsClosedOnParentDivergence(t *testing.T) {
	source := newMigrationSource(100, 100, nil)
	server := httptest.NewServer(source)
	defer server.Close()
	idx, err := New(Config{RPCURL: server.URL, StorePath: t.TempDir() + "/index.json"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := idx.SyncOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	source.advance(101, nil)
	source.mu.Lock()
	block := source.blocks[101]
	block.ParentHash = strings.Repeat("f", 64)
	source.blocks[101] = block
	source.mu.Unlock()
	if _, err := idx.SyncOnce(context.Background()); err == nil || !strings.Contains(err.Error(), "source chain divergence") || !strings.Contains(err.Error(), "rebuild required") {
		t.Fatalf("parent divergence did not fail closed: %v", err)
	}
	db, _ := idx.Store().Load()
	if db.LastIndexedHeight != 100 {
		t.Fatalf("divergent block was persisted: %+v", db)
	}
}

func TestIndexerFailsClosedWhenResumeHeightWasPruned(t *testing.T) {
	source := newMigrationSource(100, 100, nil)
	server := httptest.NewServer(source)
	defer server.Close()
	idx, err := New(Config{RPCURL: server.URL, StorePath: t.TempDir() + "/index.json"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := idx.SyncOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	source.advance(101, nil)
	source.advance(102, nil)
	source.mu.Lock()
	source.status.EarliestBlockHeight = 102
	source.status.EarliestBlockHash = blockHash(102)
	source.status.EarliestBlockTime = source.blocks[102].Time
	delete(source.blocks, 101)
	source.mu.Unlock()
	if _, err := idx.SyncOnce(context.Background()); err == nil || !strings.Contains(err.Error(), "below source earliest retained height 102") || !strings.Contains(err.Error(), "rebuild required") {
		t.Fatalf("pruned resume did not fail closed: %v", err)
	}
	db, _ := idx.Store().Load()
	if db.SourceEarliestHeight != 102 || db.LastIndexedHeight != 100 {
		t.Fatalf("pruned boundary was not recorded safely: %+v", db)
	}
}

type migrationSource struct {
	mu     sync.Mutex
	status Status
	blocks map[uint64]chain.Block
}

func newMigrationSource(earliest, latest uint64, transactions map[uint64][]chain.Transaction) *migrationSource {
	source := &migrationSource{blocks: map[uint64]chain.Block{}}
	for height := earliest; height <= latest; height++ {
		parent := strings.Repeat("0", 64)
		if height > 0 {
			parent = blockHash(height - 1)
		}
		source.blocks[height] = chain.Block{Height: height, Hash: blockHash(height), ParentHash: parent, Time: time.Date(2026, 7, 12, 1, 0, 0, 0, time.UTC).Add(time.Duration(height-earliest) * time.Second), Transactions: transactions[height]}
	}
	source.updateStatus(earliest, latest)
	return source
}

func (s *migrationSource) advance(height uint64, transactions []chain.Transaction) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.blocks[height] = chain.Block{Height: height, Hash: blockHash(height), ParentHash: blockHash(height - 1), Time: s.status.LatestBlockTime.Add(time.Second), Transactions: transactions}
	s.updateStatus(s.status.EarliestBlockHeight, height)
}

func (s *migrationSource) updateStatus(earliest, latest uint64) {
	s.status = Status{
		Network: "YNX Testnet", Slug: "testnet", ChainID: 6423, NativeCoinName: "YNXT", NativeCurrencySymbol: "YNXT", Decimals: 18, PublicNetwork: true,
		Height: latest, LatestBlockHash: s.blocks[latest].Hash, LatestBlockTime: s.blocks[latest].Time,
		EarliestBlockHeight: earliest, EarliestBlockHash: s.blocks[earliest].Hash, EarliestBlockTime: s.blocks[earliest].Time,
		ValidatorCount: 4, TruthfulStatus: "cometbft-rpc-and-abci-backed",
	}
}

func (s *migrationSource) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	if r.URL.Path == "/status" {
		_ = json.NewEncoder(w).Encode(s.status)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/blocks/") {
		height, err := strconv.ParseUint(strings.TrimPrefix(r.URL.Path, "/blocks/"), 10, 64)
		block, ok := s.blocks[height]
		if err != nil || !ok {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(block)
		return
	}
	http.NotFound(w, r)
}

func blockHash(height uint64) string {
	return fmt.Sprintf("%064x", height+1)
}

func TestIndexerHTTPServer(t *testing.T) {
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	rpc := httptest.NewServer(api.NewServer(devnet))
	defer rpc.Close()
	if _, err := devnet.Faucet("ynx_indexer_http", 42); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()

	idx, err := New(Config{RPCURL: rpc.URL, StorePath: t.TempDir() + "/indexer-db.json"})
	if err != nil {
		t.Fatal(err)
	}
	server := NewServerWithBuild(idx, buildinfo.Info{Commit: "abc123", Release: "ynx-chain-abc123", BuildTime: "2026-07-10T00:00:00Z"})
	if _, err := server.SyncOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()

	for _, path := range []string{"/health", "/ynx/overview", "/metrics", "/blocks/latest", "/txs"} {
		resp, err := http.Get(httpServer.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("%s returned %d", path, resp.StatusCode)
		}
		_ = resp.Body.Close()
	}
	resp, err := http.Get(httpServer.URL + "/metrics")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "ynx_indexer_last_indexed_height") {
		t.Fatalf("missing indexer metrics: %s", string(body))
	}
	resp, err = http.Get(httpServer.URL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var health map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&health); err != nil {
		t.Fatal(err)
	}
	build := health["build"].(map[string]any)
	if build["commit"] != "abc123" || build["release"] != "ynx-chain-abc123" || build["buildTime"] != "2026-07-10T00:00:00Z" {
		t.Fatalf("health missing build identity: %+v", build)
	}
	resp, err = http.Get(httpServer.URL + "/ynx/overview")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var overview map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&overview); err != nil {
		t.Fatal(err)
	}
	if overview["chainId"].(float64) != 6423 || overview["nativeCurrencySymbol"] != "YNXT" || overview["service"] != "ynx-indexerd" {
		t.Fatalf("unexpected indexer overview: %+v", overview)
	}
}
