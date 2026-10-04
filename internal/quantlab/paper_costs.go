package quantlab

import "math/big"

// PaperExecutionCosts is an explicit simulation assumption, never a venue fee.
// Empty policy preserves legacy zero-cost settlement. V1 rounds adverse prices
// against the trader and fees upward in integer quote micro-units.
type PaperExecutionCosts struct {
	Policy              string
	FeeBPS, SlippageBPS int64
}

const PaperCostPolicyV1 = "adverse_price_ceil_fee_micro_v1"

func (c PaperExecutionCosts) valid() bool {
	return c.Policy == "" && c.FeeBPS == 0 && c.SlippageBPS == 0 || c.Policy == PaperCostPolicyV1 && c.FeeBPS >= 0 && c.FeeBPS <= 10000 && c.SlippageBPS >= 0 && c.SlippageBPS < 10000
}

func paperCostSettlement(side string, price, fill int64, costs PaperExecutionCosts) (executionPrice, notional, fee int64, err error) {
	if !costs.valid() || price <= 0 || fill < 0 || (side != "buy" && side != "sell") {
		return 0, 0, 0, ErrInvalid
	}
	execution := big.NewInt(price)
	ceilDiv := func(n *big.Int, divisor int64) *big.Int {
		return n.Add(n, big.NewInt(divisor-1)).Quo(n, big.NewInt(divisor))
	}
	if costs.Policy != "" {
		factor := int64(10000) + costs.SlippageBPS
		if side == "sell" {
			factor = 10000 - costs.SlippageBPS
		}
		execution.Mul(execution, big.NewInt(factor))
		if side == "buy" {
			execution = ceilDiv(execution, 10000)
		} else {
			execution.Quo(execution, big.NewInt(10000))
		}
	}
	if !execution.IsInt64() || execution.Sign() <= 0 {
		return 0, 0, 0, ErrInvalid
	}
	n := new(big.Int).Mul(execution, big.NewInt(fill))
	if costs.Policy != "" && side == "buy" {
		n = ceilDiv(n, 1000000)
	} else {
		n.Quo(n, big.NewInt(1000000))
	}
	f := ceilDiv(new(big.Int).Mul(new(big.Int).Set(n), big.NewInt(costs.FeeBPS)), 10000)
	if !n.IsInt64() || !f.IsInt64() {
		return 0, 0, 0, ErrInvalid
	}
	return execution.Int64(), n.Int64(), f.Int64(), nil
}
