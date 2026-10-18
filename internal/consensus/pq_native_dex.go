package consensus

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"reflect"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

// Private data produced only after a real classic/PQ gateway verifies its
// original authorization, or while replaying an already-verified original.
// It carries no reusable verified bit, fabricated signature or alternate key.
type authorizedDexAction struct {
	Signer, Action                   string
	Payload                          json.RawMessage
	ClassicAuthorization, NativeHash string
}

// Native account movements stay on the actual ledger in live execution. The
// history adapter only replays escrow from validated receipt flows; it does
// not fabricate old native account balances which legacy history omitted.
type dexNativeMovement func(*executionState, *BFTDexPool, bool, string, int64, bool) ([]chain.LotFlow, error)

func detachDexExecution(state executionState) executionState {
	state.accounts = cloneExecutionAccounts(state)
	state.nativeAccounts = nil
	state.traceLots = cloneTraceLots(state.traceLots)
	state.dexAssets = append([]BFTDexAsset(nil), state.dexAssets...)
	state.dexBalances = append([]BFTDexBalance(nil), state.dexBalances...)
	state.dexPools = cloneDexPools(state.dexPools)
	state.dexEvents = cloneBFTDexEvents(state.dexEvents)
	return state
}
func cloneBFTDexEvents(values []BFTDexEvent) []BFTDexEvent {
	if len(values) == 0 {
		return nil
	}
	out := append([]BFTDexEvent{}, values...)
	for i := range out {
		if len(values[i].NativeFlows) != 0 {
			out[i].NativeFlows = append([]chain.LotFlow(nil), values[i].NativeFlows...)
		} else {
			out[i].NativeFlows = nil
		}
	}
	return out
}

