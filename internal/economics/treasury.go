package economics

import (
	"errors"
	"math"
	"sort"
	"time"
)

var TreasuryBucketIDs = []string{"stable_reserve", "validator_runway", "insurance", "liquidity_budget", "development_public_goods", "provider_obligations", "emergency_reserve"}

type TreasuryStressInputs struct {
	AsOf                   time.Time        `json:"asOf"`
	BucketsYNXT            map[string]int64 `json:"bucketsYnxt"`
	MonthlyRevenueYNXT     int64            `json:"monthlyRevenueYnxt"`
	MonthlyObligationsYNXT int64            `json:"monthlyObligationsYnxt"`
	InitialShockBPS        map[string]int64 `json:"initialShockBps"`
	Months                 int              `json:"months"`
}
type TreasuryMonth struct {
	Month               int              `json:"month"`
	OpeningYNXT         int64            `json:"openingYnxt"`
	RevenueYNXT         int64            `json:"revenueYnxt"`
	ObligationsDueYNXT  int64            `json:"obligationsDueYnxt"`
	ObligationsPaidYNXT int64            `json:"obligationsPaidYnxt"`
	ClosingYNXT         int64            `json:"closingYnxt"`
	BucketsYNXT         map[string]int64 `json:"bucketsYnxt"`
}
type TreasuryStressResult struct {
	SchemaVersion       int                  `json:"schemaVersion"`
	Source              string               `json:"source"`
	AsOf                time.Time            `json:"asOf"`
	Version             int                  `json:"version"`
	Coverage            string               `json:"coverage"`
	Inputs              TreasuryStressInputs `json:"inputs"`
	InitialLossYNXT     int64                `json:"initialLossYnxt"`
	RunwayMonths        int                  `json:"runwayMonths"`
	FirstShortfallMonth *int                 `json:"firstShortfallMonth"`
	Months              []TreasuryMonth      `json:"months"`
	Warnings            []string             `json:"warnings"`
}

func SimulateTreasuryStress(in TreasuryStressInputs) (TreasuryStressResult, error) {
	if in.AsOf.IsZero() || in.Months < 1 || in.Months > 120 || in.MonthlyRevenueYNXT < 0 || in.MonthlyObligationsYNXT < 0 {
		return TreasuryStressResult{}, errors.New("Treasury stress inputs are incomplete or outside bounds")
	}
	if err := validateTreasuryMaps(in.BucketsYNXT, in.InitialShockBPS); err != nil {
		return TreasuryStressResult{}, err
	}
	balances := copyIntMap(in.BucketsYNXT)
	initialBefore, err := sumIntMap(balances)
	if err != nil {
		return TreasuryStressResult{}, err
	}
	for _, id := range TreasuryBucketIDs {
		loss, err := mulBPS(balances[id], in.InitialShockBPS[id])
		if err != nil {
			return TreasuryStressResult{}, err
		}
		balances[id] -= loss
	}
	initialAfter, _ := sumIntMap(balances)
	result := TreasuryStressResult{SchemaVersion: 1, Source: "user-supplied-treasury-stress-input", AsOf: in.AsOf.UTC(), Version: 1, Coverage: "deterministic-scenario-not-live-treasury-authority", Inputs: in, InitialLossYNXT: initialBefore - initialAfter, RunwayMonths: in.Months, Months: make([]TreasuryMonth, 0, in.Months), Warnings: []string{"Scenario output is not a forecast, reserve attestation, custody proof, or guaranteed runway.", "No secret market support, price support, leverage, or rehypothecation is modeled."}}
	waterfall := []string{"provider_obligations", "stable_reserve", "emergency_reserve", "validator_runway", "insurance", "development_public_goods", "liquidity_budget"}
	for month := 1; month <= in.Months; month++ {
		opening, _ := sumIntMap(balances)
		if balances["stable_reserve"] > math.MaxInt64-in.MonthlyRevenueYNXT {
			return TreasuryStressResult{}, errors.New("Treasury revenue overflow")
		}
		balances["stable_reserve"] += in.MonthlyRevenueYNXT
		remaining := in.MonthlyObligationsYNXT
		for _, id := range waterfall {
			paid := balances[id]
			if paid > remaining {
				paid = remaining
			}
			balances[id] -= paid
			remaining -= paid
			if remaining == 0 {
				break
			}
		}
		paid := in.MonthlyObligationsYNXT - remaining
		closing, _ := sumIntMap(balances)
		result.Months = append(result.Months, TreasuryMonth{Month: month, OpeningYNXT: opening, RevenueYNXT: in.MonthlyRevenueYNXT, ObligationsDueYNXT: in.MonthlyObligationsYNXT, ObligationsPaidYNXT: paid, ClosingYNXT: closing, BucketsYNXT: copyIntMap(balances)})
		if remaining > 0 && result.FirstShortfallMonth == nil {
			value := month
			result.FirstShortfallMonth = &value
			result.RunwayMonths = month - 1
		}
	}
	return result, nil
}

func validateTreasuryMaps(balances, shocks map[string]int64) error {
	if len(balances) != len(TreasuryBucketIDs) || len(shocks) != len(TreasuryBucketIDs) {
		return errors.New("Treasury scenario requires every canonical bucket exactly once")
	}
	allowed := map[string]bool{}
	for _, id := range TreasuryBucketIDs {
		allowed[id] = true
		if balances[id] < 0 || shocks[id] < 0 || shocks[id] > BasisPoints {
			return errors.New("Treasury balance or shock is outside bounds")
		}
	}
	for id := range balances {
		if !allowed[id] {
			return errors.New("Treasury scenario contains unknown bucket")
		}
	}
	for id := range shocks {
		if !allowed[id] {
			return errors.New("Treasury scenario contains unknown shock bucket")
		}
	}
	return nil
}
func copyIntMap(in map[string]int64) map[string]int64 {
	out := make(map[string]int64, len(in))
	keys := make([]string, 0, len(in))
	for key := range in {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		out[key] = in[key]
	}
	return out
}
func sumIntMap(in map[string]int64) (int64, error) {
	var total int64
	for _, value := range in {
		if value < 0 || total > math.MaxInt64-value {
			return 0, errors.New("Treasury total overflow")
		}
		total += value
	}
	return total, nil
}
