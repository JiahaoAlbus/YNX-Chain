package economics

import (
	"errors"
	"math"
	"math/rand"
	"sort"
	"time"
)

const MacroStressVersion = 1

type MacroStressPolicy struct {
	Version                     int   `json:"version"`
	FeeBurnBPS                  int64 `json:"feeBurnBps"`
	ValidatorFeeBPS             int64 `json:"validatorFeeBps"`
	ProviderFeeBPS              int64 `json:"providerFeeBps"`
	ProtocolFeeBPS              int64 `json:"protocolFeeBps"`
	TreasuryFeeBPS              int64 `json:"treasuryFeeBps"`
	ValidatorIssuanceBPS        int64 `json:"validatorIssuanceBps"`
	PublicGoodsIssuanceBPS      int64 `json:"publicGoodsIssuanceBps"`
	GrantsIssuanceBPS           int64 `json:"grantsIssuanceBps"`
	MaximumSybilLeakageBPS      int64 `json:"maximumSybilLeakageBps"`
	MinimumTreasuryRunwayMonths int64 `json:"minimumTreasuryRunwayMonths"`
}

type MacroStressScenario struct {
	Name                           string `json:"name"`
	UsageMultiplierBPS             int64  `json:"usageMultiplierBps"`
	UsageVolatilityBPS             int64  `json:"usageVolatilityBps"`
	RevenueCollapseBPS             int64  `json:"revenueCollapseBps"`
	AnnualValidatorCostYNXT        int64  `json:"annualValidatorCostYnxt"`
	TreasuryOpeningYNXT            int64  `json:"treasuryOpeningYnxt"`
	TreasuryMonthlyObligationsYNXT int64  `json:"treasuryMonthlyObligationsYnxt"`
	AnnualLiquidityIncentivesYNXT  int64  `json:"annualLiquidityIncentivesYnxt"`
	SybilLeakageBPS                int64  `json:"sybilLeakageBps"`
	StableReserveUnits             int64  `json:"stableReserveUnits"`
	StableSupplyUnits              int64  `json:"stableSupplyUnits"`
	StableAnnualSupplyGrowthBPS    int64  `json:"stableAnnualSupplyGrowthBps"`
	StableAnnualReserveInflowBPS   int64  `json:"stableAnnualReserveInflowBps"`
	GovernanceAttackProbabilityBPS int64  `json:"governanceAttackProbabilityBps"`
	GovernanceTreasuryLossBPS      int64  `json:"governanceTreasuryLossBps"`
	BridgeFailureProbabilityBPS    int64  `json:"bridgeFailureProbabilityBps"`
	BridgeTreasuryLossYNXT         int64  `json:"bridgeTreasuryLossYnxt"`
	OracleFailureProbabilityBPS    int64  `json:"oracleFailureProbabilityBps"`
	OracleStableReserveLossBPS     int64  `json:"oracleStableReserveLossBps"`
}

type MacroStressInputs struct {
	AsOf                          time.Time             `json:"asOf"`
	Seed                          int64                 `json:"seed"`
	Iterations                    int                   `json:"iterations"`
	Years                         int                   `json:"years"`
	OpeningSupplyYNXT             int64                 `json:"openingSupplyYnxt"`
	OpeningStakedYNXT             int64                 `json:"openingStakedYnxt"`
	ValidatorCount                int64                 `json:"validatorCount"`
	LargestOperatorBPS            int64                 `json:"largestOperatorBps"`
	BaselineAnnualTxCount         int64                 `json:"baselineAnnualTxCount"`
	AverageFeeYNXTPerTx           int64                 `json:"averageFeeYnxtPerTx"`
	AnnualExplicitServiceBurnYNXT int64                 `json:"annualExplicitServiceBurnYnxt"`
	Scenarios                     []MacroStressScenario `json:"scenarios"`
}

