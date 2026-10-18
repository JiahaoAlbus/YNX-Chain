package ynxauth

import (
	"bytes"
	"encoding/binary"
	"errors"
	"math"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const (
	ActionDomain          = "YNX-NATIVE-ACTION/v1"
	MaxActionPayloadBytes = 4096
	MaxActionBytes        = 8192

	ActionStake              = "stake"
	ActionResourceDelegate   = "resource_delegation_create"
	ActionResourceRent       = "resource_rental_create"
	ActionDexAssetCreate     = "dex_asset_create"
	ActionDexAssetMint       = "dex_asset_mint"
	ActionDexAssetTransfer   = "dex_asset_transfer"
	ActionDexPoolCreate      = "dex_pool_create"
	ActionDexLiquidityAdd    = "dex_liquidity_add"
	ActionDexLiquidityRemove = "dex_liquidity_remove"
	ActionDexSwapExactInput  = "dex_swap_exact_input"
	ActionDexSwapExactOutput = "dex_swap_exact_output"
)

var ErrAction = errors.New("invalid or unsupported native action")

// Action is a complete signing message, not an authorization capability or an
// execution result. Payload is the complete canonical E-encoded typed payload.
// Callers must bind the trusted network/owner/current policy and separately
// enforce nonce, fees, balance, quotes, deadlines and business permissions.
type Action struct {
	ChainID       []byte
	NativeChainID uint64
	Owner         string
	Nonce         uint64
	Fee           uint64
	Kind          string
	Payload       []byte
}

type StakePayload struct{ Amount uint64 }

type ResourceDelegationPayload struct {
	Provider, Beneficiary string
	AmountYNXT            uint64
	PolicyHash            string
	IdempotencyKey        string
	RequestHash           string
}

type ResourceRentalPayload struct {
	Address, Provider                           string
	Bandwidth, Compute, AICredits, TrustCredits uint64
	QuoteID                                     string
	// QuoteExpiresAt is the exact UTC RFC3339Nano spelling, with no redundant
	// fractional zeroes. It is not checked against the local wall clock.
	QuoteExpiresAt string
	PolicyHash     string
	MaxPriceYNXT   uint64
	IdempotencyKey string
	RequestHash    string
}

type DexAssetCreatePayload struct {
	AssetID, Symbol, Name    string
	Decimals                 uint32
	MaxSupply, InitialSupply uint64
}

type DexAssetAmountPayload struct {
	AssetID string
	Amount  uint64
}

type DexAssetTransferPayload struct {
	AssetID, Recipient string
	Amount             uint64
}

type DexPoolCreatePayload struct {
	PoolID, Asset0, Asset1 string
	FeeBps                 uint32
}

type DexLiquidityPayload struct {
	PoolID                                    string
	Amount0, Amount1, MinShares, DeadlineUnix uint64
}

type DexLiquidityRemovePayload struct {
	PoolID                                       string
	Shares, MinAmount0, MinAmount1, DeadlineUnix uint64
}

type DexSwapExactInputPayload struct {
	PoolID, AssetIn                      string
	AmountIn, MinAmountOut, DeadlineUnix uint64
}

type DexSwapExactOutputPayload struct {
	PoolID, AssetOut                     string
	AmountOut, MaxAmountIn, DeadlineUnix uint64
}

var (
	actionAssetIDPattern = regexp.MustCompile(`^[a-z][a-z0-9-]{2,31}$`)
	actionSymbolPattern  = regexp.MustCompile(`^[A-Z][A-Z0-9]{1,11}$`)
	actionPoolIDPattern  = regexp.MustCompile(`^dex_[a-z0-9][a-z0-9_-]{2,59}$`)
)

func actionPositive(n uint64) bool { return n > 0 && n <= math.MaxInt64 }
func actionAssetID(s string) bool {
	return s == "YNXT" || (len(s) <= 32 && actionAssetIDPattern.MatchString(s))
}
func actionCustomAssetID(s string) bool {
	return len(s) <= 32 && actionAssetIDPattern.MatchString(s)
}
func actionPoolID(s string) bool { return len(s) <= 64 && actionPoolIDPattern.MatchString(s) }

func actionText(s string, min, max int) bool {
	if len(s) < min || len(s) > max || !utf8.ValidString(s) || s != strings.TrimSpace(s) {
		return false
	}
	for _, r := range s {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

// Resource beneficiaries/providers may be opaque resource-account identifiers
// in the existing state machine. Authority-bearing Provider/Address fields are
// separately restricted to canonical addresses and bound to Action.Owner.
func actionResourceAccount(s string) bool {
	return actionText(s, 1, 128) && strings.IndexFunc(s, unicode.IsSpace) < 0
}

func actionHex(s string, size int) bool {
	if len(s) != size {
		return false
	}
	for _, c := range s {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

func actionExpiry(s string) bool {
	if len(s) < 20 || len(s) > 30 {
		return false
	}
	t, err := time.Parse(time.RFC3339Nano, s)
	return err == nil && !t.IsZero() && t.Year() >= 1 && t.UTC().Format(time.RFC3339Nano) == s
}

func (a Action) Validate() error {
	if len(a.ChainID) != 32 || !actionPositive(a.NativeChainID) || len(a.Owner) != 42 || !accountaddress.IsCanonical(a.Owner) || a.Nonce == 0 || a.Fee > math.MaxInt64 {
		return ErrAction
	}
	p, err := DecodeActionPayload(a.Kind, a.Payload)
	if err != nil {
		return err
	}
	switch v := p.(type) {
	case ResourceDelegationPayload:
		if v.Provider != a.Owner {
			return ErrAction
		}
	case ResourceRentalPayload:
		if v.Address != a.Owner {
			return ErrAction
		}
	case ContractDeployPayload:
		if a.Fee != ContractDeployFee {
			return ErrAction
		}
	case ContractExecutePayload:
		if a.Fee != ContractExecuteFee {
			return ErrAction
		}
	}
	return nil
}

func (a Action) SigningBytes() ([]byte, error) {
	if err := a.Validate(); err != nil {
		return nil, err
	}
	f := [][]byte{[]byte(ActionDomain), ynxbatch.U32(1), a.ChainID}
	f = append(f, pair(a.NativeChainID)...)
	f = append(f, []byte(a.Owner))
	f = append(f, pair(a.Nonce)...)
	f = append(f, pair(a.Fee)...)
	f = append(f, []byte(a.Kind), a.Payload)
	return ynxbatch.EncodeFields(f...)
}

func DecodeAction(wire []byte) (Action, error) {
	var a Action
	f, err := frame(wire, 12, MaxActionBytes)
	if err != nil || !bytes.Equal(f[0], []byte(ActionDomain)) || !bytes.Equal(f[1], ynxbatch.U32(1)) {
		return a, ErrAction
	}
	r := actionReader{fields: f[3:]}
	a.ChainID, a.NativeChainID = f[2], r.u64()
	a.Owner, a.Nonce, a.Fee = r.text(), r.u64(), r.u64()
	a.Kind, a.Payload = r.text(), f[11]
	if r.err != nil {
		return Action{}, ErrAction
	}
	if err := a.Validate(); err != nil {
		return Action{}, err
	}
	canonical, err := a.SigningBytes()
	if err != nil || !bytes.Equal(canonical, wire) {
		return Action{}, ErrAction
	}
	return a, nil
}

// EncodeActionPayload accepts only the exact value types listed above. It does
// not accept maps, JSON, pointers, callbacks or arbitrary action strings. No
// spelling is silently normalized. All limits are checked before wire creation.
func EncodeActionPayload(kind string, payload any) ([]byte, error) {
	var f [][]byte
	switch p := payload.(type) {
	case ContractDeployPayload:
		return encodeContractDeployPayload(kind, p)
	case ContractExecutePayload:
		return encodeContractExecutePayload(kind, p)
	case StakePayload:
		if kind != ActionStake || !actionPositive(p.Amount) {
			return nil, ErrAction
		}
		f = pair(p.Amount)
	case ResourceDelegationPayload:
		if kind != ActionResourceDelegate || len(p.Provider) != 42 || !accountaddress.IsCanonical(p.Provider) || !actionResourceAccount(p.Beneficiary) || !actionPositive(p.AmountYNXT) || !actionHex(p.PolicyHash, 64) || !actionText(p.IdempotencyKey, 3, 128) || !actionHex(p.RequestHash, 64) {
			return nil, ErrAction
		}
		f = [][]byte{[]byte(p.Provider), []byte(p.Beneficiary)}
		f = append(f, pair(p.AmountYNXT)...)
		f = append(f, []byte(p.PolicyHash), []byte(p.IdempotencyKey), []byte(p.RequestHash))
	case ResourceRentalPayload:
		if kind != ActionResourceRent || len(p.Address) != 42 || !accountaddress.IsCanonical(p.Address) || !actionResourceAccount(p.Provider) || p.Bandwidth > math.MaxInt64 || p.Compute > math.MaxInt64 || p.AICredits > math.MaxInt64 || p.TrustCredits > math.MaxInt64 || p.Bandwidth|p.Compute|p.AICredits|p.TrustCredits == 0 || !actionHex(p.QuoteID, 24) || !actionExpiry(p.QuoteExpiresAt) || !actionHex(p.PolicyHash, 64) || !actionPositive(p.MaxPriceYNXT) || !actionText(p.IdempotencyKey, 3, 128) || !actionHex(p.RequestHash, 64) {
			return nil, ErrAction
		}
		f = [][]byte{[]byte(p.Address), []byte(p.Provider)}
		for _, n := range []uint64{p.Bandwidth, p.Compute, p.AICredits, p.TrustCredits} {
			f = append(f, pair(n)...)
		}
		f = append(f, []byte(p.QuoteID), []byte(p.QuoteExpiresAt), []byte(p.PolicyHash))
		f = append(f, pair(p.MaxPriceYNXT)...)
		f = append(f, []byte(p.IdempotencyKey), []byte(p.RequestHash))
	case DexAssetCreatePayload:
		if kind != ActionDexAssetCreate || !actionCustomAssetID(p.AssetID) || len(p.Symbol) > 12 || !actionSymbolPattern.MatchString(p.Symbol) || !actionText(p.Name, 1, 80) || p.Decimals > 18 || !actionPositive(p.InitialSupply) || p.MaxSupply > math.MaxInt64 || p.MaxSupply < p.InitialSupply {
			return nil, ErrAction
		}
		f = [][]byte{[]byte(p.AssetID), []byte(p.Symbol), []byte(p.Name), ynxbatch.U32(p.Decimals)}
		f = append(f, pair(p.MaxSupply)...)
		f = append(f, pair(p.InitialSupply)...)
	case DexAssetAmountPayload:
		if kind != ActionDexAssetMint || !actionCustomAssetID(p.AssetID) || !actionPositive(p.Amount) {
			return nil, ErrAction
		}
		f = append([][]byte{[]byte(p.AssetID)}, pair(p.Amount)...)
	case DexAssetTransferPayload:
		if kind != ActionDexAssetTransfer || !actionCustomAssetID(p.AssetID) || len(p.Recipient) != 42 || !accountaddress.IsCanonical(p.Recipient) || !actionPositive(p.Amount) {
			return nil, ErrAction
		}
		f = append([][]byte{[]byte(p.AssetID), []byte(p.Recipient)}, pair(p.Amount)...)
	case DexPoolCreatePayload:
		if kind != ActionDexPoolCreate || !actionPoolID(p.PoolID) || !actionAssetID(p.Asset0) || !actionAssetID(p.Asset1) || p.Asset0 >= p.Asset1 || p.FeeBps == 0 || p.FeeBps > 1000 {
			return nil, ErrAction
		}
		f = [][]byte{[]byte(p.PoolID), []byte(p.Asset0), []byte(p.Asset1), ynxbatch.U32(p.FeeBps)}
	case DexLiquidityPayload:
		if kind != ActionDexLiquidityAdd || !actionPoolID(p.PoolID) || !actionPositive(p.Amount0) || !actionPositive(p.Amount1) || !actionPositive(p.MinShares) || !actionPositive(p.DeadlineUnix) {
			return nil, ErrAction
		}
		f = [][]byte{[]byte(p.PoolID)}
		for _, n := range []uint64{p.Amount0, p.Amount1, p.MinShares, p.DeadlineUnix} {
			f = append(f, pair(n)...)
		}
	case DexLiquidityRemovePayload:
		if kind != ActionDexLiquidityRemove || !actionPoolID(p.PoolID) || !actionPositive(p.Shares) || p.MinAmount0 > math.MaxInt64 || p.MinAmount1 > math.MaxInt64 || !actionPositive(p.DeadlineUnix) {
			return nil, ErrAction
		}
		f = [][]byte{[]byte(p.PoolID)}
		for _, n := range []uint64{p.Shares, p.MinAmount0, p.MinAmount1, p.DeadlineUnix} {
			f = append(f, pair(n)...)
		}
	case DexSwapExactInputPayload:
		if kind != ActionDexSwapExactInput || !actionPoolID(p.PoolID) || !actionAssetID(p.AssetIn) || !actionPositive(p.AmountIn) || !actionPositive(p.MinAmountOut) || !actionPositive(p.DeadlineUnix) {
			return nil, ErrAction
		}
		f = [][]byte{[]byte(p.PoolID), []byte(p.AssetIn)}
		for _, n := range []uint64{p.AmountIn, p.MinAmountOut, p.DeadlineUnix} {
			f = append(f, pair(n)...)
		}
	case DexSwapExactOutputPayload:
		if kind != ActionDexSwapExactOutput || !actionPoolID(p.PoolID) || !actionAssetID(p.AssetOut) || !actionPositive(p.AmountOut) || !actionPositive(p.MaxAmountIn) || !actionPositive(p.DeadlineUnix) {
			return nil, ErrAction
		}
		f = [][]byte{[]byte(p.PoolID), []byte(p.AssetOut)}
		for _, n := range []uint64{p.AmountOut, p.MaxAmountIn, p.DeadlineUnix} {
			f = append(f, pair(n)...)
		}
	default:
		return nil, ErrAction
	}
	return ynxbatch.EncodeFields(f...)
}

// DecodeActionPayload rejects unknown kinds, omitted/extra/duplicate positions,
// malformed integer widths, trailing bytes and noncanonical field values. The
// decoded object carries no verified flag and never executes a state transition.
func DecodeActionPayload(kind string, wire []byte) (any, error) {
	if kind == ActionContractDeploy || kind == ActionContractExecute {
		return decodeContractActionPayload(kind, wire)
	}
	count := 0
	switch kind {
	case ActionStake:
		count = 2
	case ActionResourceDelegate:
		count = 7
	case ActionResourceRent:
		count = 17
	case ActionDexAssetCreate, ActionDexSwapExactInput, ActionDexSwapExactOutput:
		count = 8
	case ActionDexAssetMint:
		count = 3
	case ActionDexAssetTransfer, ActionDexPoolCreate:
		count = 4
	case ActionDexLiquidityAdd, ActionDexLiquidityRemove:
		count = 9
	default:
		return nil, ErrAction
	}
	f, err := frame(wire, count, MaxActionPayloadBytes)
	if err != nil {
		return nil, ErrAction
	}
	r := actionReader{fields: f}
	var p any
	switch kind {
	case ActionStake:
		p = StakePayload{Amount: r.u64()}
	case ActionResourceDelegate:
		p = ResourceDelegationPayload{Provider: r.text(), Beneficiary: r.text(), AmountYNXT: r.u64(), PolicyHash: r.text(), IdempotencyKey: r.text(), RequestHash: r.text()}
	case ActionResourceRent:
		p = ResourceRentalPayload{Address: r.text(), Provider: r.text(), Bandwidth: r.u64(), Compute: r.u64(), AICredits: r.u64(), TrustCredits: r.u64(), QuoteID: r.text(), QuoteExpiresAt: r.text(), PolicyHash: r.text(), MaxPriceYNXT: r.u64(), IdempotencyKey: r.text(), RequestHash: r.text()}
	case ActionDexAssetCreate:
		p = DexAssetCreatePayload{AssetID: r.text(), Symbol: r.text(), Name: r.text(), Decimals: r.u32(), MaxSupply: r.u64(), InitialSupply: r.u64()}
	case ActionDexAssetMint:
		p = DexAssetAmountPayload{AssetID: r.text(), Amount: r.u64()}
	case ActionDexAssetTransfer:
		p = DexAssetTransferPayload{AssetID: r.text(), Recipient: r.text(), Amount: r.u64()}
	case ActionDexPoolCreate:
		p = DexPoolCreatePayload{PoolID: r.text(), Asset0: r.text(), Asset1: r.text(), FeeBps: r.u32()}
	case ActionDexLiquidityAdd:
		p = DexLiquidityPayload{PoolID: r.text(), Amount0: r.u64(), Amount1: r.u64(), MinShares: r.u64(), DeadlineUnix: r.u64()}
	case ActionDexLiquidityRemove:
		p = DexLiquidityRemovePayload{PoolID: r.text(), Shares: r.u64(), MinAmount0: r.u64(), MinAmount1: r.u64(), DeadlineUnix: r.u64()}
	case ActionDexSwapExactInput:
		p = DexSwapExactInputPayload{PoolID: r.text(), AssetIn: r.text(), AmountIn: r.u64(), MinAmountOut: r.u64(), DeadlineUnix: r.u64()}
	case ActionDexSwapExactOutput:
		p = DexSwapExactOutputPayload{PoolID: r.text(), AssetOut: r.text(), AmountOut: r.u64(), MaxAmountIn: r.u64(), DeadlineUnix: r.u64()}
	}
	if r.err != nil || r.index != count {
		return nil, ErrAction
	}
	canonical, err := EncodeActionPayload(kind, p)
	if err != nil || !bytes.Equal(canonical, wire) {
		return nil, ErrAction
	}
	return p, nil
}

type actionReader struct {
	fields [][]byte
	index  int
	err    error
}

func (r *actionReader) field() []byte {
	if r.index >= len(r.fields) {
		r.err = ErrAction
		return nil
	}
	f := r.fields[r.index]
	r.index++
	return f
}
func (r *actionReader) text() string { return string(r.field()) }
func (r *actionReader) u32() uint32 {
	f := r.field()
	if len(f) != 4 {
		r.err = ErrAction
		return 0
	}
	return binary.BigEndian.Uint32(f)
}
func (r *actionReader) u64() uint64 { return uint64(r.u32())<<32 | uint64(r.u32()) }
