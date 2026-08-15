package explorer

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
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
	contract, _, err := devnet.DeployContract(canonicalAddress, "ExplorerEvents", "pragma solidity ^0.8.24; contract ExplorerEvents { event Audit(bytes32 indexed id); }")
	if err != nil {
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

	for _, path := range []string{"/health", "/version", "/api/summary", "/api/blocks/latest", "/api/txs", "/api/accounts?limit=10", "/api/accounts/ynx_explorer_bob", "/api/accounts/" + ynxAddress, "/api/accounts/" + ynxAddress + "/activity?limit=2", "/api/tokens/YNXT", "/api/contracts/" + contract.Address, "/api/validators", "/api/resources/ynx_explorer_bob", "/api/resource-market/analytics", "/api/fees/" + tx.Hash, "/api/fees/" + sponsoredTx.Hash, "/api/search?q=" + tx.Hash, "/api/search?q=" + ynxAddress, "/api/search?q=YNXT", "/api/search?q=" + contract.Address, "/metrics"} {
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
	if aliasDetail.Activity.TruthfulStatus != "canonical-indexed-account-activity" || aliasDetail.Activity.LastIndexedHeight == 0 || len(aliasDetail.Activity.Transactions) == 0 || len(aliasDetail.Holdings) != 1 || aliasDetail.Holdings[0].Symbol != "YNXT" {
		t.Fatalf("account detail omitted indexed history or native holdings: %+v", aliasDetail)
	}
	txResponse, err := http.Get(server.URL + "/api/txs/" + tx.Hash)
	if err != nil {
		t.Fatal(err)
	}
	defer txResponse.Body.Close()
	var transactionDetail TransactionDetail
	if err := json.NewDecoder(txResponse.Body).Decode(&transactionDetail); err != nil {
		t.Fatal(err)
	}
	if transactionDetail.Status != "finalized-indexed" || transactionDetail.From == "" || transactionDetail.To == "" || transactionDetail.BlockNum == 0 || transactionDetail.Gas.TruthfulStatus == "" || transactionDetail.HistoricalNotice == "" {
		t.Fatalf("transaction detail omitted canonical status, direction, block, gas, or history semantics: %+v", transactionDetail)
	}
	pageResponse, err := http.Get(server.URL + "/api/txs?limit=2")
	if err != nil {
		t.Fatal(err)
	}
	defer pageResponse.Body.Close()
	var transactionPage TransactionPage
	if err := json.NewDecoder(pageResponse.Body).Decode(&transactionPage); err != nil {
		t.Fatal(err)
	}
	if len(transactionPage.Transactions) != 2 || transactionPage.NextCursor == "" || transactionPage.CursorVersion == 0 {
		t.Fatalf("transaction pagination did not expose an opaque continuation: %+v", transactionPage)
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
		"mergeLiveRows(snapshot.blocks || [], latestBlocks",
		"mergeLiveRows(snapshot.transactions || [], latestTransactions",
		"canonicalHistoryChanged(snapshot.blocks || [], latestBlocks)",
		"load().then(stopFallbackPolling).catch(showLoadError)",
		"contractActivityCount: Number(currentDetail.activity.contractActivityCount || 0) + Number(next.contractActivityCount || 0)",
		"inboundYnxt: Number(previousFlow.inboundYnxt || 0) + Number(nextFlow.inboundYnxt || 0)",
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
		"data-i18n-aria=\"latestBlocks\"",
		"id=\"blockTrack\"",
		"relativeTime(new Date(lastStreamAt))",
		"/assets/ynx-logo.png",
		"/assets/ynx-icon.png",
		"const fieldKeys = ['delegatedYnxt'",
		"Incomplete Explorer detail locale:",
		"أُرسل إلى",
		"indexedCoverage",
		"EVM compatibility address",
		"tx.sponsor",
		"sponsorPoolId",
		"option value=\"zh-TW\"",
		"option value=\"ar\"",
		"document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'",
		"html[dir=\"rtl\"] .drawer",
		"html[dir=\"rtl\"] .nav-links",
		".brand span { display:none; }",
		"history.pushState",
		"openDeepLink",
		"data-activity-cursor",
		"A block is not a fixed YNXT reward",
		"Observed YNXT funds flow",
		"id=\"olderBlocks\"",
		"id=\"olderTransactions\"",
		"const supplementalKeys = ['testnet','rpcIndexerVerified'",
		"Incomplete Explorer locale:",
		"data-i18n=\"identityTitle\"",
		"data-i18n=\"footerBoundary\"",
		"data-i18n-aria=\"searchPlaceholder\"",
		"data-i18n-aria=\"intelligenceTitle\"",
		"data-i18n-aria=\"networkMetrics\"",
		"networkMetrics:'مقاييس الشبكة'",
		"localStorage.getItem('ynx-explorer-language') || 'en'",
		"document.querySelectorAll('[data-i18n-aria]')",
		"هوية YNX الأصلية أولًا.",
		"Aucun lancement mainnet n’est revendiqué.",
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
	if summary.NativeSymbol != "YNXT" || summary.IndexedTxCount != 8 || summary.Wallet.ChainIDHex != "0x1917" {
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
	if streamData == "" || !strings.Contains(streamData, `"indexedTxCount":8`) || !strings.Contains(streamData, `"resource_sponsored_action"`) || !strings.Contains(streamData, `"sponsorPoolId"`) || !strings.Contains(streamData, `"blocks"`) || !strings.Contains(streamData, `"validators"`) || !strings.Contains(streamData, `"resources"`) {
		t.Fatalf("stream did not return a live dashboard snapshot: %s", streamData)
	}
}

func TestPublicWalletURLsRejectInternalOrUnsafeAddresses(t *testing.T) {
	got := nonEmptyPublicURLs(
		"http://explorer.ynxweb4.com",
		"https://127.0.0.1:6427",
		"https://10.0.0.8",
		"https://192.168.1.8",
		"https://169.254.1.2",
		"https://localhost",
		"https://node.internal.local",
		"https://user:secret@rpc.ynxweb4.com",
		"https://rpc.ynxweb4.com?internal=1",
		"https://rpc.ynxweb4.com/",
		"https://explorer.ynxweb4.com",
	)
	want := []string{"https://rpc.ynxweb4.com", "https://explorer.ynxweb4.com"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("public URLs=%v want=%v", got, want)
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

func TestPublicFailuresDoNotExposeInternalDependencyDetails(t *testing.T) {
	service, err := New(Config{
		RPCURL:     "http://127.0.0.1:1/private-rpc",
		IndexerURL: "http://127.0.0.1:2/private-indexer",
	})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServer(service).Handler())
	defer server.Close()

	for _, path := range []string{"/health", "/api/summary", "/api/blocks/latest", "/api/txs", "/api/accounts", "/metrics"} {
		response, err := http.Get(server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		body, readErr := io.ReadAll(response.Body)
		_ = response.Body.Close()
		if readErr != nil {
			t.Fatal(readErr)
		}
		text := string(body)
		if response.StatusCode < 400 || strings.Contains(text, "127.0.0.1") || strings.Contains(text, "private-rpc") || strings.Contains(text, "private-indexer") || strings.Contains(text, "connection refused") {
			t.Fatalf("%s leaked an internal dependency failure: status=%d body=%s", path, response.StatusCode, text)
		}
		var failure map[string]any
		if err := json.Unmarshal(body, &failure); err != nil || failure["code"] == "" || failure["message"] == "" {
			t.Fatalf("%s did not return a bounded public failure: %s", path, text)
		}
	}

	for _, path := range []string{"/tx/0xabc", "/block/42", "/address/ynx1test", "/token/YNXT", "/contract/0xabc"} {
		response, err := http.Get(server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		_ = response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("deep link %s returned %d", path, response.StatusCode)
		}
	}
}
