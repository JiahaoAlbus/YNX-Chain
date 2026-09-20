package consensus

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/big"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abcitypes "github.com/cometbft/cometbft/abci/types"
)

const DexNativeAssetID = "YNXT"

var (
	dexAssetIDPattern = regexp.MustCompile(`^[a-z][a-z0-9-]{2,31}$`)
	dexSymbolPattern  = regexp.MustCompile(`^[A-Z][A-Z0-9]{1,11}$`)
	dexPoolIDPattern  = regexp.MustCompile(`^dex_[a-z0-9][a-z0-9_-]{2,59}$`)
)

type DexAssetCreatePayload struct {
	AssetID       string `json:"assetId"`
	Symbol        string `json:"symbol"`
	Name          string `json:"name"`
	Decimals      uint8  `json:"decimals"`
	MaxSupply     int64  `json:"maxSupply"`
	InitialSupply int64  `json:"initialSupply"`
}

type DexAssetAmountPayload struct {
	AssetID string `json:"assetId"`
	Amount  int64  `json:"amount"`
}

type DexAssetTransferPayload struct {
	AssetID   string `json:"assetId"`
	Recipient string `json:"recipient"`
	Amount    int64  `json:"amount"`
}

type DexPoolCreatePayload struct {
	PoolID string `json:"poolId"`
	Asset0 string `json:"asset0"`
	Asset1 string `json:"asset1"`
	FeeBps uint16 `json:"feeBps"`
}

type DexLiquidityPayload struct {
	PoolID       string `json:"poolId"`
	Amount0      int64  `json:"amount0"`
	Amount1      int64  `json:"amount1"`
	MinShares    int64  `json:"minShares"`
	DeadlineUnix int64  `json:"deadlineUnix"`
}

type DexLiquidityRemovePayload struct {
	PoolID       string `json:"poolId"`
	Shares       int64  `json:"shares"`
	MinAmount0   int64  `json:"minAmount0"`
	MinAmount1   int64  `json:"minAmount1"`
	DeadlineUnix int64  `json:"deadlineUnix"`
}

type DexSwapExactInputPayload struct {
	PoolID       string `json:"poolId"`
	AssetIn      string `json:"assetIn"`
	AmountIn     int64  `json:"amountIn"`
	MinAmountOut int64  `json:"minAmountOut"`
	DeadlineUnix int64  `json:"deadlineUnix"`
}

type DexSwapExactOutputPayload struct {
	PoolID       string `json:"poolId"`
	AssetOut     string `json:"assetOut"`
	AmountOut    int64  `json:"amountOut"`
	MaxAmountIn  int64  `json:"maxAmountIn"`
	DeadlineUnix int64  `json:"deadlineUnix"`
}

