package explorer

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/api"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/indexer"
)

func TestExplorerServesRPCAndIndexerBackedData(t *testing.T) {
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet("ynx_explorer_alice", 1000); err != nil {
		t.Fatal(err)
	}
	tx, err := devnet.Transfer("ynx_explorer_alice", "ynx_explorer_bob", 125)
	if err != nil {
		t.Fatal(err)
	}
	canonicalAddress := "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf"
	ynxAddress, err := accountaddress.Encode(canonicalAddress)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.Faucet(canonicalAddress, 50); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()

	const resourceUpstreamKey = "explorer-resource-upstream-key"
	rpc := httptest.NewServer(api.NewServerWithConfig(devnet, api.ServerConfig{ResourceGatewayUpstreamKey: resourceUpstreamKey}))
	defer rpc.Close()
	idx, err := indexer.New(indexer.Config{RPCURL: rpc.URL, StorePath: t.TempDir() + "/indexer-db.json"})
	if err != nil {
		t.Fatal(err)
	}
	indexerServer := indexer.NewServer(idx)
	if _, err := indexerServer.SyncOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	indexerHTTP := httptest.NewServer(indexerServer.Handler())
	defer indexerHTTP.Close()

	svc, err := New(Config{RPCURL: rpc.URL, IndexerURL: indexerHTTP.URL, PublicRPCURL: rpc.URL, PublicExplorerURL: "https://explorer.ynx.test", ResourceUpstreamKey: resourceUpstreamKey})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServerWithBuild(svc, buildinfo.Info{Commit: "abc123", Release: "ynx-chain-abc123", BuildTime: "2026-07-10T00:00:00Z"}).Handler())
	defer server.Close()

	for _, path := range []string{"/health", "/api/summary", "/api/blocks/latest", "/api/txs", "/api/accounts/ynx_explorer_bob", "/api/accounts/" + ynxAddress, "/api/tokens/YNXT", "/api/validators", "/api/resources/ynx_explorer_bob", "/api/resource-market/analytics", "/api/fees/" + tx.Hash, "/api/search?q=" + tx.Hash, "/api/search?q=" + ynxAddress, "/metrics"} {
		resp, err := http.Get(server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			_ = resp.Body.Close()
			t.Fatalf("%s returned %d: %s", path, resp.StatusCode, string(body))
		}
		_ = resp.Body.Close()
	}
	aliasResponse, err := http.Get(server.URL + "/api/accounts/" + ynxAddress)
	if err != nil {
		t.Fatal(err)
	}
	defer aliasResponse.Body.Close()
	var aliasDetail AccountDetail
	if err := json.NewDecoder(aliasResponse.Body).Decode(&aliasDetail); err != nil {
		t.Fatal(err)
	}
	if aliasDetail.Account.Address != canonicalAddress || aliasDetail.AddressFormats == nil || aliasDetail.AddressFormats.YNX != ynxAddress || aliasDetail.AddressFormats.EVM != canonicalAddress {
		t.Fatalf("explorer did not expose equivalent address formats: %+v", aliasDetail)
	}

	resp, err := http.Get(server.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if !strings.Contains(resp.Header.Get("Cache-Control"), "no-store") {
		t.Fatalf("explorer web response permits a stale application shell: cache-control=%q", resp.Header.Get("Cache-Control"))
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	html := string(body)
	for _, marker := range []string{
		"Add YNX Testnet to MetaMask",
		"/api/summary",
		"new EventSource('/api/stream')",
		"Network TPS",
		"Latest transactions",
		"id=\"txFilter\"",
		"id=\"detailBackdrop\"",
		"Resource economy",
		"Live finalized block stream",
		"id=\"blockTrack\"",
		"No event for ",
		"ynx1 alias",
	} {
		if !strings.Contains(html, marker) {
			t.Fatalf("explorer web is missing live interaction marker %q", marker)
		}
	}

	summary, err := svc.Summary(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if summary.NativeSymbol != "YNXT" || summary.IndexedTxCount != 3 || summary.Wallet.ChainIDHex != "0x1917" {
		t.Fatalf("unexpected summary: %+v", summary)
	}
	resp, err = http.Get(server.URL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var health Summary
	if err := json.NewDecoder(resp.Body).Decode(&health); err != nil {
		t.Fatal(err)
	}
	if health.Build.Commit != "abc123" || health.Build.Release != "ynx-chain-abc123" || health.Build.BuildTime != "2026-07-10T00:00:00Z" {
		t.Fatalf("health missing build identity: %+v", health.Build)
	}

	streamCtx, cancelStream := context.WithCancel(context.Background())
	streamReq, err := http.NewRequestWithContext(streamCtx, http.MethodGet, server.URL+"/api/stream", nil)
	if err != nil {
		t.Fatal(err)
	}
	streamResp, err := http.DefaultClient.Do(streamReq)
	if err != nil {
		t.Fatal(err)
	}
	if streamResp.StatusCode != http.StatusOK || !strings.HasPrefix(streamResp.Header.Get("Content-Type"), "text/event-stream") {
		t.Fatalf("unexpected stream response: status=%d content-type=%s", streamResp.StatusCode, streamResp.Header.Get("Content-Type"))
	}
	if streamResp.Header.Get("X-Accel-Buffering") != "no" || !strings.Contains(streamResp.Header.Get("Cache-Control"), "no-cache") {
		t.Fatalf("stream response permits proxy buffering or caching: headers=%v", streamResp.Header)
	}
	scanner := bufio.NewScanner(streamResp.Body)
	streamData := ""
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "data: ") {
			streamData = strings.TrimPrefix(line, "data: ")
			break
		}
	}
	cancelStream()
	_ = streamResp.Body.Close()
	if streamData == "" || !strings.Contains(streamData, `"indexedTxCount":3`) || !strings.Contains(streamData, `"blocks"`) || !strings.Contains(streamData, `"validators"`) || !strings.Contains(streamData, `"resources"`) {
		t.Fatalf("stream did not return a live dashboard snapshot: %s", streamData)
	}
}