type DistributionSummary struct {
	Minimum int64 `json:"minimum"`
	P10     int64 `json:"p10"`
	P50     int64 `json:"p50"`
	P90     int64 `json:"p90"`
	Maximum int64 `json:"maximum"`
}

type MacroStressScenarioResult struct {
	Name                         string              `json:"name"`
	Iterations                   int                 `json:"iterations"`
	ClosingSupplyYNXT            DistributionSummary `json:"closingSupplyYnxt"`
	NetSupplyChangeYNXT          DistributionSummary `json:"netSupplyChangeYnxt"`
	CumulativeIssuanceYNXT       DistributionSummary `json:"cumulativeIssuanceYnxt"`
	CumulativeBurnYNXT           DistributionSummary `json:"cumulativeBurnYnxt"`
	AnnualizedNetworkRevenueYNXT DistributionSummary `json:"annualizedNetworkRevenueYnxt"`
	ValidatorNetYNXT             DistributionSummary `json:"validatorNetYnxt"`
	ProviderRevenueYNXT          DistributionSummary `json:"providerRevenueYnxt"`
	TreasuryClosingYNXT          DistributionSummary `json:"treasuryClosingYnxt"`
	TreasuryShortfallYNXT        DistributionSummary `json:"treasuryShortfallYnxt"`
	TreasuryRunwayMonths         DistributionSummary `json:"treasuryRunwayMonths"`
	StableReserveRatioBPS        DistributionSummary `json:"stableReserveRatioBps"`
	LiquidityIncentiveCostYNXT   DistributionSummary `json:"liquidityIncentiveCostYnxt"`
	SybilLeakageYNXT             DistributionSummary `json:"sybilLeakageYnxt"`
	GovernanceAttackLossYNXT     DistributionSummary `json:"governanceAttackLossYnxt"`
	BridgeFailureLossYNXT        DistributionSummary `json:"bridgeFailureLossYnxt"`
	OracleReserveLossUnits       DistributionSummary `json:"oracleReserveLossUnits"`
	MainnetReadinessGatePassBPS  int64               `json:"mainnetReadinessGatePassBps"`
}

type MacroStressSimulation struct {
	SchemaVersion int                         `json:"schemaVersion"`
	Source        string                      `json:"source"`
	AsOf          time.Time                   `json:"asOf"`
	Version       int                         `json:"version"`
	Coverage      string                      `json:"coverage"`
	Policy        MacroStressPolicy           `json:"policy"`
	Inputs        MacroStressInputs           `json:"inputs"`
	Scenarios     []MacroStressScenarioResult `json:"scenarios"`
	Forecast      bool                        `json:"forecast"`
	MainnetReady  bool                        `json:"mainnetReady"`
	Warnings      []string                    `json:"warnings"`
}

type macroTrial struct {
	closingSupply, netSupply, issuance, burn, annualRevenue int64
	validatorNet, providerRevenue                           int64
	treasuryClosing, treasuryShortfall, treasuryRunway      int64
	stableRatio, liquidityCost, sybilLeakage                int64
	governanceLoss, bridgeLoss, oracleLoss                  int64
	gatePassed                                              bool
}

func DefaultMacroStressPolicy() MacroStressPolicy {
	return MacroStressPolicy{Version: MacroStressVersion, FeeBurnBPS: 6_000, ValidatorFeeBPS: 2_000, ProviderFeeBPS: 800, ProtocolFeeBPS: 600, TreasuryFeeBPS: 600, ValidatorIssuanceBPS: 7_000, PublicGoodsIssuanceBPS: 2_000, GrantsIssuanceBPS: 1_000, MaximumSybilLeakageBPS: 2_000, MinimumTreasuryRunwayMonths: 12}
}

