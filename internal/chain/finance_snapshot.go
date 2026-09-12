package chain

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"sort"
	"strconv"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

const NativeFinanceSnapshotVersion = "ynx-native-finance-snapshot-v1"

// NativeFinanceSnapshot reads the account and the complete DEX projection at one
// lock boundary. It does not claim that current, possibly pending state is BFT
// committed. The content hash is a projection identity, never a consensus AppHash.
func (d *Devnet) NativeFinanceSnapshot(address string) (map[string]any, error) {
	if address != "" && !accountaddress.IsCanonical(address) {
		return nil, errors.New("canonical account required")
	}
	d.mu.RLock()
	defer d.mu.RUnlock()
	if len(d.blocks) == 0 {
		return nil, errors.New("ledger has no block identity")
	}
	tip := d.blocks[len(d.blocks)-1]
	assets := []map[string]any{{"id": NativeDexAssetID, "symbol": "YNXT", "name": "YNX Testnet", "decimals": 0, "native": true}}
	assetIDs := make([]string, 0, len(d.dexAssets))
	for id := range d.dexAssets {
		assetIDs = append(assetIDs, id)
	}
	sort.Strings(assetIDs)
	for _, id := range assetIDs {
		a := d.dexAssets[id]
		assets = append(assets, map[string]any{"id": a.ID, "symbol": a.Symbol, "name": a.Name, "decimals": a.Decimals,
			"issuer": a.Issuer, "maxSupply": strconv.FormatInt(a.MaxSupply, 10), "totalSupply": strconv.FormatInt(a.TotalSupply, 10),
			"transactionHash": a.TxHash, "txHash": a.TxHash, "blockHeight": strconv.FormatUint(a.BlockHeight, 10), "blockHash": a.BlockHash, "auditHash": a.AuditHash})
	}
	// A registry gap cannot be hidden behind complete=true or silently converted
	// to a zero balance in a consumer.
	for id := range d.dexBalances {
		if _, ok := d.dexAssets[id]; !ok {
			return nil, errors.New("DEX balance registry is incomplete")
		}
	}
	balances := []map[string]any{}
	var account any
	if address != "" {
		a := d.accountReadOnly(address)
		_, exists := d.accounts[address]
		var nextNonce any
		if a.Nonce != math.MaxUint64 {
			nextNonce = strconv.FormatUint(a.Nonce+1, 10)
		}
		account = map[string]any{"address": address, "exists": exists, "balance": strconv.FormatInt(a.Balance, 10),
			"staked": strconv.FormatInt(a.Staked, 10), "nonce": strconv.FormatUint(a.Nonce, 10), "nextNonce": nextNonce}
		balances = append(balances, map[string]any{"assetId": NativeDexAssetID, "account": address, "amount": strconv.FormatInt(a.Balance, 10)})
		for _, id := range assetIDs {
			balances = append(balances, map[string]any{"assetId": id, "account": address, "amount": strconv.FormatInt(d.dexBalances[id][address], 10)})
		}
	}
	poolIDs := make([]string, 0, len(d.dexPools))
	for id := range d.dexPools {
		poolIDs = append(poolIDs, id)
	}
	sort.Strings(poolIDs)
	pools := []map[string]any{}
	for _, id := range poolIDs {
		p := d.dexPools[id]
		owners := make([]string, 0, len(p.Shares))
		for owner := range p.Shares {
			owners = append(owners, owner)
		}
		sort.Strings(owners)
		shares := []map[string]any{}
		for _, owner := range owners {
			shares = append(shares, map[string]any{"account": owner, "shares": strconv.FormatInt(p.Shares[owner], 10)})
		}
		pools = append(pools, map[string]any{"id": p.ID, "kind": p.Kind, "asset0": p.Asset0, "asset1": p.Asset1,
			"reserve0": strconv.FormatInt(p.Reserve0, 10), "reserve1": strconv.FormatInt(p.Reserve1, 10), "feeBps": p.FeeBps,
			"totalShares": strconv.FormatInt(p.TotalShares, 10), "shares": shares, "transactionHash": p.TxHash, "txHash": p.TxHash,
			"blockHeight": strconv.FormatUint(p.BlockHeight, 10), "blockHash": p.BlockHash, "auditHash": p.AuditHash})
	}
	events := []map[string]any{}
	for _, e := range d.dexEvents {
		stage := "pending"
		if e.BlockHeight > 0 && e.BlockHash != "" {
			stage = "included"
		}
		events = append(events, map[string]any{"id": e.ID, "type": e.Type, "poolId": e.PoolID, "signer": e.Signer, "asset0": e.Asset0, "asset1": e.Asset1,
			"amount0": strconv.FormatInt(e.Amount0, 10), "amount1": strconv.FormatInt(e.Amount1, 10), "shares": strconv.FormatInt(e.Shares, 10),
			"occurredAt": e.OccurredAt, "transactionHash": e.TxHash, "txHash": e.TxHash, "blockHeight": strconv.FormatUint(e.BlockHeight, 10),
			"blockHash": e.BlockHash, "auditHash": e.AuditHash, "stage": stage})
	}
	var checkpoint any
	if cp := d.durableCheckpoint.Load(); cp != nil {
		checkpoint = map[string]any{"height": strconv.FormatUint(cp.height, 10), "blockHash": cp.hash, "snapshotIntegrity": cp.integrity, "scope": "local-snapshot"}
	}
	result := map[string]any{"schemaVersion": NativeFinanceSnapshotVersion, "source": "authoritative chain-native YNX Testnet state",
		"chainId": strconv.FormatInt(d.cfg.ChainID, 10), "integerEncoding": "decimal-string", "nativeUnit": "whole-YNXT", "evmWeiPerYNXT": "1000000000000000000",
		"stateScope": "authoritative-current-including-pending", "atomic": true, "blockHeight": strconv.FormatUint(tip.Height, 10), "blockHash": tip.Hash,
		"appHash": nil, "consensusFinality": false, "pendingTransactionCount": len(d.pending), "durableCheckpoint": checkpoint,
		"account": account, "assets": assets, "balances": balances, "pools": pools, "events": events,
		"coverage":              map[string]any{"complete": true, "assets": true, "balances": address != "", "lpShares": true, "events": true},
		"transactionStatusPath": "/v1/native-transactions/{hash}", "signedActionCurve": "secp256k1", "nonceRule": "current-plus-one"}
	content, err := json.Marshal(result)
	if err != nil {
		return nil, err
	}
	hash := sha256.Sum256(content)
	result["snapshotId"] = "sha256:" + hex.EncodeToString(hash[:])
	result["updatedAt"] = time.Now().UTC().Format(time.RFC3339Nano)
	return result, nil
}
