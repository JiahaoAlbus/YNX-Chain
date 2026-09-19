package chain

import (
	"errors"
	"fmt"
	"math"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

func validateNativeDexMigrationState(assets []NativeDexAsset, balances []NativeDexBalance, pools []NativeDexPool, events []NativeDexEvent) (int64, error) {
	assetTotals := make(map[string]int64, len(assets))
	assetIDs := make(map[string]struct{}, len(assets))
	symbols := make(map[string]struct{}, len(assets))
	previous := ""
	for _, asset := range assets {
		if previous != "" && asset.ID <= previous {
			return 0, errors.New("assets must be sorted by unique ID")
		}
		if asset.SchemaVersion != NativeDexSchemaVersion || asset.ID == NativeDexAssetID || !nativeDexAssetPattern.MatchString(asset.ID) || !nativeDexSymbolPattern.MatchString(asset.Symbol) || strings.TrimSpace(asset.Name) == "" || !accountaddress.IsCanonical(asset.Issuer) || asset.MaxSupply <= 0 || asset.TotalSupply <= 0 || asset.TotalSupply > asset.MaxSupply || asset.CreatedAt.IsZero() || asset.UpdatedAt.Before(asset.CreatedAt) || asset.TxHash == "" || asset.BlockHeight == 0 || asset.BlockHeight > math.MaxInt64 || asset.BlockHash == "" || asset.AuditHash != nativeDexAssetAuditHash(asset) {
			return 0, fmt.Errorf("asset %q is incomplete or audit-invalid", asset.ID)
		}
		if _, exists := symbols[asset.Symbol]; exists {
			return 0, fmt.Errorf("duplicate asset symbol %q", asset.Symbol)
		}
		previous = asset.ID
		assetIDs[asset.ID] = struct{}{}
		symbols[asset.Symbol] = struct{}{}
	}

	previous = ""
	for _, balance := range balances {
		key := balance.AssetID + "\x00" + balance.Account
		if previous != "" && key <= previous {
			return 0, errors.New("balances must be sorted and unique")
		}
		if _, ok := assetIDs[balance.AssetID]; !ok || !accountaddress.IsCanonical(balance.Account) || balance.Amount < 0 {
			return 0, errors.New("DEX balance is invalid")
		}
		if assetTotals[balance.AssetID] > math.MaxInt64-balance.Amount {
			return 0, errors.New("asset balance total overflows int64")
		}
		assetTotals[balance.AssetID] += balance.Amount
		previous = key
	}

	var nativeEscrow int64
	previous = ""
	poolIDs := make(map[string]struct{}, len(pools))
	for _, pool := range pools {
		if previous != "" && pool.ID <= previous {
			return 0, errors.New("pools must be sorted by unique ID")
		}
		if pool.SchemaVersion != NativeDexSchemaVersion || !nativeDexPoolPattern.MatchString(pool.ID) || pool.Kind != "ynx-cpmm-v1" || pool.Asset0 >= pool.Asset1 || !nativeDexMigrationAssetExists(assetIDs, pool.Asset0) || !nativeDexMigrationAssetExists(assetIDs, pool.Asset1) || pool.FeeBps == 0 || pool.FeeBps > 1000 || pool.Reserve0 < 0 || pool.Reserve1 < 0 || pool.TotalShares < 0 || pool.CreatedAt.IsZero() || pool.UpdatedAt.Before(pool.CreatedAt) || pool.TxHash == "" || pool.BlockHeight == 0 || pool.BlockHeight > math.MaxInt64 || pool.BlockHash == "" || pool.AuditHash != nativeDexPoolAuditHash(pool) {
			return 0, fmt.Errorf("pool %q is incomplete or audit-invalid", pool.ID)
		}
		if (pool.TotalShares == 0) != (pool.Reserve0 == 0 && pool.Reserve1 == 0) {
			return 0, fmt.Errorf("pool %s reserves and shares do not reconcile", pool.ID)
		}
		var shares int64
		for account, amount := range pool.Shares {
			if !accountaddress.IsCanonical(account) || amount < 0 || shares > math.MaxInt64-amount {
				return 0, fmt.Errorf("pool %s has invalid LP shares", pool.ID)
			}
			shares += amount
		}
		if shares != pool.TotalShares {
			return 0, fmt.Errorf("pool %s LP shares do not reconcile", pool.ID)
		}
		for side, assetID := range []string{pool.Asset0, pool.Asset1} {
			reserve, lots := pool.Reserve0, pool.NativeLots0
			if side == 1 {
				reserve, lots = pool.Reserve1, pool.NativeLots1
			}
			var lotTotal int64
			for lotID, amount := range lots {
				if strings.TrimSpace(lotID) == "" || amount < 0 || lotTotal > math.MaxInt64-amount {
					return 0, fmt.Errorf("pool %s has invalid native provenance lots", pool.ID)
				}
				lotTotal += amount
			}
			if assetID == NativeDexAssetID {
				if lotTotal != reserve || nativeEscrow > math.MaxInt64-reserve {
					return 0, fmt.Errorf("pool %s native reserve does not reconcile", pool.ID)
				}
				nativeEscrow += reserve
			} else {
				if lotTotal != 0 || assetTotals[assetID] > math.MaxInt64-reserve {
					return 0, fmt.Errorf("pool %s non-native reserve is invalid", pool.ID)
				}
				assetTotals[assetID] += reserve
			}
		}
		previous = pool.ID
		poolIDs[pool.ID] = struct{}{}
	}
	for _, asset := range assets {
		if assetTotals[asset.ID] != asset.TotalSupply {
			return 0, fmt.Errorf("asset %s supply does not reconcile", asset.ID)
		}
	}

	eventIDs := make(map[string]struct{}, len(events))
	for _, event := range events {
		if event.SchemaVersion != NativeDexSchemaVersion || event.ID == "" || !nativeDexMigrationAction(event.Type) || !accountaddress.IsCanonical(event.Signer) || event.OccurredAt.IsZero() || event.TxHash == "" || event.BlockHeight == 0 || event.BlockHeight > math.MaxInt64 || event.BlockHash == "" || event.AuditHash != nativeDexEventAuditHash(event) {
			return 0, fmt.Errorf("event %q is incomplete or audit-invalid", event.ID)
		}
		if event.PoolID != "" {
			if _, ok := poolIDs[event.PoolID]; !ok {
				return 0, fmt.Errorf("event %s references unknown pool %s", event.ID, event.PoolID)
			}
		}
		if _, exists := eventIDs[event.ID]; exists {
			return 0, fmt.Errorf("duplicate event ID %s", event.ID)
		}
		eventIDs[event.ID] = struct{}{}
	}
	return nativeEscrow, nil
}

func nativeDexMigrationAssetExists(assets map[string]struct{}, id string) bool {
	if id == NativeDexAssetID {
		return true
	}
	_, ok := assets[id]
	return ok
}

func nativeDexMigrationAction(action string) bool {
	switch action {
	case NativeDexActionAssetCreate, NativeDexActionAssetMint, NativeDexActionAssetTransfer, NativeDexActionPoolCreate,
		NativeDexActionLiquidityAdd, NativeDexActionLiquidityRemove, NativeDexActionSwapExactInput, NativeDexActionSwapExactOutput:
		return true
	default:
		return false
	}
}
