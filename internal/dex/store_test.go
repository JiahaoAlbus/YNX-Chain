package dex

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

var testSecret = bytes.Repeat([]byte{0x42}, 32)

func fixture(index uint64, kind string) Event {
	return Event{ID: fmt.Sprintf("event-abcdefghijkl-%d", index), ChainID: 6423, ContractVersion: "ynx-dex-cpmm-v1", BlockNumber: 100 + index, BlockHash: fmt.Sprintf("0x%064x", 100+index), TxHash: fmt.Sprintf("0x%064x", 200+index), LogIndex: index, Type: kind, Pool: "0x0000000000000000000000000000000000000011", Account: "ynx1abcdefghijklmnopqrstuv", Token0: "0x0000000000000000000000000000000000000001", Token1: "0x0000000000000000000000000000000000000002", Amount0: "100", Amount1: "200", LPAmount: "50", Fee0: "1", Fee1: "0", Reserve0: "10000", Reserve1: "20000", Timestamp: time.Now().Add(-time.Minute).UTC()}
}

func TestStoreRestartReplayTamperAndConflict(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	store, err := OpenStore(path, testSecret)
	if err != nil {
		t.Fatal(err)
	}
	event := fixture(1, "liquidity-add")
	created, err := store.Append(event)
	if err != nil || !created {
		t.Fatalf("append %v %v", created, err)
	}
	created, err = store.Append(event)
	if err != nil || created {
		t.Fatalf("idempotency %v %v", created, err)
	}
	if _, err = store.Append(func() Event { value := event; value.Amount0 = "999"; return value }()); err == nil {
		t.Fatal("conflicting replay accepted")
	}
	restarted, err := OpenStore(path, testSecret)
	if err != nil || len(restarted.Events()) != 1 {
		t.Fatalf("restart %v", err)
	}
	data, _ := os.ReadFile(path)
	data = bytes.Replace(data, []byte(`"reserve0": "10000"`), []byte(`"reserve0": "99999"`), 1)
	_ = os.WriteFile(path, data, 0o600)
	if _, err = OpenStore(path, testSecret); err == nil {
		t.Fatal("tampered store accepted")
	}
}

func TestConcurrentAppendIsAtomic(t *testing.T) {
	store, err := OpenStore(filepath.Join(t.TempDir(), "state.json"), testSecret)
	if err != nil {
		t.Fatal(err)
	}
	var group sync.WaitGroup
	for i := uint64(1); i <= 40; i++ {
		group.Add(1)
		go func(index uint64) {
			defer group.Done()
			if _, err := store.Append(fixture(index, "swap")); err != nil {
				t.Errorf("append %d: %v", index, err)
			}
		}(i)
	}
	group.Wait()
	if len(store.Events()) != 40 {
		t.Fatalf("events=%d", len(store.Events()))
	}
}

func TestEventWithoutReserveSnapshotPreservesLatestPoolReserves(t *testing.T) {
	store, _ := OpenStore(filepath.Join(t.TempDir(), "state.json"), testSecret)
	syncEvent := fixture(1, "sync")
	if _, err := store.Append(syncEvent); err != nil {
		t.Fatal(err)
	}
	claim := fixture(2, "protocol-fee-claimed")
	claim.Reserve0, claim.Reserve1 = "", ""
	if _, err := store.Append(claim); err != nil {
		t.Fatal(err)
	}
	pools := store.Pools()
	if len(pools) != 1 || pools[0].Reserve0 != syncEvent.Reserve0 || pools[0].Reserve1 != syncEvent.Reserve1 {
		t.Fatalf("reserves overwritten: %#v", pools)
	}
}

