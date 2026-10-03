package quantlab

import (
	"context"
	"math"
	"math/big"
)

// Evaluate integer formulas before narrowing. Quo keeps the original truncation
// toward zero; neither floating point rounding nor saturating/clamping is used.
type researchArithmetic struct{ invalid bool }

func (a *researchArithmetic) narrow(value *big.Int) int64 {
	if !value.IsInt64() {
		a.invalid = true
		return 0
	}
	return value.Int64()
}

func (a *researchArithmetic) sum(values ...int64) int64 {
	var result big.Int
	for _, value := range values {
		result.Add(&result, big.NewInt(value))
	}
	return a.narrow(&result)
}

func (a *researchArithmetic) difference(left, right int64) int64 {
	return a.narrow(new(big.Int).Sub(big.NewInt(left), big.NewInt(right)))
}

func (a *researchArithmetic) absolute(value int64) int64 {
	return a.narrow(new(big.Int).Abs(big.NewInt(value)))
}

func (a *researchArithmetic) mulDiv(left, right, divisor int64) int64 {
	return a.productsDiv(divisor, [2]int64{left, right})
}

func (a *researchArithmetic) productsDiv(divisor int64, products ...[2]int64) int64 {
	if divisor == 0 {
		a.invalid = true
		return 0
	}
	var result big.Int
	for _, pair := range products {
		result.Add(&result, new(big.Int).Mul(big.NewInt(pair[0]), big.NewInt(pair[1])))
	}
	result.Quo(&result, big.NewInt(divisor))
	return a.narrow(&result)
}

type researchPricePrefix []big.Int

func buildResearchPricePrefix(ctx context.Context, bars []Bar) (researchPricePrefix, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	values := make(researchPricePrefix, len(bars)+1)
	for i, bar := range bars {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		values[i+1].Add(&values[i], big.NewInt(bar.Close))
	}
	return values, nil
}

func (values researchPricePrefix) average(a *researchArithmetic, start, end int) int64 {
	if start < 0 || end <= start || end >= len(values) {
		a.invalid = true
		return 0
	}
	total := new(big.Int).Sub(&values[end], &values[start])
	total.Quo(total, big.NewInt(int64(end-start)))
	return a.narrow(total)
}

func checkedResearchFloat(value float64) (int64, error) {
	value = math.Round(value)
	// float64(MaxInt64) rounds to 2^63, which is already out of range.
	if math.IsNaN(value) || math.IsInf(value, 0) || value >= 0x1p63 || value < -0x1p63 {
		return 0, researchInvalid("numeric_range")
	}
	return int64(value), nil
}
