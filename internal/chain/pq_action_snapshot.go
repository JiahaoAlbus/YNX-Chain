package chain

import (
	"errors"
	"fmt"
	"math"
	"reflect"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

// The per-transaction hook has already reverified signatures at the historical
// height. This second pass proves each successful PQ resource action has exactly
// its full object/income records and each reverse reference has a transaction.
// It also binds every PQ DEX transaction to exactly one immutable audit event.
func validatePQActionSnapshot(s devnetSnapshot) error {
	if len(s.Blocks) == 0 {
		// Partial replication state is checked again with the complete history
		// before commit, just like shared batch coverage.
		return nil
	}
	type actionRecord struct {
		tx      Transaction
		history pqActionHistory
		payload any
	}
	actions := map[string]actionRecord{}
	remember := func(tx Transaction) error {
		if !strings.HasPrefix(tx.Memo, pqActionMemo) {
			return nil
		}
		if _, duplicate := actions[tx.Hash]; duplicate {
			return errors.New("duplicate PQ action history")
		}
		h, err := decodePQActionMemo(tx.Memo)
		if err != nil {
			return err
		}
		p, err := ynxauth.DecodeActionPayload(h.Action.Kind, h.Action.Payload)
		if err != nil {
			return err
		}
		actions[tx.Hash] = actionRecord{tx, h, p}
		return nil
	}
	for _, b := range s.Blocks {
		var firstLogIndex uint64
		for txIndex, tx := range b.Transactions {
			if strings.HasPrefix(tx.Memo, pqActionMemo) {
				if tx.BlockNum != b.Height || tx.BlockHash != b.Hash {
					return errors.New("PQ action block identity differs from containing block")
				}
				if err := validatePQActionLogs(tx, uint64(txIndex), firstLogIndex); err != nil {
					return err
				}
			}
			if err := remember(tx); err != nil {
				return err
			}
			firstLogIndex += uint64(len(tx.Logs))
		}
	}
	for _, tx := range s.Pending {
		if strings.HasPrefix(tx.Memo, pqActionMemo) {
			if tx.BlockNum != 0 || tx.BlockHash != "" {
				return errors.New("pending PQ action claims block inclusion")
			}
			if err := validatePQActionLogs(tx, 0, 0); err != nil {
				return err
			}
		}
		if err := remember(tx); err != nil {
			return err
		}
	}
	delegations := map[string]ResourceDelegation{}
	rentals := map[string]ResourceRental{}
	income := map[string]ResourceIncomeRecord{}
	dexExpected := map[string]actionRecord{}
	for hash, entry := range actions {
		tx, a := entry.tx, entry.history.Action
		switch p := entry.payload.(type) {
		case ynxauth.ContractDeployPayload, ynxauth.ContractExecutePayload:
			// Complete typed contract replay, including legacy interleaving, is
			// checked in the dedicated ordered pass below.
		case ynxauth.StakePayload:
		case ynxauth.ResourceDelegationPayload:
			if entry.history.Policy == nil {
				return errors.New("PQ delegation is missing original policy")
			}
			policy := *entry.history.Policy
			id := pqResourceObjectID(a, p.IdempotencyKey)
			if _, duplicate := delegations[id]; duplicate {
				return errors.New("PQ delegation idempotency was consumed twice")
			}
			amount := int64(p.AmountYNXT)
			delegations[id] = ResourceDelegation{PQTransactionHash: hash, ID: id, Provider: p.Provider, Beneficiary: p.Beneficiary, AmountYNXT: amount, Bandwidth: amount / policy.BandwidthStakeDivisor, Compute: amount / policy.ComputeStakeDivisor, AICredits: amount / policy.AICreditStakeDivisor, TrustCredits: amount / policy.TrustStakeDivisor, PolicyID: policy.ID, PolicyVersion: policy.Version, PolicyHash: policy.PolicyHash, Status: "active", CreatedAt: tx.Timestamp}
		case ynxauth.ResourceRentalPayload:
			if entry.history.Policy == nil {
				return errors.New("PQ rental is missing original policy")
			}
			policy := *entry.history.Policy
			quote, err := pqRentalQuote(policy, p, tx.Timestamp)
			if err != nil {
				return err
			}
			id := pqResourceObjectID(a, p.IdempotencyKey)
			if _, duplicate := rentals[id]; duplicate {
				return errors.New("PQ rental idempotency was consumed twice")
			}
			providerIncome := int64(0)
			if p.Provider != ProtocolResourceProvider {
				providerIncome = quote.PriceYNXT/10000*policy.ProviderShareBps + quote.PriceYNXT%10000*policy.ProviderShareBps/10000
			}
			rental := ResourceRental{PQTransactionHash: hash, ID: id, QuoteID: quote.ID, Address: a.Owner, Provider: p.Provider, PriceYNXT: quote.PriceYNXT, ProviderIncomeYNXT: providerIncome, ProtocolFeeYNXT: quote.PriceYNXT - providerIncome, PolicyID: policy.ID, PolicyVersion: policy.Version, PolicyHash: policy.PolicyHash, GovernanceStatus: policy.GovernanceStatus, Status: "active", CreatedAt: tx.Timestamp, Bandwidth: int64(p.Bandwidth), Compute: int64(p.Compute), AICredits: int64(p.AICredits), TrustCredits: int64(p.TrustCredits)}
			rentals[id] = rental
			for _, item := range []struct {
				provider, source string
				amount           int64
			}{{p.Provider, "resource-rental", rental.ProviderIncomeYNXT}, {ProtocolResourceTreasury, "protocol-resource-fee", rental.ProtocolFeeYNXT}} {
				if item.amount == 0 {
					continue
				}
				incomeID := pqResourceIncomeID(hash, item.source)
				if _, duplicate := income[incomeID]; duplicate {
					return errors.New("PQ income identity collision")
				}
				income[incomeID] = ResourceIncomeRecord{PQTransactionHash: hash, ID: incomeID, Provider: item.provider, RentalID: id, Source: item.source, Amount: item.amount, Currency: s.Config.NativeCurrencySymbol, PolicyID: policy.ID, PolicyVersion: policy.Version, PolicyHash: policy.PolicyHash, CreatedAt: tx.Timestamp}
			}
		default:
			if !strings.HasPrefix(a.Kind, "dex_") {
				return ynxauth.ErrAction
			}
			dexExpected[hash] = entry
		}
	}
	for id, want := range delegations {
		if actual, ok := s.Delegation[id]; !ok || !reflect.DeepEqual(actual, want) {
			return errors.New("PQ delegation object differs from original transaction")
		}
	}
	for id, actual := range s.Delegation {
		if actual.PQTransactionHash != "" {
			if want, ok := delegations[id]; !ok || !reflect.DeepEqual(actual, want) {
				return errors.New("orphan or rewritten PQ delegation reference")
			}
		}
	}
	for id, want := range rentals {
		if actual, ok := s.Rentals[id]; !ok || !reflect.DeepEqual(actual, want) {
			return errors.New("PQ rental object differs from original transaction")
		}
	}
	for id, actual := range s.Rentals {
		if actual.PQTransactionHash != "" {
			if want, ok := rentals[id]; !ok || !reflect.DeepEqual(actual, want) {
				return errors.New("orphan or rewritten PQ rental reference")
			}
		}
	}
	for id, want := range income {
		if actual, ok := s.Income[id]; !ok || !reflect.DeepEqual(actual, want) {
			return errors.New("PQ income object differs from original transaction")
		}
	}
	for id, actual := range s.Income {
		if actual.PQTransactionHash != "" {
			if want, ok := income[id]; !ok || !reflect.DeepEqual(actual, want) {
				return errors.New("orphan or rewritten PQ income reference")
			}
		}
	}
	dexSeen := map[string]bool{}
	for _, event := range s.DexEvents {
		entry, pq := dexExpected[event.TxHash]
		if !pq {
			height := event.BlockHeight
			if height == 0 {
				height = s.Blocks[len(s.Blocks)-1].Height
				if height < math.MaxUint64 {
					height++
				}
			}
			if s.AccountPolicy != nil {
				if _, active := s.AccountPolicy.PolicyAt(event.Signer, height); active {
					return errors.New("active PQ DEX event lacks its action proof")
				}
			}
			continue
		}
		if dexSeen[event.TxHash] {
			return errors.New("duplicate PQ DEX execution event")
		}
		if err := validatePQDexEvent(s, entry.tx, entry.history.Action, entry.payload, event); err != nil {
			return err
		}
		dexSeen[event.TxHash] = true
	}
	if len(dexSeen) != len(dexExpected) {
		return errors.New("PQ DEX transaction lacks its original execution event")
	}
	return validatePQContractSnapshot(s)
}

func validatePQDexEvent(s devnetSnapshot, tx Transaction, a ynxauth.Action, p any, e NativeDexEvent) error {
	if e.SchemaVersion != NativeDexSchemaVersion || e.ID != hashParts("native-dex-event", tx.Hash)[:24] || e.TxHash != tx.Hash || e.Type != a.Kind || e.Signer != a.Owner || !e.OccurredAt.Equal(tx.Timestamp) || e.BlockHeight != tx.BlockNum || e.BlockHash != tx.BlockHash || e.AuditHash != nativeDexEventAuditHash(e) {
		return errors.New("PQ DEX audit event differs from original transaction")
	}
	bad := false
	switch v := p.(type) {
	case ynxauth.DexAssetCreatePayload:
		asset, ok := s.DexAssets[v.AssetID]
		bad = !ok || asset.Issuer != a.Owner || asset.Name != v.Name || asset.Symbol != v.Symbol || asset.Decimals != uint8(v.Decimals) || asset.MaxSupply != int64(v.MaxSupply) || e.Asset0 != v.AssetID || e.Amount0 != int64(v.InitialSupply) || e.PoolID != "" || e.Asset1 != "" || e.Amount1 != 0 || e.Shares != 0
	case ynxauth.DexAssetAmountPayload:
		bad = e.Asset0 != v.AssetID || e.Amount0 != int64(v.Amount) || e.PoolID != "" || e.Asset1 != "" || e.Amount1 != 0 || e.Shares != 0
	case ynxauth.DexAssetTransferPayload:
		bad = e.Asset0 != v.AssetID || e.Amount0 != int64(v.Amount) || e.PoolID != "" || e.Asset1 != "" || e.Amount1 != 0 || e.Shares != 0
	case ynxauth.DexPoolCreatePayload:
		pool, ok := s.DexPools[v.PoolID]
		bad = !ok || pool.Asset0 != v.Asset0 || pool.Asset1 != v.Asset1 || pool.FeeBps != uint16(v.FeeBps) || e.PoolID != v.PoolID || e.Asset0 != v.Asset0 || e.Asset1 != v.Asset1 || e.Amount0 != 0 || e.Amount1 != 0 || e.Shares != 0
	case ynxauth.DexLiquidityPayload:
		pool, ok := s.DexPools[v.PoolID]
		bad = !ok || e.PoolID != v.PoolID || e.Asset0 != pool.Asset0 || e.Asset1 != pool.Asset1 || e.Amount0 != int64(v.Amount0) || e.Amount1 != int64(v.Amount1) || e.Shares < int64(v.MinShares) || tx.Timestamp.Unix() > int64(v.DeadlineUnix)
	case ynxauth.DexLiquidityRemovePayload:
		pool, ok := s.DexPools[v.PoolID]
		bad = !ok || e.PoolID != v.PoolID || e.Asset0 != pool.Asset0 || e.Asset1 != pool.Asset1 || e.Amount0 <= 0 || e.Amount1 <= 0 || e.Amount0 < int64(v.MinAmount0) || e.Amount1 < int64(v.MinAmount1) || e.Shares != int64(v.Shares) || tx.Timestamp.Unix() > int64(v.DeadlineUnix)
	case ynxauth.DexSwapExactInputPayload:
		pool, ok := s.DexPools[v.PoolID]
		bad = !ok || (v.AssetIn != pool.Asset0 && v.AssetIn != pool.Asset1) || e.PoolID != v.PoolID || e.Asset0 != v.AssetIn || e.Asset1 != nativeDexOther(pool, v.AssetIn) || e.Amount0 != int64(v.AmountIn) || e.Amount1 < int64(v.MinAmountOut) || e.Shares != 0 || tx.Timestamp.Unix() > int64(v.DeadlineUnix)
	case ynxauth.DexSwapExactOutputPayload:
		pool, ok := s.DexPools[v.PoolID]
		bad = !ok || (v.AssetOut != pool.Asset0 && v.AssetOut != pool.Asset1) || e.PoolID != v.PoolID || e.Asset0 != nativeDexOther(pool, v.AssetOut) || e.Asset1 != v.AssetOut || e.Amount0 <= 0 || e.Amount0 > int64(v.MaxAmountIn) || e.Amount1 != int64(v.AmountOut) || e.Shares != 0 || tx.Timestamp.Unix() > int64(v.DeadlineUnix)
	default:
		return ynxauth.ErrAction
	}
	if bad {
		return fmt.Errorf("PQ DEX event violates signed %s fields or bounds", a.Kind)
	}
	return nil
}
