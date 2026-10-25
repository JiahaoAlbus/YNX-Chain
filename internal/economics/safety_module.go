package economics

import (
	"encoding/hex"
	"errors"
	"math"
	"sort"
	"strings"
	"time"
)

const SafetyModuleVersion = 1

type SafetyModulePolicy struct {
	Version         int   `json:"version"`
	StakeCapYNXT    int64 `json:"stakeCapYnxt"`
	CooldownSeconds int64 `json:"cooldownSeconds"`
	MaximumSlashBPS int64 `json:"maximumSlashBps"`
}

type SafetyModuleStake struct {
	Participant         string     `json:"participant"`
	AmountYNXT          int64      `json:"amountYnxt"`
	Provenance          string     `json:"provenance"`
	Status              string     `json:"status"`
	CooldownRequestedAt *time.Time `json:"cooldownRequestedAt,omitempty"`
}

type SafetyModuleInputs struct {
	AsOf                   time.Time           `json:"asOf"`
	InsuranceReserveYNXT   int64               `json:"insuranceReserveYnxt"`
	ShortfallYNXT          int64               `json:"shortfallYnxt"`
	SlashReason            string              `json:"slashReason"`
	EvidenceHash           string              `json:"evidenceHash"`
	GovernanceApproved     bool                `json:"governanceApproved"`
	FormalModelComplete    bool                `json:"formalModelComplete"`
	EconomicReviewComplete bool                `json:"economicReviewComplete"`
	SecurityAuditComplete  bool                `json:"securityAuditComplete"`
	PublicDisclosureLive   bool                `json:"publicDisclosureLive"`
	Stakes                 []SafetyModuleStake `json:"stakes"`
}

type SafetyModuleSlash struct {
	Participant   string `json:"participant"`
	Status        string `json:"status"`
	OpeningYNXT   int64  `json:"openingYnxt"`
	SlashYNXT     int64  `json:"slashYnxt"`
	RemainingYNXT int64  `json:"remainingYnxt"`
}

type SafetyModuleSimulation struct {
	SchemaVersion          int                 `json:"schemaVersion"`
	Source                 string              `json:"source"`
	AsOf                   time.Time           `json:"asOf"`
	Version                int                 `json:"version"`
	Coverage               string              `json:"coverage"`
	Policy                 SafetyModulePolicy  `json:"policy"`
	Inputs                 SafetyModuleInputs  `json:"inputs"`
	EligibleStakeYNXT      int64               `json:"eligibleStakeYnxt"`
	SlashCapacityYNXT      int64               `json:"slashCapacityYnxt"`
	InsuranceUsedYNXT      int64               `json:"insuranceUsedYnxt"`
	StakeSlashedYNXT       int64               `json:"stakeSlashedYnxt"`
	UncoveredShortfallYNXT int64               `json:"uncoveredShortfallYnxt"`
	Slashes                []SafetyModuleSlash `json:"slashes"`
	CooldownSlashable      bool                `json:"cooldownSlashable"`
	RecursiveRestaking     bool                `json:"recursiveRestaking"`
	ExecutionEnabled       bool                `json:"executionEnabled"`
	ActivationEligible     bool                `json:"activationEligible"`
	GuaranteedYield        bool                `json:"guaranteedYield"`
	Warnings               []string            `json:"warnings"`
}

func DefaultSafetyModulePolicy() SafetyModulePolicy {
	return SafetyModulePolicy{Version: SafetyModuleVersion, StakeCapYNXT: 10_000_000, CooldownSeconds: 7 * 24 * 60 * 60, MaximumSlashBPS: 3_000}
}

func (policy SafetyModulePolicy) Validate() error {
	if policy.Version != SafetyModuleVersion || policy.StakeCapYNXT < 1 || policy.CooldownSeconds < 60 || policy.CooldownSeconds > 365*24*60*60 || policy.MaximumSlashBPS < 1 || policy.MaximumSlashBPS > BasisPoints {
		return errors.New("safety module policy is incomplete or outside safety bounds")
	}
	return nil
}

