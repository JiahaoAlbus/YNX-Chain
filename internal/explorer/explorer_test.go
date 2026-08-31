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

	for _, path := range []string{"/health", "/api/summary", "/api/blocks/latest", "/api/txs", "/api/accounts?limit=10", "/api/accounts/ynx_explorer_bob", "/api/accounts/" + ynxAddress, "/api/tokens/YNXT", "/api/validators", "/api/resources/ynx_explorer_bob", "/api/resource-market/analytics", "/api/fees/" + tx.Hash, "/api/fees/" + sponsoredTx.Hash, "/api/search?q=" + tx.Hash, "/api/search?q=" + ynxAddress, "/api/search?q=YNXT", "/api/search?q=ynx-local-validator-0", "/metrics"} {
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
	for _, endpoint := range []string{"/api/blocks/latest?limit=1&offset=1", "/api/txs?limit=1&offset=1"} {
		pageResponse, err := http.Get(server.URL + endpoint)
		if err != nil {
			t.Fatal(err)
		}
		var page struct {
			Total  int `json:"total"`
			Limit  int `json:"limit"`
			Offset int `json:"offset"`
		}
		if err := json.NewDecoder(pageResponse.Body).Decode(&page); err != nil {
			_ = pageResponse.Body.Close()
			t.Fatal(err)
		}
		_ = pageResponse.Body.Close()
		if page.Total < 2 || page.Limit != 1 || page.Offset != 1 {
			t.Fatalf("%s did not expose a verified page envelope: %+v", endpoint, page)
		}
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
		"/api/summary",
		"new EventSource('/api/stream')",
		"Network TPS",
		"Real-time transactions",
		"Five newest finalized blocks, updated live",
		"YNXT account leaderboard",
		"data-account=",
		"flow-arrow",
		"/api/accounts?limit=10",
		"id=\"txFilter\"",
		"id=\"txQuickFind\"",
		"id=\"languageSelect\"",
		"empty-block-row",
		"ynx-explorer-language",
		"id=\"detailBackdrop\"",
		"Resource economy",
		"Live finalized block stream",
		"id=\"blockTrack\"",
		"No event for ",
		"/assets/ynx-logo.png",
		"/assets/ynx-icon.png",
		"YNX native address (default)",
		"EVM compatibility address",
		"tx.sponsor",
		"sponsorPoolId",
		"expected6423",
		"serviceDirectory",
		"id=\"searchSuggestions\"",
		"block-chip-meta",
		"portal-callout-stats",
		"data-chart-range=\"24h\"",
		"loadBlockchainPage",
		"setDetailLocation",
		"data-page-kind",
		"portalMessages",
		"routeMessages",
		"routeHeadings",
		"routeUI",
		"ecosystemProducts",
		"downloadProducts",
		"walletListenerProviders",
		"wallet_switchEthereumChain",
		"isMetaMask === true && item.provider?.isYNXWallet !== true",
		"YNX Chain | 6423 Testnet portal",
		"zh-CN",
		"zh-TW",
		"option value=\"ja\"",
		"option value=\"ko\"",
		"YNX Ecosystem",
		"product-actions",
		"Download center",
		"SHA-256",
		"data-wallet-session",
	} {
		if !strings.Contains(html, marker) {
			t.Fatalf("explorer web is missing live interaction marker %q", marker)
		}
	}
	for _, forbidden := range []string{"0x238e", "ynx_9102-1", "chain ID 9102"} {
		if strings.Contains(strings.ToLower(html), strings.ToLower(forbidden)) {
			t.Fatalf("explorer web contains retired network identity %q", forbidden)
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
	fallbackHandler := api.NewServerWithConfig(devnet, api.ServerConfig{ResourceGatewayUpstreamKey: resourceUpstreamKey})
	fallbackRPC := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == "/accounts" {
			http.Error(w, "account list endpoint unavailable", http.StatusMethodNotAllowed)
			return
		}
		fallbackHandler.ServeHTTP(w, r)
	}))
	defer fallbackRPC.Close()
	fallbackService, err := New(Config{RPCURL: fallbackRPC.URL, IndexerURL: indexerHTTP.URL})
	if err != nil {
		t.Fatal(err)
	}
	fallbackLeaderboard, err := fallbackService.AccountLeaderboard(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if fallbackLeaderboard.TruthfulStatus != "observed-indexed-participant-account-ranking" || fallbackLeaderboard.Ranking != "indexed-participant-liquid-ynxt-balance-descending" || len(fallbackLeaderboard.Accounts) == 0 {
		t.Fatalf("unexpected observed-account fallback: %+v", fallbackLeaderboard)
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
	if streamData == "" || !strings.Contains(streamData, `"indexedTxCount":7`) || !strings.Contains(streamData, `"resource_sponsored_action"`) || !strings.Contains(streamData, `"sponsorPoolId"`) || !strings.Contains(streamData, `"blocks"`) || !strings.Contains(streamData, `"validators"`) || !strings.Contains(streamData, `"resources"`) {
		t.Fatalf("stream did not return a live dashboard snapshot: %s", streamData)
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
