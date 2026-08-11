package dex

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestNativePollerIndexesAuthoritativePoolEventsAndCurrentReserves(t *testing.T) {
	now := time.Now().UTC().Add(-time.Second)
	blockHash := strings.Repeat("a", 64)
	txCreate := "0x" + strings.Repeat("b", 64)
	txLiquidity := "0x" + strings.Repeat("c", 64)
	account := "0x" + strings.Repeat("1", 40)
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/dex/assets":
			_ = json.NewEncoder(response).Encode(map[string]any{"items": []map[string]any{{"id": "ynx-usd-test", "symbol": "YUSDT", "name": "YNX USD Test Asset", "decimals": 6}}})
		case "/dex/pools":
			_ = json.NewEncoder(response).Encode(map[string]any{"items": []map[string]any{{"schemaVersion": 1, "id": "dex_ynxt_yusdt", "kind": "ynx-cpmm-v1", "asset0": "YNXT", "asset1": "ynx-usd-test", "reserve0": 100_000, "reserve1": 200_000, "feeBps": 30, "totalShares": 141_421, "shares": map[string]int64{account: 141_421}, "updatedAt": now, "transactionHash": txLiquidity, "blockHeight": 9, "blockHash": blockHash}}})
		case "/dex/events":
			_ = json.NewEncoder(response).Encode(map[string]any{"items": []map[string]any{
				{"schemaVersion": 1, "id": "asset-event-000000000001", "type": "dex_asset_create", "signer": account, "asset0": "ynx-usd-test", "amount0": 2_000_000, "occurredAt": now, "transactionHash": "0x" + strings.Repeat("d", 64), "blockHeight": 9, "blockHash": blockHash},
				{"schemaVersion": 1, "id": "pool-event-000000000001", "type": "dex_pool_create", "poolId": "dex_ynxt_yusdt", "signer": account, "asset0": "YNXT", "asset1": "ynx-usd-test", "occurredAt": now, "transactionHash": txCreate, "blockHeight": 9, "blockHash": blockHash},
				{"schemaVersion": 1, "id": "pool-event-000000000002", "type": "dex_liquidity_add", "poolId": "dex_ynxt_yusdt", "signer": account, "asset0": "YNXT", "asset1": "ynx-usd-test", "amount0": 100_000, "amount1": 200_000, "shares": 141_421, "occurredAt": now, "transactionHash": txLiquidity, "blockHeight": 9, "blockHash": blockHash},
			}})
		default:
			http.NotFound(response, request)
		}
	}))
	defer upstream.Close()
	statePath := filepath.Join(t.TempDir(), "state.json")
	secret := []byte("0123456789abcdef0123456789abcdef")
	store, err := OpenStore(statePath, secret)
	if err != nil {
		t.Fatal(err)
	}
	poller, err := NewNativePoller(store, NativePollerConfig{RESTURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	advanced, err := poller.PollOnce(context.Background())
	if err != nil || !advanced {
		t.Fatalf("native poll did not advance: %v %v", advanced, err)
	}
	if len(store.Events()) != 3 || len(store.Pools()) != 1 {
		t.Fatalf("native pool history was not indexed: events=%+v pools=%+v", store.Events(), store.Pools())
	}
	if tokens := poller.Tokens(); len(tokens) != 2 || tokens[0].Address != "YNXT" || tokens[1].Address != "ynx-usd-test" {
		t.Fatalf("authoritative native asset registry was not retained: %+v", tokens)
	}
	snapshot := poller.NativeSnapshot()
	if snapshot.Source != "authoritative chain-native YNX Testnet state" || len(snapshot.Pools) != 1 || snapshot.Pools[0].TotalShares != 141_421 || len(snapshot.Events) != 3 || snapshot.UpdatedAt.IsZero() {
		t.Fatalf("authoritative native snapshot was not retained: %+v", snapshot)
	}
	server := &Server{nativeProvider: poller}
	response := httptest.NewRecorder()
	server.nativeSnapshot(response, httptest.NewRequest(http.MethodGet, "/v1/native-snapshot", nil))
	if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "public, max-age=1, stale-while-revalidate=15" || !strings.Contains(response.Body.String(), `"totalShares":141421`) {
		t.Fatalf("native snapshot API is incomplete: status=%d headers=%v body=%s", response.Code, response.Header(), response.Body.String())
	}
	pool := store.Pools()[0]
	if pool.Address != "dex_ynxt_yusdt" || pool.ContractVersion != "ynx-native-dex-cpmm-v1" || pool.Reserve0 != "100000" || pool.Reserve1 != "200000" || pool.FeeBps != 30 {
		t.Fatalf("native current reserves were not retained: %+v", pool)
	}
	advanced, err = poller.PollOnce(context.Background())
	if err != nil || advanced || len(store.Events()) != 3 {
		t.Fatalf("native replay was not idempotent: %v %v events=%d", advanced, err, len(store.Events()))
	}
	restored, err := OpenStore(statePath, secret)
	if err != nil || len(restored.Events()) != 3 || restored.Pools()[0].Reserve0 != "100000" {
		t.Fatalf("native index did not survive integrity-checked restart: %+v %v", restored, err)
	}
}

func TestNativePollerHistoricalReplayDoesNotChangeWhenCurrentPoolAdvances(t *testing.T) {
	now := time.Now().UTC().Add(-time.Minute)
	blockHash1, blockHash2 := strings.Repeat("a", 64), strings.Repeat("b", 64)
	txCreate := "0x" + strings.Repeat("c", 64)
	txSwap := "0x" + strings.Repeat("d", 64)
	account := "0x" + strings.Repeat("1", 40)
	advancedPool := false
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/dex/assets":
			_ = json.NewEncoder(response).Encode(map[string]any{"items": []map[string]any{{"id": "ynx-usd-test", "symbol": "YUSDT", "name": "YNX USD Test Asset", "decimals": 6}}})
		case "/dex/pools":
			pool := map[string]any{"id": "dex_ynxt_yusdt", "asset0": "YNXT", "asset1": "ynx-usd-test", "reserve0": 0, "reserve1": 0, "feeBps": 30, "updatedAt": now, "transactionHash": txCreate, "blockHeight": 9, "blockHash": blockHash1}
			if advancedPool {
				pool["reserve0"], pool["reserve1"], pool["updatedAt"], pool["transactionHash"], pool["blockHeight"], pool["blockHash"] = 95, 210, now.Add(time.Minute), txSwap, 10, blockHash2
			}
			_ = json.NewEncoder(response).Encode(map[string]any{"items": []map[string]any{pool}})
		case "/dex/events":
			events := []map[string]any{{"id": "pool-event-000000000001", "type": "dex_pool_create", "poolId": "dex_ynxt_yusdt", "signer": account, "asset0": "YNXT", "asset1": "ynx-usd-test", "occurredAt": now, "transactionHash": txCreate, "blockHeight": 9, "blockHash": blockHash1}}
			if advancedPool {
				events = append(events, map[string]any{"id": "pool-event-000000000002", "type": "dex_swap_exact_input", "poolId": "dex_ynxt_yusdt", "signer": account, "asset0": "YNXT", "asset1": "ynx-usd-test", "amount0": 5, "amount1": 10, "occurredAt": now.Add(time.Minute), "transactionHash": txSwap, "blockHeight": 10, "blockHash": blockHash2})
			}
			_ = json.NewEncoder(response).Encode(map[string]any{"items": events})
		default:
			http.NotFound(response, request)
		}
	}))
	defer upstream.Close()
	store, err := OpenStore(filepath.Join(t.TempDir(), "state.json"), []byte("0123456789abcdef0123456789abcdef"))
	if err != nil {
		t.Fatal(err)
	}
	poller, err := NewNativePoller(store, NativePollerConfig{RESTURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	if changed, err := poller.PollOnce(context.Background()); err != nil || !changed || len(store.Events()) != 2 {
		t.Fatalf("initial poll: changed=%v err=%v events=%+v", changed, err, store.Events())
	}
	advancedPool = true
	if changed, err := poller.PollOnce(context.Background()); err != nil || !changed || len(store.Events()) != 4 {
		t.Fatalf("advanced poll: changed=%v err=%v events=%+v", changed, err, store.Events())
	}
	if changed, err := poller.PollOnce(context.Background()); err != nil || changed || len(store.Events()) != 4 {
		t.Fatalf("stable replay: changed=%v err=%v events=%+v", changed, err, store.Events())
	}
	pools := store.Pools()
	if len(pools) != 1 || pools[0].Reserve0 != "95" || pools[0].Reserve1 != "210" || pools[0].UpdatedBlock != 10 {
		t.Fatalf("current pool snapshot not retained: %+v", pools)
	}
}