type BFTDexAsset struct {
	ID          string    `json:"id"`
	Symbol      string    `json:"symbol"`
	Name        string    `json:"name"`
	Decimals    uint8     `json:"decimals"`
	Issuer      string    `json:"issuer"`
	MaxSupply   int64     `json:"maxSupply"`
	TotalSupply int64     `json:"totalSupply"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
	BlockHeight int64     `json:"blockHeight"`
	TxHash      string    `json:"txHash"`
	AuditHash   string    `json:"auditHash"`
}

type BFTDexBalance struct {
	AssetID string `json:"assetId"`
	Account string `json:"account"`
	Amount  int64  `json:"amount"`
}

type BFTDexShare struct {
	Account string `json:"account"`
	Shares  int64  `json:"shares"`
}

type BFTDexPool struct {
	ID          string           `json:"id"`
	Kind        string           `json:"kind"`
	Asset0      string           `json:"asset0"`
	Asset1      string           `json:"asset1"`
	Reserve0    int64            `json:"reserve0"`
	Reserve1    int64            `json:"reserve1"`
	FeeBps      uint16           `json:"feeBps"`
	TotalShares int64            `json:"totalShares"`
	Shares      []BFTDexShare    `json:"shares"`
	NativeLots0 map[string]int64 `json:"nativeLots0,omitempty"`
	NativeLots1 map[string]int64 `json:"nativeLots1,omitempty"`
	CreatedAt   time.Time        `json:"createdAt"`
	UpdatedAt   time.Time        `json:"updatedAt"`
	BlockHeight int64            `json:"blockHeight"`
	TxHash      string           `json:"txHash"`
	AuditHash   string           `json:"auditHash"`
}

type BFTDexEvent struct {
	ID          string    `json:"id"`
	Type        string    `json:"type"`
	PoolID      string    `json:"poolId,omitempty"`
	Signer      string    `json:"signer"`
	Asset0      string    `json:"asset0,omitempty"`
	Asset1      string    `json:"asset1,omitempty"`
	Amount0     int64     `json:"amount0,omitempty"`
	Amount1     int64     `json:"amount1,omitempty"`
	Shares      int64     `json:"shares,omitempty"`
	BlockHeight int64     `json:"blockHeight"`
	OccurredAt  time.Time `json:"occurredAt"`
	TxHash      string    `json:"txHash"`
	AuditHash   string    `json:"auditHash"`
}

func isDexAction(action string) bool {
	switch action {
	case ActionDexAssetCreate, ActionDexAssetMint, ActionDexAssetTransfer, ActionDexPoolCreate,
		ActionDexLiquidityAdd, ActionDexLiquidityRemove, ActionDexSwapExactInput, ActionDexSwapExactOutput:
		return true
	default:
		return false
	}
}

func normalizeDexAssetID(value string) string {
	value = strings.TrimSpace(value)
	if strings.EqualFold(value, DexNativeAssetID) {
		return DexNativeAssetID
	}
	return strings.ToLower(value)
}

func validDexAssetID(value string) bool {
	return value == DexNativeAssetID || dexAssetIDPattern.MatchString(value)
}

func canonicalDexActionPayload(action string, raw []byte) ([]byte, error) {
	switch action {
	case ActionDexAssetCreate:
		var input DexAssetCreatePayload
		if err := decodeCanonicalPayload(raw, &input); err != nil {
			return nil, err
		}
		input.AssetID, input.Symbol, input.Name = normalizeDexAssetID(input.AssetID), strings.ToUpper(strings.TrimSpace(input.Symbol)), strings.TrimSpace(input.Name)
		if input.AssetID == DexNativeAssetID || !dexAssetIDPattern.MatchString(input.AssetID) || !dexSymbolPattern.MatchString(input.Symbol) || input.Name == "" || len(input.Name) > 80 || input.Decimals > 18 || input.InitialSupply <= 0 || input.MaxSupply < input.InitialSupply {
			return nil, errors.New("invalid DEX Testnet asset create payload")
		}
		return json.Marshal(input)
	case ActionDexAssetMint:
		var input DexAssetAmountPayload
		if err := decodeCanonicalPayload(raw, &input); err != nil {
			return nil, err
		}
		input.AssetID = normalizeDexAssetID(input.AssetID)
		if input.AssetID == DexNativeAssetID || !dexAssetIDPattern.MatchString(input.AssetID) || input.Amount <= 0 {
			return nil, errors.New("invalid DEX asset mint payload")
		}
		return json.Marshal(input)
	case ActionDexAssetTransfer:
		var input DexAssetTransferPayload
		if err := decodeCanonicalPayload(raw, &input); err != nil {
			return nil, err
		}
		input.AssetID, input.Recipient = normalizeDexAssetID(input.AssetID), strings.TrimSpace(input.Recipient)
		if input.AssetID == DexNativeAssetID || !dexAssetIDPattern.MatchString(input.AssetID) || !IsNativeAddress(input.Recipient) || input.Amount <= 0 {
			return nil, errors.New("invalid DEX asset transfer payload")
		}
		return json.Marshal(input)
	case ActionDexPoolCreate:
		var input DexPoolCreatePayload
		if err := decodeCanonicalPayload(raw, &input); err != nil {
			return nil, err
		}
		input.PoolID, input.Asset0, input.Asset1 = strings.ToLower(strings.TrimSpace(input.PoolID)), normalizeDexAssetID(input.Asset0), normalizeDexAssetID(input.Asset1)
		if !dexPoolIDPattern.MatchString(input.PoolID) || !validDexAssetID(input.Asset0) || !validDexAssetID(input.Asset1) || input.Asset0 >= input.Asset1 || input.FeeBps == 0 || input.FeeBps > 1000 {
			return nil, errors.New("invalid DEX pool create payload")
		}
		return json.Marshal(input)
	case ActionDexLiquidityAdd:
		var input DexLiquidityPayload
		if err := decodeCanonicalPayload(raw, &input); err != nil {
			return nil, err
		}
		input.PoolID = strings.ToLower(strings.TrimSpace(input.PoolID))
		if !dexPoolIDPattern.MatchString(input.PoolID) || input.Amount0 <= 0 || input.Amount1 <= 0 || input.MinShares <= 0 || input.DeadlineUnix <= 0 {
			return nil, errors.New("invalid DEX add-liquidity payload")
		}
		return json.Marshal(input)
	case ActionDexLiquidityRemove:
		var input DexLiquidityRemovePayload
		if err := decodeCanonicalPayload(raw, &input); err != nil {
			return nil, err
		}
		input.PoolID = strings.ToLower(strings.TrimSpace(input.PoolID))
		if !dexPoolIDPattern.MatchString(input.PoolID) || input.Shares <= 0 || input.MinAmount0 < 0 || input.MinAmount1 < 0 || input.DeadlineUnix <= 0 {
			return nil, errors.New("invalid DEX remove-liquidity payload")
		}
		return json.Marshal(input)
	case ActionDexSwapExactInput:
		var input DexSwapExactInputPayload
		if err := decodeCanonicalPayload(raw, &input); err != nil {
			return nil, err
		}
		input.PoolID, input.AssetIn = strings.ToLower(strings.TrimSpace(input.PoolID)), normalizeDexAssetID(input.AssetIn)
		if !dexPoolIDPattern.MatchString(input.PoolID) || !validDexAssetID(input.AssetIn) || input.AmountIn <= 0 || input.MinAmountOut <= 0 || input.DeadlineUnix <= 0 {
			return nil, errors.New("invalid DEX exact-input payload")
		}
		return json.Marshal(input)
	case ActionDexSwapExactOutput:
		var input DexSwapExactOutputPayload
		if err := decodeCanonicalPayload(raw, &input); err != nil {
			return nil, err
		}
		input.PoolID, input.AssetOut = strings.ToLower(strings.TrimSpace(input.PoolID)), normalizeDexAssetID(input.AssetOut)
		if !dexPoolIDPattern.MatchString(input.PoolID) || !validDexAssetID(input.AssetOut) || input.AmountOut <= 0 || input.MaxAmountIn <= 0 || input.DeadlineUnix <= 0 {
			return nil, errors.New("invalid DEX exact-output payload")
		}
		return json.Marshal(input)
	default:
		return nil, fmt.Errorf("unsupported DEX action %q", action)
	}
}

func (a *Application) applyDexAction(state executionState, payload []byte, tx SignedApplicationAction, height int64, blockTime time.Time, validationOnly bool) (executionState, transactionExecution, error) {
	if err := a.chargeApplicationAction(&state, tx); err != nil {
		return executionState{}, transactionExecution{}, err
	}
	txHash := ApplicationActionHash(payload)
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
		pool := BFTDexPool{ID: input.PoolID, Kind: "ynx-cpmm-v1", Asset0: input.Asset0, Asset1: input.Asset1, FeeBps: input.FeeBps, Shares: []BFTDexShare{}, NativeLots0: map[string]int64{}, NativeLots1: map[string]int64{}, CreatedAt: blockTime, UpdatedAt: blockTime, BlockHeight: height, TxHash: txHash}
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
		if err := debitDexAssetToPool(&state, &pool, true, tx.Signer, input.Amount0); err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, err)
		}
		if err := debitDexAssetToPool(&state, &pool, false, tx.Signer, input.Amount1); err != nil {
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
		if err := creditDexAssetFromPool(&state, &pool, true, tx.Signer, amount0); err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, err)
		}
		if err := creditDexAssetFromPool(&state, &pool, false, tx.Signer, amount1); err != nil {
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
		if err := debitDexAssetToPool(&state, &pool, inIs0, tx.Signer, input.AmountIn); err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, err)
		}
		if err := creditDexAssetFromPool(&state, &pool, !inIs0, tx.Signer, amountOut); err != nil {
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
		if err := debitDexAssetToPool(&state, &pool, !outIs0, tx.Signer, amountIn); err != nil {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInsufficientYNXT, err)
		}
		if err := creditDexAssetFromPool(&state, &pool, outIs0, tx.Signer, input.AmountOut); err != nil {
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
	event.AuditHash = dexEventAuditHash(event)
	state.dexEvents = append(state.dexEvents, event)
	return state, transactionExecution{typeName: tx.Action, hash: txHash, event: abcitypes.Event{Type: "ynx.dex", Attributes: []abcitypes.EventAttribute{{Key: "action", Value: tx.Action, Index: true}, {Key: "pool_id", Value: event.PoolID, Index: true}, {Key: "signer", Value: tx.Signer, Index: true}}}}, nil
}

func requireDexDeadline(deadline int64, at time.Time, validationOnly bool) error {
	if !validationOnly && at.Unix() > deadline {
		return errors.New("DEX action deadline expired")
	}
	return nil
}
func dexAssetExists(values []BFTDexAsset, id string) bool {
	if id == DexNativeAssetID {
		return true
	}
	_, ok := dexAssetIndex(values, id)
	return ok
}
func dexAssetIndex(values []BFTDexAsset, id string) (int, bool) {
	index := sort.Search(len(values), func(i int) bool { return values[i].ID >= id })
	return index, index < len(values) && values[index].ID == id
}
func dexAssetBySymbol(values []BFTDexAsset, symbol string) (int, bool) {
	for i := range values {
		if values[i].Symbol == symbol {
			return i, true
		}
	}
	return 0, false
}
func insertDexAsset(values []BFTDexAsset, value BFTDexAsset) []BFTDexAsset {
	index, _ := dexAssetIndex(values, value.ID)
	values = append(values, BFTDexAsset{})
	copy(values[index+1:], values[index:])
	values[index] = value
	return values
}
func dexBalanceKey(asset, account string) string { return asset + "\x00" + account }
func dexBalanceIndex(values []BFTDexBalance, asset, account string) (int, bool) {
	key := dexBalanceKey(asset, account)
	index := sort.Search(len(values), func(i int) bool { return dexBalanceKey(values[i].AssetID, values[i].Account) >= key })
	return index, index < len(values) && dexBalanceKey(values[index].AssetID, values[index].Account) == key
}
func dexBalanceAmount(values []BFTDexBalance, asset, account string) int64 {
	if index, ok := dexBalanceIndex(values, asset, account); ok {
		return values[index].Amount
	}
	return 0
}
func setDexBalance(values []BFTDexBalance, asset, account string, amount int64) []BFTDexBalance {
	index, ok := dexBalanceIndex(values, asset, account)
	if ok {
		values[index].Amount = amount
		return values
	}
	values = append(values, BFTDexBalance{})
	copy(values[index+1:], values[index:])
	values[index] = BFTDexBalance{AssetID: asset, Account: account, Amount: amount}
	return values
}
func moveDexBalance(state *executionState, asset, from, to string, amount int64) error {
	fromAmount := dexBalanceAmount(state.dexBalances, asset, from)
	toAmount := dexBalanceAmount(state.dexBalances, asset, to)
	if fromAmount < amount {
		return errors.New("insufficient DEX asset balance")
	}
	if toAmount > math.MaxInt64-amount {
		return errors.New("DEX asset balance overflow")
	}
	state.dexBalances = setDexBalance(state.dexBalances, asset, from, fromAmount-amount)
	state.dexBalances = setDexBalance(state.dexBalances, asset, to, toAmount+amount)
	return nil
}
func dexPoolIndex(values []BFTDexPool, id string) (int, bool) {
	index := sort.Search(len(values), func(i int) bool { return values[i].ID >= id })
	return index, index < len(values) && values[index].ID == id
}
func insertDexPool(values []BFTDexPool, value BFTDexPool) []BFTDexPool {
	index, _ := dexPoolIndex(values, value.ID)
	values = append(values, BFTDexPool{})
	copy(values[index+1:], values[index:])
	values[index] = value
	return values
}
func dexShareIndex(values []BFTDexShare, account string) (int, bool) {
	index := sort.Search(len(values), func(i int) bool { return values[i].Account >= account })
	return index, index < len(values) && values[index].Account == account
}
func dexShareAmount(values []BFTDexShare, account string) int64 {
	if index, ok := dexShareIndex(values, account); ok {
		return values[index].Shares
	}
	return 0
}
func addDexShares(values []BFTDexShare, account string, delta int64) []BFTDexShare {
	index, ok := dexShareIndex(values, account)
	if ok {
		values[index].Shares += delta
		return values
	}
	values = append(values, BFTDexShare{})
	copy(values[index+1:], values[index:])
	values[index] = BFTDexShare{Account: account, Shares: delta}
	return values
}
func updateDexPool(pool *BFTDexPool, height int64, at time.Time, txHash string) {
	pool.UpdatedAt, pool.BlockHeight, pool.TxHash = at, height, txHash
	pool.AuditHash = dexPoolAuditHash(*pool)
}
func dexPoolDirection(pool BFTDexPool, asset string) (bool, error) {
	if asset == pool.Asset0 {
		return true, nil
	}
	if asset == pool.Asset1 {
		return false, nil
	}
	return false, errors.New("asset is not in DEX pool")
}
func dexReserves(pool BFTDexPool, first bool) (int64, int64) {
	if first {
		return pool.Reserve0, pool.Reserve1
	}
	return pool.Reserve1, pool.Reserve0
}
func dexOtherAsset(pool BFTDexPool, asset string) string {
	if asset == pool.Asset0 {
		return pool.Asset1
	}
	return pool.Asset0
}

func dexLiquidityShares(pool BFTDexPool, amount0, amount1 int64) (int64, error) {
	if pool.TotalShares == 0 {
		product := new(big.Int).Mul(big.NewInt(amount0), big.NewInt(amount1))
		root := new(big.Int).Sqrt(product)
		if !root.IsInt64() || root.Int64() <= 0 {
			return 0, errors.New("invalid initial DEX liquidity")
		}
		return root.Int64(), nil
	}
	left := new(big.Int).Mul(big.NewInt(amount0), big.NewInt(pool.Reserve1))
	right := new(big.Int).Mul(big.NewInt(amount1), big.NewInt(pool.Reserve0))
	if left.Cmp(right) != 0 {
		return 0, errors.New("DEX liquidity must match the current reserve ratio exactly")
	}
	return mulDivFloor(amount0, pool.TotalShares, pool.Reserve0)
}
func mulDivFloor(a, b, denominator int64) (int64, error) {
	if a < 0 || b < 0 || denominator <= 0 {
		return 0, errors.New("invalid DEX arithmetic operands")
	}
	value := new(big.Int).Quo(new(big.Int).Mul(big.NewInt(a), big.NewInt(b)), big.NewInt(denominator))
	if !value.IsInt64() {
		return 0, errors.New("DEX arithmetic overflow")
	}
	return value.Int64(), nil
}
func mulDivCeil(a, b, denominator int64) (int64, error) {
	if a <= 0 || b <= 0 || denominator <= 0 {
		return 0, errors.New("invalid DEX arithmetic operands")
	}
	numerator := new(big.Int).Mul(big.NewInt(a), big.NewInt(b))
	numerator.Add(numerator, big.NewInt(denominator-1))
	value := numerator.Quo(numerator, big.NewInt(denominator))
	if !value.IsInt64() {
		return 0, errors.New("DEX arithmetic overflow")
	}
	return value.Int64(), nil
}
func dexExactInputQuote(reserveIn, reserveOut, amountIn int64, feeBps uint16) (int64, error) {
	if reserveIn <= 0 || reserveOut <= 0 || amountIn <= 0 {
		return 0, errors.New("DEX pool has no executable liquidity")
	}
	effective, err := mulDivFloor(amountIn, int64(10000-feeBps), 10000)
	if err != nil || effective <= 0 {
		return 0, errors.New("DEX input is too small after fee")
	}
	if reserveIn > math.MaxInt64-effective {
		return 0, errors.New("DEX reserve overflow")
	}
	return mulDivFloor(reserveOut, effective, reserveIn+effective)
}
func dexExactOutputQuote(reserveIn, reserveOut, amountOut int64, feeBps uint16) (int64, error) {
	if reserveIn <= 0 || reserveOut <= amountOut || amountOut <= 0 {
		return 0, errors.New("DEX output exceeds pool liquidity")
	}
	effective, err := mulDivCeil(reserveIn, amountOut, reserveOut-amountOut)
	if err != nil {
		return 0, err
	}
	return mulDivCeil(effective, 10000, int64(10000-feeBps))
}

func debitDexAssetToPool(state *executionState, pool *BFTDexPool, asset0 bool, account string, amount int64) error {
	asset := pool.Asset1
	lots := &pool.NativeLots1
	if asset0 {
		asset, lots = pool.Asset0, &pool.NativeLots0
	}
	if asset != DexNativeAssetID {
		current := dexBalanceAmount(state.dexBalances, asset, account)
		if current < amount {
			return errors.New("insufficient DEX asset balance")
		}
		state.dexBalances = setDexBalance(state.dexBalances, asset, account, current-amount)
		return nil
	}
	index, ok := accountIndex(state.accounts, account)
	if !ok || state.accounts[index].Balance < amount {
		return errors.New("insufficient YNXT balance for DEX action")
	}
	if *lots == nil {
		*lots = map[string]int64{}
	}
	if err := moveAccountLotsToDexPool(&state.accounts[index], *lots, amount); err != nil {
		return err
	}
	state.accounts[index].Balance -= amount
	return nil
}
func creditDexAssetFromPool(state *executionState, pool *BFTDexPool, asset0 bool, account string, amount int64) error {
	asset := pool.Asset1
	lots := &pool.NativeLots1
	if asset0 {
		asset, lots = pool.Asset0, &pool.NativeLots0
	}
	if asset != DexNativeAssetID {
		current := dexBalanceAmount(state.dexBalances, asset, account)
		if current > math.MaxInt64-amount {
			return errors.New("DEX asset balance overflow")
		}
		state.dexBalances = setDexBalance(state.dexBalances, asset, account, current+amount)
		return nil
	}
	state.accounts, _ = ensureAccount(state.accounts, account)
	index, _ := accountIndex(state.accounts, account)
	if state.accounts[index].Balance > math.MaxInt64-amount {
		return errors.New("YNXT balance overflow")
	}
	if err := moveDexPoolLotsToAccount(*lots, &state.accounts[index], amount); err != nil {
		return err
	}
	state.accounts[index].Balance += amount
	return nil
}
func moveAccountLotsToDexPool(account *chain.ConsensusAccount, poolLots map[string]int64, amount int64) error {
	remaining := amount
	keys := sortedLotKeys(account.Lots)
	for _, key := range keys {
		if remaining == 0 {
			break
		}
		available := account.Lots[key]
		if available <= 0 {
			continue
		}
		moved := available
		if moved > remaining {
			moved = remaining
		}
		account.Lots[key] -= moved
		poolLots[key] += moved
		remaining -= moved
	}
	if remaining != 0 {
		return errors.New("insufficient traceable YNXT lots for DEX action")
	}
	return nil
}
func moveDexPoolLotsToAccount(poolLots map[string]int64, account *chain.ConsensusAccount, amount int64) error {
	remaining := amount
	keys := sortedLotKeys(poolLots)
	if account.Lots == nil {
		account.Lots = map[string]int64{}
	}
	for _, key := range keys {
		if remaining == 0 {
			break
		}
		available := poolLots[key]
		if available <= 0 {
			continue
		}
		moved := available
		if moved > remaining {
			moved = remaining
		}
		poolLots[key] -= moved
		account.Lots[key] += moved
		remaining -= moved
	}
	if remaining != 0 {
		return errors.New("DEX pool traceable YNXT lots do not cover output")
	}
	return nil
}
func sortedLotKeys(values map[string]int64) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func dexAssetAuditHash(value BFTDexAsset) string {
	value.AuditHash = ""
	return recordAuditHash("YNX_DEX_ASSET_V1", value)
}
func dexPoolAuditHash(value BFTDexPool) string {
	value.AuditHash = ""
	return recordAuditHash("YNX_DEX_POOL_V1", value)
}
func dexEventAuditHash(value BFTDexEvent) string {
	value.AuditHash = ""
	return recordAuditHash("YNX_DEX_EVENT_V1", value)
}

func cloneDexPools(values []BFTDexPool) []BFTDexPool {
	if values == nil {
		return nil
	}
	out := make([]BFTDexPool, len(values))
	copy(out, values)
	for i := range out {
		if values[i].Shares != nil {
			out[i].Shares = append([]BFTDexShare{}, values[i].Shares...)
		}
		out[i].NativeLots0 = cloneInt64Map(values[i].NativeLots0)
		out[i].NativeLots1 = cloneInt64Map(values[i].NativeLots1)
	}
	return out
}
func cloneInt64Map(values map[string]int64) map[string]int64 {
	if values == nil {
		return nil
	}
	out := make(map[string]int64, len(values))
	for key, value := range values {
		out[key] = value
	}
	return out
}

func validateDexState(assets []BFTDexAsset, balances []BFTDexBalance, pools []BFTDexPool, events []BFTDexEvent) (int64, error) {
	assetTotals := map[string]int64{}
	previous := ""
	symbols := map[string]struct{}{}
	for _, asset := range assets {
		if previous != "" && asset.ID <= previous {
			return 0, errors.New("DEX assets must be sorted by unique ID")
		}
		previous = asset.ID
		if asset.ID == DexNativeAssetID || !dexAssetIDPattern.MatchString(asset.ID) || !dexSymbolPattern.MatchString(asset.Symbol) || asset.Name == "" || !IsNativeAddress(asset.Issuer) || asset.MaxSupply <= 0 || asset.TotalSupply <= 0 || asset.TotalSupply > asset.MaxSupply || asset.CreatedAt.IsZero() || asset.UpdatedAt.Before(asset.CreatedAt) || asset.BlockHeight <= 0 || asset.TxHash == "" || asset.AuditHash != dexAssetAuditHash(asset) {
			return 0, errors.New("committed DEX asset is invalid")
		}
		if _, ok := symbols[asset.Symbol]; ok {
			return 0, errors.New("DEX asset symbols must be unique")
		}
		symbols[asset.Symbol] = struct{}{}
	}
	previous = ""
	for _, balance := range balances {
		key := dexBalanceKey(balance.AssetID, balance.Account)
		if previous != "" && key <= previous {
			return 0, errors.New("DEX balances must be sorted and unique")
		}
		previous = key
		if balance.AssetID == DexNativeAssetID || !IsNativeAddress(balance.Account) || balance.Amount < 0 || !dexAssetExists(assets, balance.AssetID) {
			return 0, errors.New("committed DEX balance is invalid")
		}
		if assetTotals[balance.AssetID] > math.MaxInt64-balance.Amount {
			return 0, errors.New("DEX asset reconciliation overflow")
		}
		assetTotals[balance.AssetID] += balance.Amount
	}
	var nativeEscrow int64
	previous = ""
	for _, pool := range pools {
		if previous != "" && pool.ID <= previous {
			return 0, errors.New("DEX pools must be sorted by unique ID")
		}
		previous = pool.ID
		if !dexPoolIDPattern.MatchString(pool.ID) || pool.Kind != "ynx-cpmm-v1" || pool.Asset0 >= pool.Asset1 || !dexAssetExists(assets, pool.Asset0) || !dexAssetExists(assets, pool.Asset1) || pool.FeeBps == 0 || pool.FeeBps > 1000 || pool.Reserve0 < 0 || pool.Reserve1 < 0 || pool.TotalShares < 0 || pool.CreatedAt.IsZero() || pool.UpdatedAt.Before(pool.CreatedAt) || pool.BlockHeight <= 0 || pool.TxHash == "" || pool.AuditHash != dexPoolAuditHash(pool) {
			return 0, errors.New("committed DEX pool is invalid")
		}
		if (pool.TotalShares == 0) != (pool.Reserve0 == 0 && pool.Reserve1 == 0) {
			return 0, errors.New("empty DEX pool reserves and shares must reconcile")
		}
		var shares int64
		sharePrevious := ""
		for _, value := range pool.Shares {
			if sharePrevious != "" && value.Account <= sharePrevious {
				return 0, errors.New("DEX LP shares must be sorted and unique")
			}
			sharePrevious = value.Account
			if !IsNativeAddress(value.Account) || value.Shares < 0 || shares > math.MaxInt64-value.Shares {
				return 0, errors.New("committed DEX LP share is invalid")
			}
			shares += value.Shares
		}
		if shares != pool.TotalShares {
			return 0, errors.New("DEX LP shares do not reconcile")
		}
		for side, asset := range []string{pool.Asset0, pool.Asset1} {
			reserve := pool.Reserve0
			lots := pool.NativeLots0
			if side == 1 {
				reserve, lots = pool.Reserve1, pool.NativeLots1
			}
			var lotTotal int64
			for _, value := range lots {
				if value < 0 || lotTotal > math.MaxInt64-value {
					return 0, errors.New("DEX native lot escrow is invalid")
				}
				lotTotal += value
			}
			if asset == DexNativeAssetID {
				if lotTotal != reserve || nativeEscrow > math.MaxInt64-reserve {
					return 0, errors.New("DEX native reserve does not reconcile to traceable lots")
				}
				nativeEscrow += reserve
			} else {
				if lotTotal != 0 || assetTotals[asset] > math.MaxInt64-reserve {
					return 0, errors.New("DEX non-native reserve is invalid")
				}
				assetTotals[asset] += reserve
			}
		}
	}
	for _, asset := range assets {
		if assetTotals[asset.ID] != asset.TotalSupply {
			return 0, fmt.Errorf("DEX asset %s supply does not reconcile", asset.ID)
		}
	}
	seen := map[string]struct{}{}
	for _, event := range events {
		if event.ID == "" || !isDexAction(event.Type) || !IsNativeAddress(event.Signer) || event.BlockHeight <= 0 || event.OccurredAt.IsZero() || event.TxHash == "" || event.AuditHash != dexEventAuditHash(event) {
			return 0, errors.New("committed DEX event is invalid")
		}
		if _, ok := seen[event.ID]; ok {
			return 0, errors.New("DEX event IDs must be unique")
		}
		seen[event.ID] = struct{}{}
	}
	return nativeEscrow, nil
}