func applyAuthorizedDexBusiness(state executionState, tx authorizedDexAction, txHash string, height int64, blockTime time.Time, validationOnly bool, native dexNativeMovement) (executionState, transactionExecution, error) {
	canonical, err := canonicalDexActionPayload(tx.Action, tx.Payload)
	if err != nil || !bytes.Equal(canonical, tx.Payload) {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("DEX business payload is not canonical"))
	}
	state = detachDexExecution(state)
	var nativeFlows []chain.LotFlow
	move := func(state *executionState, pool *BFTDexPool, side bool, owner string, amount int64, credit bool) error {
		flows, err := moveAuthorizedDexAsset(state, pool, side, owner, amount, credit, native)
		if err != nil {
			return err
		}
		nativeFlows = append(nativeFlows, flows...)
		return nil
	}

	event := BFTDexEvent{ID: ApplicationActionRecordID("dex-event", txHash), Type: tx.Action, Signer: tx.Signer, BlockHeight: height, OccurredAt: blockTime, TxHash: txHash}
	switch tx.Action {
	case ActionDexAssetCreate:
		var input DexAssetCreatePayload
		_ = json.Unmarshal(tx.Payload, &input)
		if _, ok := dexAssetIndex(state.dexAssets, input.AssetID); ok {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("DEX asset already exists"))
		}
		if _, ok := dexAssetBySymbol(state.dexAssets, input.Symbol); ok {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("DEX asset symbol already exists"))
		}
		asset := BFTDexAsset{ID: input.AssetID, Symbol: input.Symbol, Name: input.Name, Decimals: input.Decimals, Issuer: tx.Signer, MaxSupply: input.MaxSupply, TotalSupply: input.InitialSupply, CreatedAt: blockTime, UpdatedAt: blockTime, BlockHeight: height, TxHash: txHash}
		asset.AuditHash = dexAssetAuditHash(asset)
		state.dexAssets = insertDexAsset(state.dexAssets, asset)
		state.dexBalances = setDexBalance(state.dexBalances, input.AssetID, tx.Signer, input.InitialSupply)
		event.Asset0, event.Amount0 = input.AssetID, input.InitialSupply
	case ActionDexAssetMint:
		var input DexAssetAmountPayload
		_ = json.Unmarshal(tx.Payload, &input)
		index, ok := dexAssetIndex(state.dexAssets, input.AssetID)
		if !ok {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("DEX asset does not exist"))
		}
		asset := state.dexAssets[index]
		if asset.Issuer != tx.Signer {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("only the DEX asset issuer may mint"))
		}
		if asset.TotalSupply > asset.MaxSupply-input.Amount {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("DEX asset max supply exceeded"))
		}
		current := dexBalanceAmount(state.dexBalances, input.AssetID, tx.Signer)
		if current > math.MaxInt64-input.Amount {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("DEX balance overflow"))
		}
		asset.TotalSupply += input.Amount
		asset.UpdatedAt, asset.BlockHeight, asset.TxHash = blockTime, height, txHash
		asset.AuditHash = dexAssetAuditHash(asset)
		state.dexAssets[index] = asset
		state.dexBalances = setDexBalance(state.dexBalances, input.AssetID, tx.Signer, current+input.Amount)
		event.Asset0, event.Amount0 = input.AssetID, input.Amount
	case ActionDexAssetTransfer:
		var input DexAssetTransferPayload
		_ = json.Unmarshal(tx.Payload, &input)
		if _, ok := dexAssetIndex(state.dexAssets, input.AssetID); !ok {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("DEX asset does not exist"))
		}
		if err := moveDexBalance(&state, input.AssetID, tx.Signer, input.Recipient, input.Amount); err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
		}
		event.Asset0, event.Amount0 = input.AssetID, input.Amount
	case ActionDexPoolCreate:
		var input DexPoolCreatePayload
		_ = json.Unmarshal(tx.Payload, &input)
		if _, ok := dexPoolIndex(state.dexPools, input.PoolID); ok {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("DEX pool already exists"))
		}
		if !dexAssetExists(state.dexAssets, input.Asset0) || !dexAssetExists(state.dexAssets, input.Asset1) {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("DEX pool asset does not exist"))
		}
		for _, pool := range state.dexPools {
			if pool.Asset0 == input.Asset0 && pool.Asset1 == input.Asset1 && pool.FeeBps == input.FeeBps {
				return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("DEX pool pair and fee tier already exists"))
			}
		}
		pool := BFTDexPool{ID: input.PoolID, Kind: "ynx-cpmm-v1", Asset0: input.Asset0, Asset1: input.Asset1, FeeBps: input.FeeBps, Shares: []BFTDexShare{}, NativeLots0: nil, NativeLots1: nil, CreatedAt: blockTime, UpdatedAt: blockTime, BlockHeight: height, TxHash: txHash}
		pool.AuditHash = dexPoolAuditHash(pool)
		state.dexPools = insertDexPool(state.dexPools, pool)
		event.PoolID, event.Asset0, event.Asset1 = input.PoolID, input.Asset0, input.Asset1
	case ActionDexLiquidityAdd:
		var input DexLiquidityPayload
		_ = json.Unmarshal(tx.Payload, &input)
		if err := requireDexDeadline(input.DeadlineUnix, blockTime, validationOnly); err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
		}
		index, ok := dexPoolIndex(state.dexPools, input.PoolID)
		if !ok {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("DEX pool does not exist"))
		}
		pool := state.dexPools[index]
		shares, err := dexLiquidityShares(pool, input.Amount0, input.Amount1)
		if err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
		}
		if shares < input.MinShares {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("DEX minted shares are below minimum"))
		}
		if pool.Reserve0 > math.MaxInt64-input.Amount0 || pool.Reserve1 > math.MaxInt64-input.Amount1 || pool.TotalShares > math.MaxInt64-shares {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("DEX pool overflow"))
		}
		if err := move(&state, &pool, true, tx.Signer, input.Amount0, false); err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, err)
		}
		if err := move(&state, &pool, false, tx.Signer, input.Amount1, false); err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, err)
		}
		pool.Reserve0 += input.Amount0
		pool.Reserve1 += input.Amount1
		pool.TotalShares += shares
		pool.Shares = addDexShares(pool.Shares, tx.Signer, shares)
		updateDexPool(&pool, height, blockTime, txHash)
		state.dexPools[index] = pool
		event.PoolID, event.Asset0, event.Asset1, event.Amount0, event.Amount1, event.Shares = pool.ID, pool.Asset0, pool.Asset1, input.Amount0, input.Amount1, shares
	case ActionDexLiquidityRemove:
		var input DexLiquidityRemovePayload
		_ = json.Unmarshal(tx.Payload, &input)
		if err := requireDexDeadline(input.DeadlineUnix, blockTime, validationOnly); err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
		}
		index, ok := dexPoolIndex(state.dexPools, input.PoolID)
		if !ok {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("DEX pool does not exist"))
		}
		pool := state.dexPools[index]
		owned := dexShareAmount(pool.Shares, tx.Signer)
		if owned < input.Shares || pool.TotalShares <= 0 {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("insufficient DEX LP shares"))
		}
		amount0, err := mulDivFloor(input.Shares, pool.Reserve0, pool.TotalShares)
		if err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
		}
		amount1, err := mulDivFloor(input.Shares, pool.Reserve1, pool.TotalShares)
		if err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
		}
		if amount0 <= 0 || amount1 <= 0 || amount0 < input.MinAmount0 || amount1 < input.MinAmount1 {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("DEX liquidity output is below minimum"))
		}
		if err := move(&state, &pool, true, tx.Signer, amount0, true); err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
		}
		if err := move(&state, &pool, false, tx.Signer, amount1, true); err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
		}
		pool.Reserve0 -= amount0
		pool.Reserve1 -= amount1
		pool.TotalShares -= input.Shares
		pool.Shares = addDexShares(pool.Shares, tx.Signer, -input.Shares)
		updateDexPool(&pool, height, blockTime, txHash)
		state.dexPools[index] = pool
		event.PoolID, event.Asset0, event.Asset1, event.Amount0, event.Amount1, event.Shares = pool.ID, pool.Asset0, pool.Asset1, amount0, amount1, input.Shares
	case ActionDexSwapExactInput:
		var input DexSwapExactInputPayload
		_ = json.Unmarshal(tx.Payload, &input)
		if err := requireDexDeadline(input.DeadlineUnix, blockTime, validationOnly); err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
		}
		index, ok := dexPoolIndex(state.dexPools, input.PoolID)
		if !ok {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("DEX pool does not exist"))
		}
		pool := state.dexPools[index]
		inIs0, err := dexPoolDirection(pool, input.AssetIn)
		if err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
		}
		reserveIn, reserveOut := dexReserves(pool, inIs0)
		amountOut, err := dexExactInputQuote(reserveIn, reserveOut, input.AmountIn, pool.FeeBps)
		if err != nil || amountOut < input.MinAmountOut {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("DEX exact-input output is below minimum"))
		}
		if err := move(&state, &pool, inIs0, tx.Signer, input.AmountIn, false); err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, err)
		}
		if err := move(&state, &pool, !inIs0, tx.Signer, amountOut, true); err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
		}
		if inIs0 {
			pool.Reserve0 += input.AmountIn
			pool.Reserve1 -= amountOut
		} else {
			pool.Reserve1 += input.AmountIn
			pool.Reserve0 -= amountOut
		}
		updateDexPool(&pool, height, blockTime, txHash)
		state.dexPools[index] = pool
		event.PoolID, event.Asset0, event.Asset1, event.Amount0, event.Amount1 = pool.ID, input.AssetIn, dexOtherAsset(pool, input.AssetIn), input.AmountIn, amountOut
	case ActionDexSwapExactOutput:
		var input DexSwapExactOutputPayload
		_ = json.Unmarshal(tx.Payload, &input)
		if err := requireDexDeadline(input.DeadlineUnix, blockTime, validationOnly); err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
		}
		index, ok := dexPoolIndex(state.dexPools, input.PoolID)
		if !ok {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("DEX pool does not exist"))
		}
		pool := state.dexPools[index]
		outIs0, err := dexPoolDirection(pool, input.AssetOut)
		if err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
		}
		reserveOut, reserveIn := dexReserves(pool, outIs0)
		amountIn, err := dexExactOutputQuote(reserveIn, reserveOut, input.AmountOut, pool.FeeBps)
		if err != nil || amountIn > input.MaxAmountIn {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("DEX exact-output input exceeds maximum"))
		}
		if err := move(&state, &pool, !outIs0, tx.Signer, amountIn, false); err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, err)
		}
		if err := move(&state, &pool, outIs0, tx.Signer, input.AmountOut, true); err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
		}
		if outIs0 {
			pool.Reserve1 += amountIn
			pool.Reserve0 -= input.AmountOut
		} else {
			pool.Reserve0 += amountIn
			pool.Reserve1 -= input.AmountOut
		}
		updateDexPool(&pool, height, blockTime, txHash)
		state.dexPools[index] = pool
		event.PoolID, event.Asset0, event.Asset1, event.Amount0, event.Amount1 = pool.ID, dexOtherAsset(pool, input.AssetOut), input.AssetOut, amountIn, input.AmountOut
	}
	event.ClassicAuthorization, event.PQTransactionHash, event.NativeFlows = tx.ClassicAuthorization, tx.NativeHash, nativeFlows
	event.AuditHash = dexEventAuditHash(event)
	state.dexEvents = append(state.dexEvents, event)
	return state, transactionExecution{typeName: tx.Action, hash: txHash, event: abcitypes.Event{Type: "ynx.dex", Attributes: []abcitypes.EventAttribute{{Key: "action", Value: tx.Action, Index: true}, {Key: "pool_id", Value: event.PoolID, Index: true}, {Key: "signer", Value: tx.Signer, Index: true}}}}, nil
}

