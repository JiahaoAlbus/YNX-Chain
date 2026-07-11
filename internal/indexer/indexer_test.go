package indexer

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

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
