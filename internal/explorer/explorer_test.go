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
	contract, _, err := devnet.DeployContract("ynx_explorer_alice", "ExplorerDirectory", "contract ExplorerDirectory { event Registered(address indexed account); function ping() public pure returns (bool) { return true; } }")
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

	for _, path := range []string{"/health", "/version", "/api/summary", "/api/dashboard", "/api/blocks/latest", "/api/txs", "/api/accounts?limit=10", "/api/accounts/ynx_explorer_bob", "/api/accounts/ynx_explorer_bob/activity?limit=1", "/api/accounts/" + ynxAddress, "/api/tokens/YNXT", "/api/contracts/" + contract.Address, "/api/validators", "/api/resources/ynx_explorer_bob", "/api/resource-market/analytics", "/api/fees/" + tx.Hash, "/api/fees/" + sponsoredTx.Hash, "/api/search?q=" + tx.Hash, "/api/search?q=" + ynxAddress, "/api/search?q=YNXT", "/api/search?q=" + contract.Address, "/metrics"} {
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
	if aliasDetail.Account.Address != canonicalAddress || aliasDetail.AddressFormats == nil || aliasDetail.AddressFormats.YNX != ynxAddress || aliasDetail.AddressFormats.EVM != canonicalAddress || aliasDetail.Activity == nil || aliasDetail.Activity.TruthfulStatus != "retained-indexed-account-activity" {
		t.Fatalf("explorer did not expose equivalent address formats: %+v", aliasDetail)
	}
	leaderboardResponse, err := http.Get(server.URL + "/api/accounts?limit=10")
	if err != nil {
		t.Fatal(err)
	}
	defer leaderboardResponse.Body.Close()
	var leaderboard AccountLeaderboard
	if err := json.NewDecoder(leaderboardResponse.Body).Decode(&leaderboard); err != nil {
		t.Fatal(err)
	}
	if leaderboardResponse.StatusCode != http.StatusOK || leaderboard.Failed || leaderboard.Total == 0 || leaderboard.CandidateCount < leaderboard.Total || leaderboard.TruthfulStatus != "observed-indexed-participant-account-ranking" || !strings.Contains(leaderboard.Coverage, "retained Indexer") {
		t.Fatalf("Explorer returned an untruthful or empty observed-participant leaderboard: %+v", leaderboard)
	}
	contractResponse, err := http.Get(server.URL + "/api/contracts/" + contract.Address)
	if err != nil {
		t.Fatal(err)
	}
	defer contractResponse.Body.Close()
	var fetchedContract chain.ContractArtifact
	if err := json.NewDecoder(contractResponse.Body).Decode(&fetchedContract); err != nil {
		t.Fatal(err)
	}
	if contractResponse.StatusCode != http.StatusOK || fetchedContract.Address != contract.Address || fetchedContract.Name != "ExplorerDirectory" {
		t.Fatalf("Explorer did not return the RPC-backed contract record: %+v", fetchedContract)
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
		"Connect EVM compatibility wallet",
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
		"transactionHashFromPath",
		"/^\\/tx\\/(0[xX][0-9a-fA-F]{64})$/",
		"/api/accounts?limit=10",
		"fundsFlow",
		"Observed Indexer-participant sample ranked by current RPC balance; not a full-ledger census.",
		"const observedLeaderboardText",
		"this is not a full-ledger census.",
		"这不是全账本普查。",
		"全台帳の調査ではありません。",
		"전체 원장 조사가 아닙니다.",
		"no es un censo de todo el libro mayor.",
		"ce n’est pas un recensement complet du registre.",
		"dies ist keine vollständige Ledger-Erhebung.",
		"não é um censo do livro completo.",
		"это не полная перепись реестра.",
		"وليست تعدادًا كاملاً لدفتر الحسابات.",
		"ini bukan sensus seluruh ledger.",
	} {
		if !strings.Contains(html, marker) {
			t.Fatalf("explorer web is missing live interaction marker %q", marker)
		}
	}
	if strings.Contains(html, "Authoritative public-ledger ranking") {
		t.Fatal("Explorer initial leaderboard markup must not claim a full-ledger ranking when it only reports observed Indexer participants")
	}
	deepLinkResponse, err := http.Get(server.URL + "/tx/" + tx.Hash)
	if err != nil {
		t.Fatal(err)
	}
	deepLinkBody, err := io.ReadAll(deepLinkResponse.Body)
	_ = deepLinkResponse.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	if deepLinkResponse.StatusCode != http.StatusOK || !strings.Contains(deepLinkResponse.Header.Get("Content-Type"), "text/html") || !strings.Contains(string(deepLinkBody), "transactionHashFromPath") {
		t.Fatalf("transaction deep link did not serve the detail-capable Explorer shell: status=%d content-type=%q", deepLinkResponse.StatusCode, deepLinkResponse.Header.Get("Content-Type"))
	}
	uppercaseDeepLinkResponse, err := http.Get(server.URL + "/tx/0X" + strings.ToUpper(tx.Hash[2:]))
	if err != nil {
		t.Fatal(err)
	}
	_ = uppercaseDeepLinkResponse.Body.Close()
	if uppercaseDeepLinkResponse.StatusCode != http.StatusOK {
		t.Fatalf("uppercase canonical transaction deep link must resolve, got %d", uppercaseDeepLinkResponse.StatusCode)
	}
	uppercaseSearchResponse, err := http.Get(server.URL + "/api/search?q=0X" + strings.ToUpper(tx.Hash[2:]))
	if err != nil {
		t.Fatal(err)
	}
	defer uppercaseSearchResponse.Body.Close()
	var uppercaseSearch SearchResult
	if err := json.NewDecoder(uppercaseSearchResponse.Body).Decode(&uppercaseSearch); err != nil {
		t.Fatal(err)
	}
	if uppercaseSearchResponse.StatusCode != http.StatusOK || uppercaseSearch.Type != "transaction" || uppercaseSearch.Query != tx.Hash || uppercaseSearch.Path != "/api/txs/"+tx.Hash || uppercaseSearch.DeepLink != "/tx/"+tx.Hash {
		t.Fatalf("uppercase transaction search was not normalized to the indexed canonical hash: %+v", uppercaseSearch)
	}
	for _, testCase := range []struct {
		path string
		name string
	}{
		{path: "/block/1", name: "block"},
		{path: "/address/" + ynxAddress, name: "YNX address"},
		{path: "/token/YNXT", name: "native token"},
		{path: "/contract/" + contract.Address, name: "contract"},
	} {
		response, err := http.Get(server.URL + testCase.path)
		if err != nil {
			t.Fatal(err)
		}
		deepLinkHTML, readErr := io.ReadAll(response.Body)
		_ = response.Body.Close()
		if readErr != nil {
			t.Fatal(readErr)
		}
		if response.StatusCode != http.StatusOK || !strings.Contains(response.Header.Get("Content-Type"), "text/html") || !strings.Contains(string(deepLinkHTML), "openDeepLink") {
			t.Fatalf("%s deep link did not serve the refresh-safe Explorer shell: status=%d content-type=%q", testCase.name, response.StatusCode, response.Header.Get("Content-Type"))
		}
	}
	for _, path := range []string{"/block/not-a-height", "/address/not-an-address", "/token/not-ynxt", "/contract/not-an-address"} {
		response, err := http.Get(server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		_ = response.Body.Close()
		if response.StatusCode != http.StatusNotFound {
			t.Fatalf("malformed Explorer detail deep link %s must fail closed, got %d", path, response.StatusCode)
		}
	}
	for query, wantDeepLink := range map[string]string{
		"1":              "/block/1",
		ynxAddress:       "/address/" + canonicalAddress,
		"YNXT":           "/token/YNXT",
		contract.Address: "/contract/" + contract.Address,
	} {
		response, err := http.Get(server.URL + "/api/search?q=" + query)
		if err != nil {
			t.Fatal(err)
		}
		var result SearchResult
		decodeErr := json.NewDecoder(response.Body).Decode(&result)
		_ = response.Body.Close()
		if decodeErr != nil {
			t.Fatal(decodeErr)
		}
		if response.StatusCode != http.StatusOK || result.DeepLink != wantDeepLink {
			t.Fatalf("search %q did not return a refresh-safe detail link: status=%d result=%+v", query, response.StatusCode, result)
		}
	}
	invalidDeepLinkResponse, err := http.Get(server.URL + "/tx/not-a-transaction-hash")
	if err != nil {
		t.Fatal(err)
	}
	_ = invalidDeepLinkResponse.Body.Close()
	if invalidDeepLinkResponse.StatusCode != http.StatusNotFound {
		t.Fatalf("malformed transaction deep link must fail closed, got %d", invalidDeepLinkResponse.StatusCode)
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
	if streamData == "" || !strings.Contains(streamData, `"indexedTxCount":8`) || !strings.Contains(streamData, `"resource_sponsored_action"`) || !strings.Contains(streamData, `"sponsorPoolId"`) || !strings.Contains(streamData, `"blocks"`) || !strings.Contains(streamData, `"validators"`) || !strings.Contains(streamData, `"resources"`) {
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

func TestExplorerAccountDataFailsClosedWhenIndexerIsUnhealthy(t *testing.T) {
	rpc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/accounts/alice":
			_ = json.NewEncoder(w).Encode(AccountDetail{Account: chain.Account{Address: "alice", Balance: 10}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer rpc.Close()
	indexerHTTP := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/accounts":
			_ = json.NewEncoder(w).Encode(IndexedParticipants{Accounts: []IndexedAccountParticipant{{Address: "alice", TransactionCount: 1}}, Total: 1, TruthfulStatus: "observed-indexed-participants"})
		case "/health":
			_ = json.NewEncoder(w).Encode(IndexerHealth{OK: false, Service: "ynx-indexerd", ChainID: 6423, NativeSymbol: "YNXT", LastError: "private failure detail"})
		default:
			http.NotFound(w, r)
		}
	}))
	defer indexerHTTP.Close()
	svc, err := New(Config{RPCURL: rpc.URL, IndexerURL: indexerHTTP.URL})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Leaderboard(context.Background(), 10); err == nil || !strings.Contains(err.Error(), "not healthy") {
		t.Fatalf("leaderboard did not fail closed on an unhealthy Indexer: %v", err)
	}
}

func TestExplorerDoesNotExposeUpstreamErrorsToPublicClients(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "credential=should-never-reach-public-client", http.StatusBadGateway)
	}))
	defer upstream.Close()
	svc, err := New(Config{RPCURL: upstream.URL, IndexerURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	handler := NewServer(svc).Handler()
	for _, testCase := range []struct {
		path           string
		status         int
		classification string
	}{
		{path: "/health", status: http.StatusBadGateway, classification: "UPSTREAM_UNAVAILABLE"},
		{path: "/api/summary", status: http.StatusBadGateway, classification: "UPSTREAM_UNAVAILABLE"},
		{path: "/api/dashboard", status: http.StatusBadGateway, classification: "UPSTREAM_UNAVAILABLE"},
		{path: "/api/blocks/latest", status: http.StatusBadGateway, classification: "UPSTREAM_UNAVAILABLE"},
		{path: "/api/txs", status: http.StatusBadGateway, classification: "UPSTREAM_UNAVAILABLE"},
		{path: "/api/txs/0x" + strings.Repeat("a", 64), status: http.StatusBadGateway, classification: "UPSTREAM_UNAVAILABLE"},
	} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, testCase.path, nil))
		body := response.Body.String()
		if response.Code != testCase.status {
			t.Fatalf("%s returned %d, want %d: %s", testCase.path, response.Code, testCase.status, body)
		}
		if strings.Contains(body, upstream.URL) || strings.Contains(body, "127.0.0.1") || strings.Contains(body, "credential=") {
			t.Fatalf("%s leaked upstream details: %s", testCase.path, body)
		}
		var payload map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
			t.Fatalf("%s returned non-JSON public error: %v", testCase.path, err)
		}
		if payload["classification"] != testCase.classification {
			t.Fatalf("%s classification=%q, want %q", testCase.path, payload["classification"], testCase.classification)
		}
	}
}