// ReferenceMacroStressInputs returns the public, versioned sensitivity case.
// Its values are assumptions for reproducible review, not observed telemetry.
func ReferenceMacroStressInputs(asOf time.Time) MacroStressInputs {
	inputs := MacroStressInputs{AsOf: asOf.UTC(), Seed: 20260722, Iterations: 1_000, Years: 5, OpeningSupplyYNXT: 1_000_000_000, OpeningStakedYNXT: 670_000_000, ValidatorCount: 32, LargestOperatorBPS: 1_800, BaselineAnnualTxCount: 1_000_000, AverageFeeYNXTPerTx: 5, AnnualExplicitServiceBurnYNXT: 100_000}
	inputs.Scenarios = []MacroStressScenario{
		{Name: "low", UsageMultiplierBPS: 3_000, UsageVolatilityBPS: 1_000, RevenueCollapseBPS: 7_000, AnnualValidatorCostYNXT: 20_000_000, TreasuryOpeningYNXT: 300_000_000, TreasuryMonthlyObligationsYNXT: 8_000_000, AnnualLiquidityIncentivesYNXT: 20_000_000, SybilLeakageBPS: 3_000, StableReserveUnits: 1_000_000_000, StableSupplyUnits: 950_000_000, StableAnnualSupplyGrowthBPS: 500, StableAnnualReserveInflowBPS: 100, GovernanceAttackProbabilityBPS: 800, GovernanceTreasuryLossBPS: 2_000, BridgeFailureProbabilityBPS: 600, BridgeTreasuryLossYNXT: 50_000_000, OracleFailureProbabilityBPS: 600, OracleStableReserveLossBPS: 1_500},
		{Name: "medium", UsageMultiplierBPS: 10_000, UsageVolatilityBPS: 2_000, RevenueCollapseBPS: 2_000, AnnualValidatorCostYNXT: 8_000_000, TreasuryOpeningYNXT: 700_000_000, TreasuryMonthlyObligationsYNXT: 5_000_000, AnnualLiquidityIncentivesYNXT: 10_000_000, SybilLeakageBPS: 1_000, StableReserveUnits: 1_050_000_000, StableSupplyUnits: 1_000_000_000, StableAnnualSupplyGrowthBPS: 200, StableAnnualReserveInflowBPS: 200, GovernanceAttackProbabilityBPS: 300, GovernanceTreasuryLossBPS: 1_000, BridgeFailureProbabilityBPS: 200, BridgeTreasuryLossYNXT: 30_000_000, OracleFailureProbabilityBPS: 200, OracleStableReserveLossBPS: 1_000},
		{Name: "high", UsageMultiplierBPS: 18_000, UsageVolatilityBPS: 2_000, RevenueCollapseBPS: 500, AnnualValidatorCostYNXT: 12_000_000, TreasuryOpeningYNXT: 900_000_000, TreasuryMonthlyObligationsYNXT: 7_000_000, AnnualLiquidityIncentivesYNXT: 30_000_000, SybilLeakageBPS: 1_500, StableReserveUnits: 1_000_000_000, StableSupplyUnits: 1_000_000_000, StableAnnualSupplyGrowthBPS: 600, StableAnnualReserveInflowBPS: 200, GovernanceAttackProbabilityBPS: 500, GovernanceTreasuryLossBPS: 1_500, BridgeFailureProbabilityBPS: 400, BridgeTreasuryLossYNXT: 60_000_000, OracleFailureProbabilityBPS: 500, OracleStableReserveLossBPS: 1_500},
	}
	return inputs
}

