package economics

import (
	"errors"
	"fmt"
	"math"
	"time"
)

const (
	PolicyVersion = 1
	BasisPoints   = int64(10_000)
)

// Policy is a governance-bounded candidate. It is not active chain state until
// a separately versioned consensus migration adopts its exact hash.
type Policy struct {
	Version                    int   `json:"version"`
	AnnualIssuanceFloorBPS     int64 `json:"annualIssuanceFloorBps"`
	AnnualIssuanceCeilingBPS   int64 `json:"annualIssuanceCeilingBps"`
	TargetStakedRatioBPS       int64 `json:"targetStakedRatioBps"`
	StakedRatioResponseBPS     int64 `json:"stakedRatioResponseBps"`
	MinValidatorCount          int64 `json:"minValidatorCount"`
	ValidatorDeficitBPS        int64 `json:"validatorDeficitBps"`
	MaxConcentrationBPS        int64 `json:"maxConcentrationBps"`
	ConcentrationResponseBPS   int64 `json:"concentrationResponseBps"`
	RevenueOffsetBPS           int64 `json:"revenueOffsetBps"`
	MaxAnnualParameterDeltaBPS int64 `json:"maxAnnualParameterDeltaBps"`
	GovernanceTimelockSeconds  int64 `json:"governanceTimelockSeconds"`
	BaseFeeBurnBPS             int64 `json:"baseFeeBurnBps"`
	ValidatorFeeShareBPS       int64 `json:"validatorFeeShareBps"`
	ProviderFeeShareBPS        int64 `json:"providerFeeShareBps"`
	ProtocolFeeShareBPS        int64 `json:"protocolFeeShareBps"`
	TreasuryFeeShareBPS        int64 `json:"treasuryFeeShareBps"`
}

type Inputs struct {
	AsOf                  time.Time `json:"asOf"`
	TotalSupplyYNXT       int64     `json:"totalSupplyYnxt"`
	StakedSupplyYNXT      int64     `json:"stakedSupplyYnxt"`
	ValidatorCount        int64     `json:"validatorCount"`
	LargestOperatorBPS    int64     `json:"largestOperatorBps"`
	AnnualNetworkFeesYNXT int64     `json:"annualNetworkFeesYnxt"`
	AnnualServiceBurnYNXT int64     `json:"annualServiceBurnYnxt"`
	Years                 int       `json:"years"`
}

type YearResult struct {
	Year                 int   `json:"year"`
	OpeningSupplyYNXT    int64 `json:"openingSupplyYnxt"`
	IssuanceRateBPS      int64 `json:"issuanceRateBps"`
	IssuanceYNXT         int64 `json:"issuanceYnxt"`
	BaseFeeBurnYNXT      int64 `json:"baseFeeBurnYnxt"`
	ServiceBurnYNXT      int64 `json:"serviceBurnYnxt"`
	TotalBurnYNXT        int64 `json:"totalBurnYnxt"`
	ValidatorRevenueYNXT int64 `json:"validatorRevenueYnxt"`
	ProviderRevenueYNXT  int64 `json:"providerRevenueYnxt"`
	ProtocolRevenueYNXT  int64 `json:"protocolRevenueYnxt"`
	TreasuryRevenueYNXT  int64 `json:"treasuryRevenueYnxt"`
	ClosingSupplyYNXT    int64 `json:"closingSupplyYnxt"`
}

type Simulation struct {
	SchemaVersion int          `json:"schemaVersion"`
	Source        string       `json:"source"`
	AsOf          time.Time    `json:"asOf"`
	Policy        Policy       `json:"policy"`
	Inputs        Inputs       `json:"inputs"`
	Years         []YearResult `json:"years"`
	Warnings      []string     `json:"warnings"`
}

func DefaultCandidatePolicy() Policy {
	return Policy{Version: PolicyVersion, AnnualIssuanceFloorBPS: 100, AnnualIssuanceCeilingBPS: 800, TargetStakedRatioBPS: 6_700, StakedRatioResponseBPS: 400, MinValidatorCount: 32, ValidatorDeficitBPS: 150, MaxConcentrationBPS: 2_000, ConcentrationResponseBPS: 200, RevenueOffsetBPS: 5_000, MaxAnnualParameterDeltaBPS: 100, GovernanceTimelockSeconds: 604_800, BaseFeeBurnBPS: 10_000, ValidatorFeeShareBPS: 7_000, ProviderFeeShareBPS: 1_000, ProtocolFeeShareBPS: 1_000, TreasuryFeeShareBPS: 1_000}
}

