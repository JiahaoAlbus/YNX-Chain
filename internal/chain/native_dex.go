package chain

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

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

// The authoritative Testnet still runs the rollback-compatible Devnet state
// machine. These records make the already-reviewed consensus-native CPMM
// available on that state machine without introducing a custodial sidecar.
// They are deliberately versioned so a later CometBFT cutover can migrate the
// exact balances, reserves, LP shares, provenance lots and audit history.
const (
	NativeDexSchemaVersion         = 1
	NativeDexAssetID               = "YNXT"
	NativeDexActionAssetCreate     = "dex_asset_create"
	NativeDexActionAssetMint       = "dex_asset_mint"
	NativeDexActionAssetTransfer   = "dex_asset_transfer"
	NativeDexActionPoolCreate      = "dex_pool_create"
	NativeDexActionLiquidityAdd    = "dex_liquidity_add"
	NativeDexActionLiquidityRemove = "dex_liquidity_remove"
	NativeDexActionSwapExactInput  = "dex_swap_exact_input"
	NativeDexActionSwapExactOutput = "dex_swap_exact_output"
)

var (
	nativeDexAssetPattern  = regexp.MustCompile(`^[a-z][a-z0-9-]{2,31}$`)
	nativeDexSymbolPattern = regexp.MustCompile(`^[A-Z][A-Z0-9]{1,11}$`)
	nativeDexPoolPattern   = regexp.MustCompile(`^dex_[a-z0-9][a-z0-9_-]{2,59}$`)
)