func (p MacroStressPolicy) Validate() error {
	feeTotal := p.FeeBurnBPS + p.ValidatorFeeBPS + p.ProviderFeeBPS + p.ProtocolFeeBPS + p.TreasuryFeeBPS
	issuanceTotal := p.ValidatorIssuanceBPS + p.PublicGoodsIssuanceBPS + p.GrantsIssuanceBPS
	if p.Version != MacroStressVersion || feeTotal != BasisPoints || issuanceTotal != BasisPoints || p.MaximumSybilLeakageBPS < 0 || p.MaximumSybilLeakageBPS > BasisPoints || p.MinimumTreasuryRunwayMonths < 1 {
		return errors.New("macro stress policy is incomplete or unreconciled")
	}
	for _, value := range []int64{p.FeeBurnBPS, p.ValidatorFeeBPS, p.ProviderFeeBPS, p.ProtocolFeeBPS, p.TreasuryFeeBPS, p.ValidatorIssuanceBPS, p.PublicGoodsIssuanceBPS, p.GrantsIssuanceBPS} {
		if value < 0 || value > BasisPoints {
			return errors.New("macro stress policy basis points are outside bounds")
		}
	}
	return nil
}

func SimulateMacroStress(policy MacroStressPolicy, issuancePolicy Policy, in MacroStressInputs) (MacroStressSimulation, error) {
	if err := policy.Validate(); err != nil {
		return MacroStressSimulation{}, err
	}
	if err := issuancePolicy.Validate(); err != nil {
		return MacroStressSimulation{}, err
	}
	if err := validateMacroStressInputs(in); err != nil {
		return MacroStressSimulation{}, err
	}
	result := MacroStressSimulation{SchemaVersion: 1, Source: "user-supplied-seeded-monte-carlo-input", AsOf: in.AsOf.UTC(), Version: MacroStressVersion, Coverage: "low-medium-high-seeded-monte-carlo-agent-ledgers", Policy: policy, Inputs: in, Scenarios: make([]MacroStressScenarioResult, 0, len(in.Scenarios)), Forecast: false, MainnetReady: false, Warnings: []string{"Stress distributions are deterministic outputs from user-supplied assumptions, not forecasts, prices, APY, reserve attestations, or guaranteed outcomes.", "Validator, provider, Treasury, stable-reserve, liquidity-incentive and attacker ledgers are modeled separately; burn is never revenue.", "Mainnet readiness pass rate is a scenario gate, not approval or evidence of deployment, governance, custody, legal review, or live scale."}}
	for index, scenario := range in.Scenarios {
		rng := rand.New(rand.NewSource(in.Seed + int64(index)*1_000_003))
		trials := make([]macroTrial, 0, in.Iterations)
		for i := 0; i < in.Iterations; i++ {
			trial, err := runMacroTrial(policy, issuancePolicy, in, scenario, rng)
			if err != nil {
				return MacroStressSimulation{}, err
			}
			trials = append(trials, trial)
		}
		result.Scenarios = append(result.Scenarios, summarizeMacroTrials(scenario.Name, trials))
	}
	return result, nil
}