func TestExplorerLookupPreservesOnlyARealNotFoundClassification(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "internal record path must never reach a browser", http.StatusNotFound)
	}))
	defer upstream.Close()
	svc, err := New(Config{RPCURL: upstream.URL, IndexerURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	NewServer(svc).Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/txs/0x"+strings.Repeat("a", 64), nil))
	if response.Code != http.StatusNotFound || !strings.Contains(response.Body.String(), `"classification":"NOT_FOUND"`) || strings.Contains(response.Body.String(), "internal record") {
		t.Fatalf("Explorer did not expose a safe real-not-found response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestExplorerWalletCompatibilityUsesProviderDiscoveryWithoutCustomNavigation(t *testing.T) {
	for _, marker := range []string{"eip6963:requestProvider", "eth_requestAccounts", "wallet_switchEthereumChain", "eth_chainId", "accountsChanged", "chainChanged", "disconnect", "sessionStorage", "restoreWallet"} {
		if !strings.Contains(indexHTML, marker) {
			t.Fatalf("Explorer wallet compatibility missing %q", marker)
		}
	}
	for _, forbidden := range []string{"ynxwallet://", "ynx-wallet://", "location.href ="} {
		if strings.Contains(indexHTML, forbidden) {
			t.Fatalf("Explorer web wallet path must not contain %q", forbidden)
		}
	}
	restoreStart := strings.Index(indexHTML, "async function restoreWallet")
	restoreEnd := strings.Index(indexHTML, "async function connectWallet")
	if restoreStart < 0 || restoreEnd <= restoreStart {
		t.Fatal("Explorer wallet refresh restoration boundary is missing")
	}
	restoreBody := indexHTML[restoreStart:restoreEnd]
	for _, marker := range []string{"eth_accounts", "eth_chainId", "savedWalletProvider() !== id"} {
		if !strings.Contains(restoreBody, marker) {
			t.Fatalf("Explorer refresh restoration missing safe read %q", marker)
		}
	}
	for _, forbidden := range []string{"eth_requestAccounts", "wallet_switchEthereumChain", "wallet_addEthereumChain"} {
		if strings.Contains(restoreBody, forbidden) {
			t.Fatalf("Explorer refresh restoration must not perform privileged action %q", forbidden)
		}
	}
}

func TestExplorerProvidesCompleteLocaleAndRTLScaffolding(t *testing.T) {
	for _, marker := range []string{
		"localStorage.getItem('ynx-explorer-language') || 'en'",
		"html[dir=\"rtl\"] body",
		"document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'",
		"object-fit:contain",
		"/assets/ynx-logo.png",
	} {
		if !strings.Contains(indexHTML, marker) {
			t.Fatalf("Explorer locale, RTL, or logo scaffold missing %q", marker)
		}
	}
	for _, locale := range []string{"en", "zh-CN", "zh-TW", "ja", "ko", "es", "fr", "de", "pt", "ru", "ar", "id"} {
		if !strings.Contains(indexHTML, `<option value="`+locale+`">`) {
			t.Fatalf("Explorer language selector missing locale %q", locale)
		}
		if !strings.Contains(indexHTML, `"`+locale+`":{`) && !strings.Contains(indexHTML, `'`+locale+`':{`) && !strings.Contains(indexHTML, locale+`:{`) {
			t.Fatalf("Explorer locale dictionary missing locale %q", locale)
		}
	}
}

func TestExplorerLocalizesWalletChooserAndSuppressesProviderErrors(t *testing.T) {
	start := strings.Index(indexHTML, "const walletMessages = {")
	end := strings.Index(indexHTML, "const staleStreamPrefixes")
	if start < 0 || end <= start {
		t.Fatal("Explorer wallet locale catalog is missing")
	}
	walletCatalog := indexHTML[start:end]
	for _, locale := range []string{"en", "zh-CN", "zh-TW", "ja", "ko", "es", "fr", "de", "pt", "ru", "ar", "id"} {
		if !strings.Contains(walletCatalog, locale+`:{title:`) && !strings.Contains(walletCatalog, `'`+locale+`':{title:`) {
			t.Fatalf("Explorer wallet locale catalog missing %q", locale)
		}
	}
	for _, marker := range []string{
		"walletText('choose')",
		"walletText('connect')",
		"walletText('connected')",
		"walletText('notFound')",
		"walletText('rejected')",
		"walletText('network')",
	} {
		if !strings.Contains(indexHTML, marker) {
			t.Fatalf("Explorer wallet chooser is missing localized behavior %q", marker)
		}
	}
	if strings.Contains(indexHTML, "String(error?.message") {
		t.Fatal("Explorer must not expose unlocalized provider errors")
	}
}
