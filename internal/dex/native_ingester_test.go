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
	if len(store.Events()) != 2 || len(store.Pools()) != 1 {
		t.Fatalf("native pool history was not indexed: events=%+v pools=%+v", store.Events(), store.Pools())
	}
	if tokens := poller.Tokens(); len(tokens) != 2 || tokens[0].Address != "YNXT" || tokens[1].Address != "ynx-usd-test" {
		t.Fatalf("authoritative native asset registry was not retained: %+v", tokens)
	}
	pool := store.Pools()[0]
	if pool.Address != "dex_ynxt_yusdt" || pool.ContractVersion != "ynx-native-dex-cpmm-v1" || pool.Reserve0 != "100000" || pool.Reserve1 != "200000" || pool.FeeBps != 30 {
		t.Fatalf("native current reserves were not retained: %+v", pool)
	}
	advanced, err = poller.PollOnce(context.Background())
	if err != nil || advanced || len(store.Events()) != 2 {
		t.Fatalf("native replay was not idempotent: %v %v events=%d", advanced, err, len(store.Events()))
	}
	restored, err := OpenStore(statePath, secret)
	if err != nil || len(restored.Events()) != 2 || restored.Pools()[0].Reserve0 != "100000" {
		t.Fatalf("native index did not survive integrity-checked restart: %+v %v", restored, err)
	}
}