type NativeDexAsset struct {
	SchemaVersion int       `json:"schemaVersion"`
	ID            string    `json:"id"`
	Symbol        string    `json:"symbol"`
	Name          string    `json:"name"`
	Decimals      uint8     `json:"decimals"`
	Issuer        string    `json:"issuer"`
	MaxSupply     int64     `json:"maxSupply"`
	TotalSupply   int64     `json:"totalSupply"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
	TxHash        string    `json:"transactionHash"`
	BlockHeight   uint64    `json:"blockHeight,omitempty"`
	BlockHash     string    `json:"blockHash,omitempty"`
	AuditHash     string    `json:"auditHash"`
}

type NativeDexPool struct {
	SchemaVersion int              `json:"schemaVersion"`
	ID            string           `json:"id"`
	Kind          string           `json:"kind"`
	Asset0        string           `json:"asset0"`
	Asset1        string           `json:"asset1"`
	Reserve0      int64            `json:"reserve0"`
	Reserve1      int64            `json:"reserve1"`
	FeeBps        uint16           `json:"feeBps"`
	TotalShares   int64            `json:"totalShares"`
	Shares        map[string]int64 `json:"shares"`
	NativeLots0   map[string]int64 `json:"nativeLots0,omitempty"`
	NativeLots1   map[string]int64 `json:"nativeLots1,omitempty"`
	CreatedAt     time.Time        `json:"createdAt"`
	UpdatedAt     time.Time        `json:"updatedAt"`
	TxHash        string           `json:"transactionHash"`
	BlockHeight   uint64           `json:"blockHeight,omitempty"`
	BlockHash     string           `json:"blockHash,omitempty"`
	AuditHash     string           `json:"auditHash"`
}

type NativeDexEvent struct {
	SchemaVersion int       `json:"schemaVersion"`
	ID            string    `json:"id"`
	Type          string    `json:"type"`
	PoolID        string    `json:"poolId,omitempty"`
	Signer        string    `json:"signer"`
	Asset0        string    `json:"asset0,omitempty"`
	Asset1        string    `json:"asset1,omitempty"`
	Amount0       int64     `json:"amount0,omitempty"`
	Amount1       int64     `json:"amount1,omitempty"`
	Shares        int64     `json:"shares,omitempty"`
	OccurredAt    time.Time `json:"occurredAt"`
	TxHash        string    `json:"transactionHash"`
	BlockHeight   uint64    `json:"blockHeight,omitempty"`
	BlockHash     string    `json:"blockHash,omitempty"`
	AuditHash     string    `json:"auditHash"`
}

type NativeDexBalance struct {
	AssetID string `json:"assetId"`
	Account string `json:"account"`
	Amount  int64  `json:"amount"`
}
type NativeDexMutation struct {
	Asset *NativeDexAsset `json:"asset,omitempty"`
	Pool  *NativeDexPool  `json:"pool,omitempty"`
	Event NativeDexEvent  `json:"event"`
}
type NativeDexSignedActionInput struct {
	Hash, Signer, Action string
	Nonce                uint64
	Fee                  int64
	Payload              json.RawMessage
}

type NativeDexAssetCreatePayload struct {
	AssetID       string `json:"assetId"`
	Symbol        string `json:"symbol"`
	Name          string `json:"name"`
	Decimals      uint8  `json:"decimals"`
	MaxSupply     int64  `json:"maxSupply"`
	InitialSupply int64  `json:"initialSupply"`
}
type NativeDexAssetAmountPayload struct {
	AssetID string `json:"assetId"`
	Amount  int64  `json:"amount"`
}
type NativeDexAssetTransferPayload struct {
	AssetID   string `json:"assetId"`
	Recipient string `json:"recipient"`
	Amount    int64  `json:"amount"`
}
type NativeDexPoolCreatePayload struct {
	PoolID string `json:"poolId"`
	Asset0 string `json:"asset0"`
	Asset1 string `json:"asset1"`
	FeeBps uint16 `json:"feeBps"`
}
type NativeDexLiquidityPayload struct {
	PoolID       string `json:"poolId"`
	Amount0      int64  `json:"amount0"`
	Amount1      int64  `json:"amount1"`
	MinShares    int64  `json:"minShares"`
	DeadlineUnix int64  `json:"deadlineUnix"`
}
type NativeDexLiquidityRemovePayload struct {
	PoolID       string `json:"poolId"`
	Shares       int64  `json:"shares"`
	MinAmount0   int64  `json:"minAmount0"`
	MinAmount1   int64  `json:"minAmount1"`
	DeadlineUnix int64  `json:"deadlineUnix"`
}
type NativeDexSwapExactInputPayload struct {
	PoolID       string `json:"poolId"`
	AssetIn      string `json:"assetIn"`
	AmountIn     int64  `json:"amountIn"`
	MinAmountOut int64  `json:"minAmountOut"`
	DeadlineUnix int64  `json:"deadlineUnix"`
}
type NativeDexSwapExactOutputPayload struct {
	PoolID       string `json:"poolId"`
	AssetOut     string `json:"assetOut"`
	AmountOut    int64  `json:"amountOut"`
	MaxAmountIn  int64  `json:"maxAmountIn"`
	DeadlineUnix int64  `json:"deadlineUnix"`
}

func (d *Devnet) NativeDexAssets() []NativeDexAsset {
	d.mu.RLock()
	defer d.mu.RUnlock()
	values := make([]NativeDexAsset, 0, len(d.dexAssets))
	for _, value := range d.dexAssets {
		values = append(values, value)
	}
	sort.Slice(values, func(i, j int) bool { return values[i].ID < values[j].ID })
	return values
}
func (d *Devnet) NativeDexAsset(id string) (NativeDexAsset, bool) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	value, ok := d.dexAssets[normalizeNativeDexAsset(id)]
	return value, ok
}
func (d *Devnet) NativeDexPools() []NativeDexPool {
	d.mu.RLock()
	defer d.mu.RUnlock()
	values := make([]NativeDexPool, 0, len(d.dexPools))
	for _, value := range d.dexPools {
		values = append(values, cloneNativeDexPool(value))
	}
	sort.Slice(values, func(i, j int) bool { return values[i].ID < values[j].ID })
	return values
}
func (d *Devnet) NativeDexPool(id string) (NativeDexPool, bool) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	value, ok := d.dexPools[strings.ToLower(strings.TrimSpace(id))]
	return cloneNativeDexPool(value), ok
}
func (d *Devnet) NativeDexBalances(account string) []NativeDexBalance {
	d.mu.RLock()
	defer d.mu.RUnlock()
	result := []NativeDexBalance{}
	for asset, balances := range d.dexBalances {
		if amount := balances[account]; amount != 0 {
			result = append(result, NativeDexBalance{asset, account, amount})
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].AssetID < result[j].AssetID })
	return result
}
func (d *Devnet) NativeDexEvents() []NativeDexEvent {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return append([]NativeDexEvent{}, d.dexEvents...)
}

func (d *Devnet) SubmitNativeDexAction(input NativeDexSignedActionInput) (resultTx Transaction, resultMutation NativeDexMutation, replayed bool, err error) {
	if !transactionHashPattern.MatchString(input.Hash) || input.Hash != strings.ToLower(input.Hash) {
		return Transaction{}, NativeDexMutation{}, false, errors.New("DEX action hash must be canonical lowercase 32-byte hex")
	}
	if !accountaddress.IsCanonical(input.Signer) || input.Nonce == 0 || input.Fee != 1 {
		return Transaction{}, NativeDexMutation{}, false, errors.New("DEX action requires a canonical signer, positive nonce, and 1 YNXT fee")
	}
	d.mu.Lock()
	shouldPersist := false
	defer func() {
		d.mu.Unlock()
		if !shouldPersist {
			return
		}
		persistErr := d.persistSnapshot()
		d.mu.Lock()
		d.recordPersistenceErrorLocked(persistErr)
		d.mu.Unlock()
		if err == nil {
			err = persistErr
		}
	}()
	if existing, ok := d.transactionLocked(input.Hash); ok {
		for _, event := range d.dexEvents {
			if event.TxHash == input.Hash {
				return existing, NativeDexMutation{Event: event}, true, nil
			}
		}
		return Transaction{}, NativeDexMutation{}, false, errors.New("DEX action hash conflicts with a non-DEX transaction")
	}
	signer, ok := d.accounts[input.Signer]
	if !ok {
		return Transaction{}, NativeDexMutation{}, false, errors.New("DEX signer account does not exist")
	}
	if signer.Nonce == math.MaxUint64 || input.Nonce != signer.Nonce+1 {
		return Transaction{}, NativeDexMutation{}, false, fmt.Errorf("DEX action nonce %d must equal next account nonce %d", input.Nonce, signer.Nonce+1)
	}
	if signer.Balance < input.Fee || signer.ResourceUsage.BandwidthUsed == math.MaxInt64 {
		return Transaction{}, NativeDexMutation{}, false, errors.New("insufficient YNXT or bandwidth for DEX action fee")
	}
	traceable := int64(0)
	for _, amount := range signer.Lots {
		if amount > 0 {
			traceable += amount
		}
	}
	if traceable < input.Fee {
		return Transaction{}, NativeDexMutation{}, false, errors.New("insufficient traceable YNXT lots for DEX action fee")
	}
	now := time.Now().UTC()
	event := NativeDexEvent{SchemaVersion: NativeDexSchemaVersion, ID: hashParts("native-dex-event", input.Hash)[:24], Type: input.Action, Signer: input.Signer, OccurredAt: now, TxHash: input.Hash}
	mutation, err := d.applyNativeDexActionLocked(input, event, now)
	if err != nil {
		return Transaction{}, NativeDexMutation{}, false, err
	}
	feeRecipient := d.account(d.nextValidatorAddressLocked())
	flows, err := d.moveLotsLocked(signer, feeRecipient, input.Fee)
	if err != nil {
		return Transaction{}, NativeDexMutation{}, false, err
	}
	signer.Balance -= input.Fee
	signer.Nonce = input.Nonce
	signer.ResourceUsage.BandwidthUsed++
	feeRecipient.Balance += input.Fee
	mutation.Event.AuditHash = nativeDexEventAuditHash(mutation.Event)
	d.dexEvents = append(d.dexEvents, mutation.Event)
	to := mutation.Event.PoolID
	if to == "" {
		to = mutation.Event.Asset0
	}
	tx := Transaction{Hash: input.Hash, Type: input.Action, From: input.Signer, To: to, Fee: input.Fee, Nonce: input.Nonce, Timestamp: now, LotFlows: flows, Memo: "signed chain-native DEX action"}
	d.pending = append(d.pending, tx)
	shouldPersist = true
	return tx, mutation, false, nil
}

func (d *Devnet) applyNativeDexActionLocked(input NativeDexSignedActionInput, event NativeDexEvent, now time.Time) (NativeDexMutation, error) {
	switch input.Action {
	case NativeDexActionAssetCreate:
		var p NativeDexAssetCreatePayload
		if err := decodeNativeDexPayload(input.Payload, &p); err != nil {
			return NativeDexMutation{}, err
		}
		p.AssetID, p.Symbol, p.Name = normalizeNativeDexAsset(p.AssetID), strings.ToUpper(strings.TrimSpace(p.Symbol)), strings.TrimSpace(p.Name)
		if p.AssetID == NativeDexAssetID || !nativeDexAssetPattern.MatchString(p.AssetID) || !nativeDexSymbolPattern.MatchString(p.Symbol) || p.Name == "" || len(p.Name) > 80 || p.Decimals > 18 || p.InitialSupply <= 0 || p.MaxSupply < p.InitialSupply {
			return NativeDexMutation{}, errors.New("invalid DEX Testnet asset create payload")
		}
		if _, ok := d.dexAssets[p.AssetID]; ok {
			return NativeDexMutation{}, errors.New("DEX asset already exists")
		}
		for _, a := range d.dexAssets {
			if a.Symbol == p.Symbol {
				return NativeDexMutation{}, errors.New("DEX asset symbol already exists")
			}
		}
		a := NativeDexAsset{SchemaVersion: NativeDexSchemaVersion, ID: p.AssetID, Symbol: p.Symbol, Name: p.Name, Decimals: p.Decimals, Issuer: input.Signer, MaxSupply: p.MaxSupply, TotalSupply: p.InitialSupply, CreatedAt: now, UpdatedAt: now, TxHash: input.Hash}
		a.AuditHash = nativeDexAssetAuditHash(a)
		d.dexAssets[a.ID] = a
		d.setNativeDexBalance(a.ID, input.Signer, p.InitialSupply)
		event.Asset0, event.Amount0 = a.ID, p.InitialSupply
		return NativeDexMutation{Asset: &a, Event: event}, nil
	case NativeDexActionAssetMint:
		var p NativeDexAssetAmountPayload
		if err := decodeNativeDexPayload(input.Payload, &p); err != nil {
			return NativeDexMutation{}, err
		}
		p.AssetID = normalizeNativeDexAsset(p.AssetID)
		a, ok := d.dexAssets[p.AssetID]
		if !ok || p.Amount <= 0 || a.Issuer != input.Signer || a.TotalSupply > math.MaxInt64-p.Amount || a.TotalSupply+p.Amount > a.MaxSupply {
			return NativeDexMutation{}, errors.New("invalid or unauthorized DEX mint")
		}
		current := d.nativeDexBalance(a.ID, input.Signer)
		if current > math.MaxInt64-p.Amount {
			return NativeDexMutation{}, errors.New("DEX balance overflow")
		}
		a.TotalSupply += p.Amount
		a.UpdatedAt = now
		a.TxHash = input.Hash
		a.AuditHash = nativeDexAssetAuditHash(a)
		d.dexAssets[a.ID] = a
		d.setNativeDexBalance(a.ID, input.Signer, current+p.Amount)
		event.Asset0, event.Amount0 = a.ID, p.Amount
		return NativeDexMutation{Asset: &a, Event: event}, nil
	case NativeDexActionAssetTransfer:
		var p NativeDexAssetTransferPayload
		if err := decodeNativeDexPayload(input.Payload, &p); err != nil {
			return NativeDexMutation{}, err
		}
		p.AssetID = normalizeNativeDexAsset(p.AssetID)
		p.Recipient = strings.TrimSpace(p.Recipient)
		if _, ok := d.dexAssets[p.AssetID]; !ok || p.Amount <= 0 || !accountaddress.IsCanonical(p.Recipient) {
			return NativeDexMutation{}, errors.New("invalid DEX asset transfer")
		}
		if err := d.moveNativeDexBalance(p.AssetID, input.Signer, p.Recipient, p.Amount); err != nil {
			return NativeDexMutation{}, err
		}
		event.Asset0, event.Amount0 = p.AssetID, p.Amount
		return NativeDexMutation{Event: event}, nil
	case NativeDexActionPoolCreate:
		var p NativeDexPoolCreatePayload
		if err := decodeNativeDexPayload(input.Payload, &p); err != nil {
			return NativeDexMutation{}, err
		}
		p.PoolID = strings.ToLower(strings.TrimSpace(p.PoolID))
		p.Asset0, p.Asset1 = normalizeNativeDexAsset(p.Asset0), normalizeNativeDexAsset(p.Asset1)
		if !nativeDexPoolPattern.MatchString(p.PoolID) || !d.nativeDexAssetExists(p.Asset0) || !d.nativeDexAssetExists(p.Asset1) || p.Asset0 >= p.Asset1 || p.FeeBps == 0 || p.FeeBps > 1000 {
			return NativeDexMutation{}, errors.New("invalid DEX pool create payload")
		}
		if _, ok := d.dexPools[p.PoolID]; ok {
			return NativeDexMutation{}, errors.New("DEX pool already exists")
		}
		for _, pool := range d.dexPools {
			if pool.Asset0 == p.Asset0 && pool.Asset1 == p.Asset1 && pool.FeeBps == p.FeeBps {
				return NativeDexMutation{}, errors.New("DEX pool pair and fee tier already exists")
			}
		}
		pool := NativeDexPool{SchemaVersion: NativeDexSchemaVersion, ID: p.PoolID, Kind: "ynx-cpmm-v1", Asset0: p.Asset0, Asset1: p.Asset1, FeeBps: p.FeeBps, Shares: map[string]int64{}, NativeLots0: map[string]int64{}, NativeLots1: map[string]int64{}, CreatedAt: now, UpdatedAt: now, TxHash: input.Hash}
		pool.AuditHash = nativeDexPoolAuditHash(pool)
		d.dexPools[pool.ID] = pool
		event.PoolID, event.Asset0, event.Asset1 = pool.ID, pool.Asset0, pool.Asset1
		return NativeDexMutation{Pool: &pool, Event: event}, nil
	case NativeDexActionLiquidityAdd:
		var p NativeDexLiquidityPayload
		if err := decodeNativeDexPayload(input.Payload, &p); err != nil {
			return NativeDexMutation{}, err
		}
		pool, ok := d.dexPools[strings.ToLower(strings.TrimSpace(p.PoolID))]
		if !ok || p.Amount0 <= 0 || p.Amount1 <= 0 || p.MinShares <= 0 || now.Unix() > p.DeadlineUnix {
			return NativeDexMutation{}, errors.New("invalid, missing, or expired DEX add-liquidity request")
		}
		shares, err := nativeDexLiquidityShares(pool, p.Amount0, p.Amount1)
		if err != nil || shares < p.MinShares {
			return NativeDexMutation{}, errors.New("DEX minted shares are below minimum or ratio is invalid")
		}
		if err = d.requireNativeDexDebit(pool, true, input.Signer, p.Amount0); err != nil {
			return NativeDexMutation{}, err
		}
		if err = d.requireNativeDexDebit(pool, false, input.Signer, p.Amount1); err != nil {
			return NativeDexMutation{}, err
		}
		if err = d.debitNativeDexToPool(&pool, true, input.Signer, p.Amount0); err != nil {
			return NativeDexMutation{}, err
		}
		if err = d.debitNativeDexToPool(&pool, false, input.Signer, p.Amount1); err != nil {
			return NativeDexMutation{}, err
		}
		pool.Reserve0 += p.Amount0
		pool.Reserve1 += p.Amount1
		pool.TotalShares += shares
		pool.Shares[input.Signer] += shares
		d.updateNativeDexPool(&pool, input.Hash, now)
		event.PoolID, event.Asset0, event.Asset1, event.Amount0, event.Amount1, event.Shares = pool.ID, pool.Asset0, pool.Asset1, p.Amount0, p.Amount1, shares
		return NativeDexMutation{Pool: &pool, Event: event}, nil
	case NativeDexActionLiquidityRemove:
		var p NativeDexLiquidityRemovePayload
		if err := decodeNativeDexPayload(input.Payload, &p); err != nil {
			return NativeDexMutation{}, err
		}
		pool, ok := d.dexPools[strings.ToLower(strings.TrimSpace(p.PoolID))]
		if !ok || p.Shares <= 0 || now.Unix() > p.DeadlineUnix || pool.TotalShares <= 0 || pool.Shares[input.Signer] < p.Shares {
			return NativeDexMutation{}, errors.New("invalid, expired, or underfunded DEX remove-liquidity request")
		}
		a0, _ := nativeDexMulDivFloor(p.Shares, pool.Reserve0, pool.TotalShares)
		a1, _ := nativeDexMulDivFloor(p.Shares, pool.Reserve1, pool.TotalShares)
		if a0 <= 0 || a1 <= 0 || a0 < p.MinAmount0 || a1 < p.MinAmount1 {
			return NativeDexMutation{}, errors.New("DEX liquidity output is below minimum")
		}
		if err := d.creditNativeDexFromPool(&pool, true, input.Signer, a0); err != nil {
			return NativeDexMutation{}, err
		}
		if err := d.creditNativeDexFromPool(&pool, false, input.Signer, a1); err != nil {
			return NativeDexMutation{}, err
		}
		pool.Reserve0 -= a0
		pool.Reserve1 -= a1
		pool.TotalShares -= p.Shares
		pool.Shares[input.Signer] -= p.Shares
		d.updateNativeDexPool(&pool, input.Hash, now)
		event.PoolID, event.Asset0, event.Asset1, event.Amount0, event.Amount1, event.Shares = pool.ID, pool.Asset0, pool.Asset1, a0, a1, p.Shares
		return NativeDexMutation{Pool: &pool, Event: event}, nil
	case NativeDexActionSwapExactInput:
		var p NativeDexSwapExactInputPayload
		if err := decodeNativeDexPayload(input.Payload, &p); err != nil {
			return NativeDexMutation{}, err
		}
		pool, ok := d.dexPools[strings.ToLower(strings.TrimSpace(p.PoolID))]
		p.AssetIn = normalizeNativeDexAsset(p.AssetIn)
		if !ok || p.AmountIn <= 0 || p.MinAmountOut <= 0 || now.Unix() > p.DeadlineUnix {
			return NativeDexMutation{}, errors.New("invalid, missing, or expired DEX exact-input request")
		}
		in0, err := nativeDexDirection(pool, p.AssetIn)
		if err != nil {
			return NativeDexMutation{}, err
		}
		rin, rout := nativeDexReserves(pool, in0)
		out, err := NativeDexExactInputQuote(rin, rout, p.AmountIn, pool.FeeBps)
		if err != nil || out < p.MinAmountOut {
			return NativeDexMutation{}, errors.New("DEX exact-input output is below minimum")
		}
		if err = d.requireNativeDexDebit(pool, in0, input.Signer, p.AmountIn); err != nil {
			return NativeDexMutation{}, err
		}
		if err = d.debitNativeDexToPool(&pool, in0, input.Signer, p.AmountIn); err != nil {
			return NativeDexMutation{}, err
		}
		if err = d.creditNativeDexFromPool(&pool, !in0, input.Signer, out); err != nil {
			return NativeDexMutation{}, err
		}
		if in0 {
			pool.Reserve0 += p.AmountIn
			pool.Reserve1 -= out
		} else {
			pool.Reserve1 += p.AmountIn
			pool.Reserve0 -= out
		}
		d.updateNativeDexPool(&pool, input.Hash, now)
		event.PoolID, event.Asset0, event.Asset1, event.Amount0, event.Amount1 = pool.ID, p.AssetIn, nativeDexOther(pool, p.AssetIn), p.AmountIn, out
		return NativeDexMutation{Pool: &pool, Event: event}, nil
	case NativeDexActionSwapExactOutput:
		var p NativeDexSwapExactOutputPayload
		if err := decodeNativeDexPayload(input.Payload, &p); err != nil {
			return NativeDexMutation{}, err
		}
		pool, ok := d.dexPools[strings.ToLower(strings.TrimSpace(p.PoolID))]
		p.AssetOut = normalizeNativeDexAsset(p.AssetOut)
		if !ok || p.AmountOut <= 0 || p.MaxAmountIn <= 0 || now.Unix() > p.DeadlineUnix {
			return NativeDexMutation{}, errors.New("invalid, missing, or expired DEX exact-output request")
		}
		out0, err := nativeDexDirection(pool, p.AssetOut)
		if err != nil {
			return NativeDexMutation{}, err
		}
		rout, rin := nativeDexReserves(pool, out0)
		amountIn, err := NativeDexExactOutputQuote(rin, rout, p.AmountOut, pool.FeeBps)
		if err != nil || amountIn > p.MaxAmountIn {
			return NativeDexMutation{}, errors.New("DEX exact-output input exceeds maximum")
		}
		if err = d.requireNativeDexDebit(pool, !out0, input.Signer, amountIn); err != nil {
			return NativeDexMutation{}, err
		}
		if err = d.debitNativeDexToPool(&pool, !out0, input.Signer, amountIn); err != nil {
			return NativeDexMutation{}, err
		}
		if err = d.creditNativeDexFromPool(&pool, out0, input.Signer, p.AmountOut); err != nil {
			return NativeDexMutation{}, err
		}
		if out0 {
			pool.Reserve1 += amountIn
			pool.Reserve0 -= p.AmountOut
		} else {
			pool.Reserve0 += amountIn
			pool.Reserve1 -= p.AmountOut
		}
		d.updateNativeDexPool(&pool, input.Hash, now)
		event.PoolID, event.Asset0, event.Asset1, event.Amount0, event.Amount1 = pool.ID, nativeDexOther(pool, p.AssetOut), p.AssetOut, amountIn, p.AmountOut
		return NativeDexMutation{Pool: &pool, Event: event}, nil
	default:
		return NativeDexMutation{}, fmt.Errorf("unsupported DEX action %q", input.Action)
	}
}

func decodeNativeDexPayload(raw []byte, target any) error {
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(target); err != nil {
		return fmt.Errorf("decode DEX payload: %w", err)
	}
	return nil
}
func normalizeNativeDexAsset(v string) string {
	if strings.EqualFold(strings.TrimSpace(v), NativeDexAssetID) {
		return NativeDexAssetID
	}
	return strings.ToLower(strings.TrimSpace(v))
}
func (d *Devnet) nativeDexAssetExists(id string) bool {
	if id == NativeDexAssetID {
		return true
	}
	_, ok := d.dexAssets[id]
	return ok
}
func (d *Devnet) nativeDexBalance(asset, account string) int64 {
	if d.dexBalances[asset] == nil {
		return 0
	}
	return d.dexBalances[asset][account]
}
func (d *Devnet) setNativeDexBalance(asset, account string, amount int64) {
	if d.dexBalances[asset] == nil {
		d.dexBalances[asset] = map[string]int64{}
	}
	d.dexBalances[asset][account] = amount
}
func (d *Devnet) moveNativeDexBalance(asset, from, to string, amount int64) error {
	a, b := d.nativeDexBalance(asset, from), d.nativeDexBalance(asset, to)
	if a < amount {
		return errors.New("insufficient DEX asset balance")
	}
	if b > math.MaxInt64-amount {
		return errors.New("DEX asset balance overflow")
	}
	d.setNativeDexBalance(asset, from, a-amount)
	d.setNativeDexBalance(asset, to, b+amount)
	return nil
}
func nativeDexDirection(p NativeDexPool, a string) (bool, error) {
	if a == p.Asset0 {
		return true, nil
	}
	if a == p.Asset1 {
		return false, nil
	}
	return false, errors.New("asset is not in DEX pool")
}
func nativeDexReserves(p NativeDexPool, first bool) (int64, int64) {
	if first {
		return p.Reserve0, p.Reserve1
	}
	return p.Reserve1, p.Reserve0
}
func nativeDexOther(p NativeDexPool, a string) string {
	if a == p.Asset0 {
		return p.Asset1
	}
	return p.Asset0
}
func nativeDexLiquidityShares(p NativeDexPool, a0, a1 int64) (int64, error) {
	if p.TotalShares == 0 {
		v := new(big.Int).Sqrt(new(big.Int).Mul(big.NewInt(a0), big.NewInt(a1)))
		if !v.IsInt64() || v.Int64() <= 0 {
			return 0, errors.New("invalid initial DEX liquidity")
		}
		return v.Int64(), nil
	}
	if new(big.Int).Mul(big.NewInt(a0), big.NewInt(p.Reserve1)).Cmp(new(big.Int).Mul(big.NewInt(a1), big.NewInt(p.Reserve0))) != 0 {
		return 0, errors.New("DEX liquidity must match current reserve ratio")
	}
	return nativeDexMulDivFloor(a0, p.TotalShares, p.Reserve0)
}
func nativeDexMulDivFloor(a, b, d int64) (int64, error) {
	if a < 0 || b < 0 || d <= 0 {
		return 0, errors.New("invalid DEX arithmetic")
	}
	v := new(big.Int).Quo(new(big.Int).Mul(big.NewInt(a), big.NewInt(b)), big.NewInt(d))
	if !v.IsInt64() {
		return 0, errors.New("DEX arithmetic overflow")
	}
	return v.Int64(), nil
}
func nativeDexMulDivCeil(a, b, d int64) (int64, error) {
	if a <= 0 || b <= 0 || d <= 0 {
		return 0, errors.New("invalid DEX arithmetic")
	}
	n := new(big.Int).Mul(big.NewInt(a), big.NewInt(b))
	n.Add(n, big.NewInt(d-1))
	v := n.Quo(n, big.NewInt(d))
	if !v.IsInt64() {
		return 0, errors.New("DEX arithmetic overflow")
	}
	return v.Int64(), nil
}
func NativeDexExactInputQuote(rin, rout, amount int64, fee uint16) (int64, error) {
	if rin <= 0 || rout <= 0 || amount <= 0 || fee >= 10000 {
		return 0, errors.New("DEX pool has no executable liquidity")
	}
	effective, err := nativeDexMulDivFloor(amount, int64(10000-fee), 10000)
	if err != nil || effective <= 0 {
		return 0, errors.New("DEX input is too small after fee")
	}
	return nativeDexMulDivFloor(rout, effective, rin+effective)
}
func NativeDexExactOutputQuote(rin, rout, out int64, fee uint16) (int64, error) {
	if rin <= 0 || rout <= out || out <= 0 || fee >= 10000 {
		return 0, errors.New("DEX output exceeds pool liquidity")
	}
	effective, err := nativeDexMulDivCeil(rin, out, rout-out)
	if err != nil {
		return 0, err
	}
	return nativeDexMulDivCeil(effective, 10000, int64(10000-fee))
}
func (d *Devnet) requireNativeDexDebit(pool NativeDexPool, asset0 bool, account string, amount int64) error {
	asset := pool.Asset1
	if asset0 {
		asset = pool.Asset0
	}
	if asset != NativeDexAssetID {
		if d.nativeDexBalance(asset, account) < amount {
			return errors.New("insufficient DEX asset balance")
		}
		return nil
	}
	a := d.accounts[account]
	if a == nil || a.Balance < amount+1 {
		return errors.New("insufficient YNXT balance for DEX action and fee")
	}
	total := int64(0)
	for _, v := range a.Lots {
		if v > 0 {
			total += v
		}
	}
	if total < amount+1 {
		return errors.New("insufficient traceable YNXT lots for DEX action and fee")
	}
	return nil
}
func (d *Devnet) debitNativeDexToPool(pool *NativeDexPool, asset0 bool, account string, amount int64) error {
	asset := pool.Asset1
	lots := pool.NativeLots1
	if asset0 {
		asset = pool.Asset0
		lots = pool.NativeLots0
	}
	if asset != NativeDexAssetID {
		d.setNativeDexBalance(asset, account, d.nativeDexBalance(asset, account)-amount)
		return nil
	}
	a := d.accounts[account]
	remaining := amount
	keys := sortedNativeDexLotKeys(a.Lots)
	for _, k := range keys {
		if remaining == 0 {
			break
		}
		m := a.Lots[k]
		if m > remaining {
			m = remaining
		}
		if m > 0 {
			a.Lots[k] -= m
			lots[k] += m
			remaining -= m
		}
	}
	if remaining != 0 {
		return errors.New("insufficient traceable YNXT lots for DEX action")
	}
	a.Balance -= amount
	return nil
}
func (d *Devnet) creditNativeDexFromPool(pool *NativeDexPool, asset0 bool, account string, amount int64) error {
	asset := pool.Asset1
	lots := pool.NativeLots1
	if asset0 {
		asset = pool.Asset0
		lots = pool.NativeLots0
	}
	if asset != NativeDexAssetID {
		current := d.nativeDexBalance(asset, account)
		if current > math.MaxInt64-amount {
			return errors.New("DEX balance overflow")
		}
		d.setNativeDexBalance(asset, account, current+amount)
		return nil
	}
	a := d.account(account)
	if a.Balance > math.MaxInt64-amount {
		return errors.New("YNXT balance overflow")
	}
	remaining := amount
	keys := sortedNativeDexLotKeys(lots)
	for _, k := range keys {
		if remaining == 0 {
			break
		}
		m := lots[k]
		if m > remaining {
			m = remaining
		}
		if m > 0 {
			lots[k] -= m
			a.Lots[k] += m
			remaining -= m
		}
	}
	if remaining != 0 {
		return errors.New("DEX pool lacks traceable YNXT lots")
	}
	a.Balance += amount
	return nil
}
func (d *Devnet) updateNativeDexPool(p *NativeDexPool, tx string, at time.Time) {
	p.TxHash = tx
	p.UpdatedAt = at
	p.AuditHash = nativeDexPoolAuditHash(*p)
	d.dexPools[p.ID] = *p
}
func (d *Devnet) finalizeNativeDexRecordLocked(txHash string, height uint64, blockHash string) {
	for id, asset := range d.dexAssets {
		if asset.TxHash == txHash {
			asset.BlockHeight, asset.BlockHash = height, blockHash
			asset.AuditHash = nativeDexAssetAuditHash(asset)
			d.dexAssets[id] = asset
		}
	}
	for id, pool := range d.dexPools {
		if pool.TxHash == txHash {
			pool.BlockHeight, pool.BlockHash = height, blockHash
			pool.AuditHash = nativeDexPoolAuditHash(pool)
			d.dexPools[id] = pool
		}
	}
	for index := range d.dexEvents {
		if d.dexEvents[index].TxHash == txHash {
			d.dexEvents[index].BlockHeight, d.dexEvents[index].BlockHash = height, blockHash
			d.dexEvents[index].AuditHash = nativeDexEventAuditHash(d.dexEvents[index])
		}
	}
}
func cloneNativeDexPool(p NativeDexPool) NativeDexPool {
	p.Shares = cloneInt64Map(p.Shares)
	p.NativeLots0 = cloneInt64Map(p.NativeLots0)
	p.NativeLots1 = cloneInt64Map(p.NativeLots1)
	return p
}
func cloneInt64Map(in map[string]int64) map[string]int64 {
	out := make(map[string]int64, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}
func sortedNativeDexLotKeys(in map[string]int64) []string {
	keys := make([]string, 0, len(in))
	for key := range in {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
func nativeDexAssetAuditHash(v NativeDexAsset) string {
	v.AuditHash = ""
	b, _ := json.Marshal(v)
	return hashParts("YNX_NATIVE_DEX_ASSET_AUDIT_V1", string(b))
}
func nativeDexPoolAuditHash(v NativeDexPool) string {
	v.AuditHash = ""
	b, _ := json.Marshal(v)
	return hashParts("YNX_NATIVE_DEX_POOL_AUDIT_V1", string(b))
}
func nativeDexEventAuditHash(v NativeDexEvent) string {
	v.AuditHash = ""
	b, _ := json.Marshal(v)
	return hashParts("YNX_NATIVE_DEX_EVENT_AUDIT_V1", string(b))
}
