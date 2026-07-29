package economics

import (
	"testing"
	"time"
)

func TestTreasuryStressReportsShortfallWithoutInventingFunding(t *testing.T) {
	balances := map[string]int64{"stable_reserve": 100, "validator_runway": 100, "insurance": 100, "liquidity_budget": 100, "development_public_goods": 100, "provider_obligations": 100, "emergency_reserve": 100}
	shocks := map[string]int64{"stable_reserve": 0, "validator_runway": 0, "insurance": 0, "liquidity_budget": 5_000, "development_public_goods": 0, "provider_obligations": 0, "emergency_reserve": 0}
	result, err := SimulateTreasuryStress(TreasuryStressInputs{AsOf: time.Unix(1_800_000_000, 0), BucketsYNXT: balances, MonthlyRevenueYNXT: 10, MonthlyObligationsYNXT: 250, InitialShockBPS: shocks, Months: 4})
	if err != nil {
		t.Fatal(err)
	}
	if result.InitialLossYNXT != 50 || result.FirstShortfallMonth == nil || *result.FirstShortfallMonth != 3 || result.RunwayMonths != 2 {
		t.Fatalf("unexpected Treasury stress result: %+v", result)
	}
	if result.Months[2].ObligationsPaidYNXT >= result.Months[2].ObligationsDueYNXT {
		t.Fatal("Treasury shortfall was hidden")
	}
}

func TestTreasuryStressRejectsMissingBucket(t *testing.T) {
	if _, err := SimulateTreasuryStress(TreasuryStressInputs{AsOf: time.Now(), BucketsYNXT: map[string]int64{}, InitialShockBPS: map[string]int64{}, Months: 1}); err == nil {
		t.Fatal("incomplete Treasury scenario was accepted")
	}
}