func moveAuthorizedDexAsset(state *executionState, pool *BFTDexPool, side bool, owner string, amount int64, credit bool, native dexNativeMovement) ([]chain.LotFlow, error) {
	asset, reserve := pool.Asset1, pool.Reserve1
	if side {
		asset, reserve = pool.Asset0, pool.Reserve0
	}
	if amount <= 0 || !credit && reserve > math.MaxInt64-amount {
		return nil, errors.New("DEX actual reserve movement overflows")
	}
	if asset == DexNativeAssetID {
		return native(state, pool, side, owner, amount, credit)
	}
	if credit {
		return nil, creditDexAssetFromPool(state, pool, side, owner, amount)
	}
	return nil, debitDexAssetToPool(state, pool, side, owner, amount)
}
func dexNativePoolLots(pool *BFTDexPool, side bool) *map[string]int64 {
	if side {
		return &pool.NativeLots0
	}
	return &pool.NativeLots1
}

func liveDexNativeMovement(reserveFee int64) dexNativeMovement {
	return func(state *executionState, pool *BFTDexPool, side bool, owner string, amount int64, credit bool) ([]chain.LotFlow, error) {
		if !credit && reserveFee > 0 {
			i, ok := accountIndex(state.accounts, owner)
			if !ok || amount > math.MaxInt64-reserveFee || state.accounts[i].Balance < amount+reserveFee {
				return nil, errors.New("DEX native debit must reserve its real fee")
			}
			required := amount + reserveFee
			for _, value := range state.accounts[i].Lots {
				if value > 0 {
					required -= minInt64(value, required)
				}
				if required == 0 {
					break
				}
			}
			if required != 0 {
				return nil, errors.New("DEX native debit lacks traceable amount plus fee")
			}
		}
		before := cloneInt64Map(*dexNativePoolLots(pool, side))
		var err error
		if credit {
			err = creditDexAssetFromPool(state, pool, side, owner, amount)
		} else {
			err = debitDexAssetToPool(state, pool, side, owner, amount)
		}
		if err != nil {
			return nil, err
		}
		after := *dexNativePoolLots(pool, side)
		keys := map[string]int64{}
		for id := range before {
			keys[id] = 0
		}
		for id := range after {
			keys[id] = 0
		}
		var flows []chain.LotFlow
		var total int64
		for _, id := range sortedLotKeys(keys) {
			delta := after[id] - before[id]
			from, to := owner, pool.ID
			if credit {
				delta = -delta
				from, to = pool.ID, owner
			}
			if delta < 0 || delta > amount-total {
				return nil, errors.New("DEX native movement differs from actual lot delta")
			}
			if delta == 0 {
				continue
			}
			if reserveFee > 0 {
				lot, ok := state.traceLots[id]
				if !ok || lot.LotID != id || lot.Amount < delta {
					return nil, errors.New("DEX native movement lacks source lineage")
				}
			}
			total += delta
			flows = append(flows, chain.LotFlow{LotID: id, From: from, To: to, Amount: delta})
		}
		if total != amount {
			return nil, errors.New("DEX native movement lacks exact lot coverage")
		}
		return flows, nil
	}
}