func TestStorePricesFeesAndTWAPUseOnlyRawIndexedAmounts(t *testing.T) {
	store, _ := OpenStore(filepath.Join(t.TempDir(), "state.json"), testSecret)
	first := fixture(1, "sync")
	first.Timestamp = time.Now().Add(-2 * time.Minute).UTC()
	first.Price0Cumulative, first.Price1Cumulative = "1000", "2000"
	second := fixture(2, "sync")
	second.Timestamp = first.Timestamp.Add(60 * time.Second)
	second.Price0Cumulative, second.Price1Cumulative = "7000", "5000"
	swap := fixture(3, "swap")
	swap.Timestamp = second.Timestamp.Add(time.Second)
	swap.Fee0, swap.Fee1 = "30", "0"
	claim := fixture(4, "protocol-fee-claimed")
	claim.Timestamp = swap.Timestamp.Add(time.Second)
	claim.Fee0, claim.Fee1, claim.Reserve0, claim.Reserve1 = "5", "0", "", ""
	for _, event := range []Event{first, second, swap, claim} {
		if _, err := store.Append(event); err != nil {
			t.Fatal(err)
		}
	}
	prices := store.SpotPrices()
	if len(prices) != 1 || prices[0].Price0Numerator != "20000" || prices[0].Price0Denominator != "10000" {
		t.Fatalf("prices=%#v", prices)
	}
	twaps := store.TWAPs()
	if len(twaps) != 1 || twaps[0].Price0AverageX112 != "100" || twaps[0].Price1AverageX112 != "50" || twaps[0].IntervalSeconds != 60 {
		t.Fatalf("twaps=%#v", twaps)
	}
	fees := store.Fees()
	if len(fees) != 1 || fees[0].SwapFee0 != "30" || fees[0].ClaimedFee0 != "5" {
		t.Fatalf("fees=%#v", fees)
	}
}

func TestCandlesAggregateOnlyConfirmedSwapOHLCAndRawVolumes(t *testing.T) {
	store, _ := OpenStore(filepath.Join(t.TempDir(), "state.json"), testSecret)
	base := time.Now().UTC().Add(-10 * time.Minute).Truncate(time.Minute)
	first, second, third := fixture(11, "swap"), fixture(12, "swap"), fixture(13, "swap")
	first.Timestamp, first.Amount0, first.Amount1 = base.Add(5*time.Second), "100", "200"
	second.Timestamp, second.Amount0, second.Amount1 = base.Add(30*time.Second), "100", "300"
	third.Timestamp, third.Amount0, third.Amount1 = base.Add(65*time.Second), "200", "300"
	for _, event := range []Event{first, second, third} {
		if _, err := store.Append(event); err != nil {
			t.Fatal(err)
		}
	}
	candles := store.Candles(first.Pool, 60, 10)
	if len(candles) != 2 || candles[0].Open != "2" || candles[0].High != "3" || candles[0].Low != "2" || candles[0].Close != "3" || candles[0].Volume0 != "200" || candles[0].Volume1 != "500" || candles[0].Trades != 2 || candles[1].Close != "1.5" {
		t.Fatalf("confirmed swap candles are incorrect: %+v", candles)
	}
	if limited := store.Candles(first.Pool, 60, 1); len(limited) != 1 || limited[0].OpenedAt != candles[1].OpenedAt {
		t.Fatalf("candle limit did not keep the newest interval: %+v", limited)
	}
}

type allowSession struct{}

func (allowSession) Authorize(_ context.Context, proof string, scopes []string) (string, error) {
	if proof == strings.Repeat("p", 120) && len(scopes) == 2 {
		return "ynx1abcdefghijklmnopqrstuv", nil
	}
	return "", errors.New("rejected")
}