func validateMacroStressInputs(in MacroStressInputs) error {
	maximumInput := int64(math.MaxInt64 / 1_000_000)
	if in.AsOf.IsZero() || in.Iterations < 100 || in.Iterations > 100_000 || in.Years < 1 || in.Years > 50 || in.OpeningSupplyYNXT < 1 || in.OpeningSupplyYNXT > maximumInput || in.OpeningStakedYNXT < 0 || in.OpeningStakedYNXT > in.OpeningSupplyYNXT || in.ValidatorCount < 1 || in.LargestOperatorBPS < 0 || in.LargestOperatorBPS > BasisPoints || in.BaselineAnnualTxCount < 1 || in.AverageFeeYNXTPerTx < 0 || in.AnnualExplicitServiceBurnYNXT < 0 || in.AnnualExplicitServiceBurnYNXT > maximumInput || len(in.Scenarios) != 3 {
		return errors.New("macro stress inputs are incomplete or outside bounds")
	}
	baselineFees, err := checkedMultiply(in.BaselineAnnualTxCount, in.AverageFeeYNXTPerTx)
	if err != nil || baselineFees > maximumInput {
		return errors.New("macro stress baseline fee volume is outside arithmetic bounds")
	}
	names := map[string]bool{}
	for _, scenario := range in.Scenarios {
		if scenario.Name != "low" && scenario.Name != "medium" && scenario.Name != "high" || names[scenario.Name] {
			return errors.New("macro stress requires unique low, medium and high scenarios")
		}
		names[scenario.Name] = true
		if scenario.UsageMultiplierBPS < 0 || scenario.UsageMultiplierBPS > 2*BasisPoints || scenario.UsageVolatilityBPS < 0 || scenario.UsageVolatilityBPS > BasisPoints {
			return errors.New("macro stress usage assumptions are outside bounds")
		}
		values := []int64{scenario.RevenueCollapseBPS, scenario.SybilLeakageBPS, scenario.StableAnnualSupplyGrowthBPS, scenario.StableAnnualReserveInflowBPS, scenario.GovernanceAttackProbabilityBPS, scenario.GovernanceTreasuryLossBPS, scenario.BridgeFailureProbabilityBPS, scenario.OracleFailureProbabilityBPS, scenario.OracleStableReserveLossBPS}
		for _, value := range values {
			if value < 0 || value > BasisPoints {
				return errors.New("macro stress scenario basis points are outside bounds")
			}
		}
		if scenario.AnnualValidatorCostYNXT < 0 || scenario.AnnualValidatorCostYNXT > maximumInput || scenario.TreasuryOpeningYNXT < 0 || scenario.TreasuryOpeningYNXT > maximumInput || scenario.TreasuryMonthlyObligationsYNXT < 0 || scenario.TreasuryMonthlyObligationsYNXT > maximumInput/12 || scenario.AnnualLiquidityIncentivesYNXT < 0 || scenario.AnnualLiquidityIncentivesYNXT > maximumInput || scenario.StableReserveUnits < 1 || scenario.StableReserveUnits > maximumInput || scenario.StableSupplyUnits < 1 || scenario.StableSupplyUnits > maximumInput || scenario.BridgeTreasuryLossYNXT < 0 || scenario.BridgeTreasuryLossYNXT > maximumInput {
			return errors.New("macro stress scenario balances are outside bounds")
		}
	}
	return nil
}

