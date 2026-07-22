package economics

import (
	"reflect"
	"testing"
	"time"
)

func TestMacroStressDeterministicCoverageAndRiskSeparation(t *testing.T) {
	in := macroStressFixture()
	first, err := SimulateMacroStress(DefaultMacroStressPolicy(), DefaultCandidatePolicy(), in)
	if err != nil {
		t.Fatal(err)
	}
	second, err := SimulateMacroStress(DefaultMacroStressPolicy(), DefaultCandidatePolicy(), in)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatal("seeded macro stress simulation is not deterministic")
	}
	if first.Forecast || first.MainnetReady || first.Coverage != "low-medium-high-seeded-monte-carlo-agent-ledgers" || len(first.Scenarios) != 3 {
		t.Fatalf("simulation overclaimed or omitted scenarios: %+v", first)
	}
	low, medium, high := first.Scenarios[0], first.Scenarios[1], first.Scenarios[2]
	if low.Name != "low" || medium.Name != "medium" || high.Name != "high" || low.Iterations != in.Iterations {
		t.Fatalf("scenario identity mismatch: %+v", first.Scenarios)
	}
	if !(low.AnnualizedNetworkRevenueYNXT.P50 < medium.AnnualizedNetworkRevenueYNXT.P50 && medium.AnnualizedNetworkRevenueYNXT.P50 < high.AnnualizedNetworkRevenueYNXT.P50) {
		t.Fatalf("usage sensitivity missing: low=%+v medium=%+v high=%+v", low.AnnualizedNetworkRevenueYNXT, medium.AnnualizedNetworkRevenueYNXT, high.AnnualizedNetworkRevenueYNXT)
	}
	for _, scenario := range first.Scenarios {
		for _, distribution := range []DistributionSummary{scenario.ClosingSupplyYNXT, scenario.CumulativeIssuanceYNXT, scenario.CumulativeBurnYNXT, scenario.ValidatorNetYNXT, scenario.TreasuryClosingYNXT, scenario.StableReserveRatioBPS} {
			if distribution.Minimum > distribution.P10 || distribution.P10 > distribution.P50 || distribution.P50 > distribution.P90 || distribution.P90 > distribution.Maximum {
				t.Fatalf("unordered percentiles in %s: %+v", scenario.Name, distribution)
			}
		}
		if scenario.MainnetReadinessGatePassBPS < 0 || scenario.MainnetReadinessGatePassBPS > BasisPoints {
			t.Fatalf("invalid gate pass rate: %+v", scenario)
		}
	}
	if medium.GovernanceAttackLossYNXT.Maximum == 0 || medium.BridgeFailureLossYNXT.Maximum == 0 || medium.OracleReserveLossUnits.Maximum == 0 || medium.SybilLeakageYNXT.P50 == 0 {
		t.Fatalf("named attack/failure coverage missing: %+v", medium)
	}
	if high.StableReserveRatioBPS.P50 >= BasisPoints {
		t.Fatalf("high-growth depeg stress did not materialize: %+v", high.StableReserveRatioBPS)
	}
}

func TestMacroStressRequiresExactScenariosAndSafeArithmetic(t *testing.T) {
	in := macroStressFixture()
	in.Scenarios[2].Name = "medium"
	if _, err := SimulateMacroStress(DefaultMacroStressPolicy(), DefaultCandidatePolicy(), in); err == nil {
		t.Fatal("duplicate scenario name accepted")
	}
	in = macroStressFixture()
	in.BaselineAnnualTxCount = 1 << 62
	in.AverageFeeYNXTPerTx = 1 << 62
	if _, err := SimulateMacroStress(DefaultMacroStressPolicy(), DefaultCandidatePolicy(), in); err == nil {
		t.Fatal("overflowing baseline accepted")
	}
}

func macroStressFixture() MacroStressInputs {
	return ReferenceMacroStressInputs(time.Date(2026, 7, 22, 0, 0, 0, 0, time.UTC))
}
