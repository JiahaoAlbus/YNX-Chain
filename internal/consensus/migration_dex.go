package consensus

import (
	"reflect"
	"sort"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func dexStateFromMigration(migration chain.ConsensusMigrationState) ([]BFTDexAsset, []BFTDexBalance, []BFTDexPool, []BFTDexEvent) {
	assets := make([]BFTDexAsset, 0, len(migration.DexAssets))
	for _, value := range migration.DexAssets {
		asset := BFTDexAsset{
			ID: value.ID, Symbol: value.Symbol, Name: value.Name, Decimals: value.Decimals, Issuer: value.Issuer,
			MaxSupply: value.MaxSupply, TotalSupply: value.TotalSupply, CreatedAt: value.CreatedAt, UpdatedAt: value.UpdatedAt,
			BlockHeight: int64(value.BlockHeight), TxHash: value.TxHash,
		}
		asset.AuditHash = dexAssetAuditHash(asset)
		assets = append(assets, asset)
	}
	balances := make([]BFTDexBalance, 0, len(migration.DexBalances))
	for _, value := range migration.DexBalances {
		balances = append(balances, BFTDexBalance{AssetID: value.AssetID, Account: value.Account, Amount: value.Amount})
	}
	pools := make([]BFTDexPool, 0, len(migration.DexPools))
	for _, value := range migration.DexPools {
		shares := make([]BFTDexShare, 0, len(value.Shares))
		for account, amount := range value.Shares {
			shares = append(shares, BFTDexShare{Account: account, Shares: amount})
		}
		sort.Slice(shares, func(i, j int) bool { return shares[i].Account < shares[j].Account })
		pool := BFTDexPool{
			ID: value.ID, Kind: value.Kind, Asset0: value.Asset0, Asset1: value.Asset1,
			Reserve0: value.Reserve0, Reserve1: value.Reserve1, FeeBps: value.FeeBps, TotalShares: value.TotalShares,
			Shares: shares, NativeLots0: migrationDexLots(value.NativeLots0), NativeLots1: migrationDexLots(value.NativeLots1),
			CreatedAt: value.CreatedAt, UpdatedAt: value.UpdatedAt, BlockHeight: int64(value.BlockHeight), TxHash: value.TxHash,
		}
		pool.AuditHash = dexPoolAuditHash(pool)
		pools = append(pools, pool)
	}
	events := make([]BFTDexEvent, 0, len(migration.DexEvents))
	for _, value := range migration.DexEvents {
		event := BFTDexEvent{
			ID: value.ID, Type: value.Type, PoolID: value.PoolID, Signer: value.Signer,
			Asset0: value.Asset0, Asset1: value.Asset1, Amount0: value.Amount0, Amount1: value.Amount1, Shares: value.Shares,
			BlockHeight: int64(value.BlockHeight), OccurredAt: value.OccurredAt, TxHash: value.TxHash,
		}
		event.AuditHash = dexEventAuditHash(event)
		events = append(events, event)
	}
	return assets, balances, pools, events
}

func migrationDexLots(values map[string]int64) map[string]int64 {
	if len(values) == 0 {
		return nil
	}
	return cloneInt64Map(values)
}

func committedDexMatchesMigration(state CommittedState, migration chain.ConsensusMigrationState) bool {
	assets, balances, pools, events := dexStateFromMigration(migration)
	return equalEmptyOrDeep(state.DexAssets, assets) && equalEmptyOrDeep(state.DexBalances, balances) && equalEmptyOrDeep(state.DexPools, pools) && equalEmptyOrDeep(state.DexEvents, events)
}

func equalEmptyOrDeep(left, right any) bool {
	lv, rv := reflect.ValueOf(left), reflect.ValueOf(right)
	if lv.Kind() == reflect.Slice && rv.Kind() == reflect.Slice && lv.Len() == 0 && rv.Len() == 0 {
		return true
	}
	return reflect.DeepEqual(left, right)
}