func runMacroTrial(policy MacroStressPolicy, issuancePolicy Policy, in MacroStressInputs, scenario MacroStressScenario, rng *rand.Rand) (macroTrial, error) {
	supply, staked := in.OpeningSupplyYNXT, in.OpeningStakedYNXT
	treasury, reserve, stableSupply := scenario.TreasuryOpeningYNXT, scenario.StableReserveUnits, scenario.StableSupplyUnits
	trial := macroTrial{}
	for year := 0; year < in.Years; year++ {
		usageBPS := randomBand(rng, scenario.UsageMultiplierBPS, scenario.UsageVolatilityBPS)
		txCount, err := mulDiv(in.BaselineAnnualTxCount, usageBPS, BasisPoints)
		if err != nil {
			return macroTrial{}, err
		}
		fees, err := checkedMultiply(txCount, in.AverageFeeYNXTPerTx)
		if err != nil {
			return macroTrial{}, err
		}
		fees, _ = mulDiv(fees, BasisPoints-scenario.RevenueCollapseBPS, BasisPoints)
		issuanceRate := issuanceRate(issuancePolicy, Inputs{StakedSupplyYNXT: staked, ValidatorCount: in.ValidatorCount, LargestOperatorBPS: in.LargestOperatorBPS, AnnualNetworkFeesYNXT: fees}, supply)
		issuance, err := mulDiv(supply, issuanceRate, BasisPoints)
		if err != nil {
			return macroTrial{}, err
		}
		feeBurn, _ := mulDiv(fees, policy.FeeBurnBPS, BasisPoints)
		burn := feeBurn + in.AnnualExplicitServiceBurnYNXT
		if burn > supply+issuance {
			burn = supply + issuance
		}
		if supply > math.MaxInt64-issuance {
			return macroTrial{}, errors.New("macro stress supply overflow")
		}
		supply = supply + issuance - burn
		staked, _ = mulDiv(supply, in.OpeningStakedYNXT, in.OpeningSupplyYNXT)
		validatorIssuance, _ := mulDiv(issuance, policy.ValidatorIssuanceBPS, BasisPoints)
		validatorFees, _ := mulDiv(fees, policy.ValidatorFeeBPS, BasisPoints)
		providerFees, _ := mulDiv(fees, policy.ProviderFeeBPS, BasisPoints)
		treasuryFees, _ := mulDiv(fees, policy.TreasuryFeeBPS, BasisPoints)
		publicGoods, _ := mulDiv(issuance, policy.PublicGoodsIssuanceBPS+policy.GrantsIssuanceBPS, BasisPoints)
		trial.validatorNet += validatorIssuance + validatorFees - scenario.AnnualValidatorCostYNXT
		trial.providerRevenue += providerFees
		trial.issuance += issuance
		trial.burn += burn
		trial.annualRevenue += fees
		treasuryInflow := treasuryFees + publicGoods
		annualObligations, err := checkedMultiply(scenario.TreasuryMonthlyObligationsYNXT, 12)
		if err != nil {
			return macroTrial{}, err
		}
		if annualObligations > math.MaxInt64-scenario.AnnualLiquidityIncentivesYNXT {
			return macroTrial{}, errors.New("macro stress expense overflow")
		}
		expenses := annualObligations + scenario.AnnualLiquidityIncentivesYNXT
		trial.liquidityCost += scenario.AnnualLiquidityIncentivesYNXT
		sybil, _ := mulDiv(scenario.AnnualLiquidityIncentivesYNXT, scenario.SybilLeakageBPS, BasisPoints)
		trial.sybilLeakage += sybil
		if randomEvent(rng, scenario.GovernanceAttackProbabilityBPS) {
			loss, _ := mulDiv(treasury, scenario.GovernanceTreasuryLossBPS, BasisPoints)
			trial.governanceLoss += loss
			if expenses > math.MaxInt64-loss {
				return macroTrial{}, errors.New("macro stress governance loss overflow")
			}
			expenses += loss
		}
		if randomEvent(rng, scenario.BridgeFailureProbabilityBPS) {
			trial.bridgeLoss += scenario.BridgeTreasuryLossYNXT
			if expenses > math.MaxInt64-scenario.BridgeTreasuryLossYNXT {
				return macroTrial{}, errors.New("macro stress bridge loss overflow")
			}
			expenses += scenario.BridgeTreasuryLossYNXT
		}
		if treasury > math.MaxInt64-treasuryInflow {
			return macroTrial{}, errors.New("macro stress treasury overflow")
		}
		available := treasury + treasuryInflow
		if expenses > available {
			trial.treasuryShortfall += expenses - available
			treasury = 0
		} else {
			treasury = available - expenses
		}
		reserveInflow, _ := mulDiv(reserve, scenario.StableAnnualReserveInflowBPS, BasisPoints)
		if reserve > math.MaxInt64-reserveInflow {
			return macroTrial{}, errors.New("macro stress reserve overflow")
		}
		reserve += reserveInflow
		stableGrowth, _ := mulDiv(stableSupply, scenario.StableAnnualSupplyGrowthBPS, BasisPoints)
		if stableSupply > math.MaxInt64-stableGrowth {
			return macroTrial{}, errors.New("macro stress stable supply overflow")
		}
		stableSupply += stableGrowth
		if randomEvent(rng, scenario.OracleFailureProbabilityBPS) {
			loss, _ := mulDiv(reserve, scenario.OracleStableReserveLossBPS, BasisPoints)
			reserve -= loss
			trial.oracleLoss += loss
		}
	}
	trial.closingSupply = supply
	trial.netSupply = supply - in.OpeningSupplyYNXT
	trial.annualRevenue /= int64(in.Years)
	trial.treasuryClosing = treasury
	monthlyNetExpense := scenario.TreasuryMonthlyObligationsYNXT
	if monthlyNetExpense > 0 {
		trial.treasuryRunway = minInt64(120, treasury/monthlyNetExpense)
	} else {
		trial.treasuryRunway = 120
	}
	trial.stableRatio, _ = mulDiv(reserve, BasisPoints, stableSupply)
	trial.gatePassed = trial.validatorNet >= 0 && trial.treasuryShortfall == 0 && trial.treasuryRunway >= policy.MinimumTreasuryRunwayMonths && trial.stableRatio >= BasisPoints && scenario.SybilLeakageBPS <= policy.MaximumSybilLeakageBPS && trial.governanceLoss == 0 && trial.bridgeLoss == 0 && trial.oracleLoss == 0
	return trial, nil
}

