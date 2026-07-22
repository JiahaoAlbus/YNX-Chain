package streambft

import (
	"errors"
	"fmt"
	"math/bits"
)

type ResourcePrices struct {
	Compute      uint64 `json:"compute"`
	StorageRead  uint64 `json:"storageRead"`
	StorageWrite uint64 `json:"storageWrite"`
	Bandwidth    uint64 `json:"bandwidth"`
	StateGrowth  uint64 `json:"stateGrowth"`
}

type FeeMarketConfig struct {
	MinimumBaseFee    uint64             `json:"minimumBaseFee"`
	MaximumBaseFee    uint64             `json:"maximumBaseFee"`
	ChangeDenominator uint64             `json:"changeDenominator"`
	Target            map[Lane]Resources `json:"target"`
	Prices            ResourcePrices     `json:"prices"`
}

type FeeMarketState struct {
	BaseFee map[Lane]uint64 `json:"baseFee"`
}

func (config FeeMarketConfig) Validate() error {
	if config.MinimumBaseFee == 0 || config.MaximumBaseFee < config.MinimumBaseFee || config.ChangeDenominator == 0 {
		return errors.New("fee market bounds are invalid")
	}
	if config.Prices == (ResourcePrices{}) {
		return errors.New("resource prices are zero")
	}
	for _, lane := range orderedLanes {
		if config.Target[lane] == (Resources{}) {
			return fmt.Errorf("fee target is missing for lane %s", lane)
		}
	}
	return nil
}

func (state FeeMarketState) Next(config FeeMarketConfig, usage map[Lane]Resources) (FeeMarketState, error) {
	if err := config.Validate(); err != nil {
		return FeeMarketState{}, err
	}
	next := FeeMarketState{BaseFee: make(map[Lane]uint64, len(orderedLanes))}
	for _, lane := range orderedLanes {
		current := state.BaseFee[lane]
		if current < config.MinimumBaseFee {
			current = config.MinimumBaseFee
		}
		target := config.Target[lane].Compute
		consumed := usage[lane].Compute
		if consumed == target {
			next.BaseFee[lane] = current
			continue
		}
		var distance uint64
		increasing := consumed > target
		if increasing {
			distance = consumed - target
		} else {
			distance = target - consumed
		}
		change, overflow := mulDiv(current, distance, target, config.ChangeDenominator)
		if overflow {
			change = config.MaximumBaseFee
		}
		if change == 0 {
			change = 1
		}
		if increasing {
			if change > config.MaximumBaseFee-current {
				next.BaseFee[lane] = config.MaximumBaseFee
			} else {
				next.BaseFee[lane] = current + change
			}
		} else if change >= current-config.MinimumBaseFee {
			next.BaseFee[lane] = config.MinimumBaseFee
		} else {
			next.BaseFee[lane] = current - change
		}
	}
	return next, nil
}

func ResourceFee(resources Resources, prices ResourcePrices) (uint64, error) {
	pairs := [][2]uint64{
		{resources.Compute, prices.Compute}, {resources.StorageRead, prices.StorageRead},
		{resources.StorageWrite, prices.StorageWrite}, {resources.Bandwidth, prices.Bandwidth},
		{resources.StateGrowth, prices.StateGrowth},
	}
	var total uint64
	for _, pair := range pairs {
		high, low := bits.Mul64(pair[0], pair[1])
		if high != 0 || total > ^uint64(0)-low {
			return 0, errors.New("resource fee overflow")
		}
		total += low
	}
	return total, nil
}

func mulDiv(value, numerator, denominator, secondary uint64) (uint64, bool) {
	if denominator == 0 || secondary == 0 {
		return 0, true
	}
	high, low := bits.Mul64(value, numerator)
	if high != 0 {
		return 0, true
	}
	return low / denominator / secondary, false
}
