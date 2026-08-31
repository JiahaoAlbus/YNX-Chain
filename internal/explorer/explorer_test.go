package explorer

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/api"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/indexer"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
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
	ownerKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 91))
	userKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 92))
	owner, _ := consensus.NativeAddress(ownerKey.PubKey().SerializeCompressed())
	user, _ := consensus.NativeAddress(userKey.PubKey().SerializeCompressed())
	_, _ = devnet.Faucet(owner, 50)
	_, _ = devnet.Faucet(user, 50)
	poolInput := chain.ResourcePoolCreateInput{PoolType: "merchant", Name: "Explorer merchant", AllowedBeneficiaries: []string{user}, AllowedScopes: []string{"pay_api"}, AllowedResourceTypes: []string{"bandwidth"}, PerActionLimit: chain.ResourceUnits{Bandwidth: 5}, CumulativeAllowance: chain.ResourceUnits{Bandwidth: 10}, ExpiresAt: time.Now().UTC().Add(time.Hour), IdempotencyKey: "explorer-pool-create"}
	poolInput.Authorization, _ = chain.SignResourceAuthorization(ownerKey, 6423, chain.ResourcePoolCreateAction, poolInput, 1)
	pool, _, err := devnet.CreateResourcePool(poolInput)
	if err != nil {
		t.Fatal(err)
	}
	sponsorInput := chain.ResourceSponsorshipInput{PoolID: pool.ID, Beneficiary: user, Scope: "pay_api", ResourceType: "bandwidth", Amount: 2, ActionReference: "explorer-pay:1", IdempotencyKey: "explorer-sponsor"}
	sponsorInput.Authorization, _ = chain.SignResourceAuthorization(userKey, 6423, chain.ResourceSponsorAction, sponsorInput, 1)
	_, sponsoredTx, err := devnet.SponsorResource(sponsorInput)
	if err != nil {
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

	for _, path := range []string{"/health", "/version", "/api/summary", "/api/dashboard", "/api/blocks/latest", "/api/txs", "/api/accounts/ynx_explorer_bob", "/api/accounts/" + ynxAddress, "/api/tokens/YNXT", "/api/validators", "/api/resources/ynx_explorer_bob", "/api/resource-market/analytics", "/api/fees/" + tx.Hash, "/api/fees/" + sponsoredTx.Hash, "/api/search?q=" + tx.Hash, "/api/search?q=" + ynxAddress, "/metrics"} {
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
	feeResponse, err := http.Get(server.URL + "/api/fees/" + sponsoredTx.Hash)
	if err != nil {
		t.Fatal(err)
	}
	defer feeResponse.Body.Close()
	var sponsorFee FeeDetail
	if err := json.NewDecoder(feeResponse.Body).Decode(&sponsorFee); err != nil {
		t.Fatal(err)
	}
	if sponsorFee.Payer != user || sponsorFee.Sponsor != owner || sponsorFee.SponsorPoolID != pool.ID || sponsorFee.ResourceSource != "merchant-resource-pool" || sponsorFee.ResourceConsumed != 2 {
		t.Fatalf("indexed Explorer fee response omitted sponsor evidence: %+v", sponsorFee)
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
		"Open MetaMask compatibility",
		"/api/dashboard",
		"new EventSource('/api/stream')",
		"Network TPS",
		"Latest transactions",
		"id=\"txFilter\"",
		"id=\"detailBackdrop\"",
		"Resource economy",
		"Live finalized block stream",
		"id=\"blockTrack\"",
		"No event for ",
		"/assets/ynx-logo.png",
		"YNX native address (default)",
		"EVM compatibility address",
		"tx.sponsor",
		"sponsorPoolId",
	} {
		if !strings.Contains(html, marker) {
			t.Fatalf("explorer web is missing live interaction marker %q", marker)
		}
	}
	logoResponse, err := http.Get(server.URL + "/assets/ynx-logo.png")
	if err != nil {
		t.Fatal(err)
	}
	defer logoResponse.Body.Close()
	logoBody, err := io.ReadAll(logoResponse.Body)
	if err != nil {
		t.Fatal(err)
	}
	if logoResponse.StatusCode != http.StatusOK || logoResponse.Header.Get("Content-Type") != "image/png" || len(logoBody) < 8 || string(logoBody[:8]) != "\x89PNG\r\n\x1a\n" {
		t.Fatalf("explorer logo asset is invalid: status=%d content-type=%q size=%d", logoResponse.StatusCode, logoResponse.Header.Get("Content-Type"), len(logoBody))
	}

	summary, err := svc.Summary(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if summary.NativeSymbol != "YNXT" || summary.IndexedTxCount != 7 || summary.Wallet.ChainIDHex != "0x1917" {
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
	if health.Build.Commit != "abc123" || health.Build.Release != "ynx-chain-abc123" || health.Build.BuildTime != "2026-07-10T00:00:00Z" || health.StartedAt.IsZero() {
		t.Fatalf("health missing build identity: %+v", health.Build)
	}
	versionResponse, err := http.Get(server.URL + "/version")
	if err != nil {
		t.Fatal(err)
	}
	defer versionResponse.Body.Close()
	var version map[string]any
	if err := json.NewDecoder(versionResponse.Body).Decode(&version); err != nil {
		t.Fatal(err)
	}
	if version["service"] != "ynx-explorerd" || version["startedAt"] == "" || version["build"].(map[string]any)["commit"] != "abc123" {
		t.Fatalf("unexpected version response: %+v", version)
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
	if streamData == "" || !strings.Contains(streamData, `"indexedTxCount":7`) || !strings.Contains(streamData, `"resource_sponsored_action"`) || !strings.Contains(streamData, `"sponsorPoolId"`) || !strings.Contains(streamData, `"blocks"`) || !strings.Contains(streamData, `"validators"`) || !strings.Contains(streamData, `"resources"`) {
		t.Fatalf("stream did not return a live dashboard snapshot: %s", streamData)
	}
}

func TestDashboardSnapshotIsSharedAcrossConcurrentUsers(t *testing.T) {
	var rpcRequests atomic.Int64
	var indexerRequests atomic.Int64
	rpc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rpcRequests.Add(1)
		switch r.URL.Path {
		case "/status":
			_ = json.NewEncoder(w).Encode(Status{Network: "YNX Testnet", Slug: "ynx-testnet", ChainID: 6423, NativeCoinName: "YNXT", NativeCurrencySymbol: "YNXT", Decimals: 18, PublicNetwork: true, Height: 100, ValidatorCount: 4})
		case "/validators":
			_ = json.NewEncoder(w).Encode(map[string]any{"validators": []any{}})
		case "/resource-market/analytics":
			_ = json.NewEncoder(w).Encode(map[string]any{"policyVersion": "test"})
		default:
			http.NotFound(w, r)
		}
	}))
	defer rpc.Close()
	indexerHTTP := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		indexerRequests.Add(1)
		switch r.URL.Path {
		case "/health":
			_ = json.NewEncoder(w).Encode(IndexerHealth{OK: true, Service: "ynx-indexerd", Network: "YNX Testnet", ChainID: 6423, NativeSymbol: "YNXT", LastIndexedHeight: 100})
		case "/blocks/latest":
			_ = json.NewEncoder(w).Encode(map[string]any{"blocks": []any{}})
		case "/txs":
			_ = json.NewEncoder(w).Encode(map[string]any{"transactions": []any{}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer indexerHTTP.Close()
	svc, err := New(Config{RPCURL: rpc.URL, IndexerURL: indexerHTTP.URL, ResourceUpstreamKey: "test"})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServer(svc).Handler())
	defer server.Close()
	const users = 40
	var wg sync.WaitGroup
	errors := make(chan error, users)
	wg.Add(users)
	for range users {
		go func() {
			defer wg.Done()
			response, err := http.Get(server.URL + "/api/dashboard")
			if err != nil {
				errors <- err
				return
			}
			defer response.Body.Close()
			if response.StatusCode != http.StatusOK {
				errors <- fmt.Errorf("dashboard returned %d", response.StatusCode)
			}
		}()
	}
	wg.Wait()
	close(errors)
	for err := range errors {
		t.Fatal(err)
	}
	if rpcRequests.Load() != 3 || indexerRequests.Load() != 3 {
		t.Fatalf("40 concurrent users did not share one upstream snapshot: rpc=%d indexer=%d", rpcRequests.Load(), indexerRequests.Load())
	}
}

func TestFeeDetailUsesRealSponsorTransactionEvidence(t *testing.T) {
	tx := chain.Transaction{Hash: "0x" + strings.Repeat("a", 64), Type: "resource_sponsored_action", From: "0x1111111111111111111111111111111111111111", Fee: 0, Sponsor: "0x2222222222222222222222222222222222222222", SponsorPoolID: "rsp_test", ResourceSource: "merchant-resource-pool", ResourceType: "bandwidth", ResourceConsumed: 7, ActionReference: "pay:invoice-1"}
	detail := FeeDetailFromTx(tx)
	if detail.Payer != tx.From || detail.Sponsor != tx.Sponsor || detail.SponsorPoolID != tx.SponsorPoolID || detail.ResourceSource != "merchant-resource-pool" || detail.ResourceType != "bandwidth" || detail.ResourceConsumed != 7 || detail.ActionReference != tx.ActionReference || detail.FeeYNXT != 0 {
		t.Fatalf("fee detail omitted sponsor evidence: %+v", detail)
	}
	direct := FeeDetailFromTx(chain.Transaction{Hash: "direct", From: tx.From, Fee: 1})
	if direct.Sponsor != "" || direct.ResourceSource != "direct-ynxt-fee-or-resource-endpoint" {
		t.Fatalf("direct transaction was mislabeled as sponsored: %+v", direct)
	}
}

func TestExplorerFailsClosedOnRPCIndexerIdentityMismatch(t *testing.T) {
	rpc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/status" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(Status{Network: "YNX Testnet", ChainID: 6423, NativeCoinName: "YNXT", NativeCurrencySymbol: "YNXT", Decimals: 18})
	}))
	defer rpc.Close()
	indexerHTTP := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(IndexerHealth{OK: true, Service: "ynx-indexerd", Network: "another-network", ChainID: 1, NativeSymbol: "YNXT"})
	}))
	defer indexerHTTP.Close()
	svc, err := New(Config{RPCURL: rpc.URL, IndexerURL: indexerHTTP.URL})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Summary(context.Background()); err == nil || !strings.Contains(err.Error(), "chain identity mismatch") {
		t.Fatalf("mismatched RPC and indexer identity did not fail closed: %v", err)
	}
}

func TestExplorerRejectsNonCanonicalIndexerService(t *testing.T) {
	rpc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(Status{Network: "YNX Testnet", ChainID: 6423, NativeCoinName: "YNXT", NativeCurrencySymbol: "YNXT", Decimals: 18})
	}))
	defer rpc.Close()
	indexerHTTP := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(IndexerHealth{OK: true, Service: "unknown-indexer", Network: "YNX Testnet", ChainID: 6423, NativeSymbol: "YNXT"})
	}))
	defer indexerHTTP.Close()
	svc, err := New(Config{RPCURL: rpc.URL, IndexerURL: indexerHTTP.URL})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Summary(context.Background()); err == nil || !strings.Contains(err.Error(), "indexer dependency identity mismatch") {
		t.Fatalf("non-canonical indexer identity did not fail closed: %v", err)
	}
}