// Replay checks escrow itself and receipt amounts, without manufacturing an
// old user's missing native balance. Real admission always uses the live mover.
func replayDexNativeMovement(original []chain.LotFlow, trace map[string]chain.TrustTraceLot) (dexNativeMovement, *bool) {
	used := false
	return func(_ *executionState, pool *BFTDexPool, side bool, owner string, amount int64, credit bool) ([]chain.LotFlow, error) {
		if used {
			return nil, errors.New("DEX native flow receipt was reused")
		}
		used = true
		lots := dexNativePoolLots(pool, side)
		if *lots == nil {
			*lots = map[string]int64{}
		}
		from, to := owner, pool.ID
		if credit {
			from, to = pool.ID, owner
		}
		var total int64
		previous := ""
		for _, flow := range original {
			if flow.LotID == "" || flow.LotID <= previous || flow.From != from || flow.To != to || flow.Amount <= 0 || flow.Amount > amount-total {
				return nil, errors.New("DEX native receipt has invalid identity, order or amount")
			}
			if trace != nil {
				lot, ok := trace[flow.LotID]
				if !ok || lot.LotID != flow.LotID || lot.Amount < flow.Amount {
					return nil, errors.New("DEX native receipt lacks original lineage")
				}
			}
			total += flow.Amount
			previous = flow.LotID
		}
		if total != amount {
			return nil, errors.New("DEX native receipt does not cover its signed operation")
		}
		if credit {
			remaining := amount
			var expected []chain.LotFlow
			for _, id := range sortedLotKeys(*lots) {
				n := minInt64((*lots)[id], remaining)
				if n <= 0 {
					continue
				}
				expected = append(expected, chain.LotFlow{LotID: id, From: from, To: to, Amount: n})
				remaining -= n
				if remaining == 0 {
					break
				}
			}
			if remaining != 0 || !reflect.DeepEqual(expected, original) {
				return nil, errors.New("DEX native output differs from actual ordered escrow lots")
			}
		}
		for _, flow := range original {
			if credit {
				if (*lots)[flow.LotID] < flow.Amount {
					return nil, errors.New("DEX escrow receipt overspends a lot")
				}
				(*lots)[flow.LotID] -= flow.Amount
			} else {
				if (*lots)[flow.LotID] > math.MaxInt64-flow.Amount {
					return nil, errors.New("DEX escrow receipt overflows a lot")
				}
				(*lots)[flow.LotID] += flow.Amount
			}
		}
		return append([]chain.LotFlow(nil), original...), nil
	}, &used
}