func (p Policy) Validate() error {
	if p.Version != PolicyVersion {
		return fmt.Errorf("unsupported economics policy version %d", p.Version)
	}
	for name, value := range map[string]int64{"issuance floor": p.AnnualIssuanceFloorBPS, "issuance ceiling": p.AnnualIssuanceCeilingBPS, "target staked ratio": p.TargetStakedRatioBPS, "staked response": p.StakedRatioResponseBPS, "validator deficit": p.ValidatorDeficitBPS, "max concentration": p.MaxConcentrationBPS, "concentration response": p.ConcentrationResponseBPS, "revenue offset": p.RevenueOffsetBPS, "parameter delta": p.MaxAnnualParameterDeltaBPS, "base fee burn": p.BaseFeeBurnBPS, "validator fee share": p.ValidatorFeeShareBPS, "provider fee share": p.ProviderFeeShareBPS, "protocol fee share": p.ProtocolFeeShareBPS, "treasury fee share": p.TreasuryFeeShareBPS} {
		if value < 0 || value > BasisPoints {
			return fmt.Errorf("%s must be between 0 and %d bps", name, BasisPoints)
		}
	}
	if p.AnnualIssuanceFloorBPS > p.AnnualIssuanceCeilingBPS || p.MinValidatorCount < 1 || p.GovernanceTimelockSeconds < 86_400 {
		return errors.New("economics policy has invalid floor, validator count, or timelock")
	}
	if p.ValidatorFeeShareBPS+p.ProviderFeeShareBPS+p.ProtocolFeeShareBPS+p.TreasuryFeeShareBPS != BasisPoints {
		return errors.New("non-burn fee shares must total 10000 bps")
	}
	return nil
}

func Simulate(policy Policy, in Inputs) (Simulation, error) {
	if err := policy.Validate(); err != nil {
		return Simulation{}, err
	}
	if in.AsOf.IsZero() || in.TotalSupplyYNXT <= 0 || in.StakedSupplyYNXT < 0 || in.StakedSupplyYNXT > in.TotalSupplyYNXT || in.ValidatorCount < 1 || in.LargestOperatorBPS < 0 || in.LargestOperatorBPS > BasisPoints || in.AnnualNetworkFeesYNXT < 0 || in.AnnualServiceBurnYNXT < 0 || in.Years < 1 || in.Years > 100 {
		return Simulation{}, errors.New("simulation inputs are incomplete or outside safety bounds")
	}
	result := Simulation{SchemaVersion: 1, Source: "user-supplied-simulation-input", AsOf: in.AsOf.UTC(), Policy: policy, Inputs: in, Years: make([]YearResult, 0, in.Years), Warnings: []string{"Candidate simulation only; no guaranteed APY, price, peg, liquidity, revenue, or governance outcome.", "Burn is supply destruction and is not revenue."}}
	supply := in.TotalSupplyYNXT
	for year := 1; year <= in.Years; year++ {
		rate := issuanceRate(policy, in, supply)
		issuance, err := mulBPS(supply, rate)
		if err != nil {
			return Simulation{}, err
		}
		baseBurn, err := mulBPS(in.AnnualNetworkFeesYNXT, policy.BaseFeeBurnBPS)
		if err != nil {
			return Simulation{}, err
		}
		distributable := in.AnnualNetworkFeesYNXT - baseBurn
		validatorRevenue, _ := mulBPS(distributable, policy.ValidatorFeeShareBPS)
		providerRevenue, _ := mulBPS(distributable, policy.ProviderFeeShareBPS)
		protocolRevenue, _ := mulBPS(distributable, policy.ProtocolFeeShareBPS)
		treasuryRevenue := distributable - validatorRevenue - providerRevenue - protocolRevenue
		totalBurn := baseBurn + in.AnnualServiceBurnYNXT
		if totalBurn > supply+issuance {
			totalBurn = supply + issuance
		}
		closing := supply + issuance - totalBurn
		result.Years = append(result.Years, YearResult{Year: year, OpeningSupplyYNXT: supply, IssuanceRateBPS: rate, IssuanceYNXT: issuance, BaseFeeBurnYNXT: baseBurn, ServiceBurnYNXT: totalBurn - baseBurn, TotalBurnYNXT: totalBurn, ValidatorRevenueYNXT: validatorRevenue, ProviderRevenueYNXT: providerRevenue, ProtocolRevenueYNXT: protocolRevenue, TreasuryRevenueYNXT: treasuryRevenue, ClosingSupplyYNXT: closing})
		supply = closing
	}
	return result, nil
}

func issuanceRate(p Policy, in Inputs, supply int64) int64 {
	rate := p.AnnualIssuanceFloorBPS
	stakedRatio := in.StakedSupplyYNXT * BasisPoints / supply
	if stakedRatio < p.TargetStakedRatioBPS {
		rate += (p.TargetStakedRatioBPS - stakedRatio) * p.StakedRatioResponseBPS / BasisPoints
	}
	if in.ValidatorCount < p.MinValidatorCount {
		rate += (p.MinValidatorCount - in.ValidatorCount) * p.ValidatorDeficitBPS / p.MinValidatorCount
	}
	if in.LargestOperatorBPS > p.MaxConcentrationBPS {
		rate += (in.LargestOperatorBPS - p.MaxConcentrationBPS) * p.ConcentrationResponseBPS / BasisPoints
	}
	if in.AnnualNetworkFeesYNXT > 0 {
		offset := in.AnnualNetworkFeesYNXT * BasisPoints / supply * p.RevenueOffsetBPS / BasisPoints
		rate -= offset
	}
	if rate < p.AnnualIssuanceFloorBPS {
		return p.AnnualIssuanceFloorBPS
	}
	if rate > p.AnnualIssuanceCeilingBPS {
		return p.AnnualIssuanceCeilingBPS
	}
	return rate
}

func mulBPS(value, bps int64) (int64, error) {
	if value < 0 || bps < 0 || value > math.MaxInt64/BasisPoints {
		return 0, errors.New("economic calculation overflow or negative value")
	}
	return value * bps / BasisPoints, nil
}
