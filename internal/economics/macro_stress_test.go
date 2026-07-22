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
	base := MacroStressInputs{AsOf: time.Date(2026, 7, 22, 0, 0, 0, 0, time.UTC), Seed: 20260722, Iterations: 1_000, Years: 5, OpeningSupplyYNXT: 1_000_000_000, OpeningStakedYNXT: 670_000_000, ValidatorCount: 32, LargestOperatorBPS: 1_800, BaselineAnnualTxCount: 1_000_000, AverageFeeYNXTPerTx: 5, AnnualExplicitServiceBurnYNXT: 100_000}
	base.Scenarios = []MacroStressScenario{
		{Name: "low", UsageMultiplierBPS: 3_000, UsageVolatilityBPS: 1_000, RevenueCollapseBPS: 7_000, AnnualValidatorCostYNXT: 20_000_000, TreasuryOpeningYNXT: 300_000_000, TreasuryMonthlyObligationsYNXT: 8_000_000, AnnualLiquidityIncentivesYNXT: 20_000_000, SybilLeakageBPS: 3_000, StableReserveUnits: 1_000_000_000, StableSupplyUnits: 950_000_000, StableAnnualSupplyGrowthBPS: 500, StableAnnualReserveInflowBPS: 100, GovernanceAttackProbabilityBPS: 800, GovernanceTreasuryLossBPS: 2_000, BridgeFailureProbabilityBPS: 600, BridgeTreasuryLossYNXT: 50_000_000, OracleFailureProbabilityBPS: 600, OracleStableReserveLossBPS: 1_500},
		{Name: "medium", UsageMultiplierBPS: 10_000, UsageVolatilityBPS: 2_000, RevenueCollapseBPS: 2_000, AnnualValidatorCostYNXT: 8_000_000, TreasuryOpeningYNXT: 700_000_000, TreasuryMonthlyObligationsYNXT: 5_000_000, AnnualLiquidityIncentivesYNXT: 10_000_000, SybilLeakageBPS: 1_000, StableReserveUnits: 1_050_000_000, StableSupplyUnits: 1_000_000_000, StableAnnualSupplyGrowthBPS: 200, StableAnnualReserveInflowBPS: 200, GovernanceAttackProbabilityBPS: 300, GovernanceTreasuryLossBPS: 1_000, BridgeFailureProbabilityBPS: 200, BridgeTreasuryLossYNXT: 30_000_000, OracleFailureProbabilityBPS: 200, OracleStableReserveLossBPS: 1_000},
		{Name: "high", UsageMultiplierBPS: 18_000, UsageVolatilityBPS: 2_000, RevenueCollapseBPS: 500, AnnualValidatorCostYNXT: 12_000_000, TreasuryOpeningYNXT: 900_000_000, TreasuryMonthlyObligationsYNXT: 7_000_000, AnnualLiquidityIncentivesYNXT: 30_000_000, SybilLeakageBPS: 1_500, StableReserveUnits: 1_000_000_000, StableSupplyUnits: 1_000_000_000, StableAnnualSupplyGrowthBPS: 600, StableAnnualReserveInflowBPS: 200, GovernanceAttackProbabilityBPS: 500, GovernanceTreasuryLossBPS: 1_500, BridgeFailureProbabilityBPS: 400, BridgeTreasuryLossYNXT: 60_000_000, OracleFailureProbabilityBPS: 500, OracleStableReserveLossBPS: 1_500},
	}
	return base
}