func pqAuthorizedDexAction(action ynxauth.Action, nativeHash string) (authorizedDexAction, error) {
	tx := authorizedDexAction{Signer: action.Owner, Action: action.Kind, NativeHash: nativeHash}
	if !isDexAction(action.Kind) || action.Fee != 1 {
		return tx, errors.New("PQ native DEX requires a supported kind and fee one")
	}
	value, err := ynxauth.DecodeActionPayload(action.Kind, action.Payload)
	if err != nil {
		return tx, err
	}
	var payload any
	switch p := value.(type) {
	case ynxauth.DexAssetCreatePayload:
		payload = DexAssetCreatePayload{p.AssetID, p.Symbol, p.Name, uint8(p.Decimals), int64(p.MaxSupply), int64(p.InitialSupply)}
	case ynxauth.DexAssetAmountPayload:
		payload = DexAssetAmountPayload{p.AssetID, int64(p.Amount)}
	case ynxauth.DexAssetTransferPayload:
		payload = DexAssetTransferPayload{p.AssetID, p.Recipient, int64(p.Amount)}
	case ynxauth.DexPoolCreatePayload:
		payload = DexPoolCreatePayload{p.PoolID, p.Asset0, p.Asset1, uint16(p.FeeBps)}
	case ynxauth.DexLiquidityPayload:
		payload = DexLiquidityPayload{p.PoolID, int64(p.Amount0), int64(p.Amount1), int64(p.MinShares), int64(p.DeadlineUnix)}
	case ynxauth.DexLiquidityRemovePayload:
		payload = DexLiquidityRemovePayload{p.PoolID, int64(p.Shares), int64(p.MinAmount0), int64(p.MinAmount1), int64(p.DeadlineUnix)}
	case ynxauth.DexSwapExactInputPayload:
		payload = DexSwapExactInputPayload{p.PoolID, p.AssetIn, int64(p.AmountIn), int64(p.MinAmountOut), int64(p.DeadlineUnix)}
	case ynxauth.DexSwapExactOutputPayload:
		payload = DexSwapExactOutputPayload{p.PoolID, p.AssetOut, int64(p.AmountOut), int64(p.MaxAmountIn), int64(p.DeadlineUnix)}
	default:
		return tx, errors.New("unsupported typed DEX payload")
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return tx, err
	}
	tx.Payload, err = canonicalDexActionPayload(tx.Action, raw)
	if err != nil || !bytes.Equal(tx.Payload, raw) {
		return tx, errors.New("DEX typed payload differs from canonical business request")
	}
	return tx, nil
}

const pqDexHistoryMemo = "ynx-abci-pq-dex-v1:"

func isPQDexHistory(tx chain.Transaction) bool { return strings.HasPrefix(tx.Memo, pqDexHistoryMemo) }
func dexHistoryTransaction(action ynxauth.Action, nativeHash string, event BFTDexEvent, raw []byte, flows []chain.LotFlow) chain.Transaction {
	to := event.PoolID
	if to == "" {
		to = event.Asset0
	}
	return chain.Transaction{Hash: nativeHash, Type: action.Kind, From: action.Owner, To: to, Fee: 1, Nonce: action.Nonce, BlockNum: uint64(event.BlockHeight), Timestamp: event.OccurredAt, Memo: pqDexHistoryMemo + hex.EncodeToString(raw), LotFlows: flows}
}

