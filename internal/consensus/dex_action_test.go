package consensus

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

func TestDEXAssetPoolSwapAndLiquidityLifecycleCommitsRealState(t *testing.T) {
	ctx := context.Background()
	issuerKey, traderKey := deterministicPrivateKey(221), deterministicPrivateKey(222)
	issuer, trader := mustNativeAddress(t, issuerKey), mustNativeAddress(t, traderKey)
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
	statePath := filepath.Join(t.TempDir(), "state.json")
	app, err := NewPersistentApplication(migration, statePath)
	if err != nil {
		t.Fatal(err)
	}

	blockTime := time.Date(2026, 8, 9, 9, 0, 0, 0, time.UTC)
	deadline := blockTime.Add(time.Hour).Unix()
	txs := [][]byte{
		signedAssetAction(t, issuerKey, ActionDexAssetCreate, DexAssetCreatePayload{AssetID: "ynx-usd-test", Symbol: "YUSDT", Name: "YNX USD Test Asset", Decimals: 6, MaxSupply: 10_000_000, InitialSupply: 2_000_000}, 1),
		signedAssetAction(t, issuerKey, ActionDexAssetTransfer, DexAssetTransferPayload{AssetID: "ynx-usd-test", Recipient: trader, Amount: 200_000}, 2),
		signedAssetAction(t, issuerKey, ActionDexPoolCreate, DexPoolCreatePayload{PoolID: "dex_ynxt_yusdt", Asset0: DexNativeAssetID, Asset1: "ynx-usd-test", FeeBps: 30}, 3),
		signedAssetAction(t, issuerKey, ActionDexLiquidityAdd, DexLiquidityPayload{PoolID: "dex_ynxt_yusdt", Amount0: 100_000, Amount1: 200_000, MinShares: 141_000, DeadlineUnix: deadline}, 4),
		signedAssetAction(t, traderKey, ActionDexSwapExactInput, DexSwapExactInputPayload{PoolID: "dex_ynxt_yusdt", AssetIn: "ynx-usd-test", AmountIn: 10_000, MinAmountOut: 4_700, DeadlineUnix: deadline}, 1),
		signedAssetAction(t, traderKey, ActionDexSwapExactOutput, DexSwapExactOutputPayload{PoolID: "dex_ynxt_yusdt", AssetOut: "ynx-usd-test", AmountOut: 2_000, MaxAmountIn: 1_200, DeadlineUnix: deadline}, 2),
		signedAssetAction(t, issuerKey, ActionDexLiquidityRemove, DexLiquidityRemovePayload{PoolID: "dex_ynxt_yusdt", Shares: 10_000, MinAmount0: 1, MinAmount1: 1, DeadlineUnix: deadline}, 5),
	}
	height := int64(migration.Height) + 1
	finalized, err := app.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: height, Time: blockTime, Txs: txs})
	if err != nil || len(finalized.TxResults) != len(txs) {
		t.Fatalf("DEX block failed: %+v %v", finalized, err)
	}
	for index, result := range finalized.TxResults {
		if result.Code != 0 {
			t.Fatalf("DEX action %d failed: %+v", index, result)
		}
	}
	if _, err := app.Commit(ctx, &abcitypes.RequestCommit{}); err != nil {
		t.Fatal(err)
	}

	var assets []BFTDexAsset
	queryJSON(t, app, "/dex/assets", &assets)
	if len(assets) != 1 || assets[0].ID != "ynx-usd-test" || assets[0].TotalSupply != 2_000_000 {
		t.Fatalf("unexpected committed DEX assets: %+v", assets)
	}
	var pool BFTDexPool
	queryJSON(t, app, "/dex/pools/dex_ynxt_yusdt", &pool)
	if pool.Reserve0 <= 0 || pool.Reserve1 <= 0 || pool.TotalShares <= 0 || len(pool.NativeLots0) == 0 || pool.AuditHash != dexPoolAuditHash(pool) {
		t.Fatalf("DEX pool is not fully state-bound: %+v", pool)
	}
	var balances []BFTDexBalance
	queryJSON(t, app, "/dex/balances/"+trader, &balances)
	if len(balances) != 1 || balances[0].AssetID != "ynx-usd-test" || balances[0].Amount <= 0 {
		t.Fatalf("unexpected trader DEX balances: %+v", balances)
	}
	var events []BFTDexEvent
	queryJSON(t, app, "/dex/events", &events)
	if len(events) != len(txs) || events[4].Type != ActionDexSwapExactInput || events[5].Type != ActionDexSwapExactOutput {
		t.Fatalf("DEX event history is incomplete: %+v", events)
	}
	if err := app.committed.Validate(migration); err != nil {
		t.Fatalf("DEX committed state failed supply, lot, or hash validation: %v", err)
	}

	// A DEX is not usable if its assets, balances, pool reserves, and event tape
	// disappear when a validator process restarts. Re-open the exact persisted
	// ABCI state and prove that every owner-visible record is still queryable.
	restarted, err := NewPersistentApplication(migration, statePath)
	if err != nil {
		t.Fatalf("restart persistent DEX application: %v", err)
	}
	var restartedAssets []BFTDexAsset
	queryJSON(t, restarted, "/dex/assets", &restartedAssets)
	var restartedPool BFTDexPool
	queryJSON(t, restarted, "/dex/pools/dex_ynxt_yusdt", &restartedPool)
	var restartedBalances []BFTDexBalance
	queryJSON(t, restarted, "/dex/balances/"+trader, &restartedBalances)
	var restartedEvents []BFTDexEvent
	queryJSON(t, restarted, "/dex/events", &restartedEvents)
	if len(restartedAssets) != len(assets) || restartedPool.AuditHash != pool.AuditHash || len(restartedBalances) != len(balances) || len(restartedEvents) != len(events) || restarted.committed.AppHash != app.committed.AppHash {
		t.Fatalf("DEX restart changed committed owner state: assets=%d/%d balances=%d/%d events=%d/%d pool=%s/%s appHash=%s/%s", len(restartedAssets), len(assets), len(restartedBalances), len(balances), len(restartedEvents), len(events), restartedPool.AuditHash, pool.AuditHash, restarted.committed.AppHash, app.committed.AppHash)
	}

	expired := signedAssetAction(t, traderKey, ActionDexSwapExactInput, DexSwapExactInputPayload{PoolID: pool.ID, AssetIn: "ynx-usd-test", AmountIn: 100, MinAmountOut: 1, DeadlineUnix: blockTime.Unix()}, 3)
	result, err := app.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: height + 1, Time: blockTime.Add(time.Second), Txs: [][]byte{expired}})
	if err != nil || result.TxResults[0].Code == 0 {
		t.Fatalf("expired DEX swap was not rejected: %+v %v", result, err)
	}
	if _, err := NewSignedApplicationAction(issuerKey, 6423, ActionDexAssetMint, DexAssetAmountPayload{AssetID: DexNativeAssetID, Amount: 1}, 6); err == nil {
		t.Fatal("native YNXT mint was accepted as a DEX action")
	}
}

