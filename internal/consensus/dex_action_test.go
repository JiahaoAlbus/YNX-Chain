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
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
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
	app, err := NewPersistentApplication(migration, filepath.Join(t.TempDir(), "state.json"))
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

	expired := signedAssetAction(t, traderKey, ActionDexSwapExactInput, DexSwapExactInputPayload{PoolID: pool.ID, AssetIn: "ynx-usd-test", AmountIn: 100, MinAmountOut: 1, DeadlineUnix: blockTime.Unix()}, 3)
	result, err := app.FinalizeBlock(ctx, &abcitypes.RequestFinalizeBlock{Height: height + 1, Time: blockTime.Add(time.Second), Txs: [][]byte{expired}})
	if err != nil || result.TxResults[0].Code == 0 {
		t.Fatalf("expired DEX swap was not rejected: %+v %v", result, err)
	}
	if _, err := NewSignedApplicationAction(issuerKey, 6423, ActionDexAssetMint, DexAssetAmountPayload{AssetID: DexNativeAssetID, Amount: 1}, 6); err == nil {
		t.Fatal("native YNXT mint was accepted as a DEX action")
	}
}

func TestNativeDEXMigrationPreservesBalancesPoolsLotsAndEvents(t *testing.T) {
	issuerKey := deterministicPrivateKey(224)
	issuer := mustNativeAddress(t, issuerKey)
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := devnet.Faucet(issuer, 1_000_000); err != nil {
		t.Fatal(err)
	}
	devnet.ProduceBlock()
	deadline := time.Now().Add(time.Hour).Unix()
	actions := []struct {
		name    string
		payload any
	}{
		{ActionDexAssetCreate, DexAssetCreatePayload{AssetID: "ynx-usd-test", Symbol: "YUSDT", Name: "YNX USD Test Asset", Decimals: 6, MaxSupply: 10_000_000, InitialSupply: 2_000_000}},
		{ActionDexPoolCreate, DexPoolCreatePayload{PoolID: "dex_ynxt_yusdt", Asset0: DexNativeAssetID, Asset1: "ynx-usd-test", FeeBps: 30}},
		{ActionDexLiquidityAdd, DexLiquidityPayload{PoolID: "dex_ynxt_yusdt", Amount0: 100_000, Amount1: 200_000, MinShares: 141_000, DeadlineUnix: deadline}},
	}
	for index, action := range actions {
		tx, err := NewSignedApplicationAction(issuerKey, 6423, action.name, action.payload, uint64(index+1))
		if err != nil {
			t.Fatal(err)
		}
		raw, err := EncodeSignedApplicationAction(tx)
		if err != nil {
			t.Fatal(err)
		}
		if _, _, _, err := devnet.SubmitNativeDexAction(chain.NativeDexSignedActionInput{Hash: ApplicationActionHash(raw), Signer: tx.Signer, Action: tx.Action, Nonce: tx.Nonce, Fee: tx.Fee, Payload: tx.Payload}); err != nil {
			t.Fatalf("submit native DEX action %s: %v", action.name, err)
		}
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	if len(migration.DexAssets) != 1 || len(migration.DexBalances) != 1 || len(migration.DexPools) != 1 || len(migration.DexEvents) != 3 {
		t.Fatalf("migration omitted native DEX state: %+v", migration)
	}
	if migration.DexPools[0].Reserve0 != 100_000 || migration.LiquidSupplyYNXT <= 1_000_000 {
		t.Fatalf("migration did not account for native DEX escrow: %+v", migration.DexPools[0])
	}
	if err := migration.Validate(); err != nil {
		t.Fatalf("native DEX migration failed validation: %v", err)
	}
	app, err := NewPersistentApplication(migration, filepath.Join(t.TempDir(), "migrated-state.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !committedDexMatchesMigration(app.committed, migration) {
		expectedAssets, expectedBalances, expectedPools, expectedEvents := dexStateFromMigration(migration)
		t.Fatalf("initial BFT state did not preserve native DEX migration records\nassets=%#v expected=%#v\nbalances=%#v expected=%#v\npools=%#v expected=%#v\nevents=%#v expected=%#v", app.committed.DexAssets, expectedAssets, app.committed.DexBalances, expectedBalances, app.committed.DexPools, expectedPools, app.committed.DexEvents, expectedEvents)
	}
	if err := app.committed.Validate(migration); err != nil {
		t.Fatalf("migrated native DEX committed state is invalid: %v", err)
	}
	if app.committed.DexPools[0].AuditHash != dexPoolAuditHash(app.committed.DexPools[0]) || len(app.committed.DexPools[0].NativeLots0) == 0 {
		t.Fatalf("migrated pool lost audit binding or provenance: %+v", app.committed.DexPools[0])
	}
}

func TestCommittedStateMigratesVersion8WithoutInventingDEXRecords(t *testing.T) {
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
	legacy.Version = 8
	legacy.DexAssets, legacy.DexBalances, legacy.DexPools, legacy.DexEvents = nil, nil, nil, nil
	legacy.Initialized = true
	legacy.Height = int64(migration.Height) + 1
	legacy.AppHash = migration.StateHash
	payload, _ := json.Marshal(legacy)
	path := filepath.Join(t.TempDir(), "state-v8.json")
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	migrated, err := loadCommittedState(path, migration)
	if err != nil {
		t.Fatal(err)
	}
	if migrated.Version != CommittedStateVersion || len(migrated.DexAssets)+len(migrated.DexBalances)+len(migrated.DexPools)+len(migrated.DexEvents) != 0 {
		t.Fatalf("v8 migration changed history or invented DEX state: %+v", migrated)
	}
}

func signedAssetAction(t *testing.T, key *secp256k1.PrivateKey, action string, payload any, nonce uint64) []byte {
	t.Helper()
	tx, err := NewSignedApplicationAction(key, 6423, action, payload, nonce)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := EncodeSignedApplicationAction(tx)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}