func (a *Application) applyPQDexAction(state executionState, raw []byte, height int64, at time.Time) (executionState, transactionExecution, error) {
	fail := func(err error) (executionState, transactionExecution, error) {
		return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
	}
	wire, action, err := DecodePQNativeActionTransaction(raw)
	if err != nil {
		return fail(err)
	}
	if height <= 0 || state.accountPolicy == nil || action.NativeChainID != uint64(a.migration.Network.ChainID) || !bytes.Equal(action.ChainID, state.accountPolicy.NetworkID) {
		return fail(errors.New("PQ DEX requires actual policy, network and height"))
	}
	member, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		return fail(err)
	}
	if err = a.pqCertificateCache.VerifyDecodedMember(state.accountPolicy, action.Owner, ynxauth.TransactionPurpose, member.Message, member, uint64(height)); err != nil {
		return fail(err)
	}
	nativeHash, abciHash := SignedTransactionHash(wire), SignedTransactionHash(raw)
	for _, entry := range state.pqHistory {
		if entry.Transaction.Hash == nativeHash || entry.ABCITransactionHash == abciHash {
			return fail(errors.New("original PQ DEX authorization already executed"))
		}
	}
	auth, err := pqAuthorizedDexAction(action, nativeHash)
	if err != nil {
		return fail(err)
	}
	if err := requireReplayableDexHistory(state.dexEvents, a.migration); err != nil {
		return fail(err)
	}
	index, ok := accountIndex(state.accounts, action.Owner)
	if !ok || state.accounts[index].Nonce == math.MaxUint64 || action.Nonce != state.accounts[index].Nonce+1 || state.accounts[index].Balance < 1 || state.accounts[index].ResourceUsage.BandwidthUsed == math.MaxInt64 {
		return fail(errors.New("PQ DEX requires exact nonce, fee balance and bandwidth capacity"))
	}
	hasFeeLot := false
	for id, amount := range state.accounts[index].Lots {
		lot, ok := state.traceLots[id]
		if amount > 0 && ok && lot.LotID == id {
			hasFeeLot = true
			break
		}
	}
	if !hasFeeLot {
		return fail(errors.New("PQ DEX lacks traceable native fee"))
	}
	if i, ok := accountIndex(state.accounts, a.feeRecipient); ok && a.feeRecipient != action.Owner && state.accounts[i].Balance == math.MaxInt64 {
		return fail(errors.New("PQ DEX fee recipient overflows"))
	}
	validationOnly := at.IsZero()
	if validationOnly {
		at = time.Unix(height, 0)
	}
	at = at.UTC()
	next, execution, err := applyAuthorizedDexBusiness(state, auth, abciHash, height, at, validationOnly, liveDexNativeMovement(1))
	if err != nil {
		return executionState{}, transactionExecution{}, err
	}
	// Native source semantics: reserve the fee during native debits, perform the
	// business effect, then move the real fee lots and consume nonce/BW once.
	flows, err := a.chargePQContract(&next, action, 0)
	if err != nil {
		return fail(err)
	}
	event := next.dexEvents[len(next.dexEvents)-1]
	tx := dexHistoryTransaction(action, nativeHash, event, raw, flows)
	next.feeEvents = state.feeEvents.append(newCurrentFeeEvent(abciHash, PQActionType, action.Owner, a.feeRecipient, 1, height, at))
	next.pqHistory = append(clonePQHistory(state.pqHistory), PQCommittedAuthorization{ABCITransactionHash: abciHash, Transaction: tx})
	execution.typeName, execution.hash = PQActionType, abciHash
	return next, execution, nil
}

func requireReplayableDexHistory(events []BFTDexEvent, m chain.ConsensusMigrationState) error {
	_, _, _, source := dexStateFromMigration(m)
	if len(events) < len(source) {
		return errors.New("DEX history lost trusted migration events")
	}
	for i, event := range source {
		if !reflect.DeepEqual(event, events[i]) {
			return errors.New("DEX migration event prefix changed")
		}
	}
	for _, event := range events[len(source):] {
		if event.ClassicAuthorization == "" && event.PQTransactionHash == "" {
			return errors.New("DEX PQ admission needs the missing original post-migration classic transaction; an unsigned checkpoint is not a substitute")
		}
	}
	return nil
}

func decodePQDexHistory(entry PQCommittedAuthorization) ([]byte, ynxauth.Action, authorizedDexAction, error) {
	var action ynxauth.Action
	var auth authorizedDexAction
	tx := entry.Transaction
	if !isPQDexHistory(tx) || len(tx.Memo) > 4*chain.MaxPQActionMemberBytes+1024 {
		return nil, action, auth, errors.New("missing or oversized PQ DEX history")
	}
	raw, err := hex.DecodeString(strings.TrimPrefix(tx.Memo, pqDexHistoryMemo))
	if err != nil || tx.Memo != pqDexHistoryMemo+hex.EncodeToString(raw) {
		return nil, action, auth, errors.New("noncanonical PQ DEX history")
	}
	wire, action, err := DecodePQNativeActionTransaction(raw)
	if err != nil {
		return nil, action, auth, err
	}
	auth, err = pqAuthorizedDexAction(action, SignedTransactionHash(wire))
	if err != nil {
		return nil, action, auth, err
	}
	if entry.ABCITransactionHash != SignedTransactionHash(raw) || tx.Hash != auth.NativeHash || tx.Timestamp.IsZero() || tx.Timestamp.Location() != time.UTC {
		return nil, action, auth, errors.New("PQ DEX original envelope identity or time differs")
	}
	return wire, action, auth, nil
}

func pqDexFeeHash(s CommittedState, hash string) bool {
	for _, entry := range s.PQHistory {
		if entry.ABCITransactionHash == hash && isPQDexHistory(entry.Transaction) {
			return true
		}
	}
	return false
}