func TestCommittedStateMigratesVersion12WithoutInventingDEXRecords(t *testing.T) {
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	owner := mustNativeAddress(t, deterministicPrivateKey(223))
	if _, err := devnet.Faucet(owner, 100); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	legacy := initialCommittedState(migration)
	legacy.Version = 12
	legacy.DexAssets, legacy.DexBalances, legacy.DexPools, legacy.DexEvents = nil, nil, nil, nil
	legacy.Initialized = true
	legacy.Height = int64(migration.Height) + 1
	legacy.FeeEvents = []BFTFeeEvent{newCurrentFeeEvent("0xv12", "transfer", owner, migration.Validators[0].Address, 1, legacy.Height, time.Unix(12, 0).UTC())}
	legacy.AppHash, err = legacy.calculateHashFor("YNX_ABCI_STATE_V12", 12)
	if err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(legacy)
	path := filepath.Join(t.TempDir(), "state-v12.json")
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	migrated, err := loadCommittedState(path, migration)
	if err != nil {
		t.Fatal(err)
	}
	if migrated.Version != CommittedStateVersion || len(migrated.FeeEvents) != 1 || len(migrated.DexAssets)+len(migrated.DexBalances)+len(migrated.DexPools)+len(migrated.DexEvents) != 0 {
		t.Fatalf("v12 migration changed history or invented DEX state: %+v", migrated)
	}
}