func TestServerStrictSchemaAuthAndTruthfulSources(t *testing.T) {
	store, _ := OpenStore(filepath.Join(t.TempDir(), "state.json"), testSecret)
	token := Token{ChainID: ChainID, Address: "0x0000000000000000000000000000000000000002", Symbol: "TWO", Name: "Test Token Two", Decimals: 18, Standard: "ERC-20", ReviewStatus: "owner-reviewed-testnet"}
	server, err := NewServer(store, buildinfo.Info{Commit: "abc123", Release: "test"}, strings.Repeat("k", 32), allowSession{}, token)
	if err != nil {
		t.Fatal(err)
	}
	handler := server.Handler()
	event := fixture(1, "liquidity-add")
	data, _ := json.Marshal(event)
	request := httptest.NewRequest(http.MethodPost, "/internal/v1/events", bytes.NewReader(data))
	request.Header.Set("X-YNX-DEX-Indexer-Key", strings.Repeat("k", 32))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("ingest %d %s", response.Code, response.Body.String())
	}
	bad := map[string]any{}
	_ = json.Unmarshal(data, &bad)
	bad["unknown"] = true
	data, _ = json.Marshal(bad)
	request = httptest.NewRequest(http.MethodPost, "/internal/v1/events", bytes.NewReader(data))
	request.Header.Set("X-YNX-DEX-Indexer-Key", strings.Repeat("k", 32))
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("unknown fields %d", response.Code)
	}
	request = httptest.NewRequest(http.MethodGet, "/v1/account/positions", nil)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("missing wallet session %d", response.Code)
	}
	request = httptest.NewRequest(http.MethodGet, "/v1/account/positions", nil)
	request.Header.Set("X-YNX-Product-Session-Proof", strings.Repeat("p", 120))
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "netLpAmount") {
		t.Fatalf("positions %d %s", response.Code, response.Body.String())
	}
	request = httptest.NewRequest(http.MethodGet, "/v1/analytics", nil)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if !strings.Contains(response.Body.String(), "YNX Testnet EVM events") {
		t.Fatal("analytics source is not explicit")
	}
	request = httptest.NewRequest(http.MethodGet, "/v1/tokens", nil)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"reviewStatus":"owner-reviewed-testnet"`) || !strings.Contains(response.Body.String(), `"mainnet":false`) {
		t.Fatalf("tokens %d %s", response.Code, response.Body.String())
	}
	for path, source := range map[string]string{"/v1/prices": "raw indexed reserve ratios", "/v1/twap": "cumulative-price deltas", "/v1/fees": "raw token fee amounts"} {
		request = httptest.NewRequest(http.MethodGet, path, nil)
		response = httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), source) {
			t.Fatalf("%s %d %s", path, response.Code, response.Body.String())
		}
	}
	request = httptest.NewRequest(http.MethodGet, "/v1/candles?pool=0x0000000000000000000000000000000000000011&interval=60&limit=200", nil)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "confirmed swap events") {
		t.Fatalf("candles %d %s", response.Code, response.Body.String())
	}
	request = httptest.NewRequest(http.MethodGet, "/v1/candles?pool=bad&interval=7", nil)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("invalid candles query was accepted: %d", response.Code)
	}
}

func TestServerEmptyTokenRegistryIsStableJSONArray(t *testing.T) {
	store, _ := OpenStore(filepath.Join(t.TempDir(), "state.json"), testSecret)
	server, err := NewServer(store, buildinfo.Info{Commit: "abc123", Release: "test"}, strings.Repeat("k", 32), allowSession{})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/v1/tokens", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"items":[]`) {
		t.Fatalf("empty token registry must be a stable JSON array: %d %s", response.Code, response.Body.String())
	}
	healthRequest := httptest.NewRequest(http.MethodGet, "/health", nil)
	healthResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(healthResponse, healthRequest)
	for _, expected := range []string{`"indexedPools":0`, `"marketSourceConfigured":false`, `"marketAvailable":false`, `"executionAvailable":false`} {
		if !strings.Contains(healthResponse.Body.String(), expected) {
			t.Fatalf("empty runtime must fail closed on %s: %s", expected, healthResponse.Body.String())
		}
	}
}

func TestServerExecutionCannotBeOpenedByMarketReadiness(t *testing.T) {
	store, err := OpenStore(filepath.Join(t.TempDir(), "state.json"), testSecret)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Append(fixture(99, "liquidity-add")); err != nil {
		t.Fatal(err)
	}
	server, err := NewServer(store, buildinfo.Info{}, strings.Repeat("k", 32), nil)
	if err != nil {
		t.Fatal(err)
	}
	server.SetRuntimeBoundary(true, true)
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/health", nil))
	for _, expected := range []string{
		`"executionAvailable":false`,
		`"executionGate":"chain_core_strategy_vault_v1_35_product_evidence"`,
		`"executionGateSatisfied":false`,
	} {
		if !strings.Contains(recorder.Body.String(), expected) {
			t.Fatalf("custody gate must fail closed on %s: %s", expected, recorder.Body.String())
		}
	}
}

