package bftgateway

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func TestGatewayCommitsAndQueriesDEXAssetsPoolsLiquidityAndSwaps(t *testing.T) {
	issuerKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 91))
	traderKey := secp256k1.PrivKeyFromBytes(append(make([]byte, 31), 92))
	issuer, _ := consensus.NativeAddress(issuerKey.PubKey().SerializeCompressed())
	trader, _ := consensus.NativeAddress(traderKey.PubKey().SerializeCompressed())
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet(issuer, 1_000_000); err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.Faucet(trader, 100_000); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	app, err := consensus.NewApplication(migration)
	if err != nil {
		t.Fatal(err)
	}
	upstream := httptest.NewServer(newABCICometFixture(t, app, int64(migration.Height)))
	defer upstream.Close()
	gateway, err := New(Config{CometRPCURL: upstream.URL})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(gateway.Handler())
	defer server.Close()
	deadline := time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC).Unix()

	create := signedDEXFixture(t, issuerKey, consensus.ActionDexAssetCreate, consensus.DexAssetCreatePayload{AssetID: "ynx-usd-test", Symbol: "YUSDT", Name: "YNX USD Test Asset", Decimals: 6, MaxSupply: 10_000_000, InitialSupply: 2_000_000}, 1)
	var assetResponse struct {
		Failure bool                  `json:"failure"`
		Version string                `json:"version"`
		Asset   consensus.BFTDexAsset `json:"asset"`
		Event   consensus.BFTDexEvent `json:"event"`
	}
	postSignedAction(t, server.URL+"/dex/assets", create, http.StatusCreated, &assetResponse)
	if assetResponse.Failure || assetResponse.Version != dexAPIVersion || assetResponse.Asset.ID != "ynx-usd-test" || assetResponse.Asset.Issuer != issuer || assetResponse.Event.Type != consensus.ActionDexAssetCreate {
		t.Fatalf("unexpected DEX asset response: %+v", assetResponse)
	}

	transfer := signedDEXFixture(t, issuerKey, consensus.ActionDexAssetTransfer, consensus.DexAssetTransferPayload{AssetID: "ynx-usd-test", Recipient: trader, Amount: 200_000}, 2)
	postSignedAction(t, server.URL+"/dex/assets/ynx-usd-test/transfer", transfer, http.StatusOK, nil)
	postSignedAction(t, server.URL+"/dex/assets/wrong/transfer", transfer, http.StatusBadRequest, nil)

	createPool := signedDEXFixture(t, issuerKey, consensus.ActionDexPoolCreate, consensus.DexPoolCreatePayload{PoolID: "dex_ynxt_yusdt", Asset0: consensus.DexNativeAssetID, Asset1: "ynx-usd-test", FeeBps: 30}, 3)
	var poolResponse struct {
		Failure bool                 `json:"failure"`
		Pool    consensus.BFTDexPool `json:"pool"`
	}
	postSignedAction(t, server.URL+"/dex/pools", createPool, http.StatusCreated, &poolResponse)
	if poolResponse.Failure || poolResponse.Pool.ID != "dex_ynxt_yusdt" {
		t.Fatalf("unexpected DEX pool response: %+v", poolResponse)
	}

	add := signedDEXFixture(t, issuerKey, consensus.ActionDexLiquidityAdd, consensus.DexLiquidityPayload{PoolID: "dex_ynxt_yusdt", Amount0: 100_000, Amount1: 200_000, MinShares: 141_000, DeadlineUnix: deadline}, 4)
	postSignedAction(t, server.URL+"/dex/pools/dex_ynxt_yusdt/liquidity/add", add, http.StatusOK, &poolResponse)
	if poolResponse.Pool.Reserve0 != 100_000 || poolResponse.Pool.Reserve1 != 200_000 || poolResponse.Pool.TotalShares <= 0 {
		t.Fatalf("DEX liquidity did not commit: %+v", poolResponse.Pool)
	}

	swap := signedDEXFixture(t, traderKey, consensus.ActionDexSwapExactInput, consensus.DexSwapExactInputPayload{PoolID: "dex_ynxt_yusdt", AssetIn: "ynx-usd-test", AmountIn: 10_000, MinAmountOut: 4_700, DeadlineUnix: deadline}, 1)
	postSignedAction(t, server.URL+"/dex/pools/dex_ynxt_yusdt/swaps/exact-input", swap, http.StatusOK, &poolResponse)
	if poolResponse.Pool.Reserve0 >= 100_000 || poolResponse.Pool.Reserve1 != 210_000 {
		t.Fatalf("DEX swap did not change committed reserves: %+v", poolResponse.Pool)
	}

	var listed struct {
		Failure bool                   `json:"failure"`
		Pools   []consensus.BFTDexPool `json:"pools"`
	}
	getJSON(t, server.URL+"/dex/pools", &listed)
	if listed.Failure || len(listed.Pools) != 1 || listed.Pools[0].ID != "dex_ynxt_yusdt" {
		t.Fatalf("unexpected DEX pool list: %+v", listed)
	}
	var balances struct {
		Failure  bool                      `json:"failure"`
		Address  string                    `json:"address"`
		Balances []consensus.BFTDexBalance `json:"balances"`
	}
	getJSON(t, server.URL+"/dex/balances/"+trader, &balances)
	if balances.Failure || balances.Address != trader || len(balances.Balances) != 1 || balances.Balances[0].Amount != 190_000 {
		t.Fatalf("unexpected DEX trader balance: %+v", balances)
	}
	var events struct {
		Failure bool                    `json:"failure"`
		Events  []consensus.BFTDexEvent `json:"events"`
	}
	getJSON(t, server.URL+"/dex/events", &events)
	if events.Failure || len(events.Events) != 5 || events.Events[4].Type != consensus.ActionDexSwapExactInput {
		t.Fatalf("unexpected DEX events: %+v", events)
	}
}

func signedDEXFixture(t *testing.T, key *secp256k1.PrivateKey, action string, payload any, nonce uint64) []byte {
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
