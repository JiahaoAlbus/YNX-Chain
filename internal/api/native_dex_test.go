package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestAuthoritativeNativeDEXEmptyCollectionsEncodeAsArrays(t *testing.T) {
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	server := httptest.NewServer(NewServer(devnet))
	defer server.Close()

	for _, path := range []string{"/dex/assets", "/dex/pools", "/dex/events"} {
		response, err := http.Get(server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		var body struct {
			Items json.RawMessage `json:"items"`
		}
		if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
			response.Body.Close()
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusOK || string(body.Items) != "[]" {
			t.Fatalf("%s did not return an empty JSON array: status=%d items=%s", path, response.StatusCode, body.Items)
		}
	}
}

func TestAuthoritativeNativeDEXSignedLifecycleAndPersistence(t *testing.T) {
	dataDir := t.TempDir()
	devnet, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), dataDir)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServer(devnet))
	defer server.Close()
	issuerKey, traderKey := testDexKey(71), testDexKey(72)
	issuer, _ := consensus.NativeAddress(issuerKey.PubKey().SerializeCompressed())
	trader, _ := consensus.NativeAddress(traderKey.PubKey().SerializeCompressed())
	var response map[string]any
	doJSON(t, http.MethodPost, server.URL+"/faucet", map[string]any{"address": issuer, "amount": 1_000_000}, http.StatusCreated, &response)
	doJSON(t, http.MethodPost, server.URL+"/faucet", map[string]any{"address": trader, "amount": 100_000}, http.StatusCreated, &response)
	devnet.ProduceBlock()
	deadline := time.Now().Add(time.Hour).Unix()

	create := signedDexAction(t, issuerKey, consensus.ActionDexAssetCreate, consensus.DexAssetCreatePayload{AssetID: "ynx-usd-test", Symbol: "YUSDT", Name: "YNX USD Test Asset", Decimals: 6, MaxSupply: 10_000_000, InitialSupply: 2_000_000}, 1)
	doRawJSON(t, server.URL+"/dex/assets", create, http.StatusCreated, &response)
	if response["replayed"] != false || response["source"] != "authoritative chain-native YNX Testnet state" {
		t.Fatalf("unexpected DEX create response: %v", response)
	}
	doRawJSON(t, server.URL+"/dex/assets", create, http.StatusOK, &response)
	if response["replayed"] != true {
		t.Fatalf("DEX action replay was not idempotent: %v", response)
	}

	transfer := signedDexAction(t, issuerKey, consensus.ActionDexAssetTransfer, consensus.DexAssetTransferPayload{AssetID: "ynx-usd-test", Recipient: trader, Amount: 200_000}, 2)
	doRawJSON(t, server.URL+"/dex/assets/ynx-usd-test/transfer", transfer, http.StatusOK, &response)
	createPool := signedDexAction(t, issuerKey, consensus.ActionDexPoolCreate, consensus.DexPoolCreatePayload{PoolID: "dex_ynxt_yusdt", Asset0: consensus.DexNativeAssetID, Asset1: "ynx-usd-test", FeeBps: 30}, 3)
	doRawJSON(t, server.URL+"/dex/pools", createPool, http.StatusCreated, &response)
	add := signedDexAction(t, issuerKey, consensus.ActionDexLiquidityAdd, consensus.DexLiquidityPayload{PoolID: "dex_ynxt_yusdt", Amount0: 100_000, Amount1: 200_000, MinShares: 141_000, DeadlineUnix: deadline}, 4)
	doRawJSON(t, server.URL+"/dex/pools/dex_ynxt_yusdt/liquidity/add", add, http.StatusOK, &response)
	swap := signedDexAction(t, traderKey, consensus.ActionDexSwapExactInput, consensus.DexSwapExactInputPayload{PoolID: "dex_ynxt_yusdt", AssetIn: "ynx-usd-test", AmountIn: 10_000, MinAmountOut: 4_700, DeadlineUnix: deadline}, 1)
	doRawJSON(t, server.URL+"/dex/pools/dex_ynxt_yusdt/swaps/exact-input", swap, http.StatusOK, &response)
	devnet.ProduceBlock()

	var pools struct {
		Items []chain.NativeDexPool `json:"items"`
	}
	doJSON(t, http.MethodGet, server.URL+"/dex/pools", nil, http.StatusOK, &pools)
	if len(pools.Items) != 1 || pools.Items[0].Reserve0 <= 0 || pools.Items[0].Reserve1 <= 0 || pools.Items[0].TotalShares <= 0 || pools.Items[0].BlockHeight == 0 || pools.Items[0].BlockHash == "" {
		t.Fatalf("DEX pool lacks committed liquidity: %+v", pools)
	}
	var events struct {
		Items []chain.NativeDexEvent `json:"items"`
	}
	doJSON(t, http.MethodGet, server.URL+"/dex/events", nil, http.StatusOK, &events)
	if len(events.Items) != 5 || events.Items[4].Type != consensus.ActionDexSwapExactInput || events.Items[4].AuditHash == "" || events.Items[4].BlockHeight == 0 || events.Items[4].BlockHash == "" {
		t.Fatalf("DEX audit history incomplete: %+v", events)
	}
	var balances struct {
		Items  []chain.NativeDexBalance `json:"items"`
		Native int64                    `json:"nativeYNXT"`
	}
	doJSON(t, http.MethodGet, server.URL+"/dex/balances/"+trader, nil, http.StatusOK, &balances)
	if len(balances.Items) != 1 || balances.Items[0].Amount >= 200_000 || balances.Native <= 100_000 {
		t.Fatalf("DEX swap balances did not settle: %+v", balances)
	}

	restored, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), dataDir)
	if err != nil {
		t.Fatal(err)
	}
	pool, ok := restored.NativeDexPool("dex_ynxt_yusdt")
	if !ok || pool.Reserve0 != pools.Items[0].Reserve0 || len(restored.NativeDexEvents()) != 5 {
		t.Fatalf("DEX state did not survive restart: %+v %v", pool, ok)
	}
}

func testDexKey(value byte) *secp256k1.PrivateKey {
	raw := make([]byte, 32)
	raw[31] = value
	return secp256k1.PrivKeyFromBytes(raw)
}
func signedDexAction(t *testing.T, key *secp256k1.PrivateKey, action string, payload any, nonce uint64) []byte {
	t.Helper()
	tx, err := consensus.NewSignedApplicationAction(key, 6423, action, payload, nonce)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := consensus.EncodeSignedApplicationAction(tx)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