// A complete DEX replay starts at the independent migration checkpoint. Old
// opaque post-checkpoint classic events remain loadable under their old rules,
// but are never silently promoted into replayable PQ authority.
func validateConsensusPQDex(s CommittedState, m chain.ConsensusMigrationState) error {
	cache := chain.NewPQCertificateCache()
	entries := map[string]PQCommittedAuthorization{}
	orders := map[string]int{}
	auths := map[string]authorizedDexAction{}
	actions := map[string]ynxauth.Action{}
	for order, entry := range s.PQHistory {
		tx := entry.Transaction
		if !isPQDexHistory(tx) {
			continue
		}
		wire, action, auth, err := decodePQDexHistory(entry)
		if err != nil {
			return err
		}
		if s.AccountPolicy == nil || action.NativeChainID != uint64(s.ChainID) || !bytes.Equal(action.ChainID, s.AccountPolicy.NetworkID) || tx.BlockNum <= m.Height || tx.BlockNum > uint64(s.Height) {
			return errors.New("PQ DEX network or actual height mismatch")
		}
		member, err := ynxbatch.DecodeMember(wire)
		if err != nil {
			return err
		}
		if err = cache.VerifyDecodedMember(s.AccountPolicy, action.Owner, ynxauth.TransactionPurpose, member.Message, member, tx.BlockNum); err != nil {
			return err
		}
		if _, dup := entries[entry.ABCITransactionHash]; dup {
			return errors.New("duplicate PQ DEX original authorization")
		}
		entries[entry.ABCITransactionHash], orders[entry.ABCITransactionHash], auths[entry.ABCITransactionHash], actions[entry.ABCITransactionHash] = entry, order, auth, action
	}
	assets, balances, pools, sourceEvents := dexStateFromMigration(m)
	if len(s.DexEvents) < len(sourceEvents) {
		return errors.New("DEX migration events were removed")
	}
	for i, event := range sourceEvents {
		if !reflect.DeepEqual(event, s.DexEvents[i]) {
			return errors.New("DEX source prefix differs from trusted migration")
		}
	}
	replayable := requireReplayableDexHistory(s.DexEvents, m) == nil
	if len(entries) > 0 && !replayable {
		return errors.New("PQ DEX history crosses a post-migration classic event without its original proof")
	}
	// The replay ledger contains only the real DEX substate. Native account
	// balances are deliberately absent; the native mover validates escrow flows.
	replay := executionState{dexAssets: assets, dexBalances: balances, dexPools: pools, dexEvents: sourceEvents}
	seen := map[string]bool{}
	lastPQOrder := -1
	lastHeight := int64(m.Height)
	classicNonce := map[string]uint64{}
	for _, account := range m.Accounts {
		classicNonce[account.Address] = account.Nonce
	}
	tracked, lastNonce, activeSequence := map[string]bool{}, map[string]uint64{}, map[string]bool{}
	feeRecipient := ""
	for _, v := range m.Validators {
		if v.Active {
			feeRecipient = v.Address
			break
		}
	}
	for _, event := range s.DexEvents[len(sourceEvents):] {
		if event.BlockHeight <= int64(m.Height) || event.BlockHeight < lastHeight || event.BlockHeight > s.Height || event.OccurredAt.IsZero() || event.OccurredAt.Location() != time.UTC {
			return errors.New("DEX execution history position or time invalid")
		}
		lastHeight = event.BlockHeight
		var auth authorizedDexAction
		entry, pq := entries[event.TxHash]
		if pq {
			if seen[event.TxHash] || orders[event.TxHash] <= lastPQOrder || event.ClassicAuthorization != "" || event.PQTransactionHash != entry.Transaction.Hash || event.BlockHeight != int64(entry.Transaction.BlockNum) || !event.OccurredAt.Equal(entry.Transaction.Timestamp) {
				return errors.New("PQ DEX event does not bind its original authorization and position")
			}
			seen[event.TxHash], lastPQOrder = true, orders[event.TxHash]
			auth = auths[event.TxHash]
			action := actions[event.TxHash]
			raw, _ := hex.DecodeString(strings.TrimPrefix(entry.Transaction.Memo, pqDexHistoryMemo))
			expected := dexHistoryTransaction(action, auth.NativeHash, event, raw, entry.Transaction.LotFlows)
			if !reflect.DeepEqual(expected, entry.Transaction) {
				return errors.New("PQ DEX history acquired unexecuted fields")
			}
			var total int64
			previous := ""
			for _, flow := range entry.Transaction.LotFlows {
				lot, ok := s.TraceLots[flow.LotID]
				if flow.LotID == "" || flow.LotID <= previous || flow.From != action.Owner || flow.To != feeRecipient || flow.Amount <= 0 || flow.Amount > 1-total || !ok || lot.LotID != flow.LotID || lot.Amount < flow.Amount {
					return errors.New("PQ DEX fee lacks exact original trace lineage")
				}
				total += flow.Amount
				previous = flow.LotID
			}
			if total != 1 {
				return errors.New("PQ DEX fee lot coverage is incomplete")
			}
			expectedFee := newCurrentFeeEvent(entry.ABCITransactionHash, PQActionType, action.Owner, feeRecipient, 1, event.BlockHeight, event.OccurredAt)
			count := 0
			for _, fee := range s.FeeEvents {
				if fee.TxHash == entry.ABCITransactionHash {
					count++
					if fee != expectedFee {
						return errors.New("PQ DEX fee event differs from actual fee")
					}
				}
			}
			if count != 1 {
				return errors.New("PQ DEX requires one exact fee event")
			}
			tracked[action.Owner] = true
		} else {
			if event.PQTransactionHash != "" {
				return errors.New("DEX PQ marker has no original authorization")
			}
			if err := requireConsensusLegacy(s.AccountPolicy, event.Signer, event.BlockHeight); err != nil {
				return err
			}
			if event.ClassicAuthorization == "" {
				continue
			}
			if len(event.ClassicAuthorization) > 2*MaxSignedActionSize {
				return errors.New("DEX classic original exceeds canonical envelope bound")
			}
			raw, err := hex.DecodeString(event.ClassicAuthorization)
			if err != nil || event.ClassicAuthorization != hex.EncodeToString(raw) || ApplicationActionHash(raw) != event.TxHash {
				return errors.New("DEX classic original bytes or hash mismatch")
			}
			tx, err := DecodeSignedApplicationAction(raw)
			if err != nil {
				return err
			}
			if err = tx.Verify(s.ChainID); err != nil {
				return err
			}
			if !isDexAction(tx.Action) || tx.Signer != event.Signer || tx.Action != event.Type {
				return errors.New("DEX classic original authority differs from event")
			}
			// Other classic business can consume intervening nonces. Its full
			// native ledger is not reconstructed here, but a DEX original may
			// never be replayed, move backwards, or exceed the actual account.
			i, ok := accountIndex(s.Accounts, tx.Signer)
			if !ok || tx.Nonce <= classicNonce[tx.Signer] || tx.Nonce > s.Accounts[i].Nonce {
				return errors.New("DEX classic original nonce is replayed or exceeds its account")
			}
			for _, prior := range s.PQHistory {
				if prior.Transaction.From == tx.Signer && prior.Transaction.Nonce == tx.Nonce {
					return errors.New("DEX classic original reuses a PQ ledger nonce")
				}
			}
			classicNonce[tx.Signer] = tx.Nonce
			expectedFee := newCurrentFeeEvent(event.TxHash, tx.Action, tx.Signer, feeRecipient, tx.Fee, event.BlockHeight, event.OccurredAt)
			feeCount := 0
			for _, fee := range s.FeeEvents {
				if fee.TxHash == event.TxHash {
					feeCount++
					if fee != expectedFee {
						return errors.New("DEX classic fee differs from its original execution")
					}
				}
			}
			if feeCount != 1 {
				return errors.New("DEX classic original requires one exact fee event")
			}
			auth = authorizedDexAction{Signer: tx.Signer, Action: tx.Action, Payload: bytes.Clone(tx.Payload), ClassicAuthorization: event.ClassicAuthorization}
		}
		if replayable {
			mover, used := replayDexNativeMovement(event.NativeFlows, s.TraceLots)
			next, _, err := applyAuthorizedDexBusiness(replay, auth, event.TxHash, event.BlockHeight, event.OccurredAt, false, mover)
			if err != nil {
				return err
			}
			if len(event.NativeFlows) > 0 && !*used || !reflect.DeepEqual(next.dexEvents[len(next.dexEvents)-1], event) {
				return errors.New("DEX ordered business replay differs from complete original event")
			}
			replay = next
		}
	}
	if len(seen) != len(entries) {
		return errors.New("PQ DEX authorization lacks its executed event")
	}
	if replayable && (!equalEmptyOrDeep(replay.dexAssets, s.DexAssets) || !equalEmptyOrDeep(replay.dexBalances, s.DexBalances) || !equalEmptyOrDeep(replay.dexPools, s.DexPools) || !equalEmptyOrDeep(replay.dexEvents, s.DexEvents)) {
		return errors.New("DEX final state differs from complete ordered business replay")
	}
	for owner := range tracked {
		if i, ok := accountIndex(m.Accounts, owner); ok {
			lastNonce[owner] = m.Accounts[i].Nonce
		}
	}
	for _, entry := range s.PQHistory {
		tx := entry.Transaction
		if !tracked[tx.From] {
			continue
		}
		if tx.Nonce <= lastNonce[tx.From] || activeSequence[tx.From] && (lastNonce[tx.From] == math.MaxUint64 || tx.Nonce != lastNonce[tx.From]+1) {
			return errors.New("PQ DEX original nonce sequence changed")
		}
		lastNonce[tx.From] = tx.Nonce
		if isPQDexHistory(tx) {
			activeSequence[tx.From] = true
		}
	}
	for owner, nonce := range lastNonce {
		i, ok := accountIndex(s.Accounts, owner)
		if !ok || s.Accounts[i].Nonce != nonce {
			return errors.New("PQ DEX final nonce does not match complete active history")
		}
	}
	return nil
}
