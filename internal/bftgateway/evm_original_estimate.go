package bftgateway

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/big"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ethnative"
)

// Estimate the original native-Ethereum adapter in wei. This is a quote only:
// account authorization and the actual signed transaction remain checked at
// execution. Calldata calls retain the bounded contract route.
func (g *Gateway) evmEstimateOriginalNativeTransfer(ctx context.Context, params []json.RawMessage) (any, int, bool, error) {
	var fields map[string]json.RawMessage
	if json.Unmarshal(params[0], &fields) != nil || fields == nil {
		return nil, -32602, true, errors.New("transaction must be an object")
	}
	for _, name := range []string{"data", "input"} {
		if raw, ok := fields[name]; ok {
			var value string
			if json.Unmarshal(raw, &value) != nil {
				return nil, -32602, true, fmt.Errorf("%s must be a string", name)
			}
			if value != "0x" {
				return nil, 0, false, nil
			}
		}
	}
	allowed := map[string]bool{"from": true, "to": true, "value": true, "data": true, "input": true, "gas": true, "gasPrice": true, "nonce": true, "chainId": true, "type": true}
	for name := range fields {
		if !allowed[name] {
			return nil, -32004, true, fmt.Errorf("unsupported original native transaction field %q", name)
		}
	}
	to, err := requiredEVMStringField(fields, "to")
	if err != nil || !isCanonicalEVMAddress(to) {
		return nil, -32602, true, errors.New("canonical lowercase recipient is required")
	}
	from, hasFrom, err := optionalEVMStringField(fields, "from")
	if err != nil || hasFrom && (!isCanonicalEVMAddress(from) || from == to) {
		return nil, -32602, true, errors.New("sender must be a distinct canonical lowercase address")
	}
	quantity := func(name string, fallback *big.Int) (*big.Int, error) {
		raw, ok := fields[name]
		if !ok {
			return fallback, nil
		}
		var text string
		if json.Unmarshal(raw, &text) != nil {
			return nil, fmt.Errorf("%s must be a canonical hex quantity", name)
		}
		n, err := ethnative.ParseQuantity(text)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", name, err)
		}
		return n, nil
	}
	value, err := quantity("value", new(big.Int))
	if err != nil {
		return nil, -32602, true, err
	}
	if _, err = ethnative.NativeAmount(value); err != nil {
		return nil, -32000, true, err
	}
	price, err := quantity("gasPrice", big.NewInt(ethnative.GasPriceWei))
	if err != nil {
		return nil, -32602, true, err
	}
	if price.Cmp(big.NewInt(ethnative.GasPriceWei)) != 0 {
		return nil, -32004, true, errors.New("gasPrice does not match original fixed native adapter")
	}
	gas, err := quantity("gas", new(big.Int).SetUint64(ethnative.TransferGas))
	if err != nil {
		return nil, -32602, true, err
	}
	if !gas.IsUint64() || gas.Uint64() < ethnative.TransferGas || gas.Uint64() > ethnative.MaxGasLimit {
		return nil, -32004, true, errors.New("native gas must be between 25000 and 30000000")
	}
	for _, check := range []struct {
		name string
		want int64
	}{{"chainId", 6423}, {"type", 0}} {
		v, e := quantity(check.name, big.NewInt(check.want))
		if e != nil {
			return nil, -32602, true, e
		}
		if v.Cmp(big.NewInt(check.want)) != 0 {
			return nil, -32004, true, fmt.Errorf("unsupported %s", check.name)
		}
	}
	nonce, err := quantity("nonce", nil)
	if err != nil {
		return nil, -32602, true, err
	}
	if nonce != nil && (!nonce.IsUint64() || nonce.Uint64() == math.MaxUint64) {
		return nil, -32602, true, errors.New("nonce is exhausted")
	}
	status, err := g.status(ctx)
	if err != nil {
		return nil, -32603, true, err
	}
	tag := json.RawMessage(`"latest"`)
	if len(params) == 2 {
		tag = params[1]
	}
	height, err := parseCommittedBlockTag(tag, status.EarliestBlockHeight, status.Height)
	if err != nil || height != status.Height {
		return nil, -32602, true, errors.New("gas quote requires current committed block")
	}
	if _, found, e := g.committedContract(ctx, to); e != nil {
		return nil, -32603, true, e
	} else if found {
		return nil, -32000, true, errors.New("native transfer to contract is unsupported")
	}
	if hasFrom {
		var account chain.ConsensusAccount
		h, e := g.queryPQWalletJSON(ctx, "/accounts/"+from, &account)
		if e != nil {
			return nil, -32000, true, e
		}
		if h < 0 || uint64(h) != height || account.Address != from || account.Balance < 0 {
			return nil, -32603, true, errors.New("account snapshot does not match committed quote")
		}
		if account.Nonce == math.MaxUint64 || nonce != nil && nonce.Uint64() != account.Nonce {
			return nil, -32000, true, errors.New("nonce differs from current account or is exhausted")
		}
		budget := new(big.Int).Add(value, new(big.Int).Mul(gas, price))
		if ethnative.Wei(account.Balance).Cmp(budget) < 0 {
			return nil, -32000, true, errors.New("insufficient funds for value and gas budget")
		}
	}
	return hexEVMQuantity(ethnative.TransferGas), 0, true, nil
}