func TestServerRejectsUnreviewedAndDuplicateTokenMetadata(t *testing.T) {
	store, _ := OpenStore(filepath.Join(t.TempDir(), "state.json"), testSecret)
	valid := Token{ChainID: ChainID, Address: "0x00000000000000000000000000000000000000ab", Symbol: "ONE", Name: "Test Token One", Decimals: 18, Standard: "ERC-20", ReviewStatus: "owner-reviewed-testnet"}
	invalid := valid
	invalid.ReviewStatus = "self-reported"
	if _, err := NewServer(store, buildinfo.Info{}, strings.Repeat("k", 32), nil, invalid); err == nil {
		t.Fatal("unreviewed token accepted")
	}
	duplicate := valid
	duplicate.Address = "0x00000000000000000000000000000000000000AB"
	if _, err := NewServer(store, buildinfo.Info{}, strings.Repeat("k", 32), nil, valid, duplicate); err == nil {
		t.Fatal("case-insensitive duplicate token accepted")
	}
}

func TestRemoteAuthorizerRequiresExactCentralBindingResponse(t *testing.T) {
	account := "ynx1abcdefghijklmnopqrstuv"
	scopes := []string{"account:read", "dex:positions:read"}
	proof := strings.Repeat("A", 120)
	var mode atomic.Value
	mode.Store("valid")
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if values, ok := body["requiredScopes"].([]any); !ok || len(values) != 2 {
			t.Error("required scopes missing")
		}
		if request.Header.Get("X-YNX-Product-Session-Proof") != proof {
			t.Error("product-session proof was not forwarded")
		}
		session := map[string]any{
			"verifierVersion": "wallet-auth-v1", "sessionBinding": strings.Repeat("a", 64), "chainId": "ynx_6423-1", "requestingProduct": "dex",
			"productClientId": "ynx-dex-web-v1", "bundleId": "com.ynxweb4.dex.web", "callback": "https://dex.ynxweb4.com/wallet-auth/callback",
			"productDeviceAlgorithm": "p256-sha256", "productDeviceKey": strings.Repeat("d", 44), "deviceBinding": strings.Repeat("e", 64),
			"account": account, "scopes": scopes, "nonce": strings.Repeat("n", 32), "accountPublicKey": "02" + strings.Repeat("1", 64),
			"purpose": "Read exact DEX positions", "requestDigest": strings.Repeat("f", 64), "approvalDigest": strings.Repeat("b", 64),
			"issuedAt": time.Now().Add(-time.Minute).UTC(), "expiresAt": time.Now().Add(time.Minute).UTC(),
		}
		value := map[string]any{"ok": true, "schemaVersion": 1, "stateDigest": strings.Repeat("c", 64), "result": map[string]any{"active": true, "session": session}}
		if mode.Load().(string) == "substitute" {
			session["bundleId"] = "com.ynxweb4.exchange.web"
		}
		if mode.Load().(string) == "unknown" {
			value["extra"] = true
		}
		if mode.Load().(string) == "schema" {
			value["schemaVersion"] = 2
		}
		if mode.Load().(string) == "digest" {
			value["stateDigest"] = "invalid"
		}
		writeJSON(response, http.StatusOK, value)
	}))
	defer upstream.Close()
	authorizer := RemoteAuthorizer{URL: upstream.URL}
	if authorizedAccount, err := authorizer.Authorize(context.Background(), proof, scopes); err != nil || authorizedAccount != account {
		t.Fatalf("valid binding rejected: %v", err)
	}
	for _, next := range []string{"substitute", "unknown", "schema", "digest"} {
		mode.Store(next)
		if _, err := authorizer.Authorize(context.Background(), proof, scopes); err == nil {
			t.Fatalf("%s response accepted", next)
		}
	}
}