func SimulateSafetyModule(policy SafetyModulePolicy, input SafetyModuleInputs) (SafetyModuleSimulation, error) {
	if err := policy.Validate(); err != nil {
		return SafetyModuleSimulation{}, err
	}
	stakes, eligible, capacities, err := validateSafetyModuleInputs(policy, input)
	if err != nil {
		return SafetyModuleSimulation{}, err
	}
	insuranceUsed := input.InsuranceReserveYNXT
	if insuranceUsed > input.ShortfallYNXT {
		insuranceUsed = input.ShortfallYNXT
	}
	remaining := input.ShortfallYNXT - insuranceUsed
	var capacityTotal int64
	for _, value := range capacities {
		if capacityTotal > math.MaxInt64-value {
			return SafetyModuleSimulation{}, errors.New("safety module slash capacity overflows")
		}
		capacityTotal += value
	}
	target := remaining
	if target > capacityTotal {
		target = capacityTotal
	}
	allocations := make([]int64, len(stakes))
	var allocated int64
	if target > 0 && capacityTotal > 0 {
		for index, capacity := range capacities {
			allocation, err := mulDiv(target, capacity, capacityTotal)
			if err != nil {
				return SafetyModuleSimulation{}, err
			}
			allocations[index] = allocation
			allocated += allocation
		}
		for allocated < target {
			progress := false
			for index := range allocations {
				if allocations[index] < capacities[index] && allocated < target {
					allocations[index]++
					allocated++
					progress = true
				}
			}
			if !progress {
				return SafetyModuleSimulation{}, errors.New("safety module slash remainder cannot be allocated")
			}
		}
	}
	slashes := make([]SafetyModuleSlash, 0, len(stakes))
	for index, stake := range stakes {
		if allocations[index] == 0 {
			continue
		}
		slashes = append(slashes, SafetyModuleSlash{Participant: stake.Participant, Status: stake.Status, OpeningYNXT: stake.AmountYNXT, SlashYNXT: allocations[index], RemainingYNXT: stake.AmountYNXT - allocations[index]})
	}
	return SafetyModuleSimulation{
		SchemaVersion: 1, Source: "user-supplied-safety-module-stress-input", AsOf: input.AsOf.UTC(), Version: SafetyModuleVersion, Coverage: "deterministic-candidate-model-not-chain-state", Policy: policy, Inputs: input,
		EligibleStakeYNXT: eligible, SlashCapacityYNXT: capacityTotal, InsuranceUsedYNXT: insuranceUsed, StakeSlashedYNXT: allocated, UncoveredShortfallYNXT: remaining - allocated, Slashes: slashes,
		CooldownSlashable: true, RecursiveRestaking: false, ExecutionEnabled: false, ActivationEligible: false, GuaranteedYield: false,
		Warnings: []string{"Candidate simulation only; it does not execute stake, slashing, insurance, governance, or treasury transfers.", "Insurance is consumed before capped voluntary stake; a residual shortfall remains explicitly uncovered.", "Cooling stake remains slashable until the cooldown completes. Derivative or recursively restaked provenance is rejected.", "No reward source, yield, loss protection, recovery guarantee, or activation approval is implied."},
	}, nil
}

func validateSafetyModuleInputs(policy SafetyModulePolicy, input SafetyModuleInputs) ([]SafetyModuleStake, int64, []int64, error) {
	if input.AsOf.IsZero() || input.InsuranceReserveYNXT < 0 || input.ShortfallYNXT <= 0 || len(input.Stakes) == 0 || len(input.Stakes) > 100_000 {
		return nil, 0, nil, errors.New("safety module inputs are incomplete or outside bounds")
	}
	reason := strings.ToLower(strings.TrimSpace(input.SlashReason))
	if reason != "protocol_shortfall" && reason != "consensus_safety_failure" {
		return nil, 0, nil, errors.New("safety module slash reason is not explicitly allowed")
	}
	if len(input.EvidenceHash) != 64 || strings.ToLower(input.EvidenceHash) != input.EvidenceHash {
		return nil, 0, nil, errors.New("safety module evidence hash is invalid")
	}
	if _, err := hex.DecodeString(input.EvidenceHash); err != nil {
		return nil, 0, nil, errors.New("safety module evidence hash is invalid")
	}
	stakes := append([]SafetyModuleStake(nil), input.Stakes...)
	sort.Slice(stakes, func(i, j int) bool { return stakes[i].Participant < stakes[j].Participant })
	capacities := make([]int64, len(stakes))
	var eligible int64
	previous := ""
	for index, stake := range stakes {
		stake.Participant = strings.TrimSpace(stake.Participant)
		stake.Status = strings.ToLower(strings.TrimSpace(stake.Status))
		stake.Provenance = strings.ToLower(strings.TrimSpace(stake.Provenance))
		stakes[index] = stake
		if stake.Participant == "" || stake.Participant == previous || stake.AmountYNXT <= 0 || stake.Provenance != "native_wallet_ynxt" {
			return nil, 0, nil, errors.New("safety stake identity, amount, or non-recursive provenance is invalid")
		}
		previous = stake.Participant
		slashable := false
		switch stake.Status {
		case "active":
			if stake.CooldownRequestedAt != nil {
				return nil, 0, nil, errors.New("active safety stake cannot have a cooldown request")
			}
			slashable = true
		case "cooling":
			if stake.CooldownRequestedAt == nil || stake.CooldownRequestedAt.After(input.AsOf) || !input.AsOf.Before(stake.CooldownRequestedAt.Add(time.Duration(policy.CooldownSeconds)*time.Second)) {
				return nil, 0, nil, errors.New("cooling safety stake is outside its slashable cooldown")
			}
			slashable = true
		case "exited":
			if stake.CooldownRequestedAt == nil || input.AsOf.Before(stake.CooldownRequestedAt.Add(time.Duration(policy.CooldownSeconds)*time.Second)) {
				return nil, 0, nil, errors.New("exited safety stake has not completed cooldown")
			}
		default:
			return nil, 0, nil, errors.New("safety stake status is unsupported")
		}
		if slashable {
			if eligible > math.MaxInt64-stake.AmountYNXT {
				return nil, 0, nil, errors.New("eligible safety stake overflows")
			}
			eligible += stake.AmountYNXT
			capacity, err := mulDiv(stake.AmountYNXT, policy.MaximumSlashBPS, BasisPoints)
			if err != nil {
				return nil, 0, nil, err
			}
			capacities[index] = capacity
		}
	}
	if eligible > policy.StakeCapYNXT {
		return nil, 0, nil, errors.New("eligible safety stake exceeds the module cap")
	}
	return stakes, eligible, capacities, nil
}