func randomBand(rng *rand.Rand, center, width int64) int64 {
	minimum := center - width
	if minimum < 0 {
		minimum = 0
	}
	maximum := center + width
	if maximum > 2*BasisPoints {
		maximum = 2 * BasisPoints
	}
	if maximum <= minimum {
		return minimum
	}
	return minimum + rng.Int63n(maximum-minimum+1)
}

func randomEvent(rng *rand.Rand, probabilityBPS int64) bool {
	return probabilityBPS > 0 && rng.Int63n(BasisPoints) < probabilityBPS
}

func summarizeMacroTrials(name string, trials []macroTrial) MacroStressScenarioResult {
	values := func(selectValue func(macroTrial) int64) DistributionSummary {
		items := make([]int64, len(trials))
		for i, trial := range trials {
			items[i] = selectValue(trial)
		}
		sort.Slice(items, func(i, j int) bool { return items[i] < items[j] })
		return DistributionSummary{Minimum: items[0], P10: percentile(items, 10), P50: percentile(items, 50), P90: percentile(items, 90), Maximum: items[len(items)-1]}
	}
	passes := int64(0)
	for _, trial := range trials {
		if trial.gatePassed {
			passes++
		}
	}
	return MacroStressScenarioResult{Name: name, Iterations: len(trials), ClosingSupplyYNXT: values(func(v macroTrial) int64 { return v.closingSupply }), NetSupplyChangeYNXT: values(func(v macroTrial) int64 { return v.netSupply }), CumulativeIssuanceYNXT: values(func(v macroTrial) int64 { return v.issuance }), CumulativeBurnYNXT: values(func(v macroTrial) int64 { return v.burn }), AnnualizedNetworkRevenueYNXT: values(func(v macroTrial) int64 { return v.annualRevenue }), ValidatorNetYNXT: values(func(v macroTrial) int64 { return v.validatorNet }), ProviderRevenueYNXT: values(func(v macroTrial) int64 { return v.providerRevenue }), TreasuryClosingYNXT: values(func(v macroTrial) int64 { return v.treasuryClosing }), TreasuryShortfallYNXT: values(func(v macroTrial) int64 { return v.treasuryShortfall }), TreasuryRunwayMonths: values(func(v macroTrial) int64 { return v.treasuryRunway }), StableReserveRatioBPS: values(func(v macroTrial) int64 { return v.stableRatio }), LiquidityIncentiveCostYNXT: values(func(v macroTrial) int64 { return v.liquidityCost }), SybilLeakageYNXT: values(func(v macroTrial) int64 { return v.sybilLeakage }), GovernanceAttackLossYNXT: values(func(v macroTrial) int64 { return v.governanceLoss }), BridgeFailureLossYNXT: values(func(v macroTrial) int64 { return v.bridgeLoss }), OracleReserveLossUnits: values(func(v macroTrial) int64 { return v.oracleLoss }), MainnetReadinessGatePassBPS: passes * BasisPoints / int64(len(trials))}
}

func percentile(sorted []int64, percent int) int64 {
	index := (len(sorted) - 1) * percent / 100
	return sorted[index]
}
