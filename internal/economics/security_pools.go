package economics

import (
	"errors"
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"
)

const SecurityPoolsVersion = 1

var securityEvidencePattern = regexp.MustCompile(`^(sha256:)?[0-9a-fA-F]{64}$`)
var CanonicalSecurityPoolIDs = []string{"safety_module", "oracle", "bridge", "storage", "ai", "indexer"}

type SecurityPoolPolicy struct {
	AllowedCondition string `json:"allowedCondition"`
	CooldownEpochs   int64  `json:"cooldownEpochs"`
	MaxSlashBPS      int64  `json:"maxSlashBps"`
	StakeCapYNXT     int64  `json:"stakeCapYnxt"`
}

type SecurityPoolsPolicy struct {
	Version                  int                           `json:"version"`
	GovernanceTimelockEpochs int64                         `json:"governanceTimelockEpochs"`
	Pools                    map[string]SecurityPoolPolicy `json:"pools"`
}

type InitialSecurityPool struct {
	StakeYNXT     int64 `json:"stakeYnxt"`
	InsuranceYNXT int64 `json:"insuranceYnxt"`
	Paused        bool  `json:"paused"`
}

type SecurityPoolAction struct {
	Epoch              int64  `json:"epoch"`
	Type               string `json:"type"`
	Pool               string `json:"pool"`
	Amount             int64  `json:"amount,omitempty"`
	QueueID            string `json:"queueId,omitempty"`
	FundingSource      string `json:"fundingSource,omitempty"`
	Condition          string `json:"condition,omitempty"`
	GovernanceApproved bool   `json:"governanceApproved,omitempty"`
	DecisionEpoch      int64  `json:"decisionEpoch,omitempty"`
	EvidenceHash       string `json:"evidenceHash,omitempty"`
}

type SecurityPoolsInputs struct {
	AsOf              time.Time                      `json:"asOf"`
	InitialPools      map[string]InitialSecurityPool `json:"initialPools"`
	GovernanceActive  bool                           `json:"governanceActive"`
	ContractsAudited  bool                           `json:"contractsAudited"`
	ContractsDeployed bool                           `json:"contractsDeployed"`
	Actions           []SecurityPoolAction           `json:"actions"`
}

type SecurityExit struct {
	ID                    string `json:"id"`
	RequestedEpoch        int64  `json:"requestedEpoch"`
	MaturesEpoch          int64  `json:"maturesEpoch"`
	InitialClaimYNXT      int64  `json:"initialClaimYnxt"`
	ClaimYNXT             int64  `json:"claimYnxt"`
	CumulativeHaircutYNXT int64  `json:"cumulativeHaircutYnxt"`
	Status                string `json:"status"`
}

type SecurityPoolSnapshot struct {
	Pool             string         `json:"pool"`
	AllowedCondition string         `json:"allowedCondition"`
	StakeYNXT        int64          `json:"stakeYnxt"`
	InsuranceYNXT    int64          `json:"insuranceYnxt"`
	PendingExitYNXT  int64          `json:"pendingExitYnxt"`
	ActiveStakeYNXT  int64          `json:"activeStakeYnxt"`
	StakeCapYNXT     int64          `json:"stakeCapYnxt"`
	MaxSlashBPS      int64          `json:"maxSlashBps"`
	Paused           bool           `json:"paused"`
	ExitQueue        []SecurityExit `json:"exitQueue"`
	ExitQueueSolvent bool           `json:"exitQueueSolvent"`
}

type SecurityPoolsStep struct {
	Index                  int                    `json:"index"`
	Action                 SecurityPoolAction     `json:"action"`
	Accepted               bool                   `json:"accepted"`
	Failure                string                 `json:"failure,omitempty"`
	InsuranceUsedYNXT      int64                  `json:"insuranceUsedYnxt"`
	StakeSlashedYNXT       int64                  `json:"stakeSlashedYnxt"`
	ExitHaircutYNXT        int64                  `json:"exitHaircutYnxt"`
	UncoveredLossYNXT      int64                  `json:"uncoveredLossYnxt"`
	Pools                  []SecurityPoolSnapshot `json:"pools"`
	CrossPoolTransfersYNXT int64                  `json:"crossPoolTransfersYnxt"`
}

type SecurityPoolsSimulation struct {
	SchemaVersion         int                 `json:"schemaVersion"`
	Source                string              `json:"source"`
	AsOf                  time.Time           `json:"asOf"`
	Version               int                 `json:"version"`
	Coverage              string              `json:"coverage"`
	Policy                SecurityPoolsPolicy `json:"policy"`
	Inputs                SecurityPoolsInputs `json:"inputs"`
	Steps                 []SecurityPoolsStep `json:"steps"`
	MainnetReady          bool                `json:"mainnetReady"`
	ContractExecution     bool                `json:"contractExecution"`
	RecursiveRestaking    bool                `json:"recursiveRestaking"`
	CrossServiceContagion bool                `json:"crossServiceContagion"`
	GuaranteedCoverage    bool                `json:"guaranteedCoverage"`
	Warnings              []string            `json:"warnings"`
}

type securityPoolState struct {
	stake     int64
	insurance int64
	paused    bool
	queue     []SecurityExit
}

type securityPoolsState map[string]*securityPoolState

func DefaultSecurityPoolsPolicy() SecurityPoolsPolicy {
	conditions := map[string]string{"safety_module": "protocol_shortfall", "oracle": "oracle_failure", "bridge": "bridge_failure", "storage": "storage_failure", "ai": "ai_failure", "indexer": "indexer_failure"}
	pools := make(map[string]SecurityPoolPolicy, len(conditions))
	for id, condition := range conditions {
		pools[id] = SecurityPoolPolicy{AllowedCondition: condition, CooldownEpochs: 21, MaxSlashBPS: 3_000, StakeCapYNXT: 10_000_000}
	}
	return SecurityPoolsPolicy{Version: SecurityPoolsVersion, GovernanceTimelockEpochs: 7, Pools: pools}
}

func (p SecurityPoolsPolicy) Validate() error {
	if p.Version != SecurityPoolsVersion || p.GovernanceTimelockEpochs < 1 || len(p.Pools) != len(CanonicalSecurityPoolIDs) {
		return errors.New("security pools policy is incomplete")
	}
	for _, id := range CanonicalSecurityPoolIDs {
		entry, ok := p.Pools[id]
		if !ok || strings.TrimSpace(entry.AllowedCondition) == "" || entry.CooldownEpochs < 1 || entry.MaxSlashBPS < 1 || entry.MaxSlashBPS > BasisPoints || entry.StakeCapYNXT < 1 {
			return errors.New("security pool policy is outside safety bounds")
		}
	}
	for id := range p.Pools {
		if !containsString(CanonicalSecurityPoolIDs, id) {
			return errors.New("security pool policy contains an unknown pool")
		}
	}
	return nil
}

func SimulateSecurityPools(policy SecurityPoolsPolicy, in SecurityPoolsInputs) (SecurityPoolsSimulation, error) {
	if err := policy.Validate(); err != nil {
		return SecurityPoolsSimulation{}, err
	}
	if err := validateSecurityPoolsInputs(policy, in); err != nil {
		return SecurityPoolsSimulation{}, err
	}
	state := make(securityPoolsState, len(in.InitialPools))
	for _, id := range CanonicalSecurityPoolIDs {
		initial := in.InitialPools[id]
		state[id] = &securityPoolState{stake: initial.StakeYNXT, insurance: initial.InsuranceYNXT, paused: initial.Paused, queue: []SecurityExit{}}
	}
	result := SecurityPoolsSimulation{SchemaVersion: 1, Source: "user-supplied-security-pool-stress-input", AsOf: in.AsOf.UTC(), Version: SecurityPoolsVersion, Coverage: "deterministic-candidate-model-not-chain-state", Policy: policy, Inputs: in, Steps: make([]SecurityPoolsStep, 0, len(in.Actions)), MainnetReady: false, ContractExecution: false, RecursiveRestaking: false, CrossServiceContagion: false, GuaranteedCoverage: false, Warnings: []string{"Candidate simulation only; no audited contract, governance authority, deployed pool, insurance policy, guaranteed coverage, yield, or recovery.", "Each service pool can cover only its declared condition; uncovered loss is reported and never transferred to another pool.", "Exit claims remain slashable during cooldown and may be reduced by an approved incident."}}
	for i, action := range in.Actions {
		before := cloneSecurityPoolsState(state)
		insuranceUsed, stakeSlashed, haircut, uncovered, failure := applySecurityPoolAction(state, policy, action)
		if failure != "" {
			state = before
			insuranceUsed, stakeSlashed, haircut, uncovered = 0, 0, 0, 0
		}
		result.Steps = append(result.Steps, SecurityPoolsStep{Index: i + 1, Action: action, Accepted: failure == "", Failure: failure, InsuranceUsedYNXT: insuranceUsed, StakeSlashedYNXT: stakeSlashed, ExitHaircutYNXT: haircut, UncoveredLossYNXT: uncovered, Pools: securityPoolsSnapshot(state, policy), CrossPoolTransfersYNXT: 0})
	}
	return result, nil
}

func validateSecurityPoolsInputs(policy SecurityPoolsPolicy, in SecurityPoolsInputs) error {
	if in.AsOf.IsZero() || len(in.InitialPools) != len(CanonicalSecurityPoolIDs) || len(in.Actions) < 1 || len(in.Actions) > 10_000 {
		return errors.New("security pools inputs are incomplete")
	}
	for _, id := range CanonicalSecurityPoolIDs {
		value, ok := in.InitialPools[id]
		if !ok || value.StakeYNXT < 0 || value.InsuranceYNXT < 0 || value.StakeYNXT > policy.Pools[id].StakeCapYNXT {
			return errors.New("initial security pool state is outside bounds")
		}
	}
	previous := int64(-1)
	for _, action := range in.Actions {
		if action.Epoch < 0 || action.Epoch < previous {
			return errors.New("security pool actions must be epoch ordered")
		}
		previous = action.Epoch
	}
	return nil
}

func applySecurityPoolAction(state securityPoolsState, policy SecurityPoolsPolicy, action SecurityPoolAction) (int64, int64, int64, int64, string) {
	action.Type = strings.ToLower(strings.TrimSpace(action.Type))
	action.Pool = strings.ToLower(strings.TrimSpace(action.Pool))
	pool, ok := state[action.Pool]
	if !ok {
		return 0, 0, 0, 0, "unknown_pool"
	}
	poolPolicy := policy.Pools[action.Pool]
	switch action.Type {
	case "stake":
		if pool.paused {
			return 0, 0, 0, 0, "pool_paused"
		}
		if action.FundingSource != "external_unencumbered" {
			return 0, 0, 0, 0, "recursive_or_encumbered_stake_rejected"
		}
		if action.Amount < 1 || pool.stake > poolPolicy.StakeCapYNXT-action.Amount {
			return 0, 0, 0, 0, "stake_cap_exceeded"
		}
		pool.stake += action.Amount
	case "fund_insurance":
		if action.FundingSource != "external_unencumbered" || action.Amount < 1 || pool.insurance > math.MaxInt64-action.Amount {
			return 0, 0, 0, 0, "insurance_funding_invalid"
		}
		pool.insurance += action.Amount
	case "request_exit":
		pending := pendingSecurityExits(pool.queue)
		if action.Amount < 1 || pool.stake < pending || action.Amount > pool.stake-pending {
			return 0, 0, 0, 0, "exit_exceeds_active_stake"
		}
		id := fmt.Sprintf("%s-exit-%06d", action.Pool, len(pool.queue)+1)
		pool.queue = append(pool.queue, SecurityExit{ID: id, RequestedEpoch: action.Epoch, MaturesEpoch: action.Epoch + poolPolicy.CooldownEpochs, InitialClaimYNXT: action.Amount, ClaimYNXT: action.Amount, Status: "queued"})
	case "fulfill_exit":
		index := -1
		for i := range pool.queue {
			if pool.queue[i].ID == strings.TrimSpace(action.QueueID) {
				index = i
				break
			}
		}
		if index < 0 || pool.queue[index].Status != "queued" {
			return 0, 0, 0, 0, "exit_not_queued"
		}
		if action.Epoch < pool.queue[index].MaturesEpoch {
			return 0, 0, 0, 0, "exit_not_mature"
		}
		if pool.stake < pool.queue[index].ClaimYNXT {
			return 0, 0, 0, 0, "exit_pool_insolvent"
		}
		pool.stake -= pool.queue[index].ClaimYNXT
		pool.queue[index].Status = "fulfilled"
	case "incident":
		if action.Amount < 1 || action.Condition != poolPolicy.AllowedCondition {
			return 0, 0, 0, 0, "incident_condition_not_authorized_for_pool"
		}
		if !action.GovernanceApproved || action.DecisionEpoch < 0 || action.Epoch < action.DecisionEpoch+policy.GovernanceTimelockEpochs || !securityEvidencePattern.MatchString(strings.TrimSpace(action.EvidenceHash)) {
			return 0, 0, 0, 0, "incident_governance_evidence_or_timelock_invalid"
		}
		insuranceUsed := minInt64(action.Amount, pool.insurance)
		pool.insurance -= insuranceUsed
		remaining := action.Amount - insuranceUsed
		maxSlash, _ := mulDiv(pool.stake, poolPolicy.MaxSlashBPS, BasisPoints)
		stakeSlashed := minInt64(remaining, maxSlash)
		stakeBefore := pool.stake
		pool.stake -= stakeSlashed
		haircut := haircutSecurityExits(pool, stakeBefore, pool.stake)
		return insuranceUsed, stakeSlashed, haircut, remaining - stakeSlashed, ""
	case "pause", "unpause":
		if !action.GovernanceApproved || action.DecisionEpoch < 0 || action.Epoch < action.DecisionEpoch+policy.GovernanceTimelockEpochs || !securityEvidencePattern.MatchString(strings.TrimSpace(action.EvidenceHash)) {
			return 0, 0, 0, 0, "control_governance_evidence_or_timelock_invalid"
		}
		pool.paused = action.Type == "pause"
	default:
		return 0, 0, 0, 0, "unsupported_action"
	}
	return 0, 0, 0, 0, ""
}

func haircutSecurityExits(pool *securityPoolState, before, after int64) int64 {
	if before <= 0 || after >= before {
		return 0
	}
	totalHaircut := int64(0)
	for i := range pool.queue {
		if pool.queue[i].Status != "queued" {
			continue
		}
		newClaim, _ := mulDiv(pool.queue[i].ClaimYNXT, after, before)
		reduction := pool.queue[i].ClaimYNXT - newClaim
		pool.queue[i].ClaimYNXT = newClaim
		pool.queue[i].CumulativeHaircutYNXT += reduction
		totalHaircut += reduction
	}
	return totalHaircut
}

func securityPoolsSnapshot(state securityPoolsState, policy SecurityPoolsPolicy) []SecurityPoolSnapshot {
	result := make([]SecurityPoolSnapshot, 0, len(CanonicalSecurityPoolIDs))
	for _, id := range CanonicalSecurityPoolIDs {
		pool := state[id]
		pending := pendingSecurityExits(pool.queue)
		active := int64(0)
		if pool.stake >= pending {
			active = pool.stake - pending
		}
		result = append(result, SecurityPoolSnapshot{Pool: id, AllowedCondition: policy.Pools[id].AllowedCondition, StakeYNXT: pool.stake, InsuranceYNXT: pool.insurance, PendingExitYNXT: pending, ActiveStakeYNXT: active, StakeCapYNXT: policy.Pools[id].StakeCapYNXT, MaxSlashBPS: policy.Pools[id].MaxSlashBPS, Paused: pool.paused, ExitQueue: append([]SecurityExit(nil), pool.queue...), ExitQueueSolvent: pool.stake >= pending})
	}
	return result
}

func cloneSecurityPoolsState(value securityPoolsState) securityPoolsState {
	out := make(securityPoolsState, len(value))
	for id, pool := range value {
		out[id] = &securityPoolState{stake: pool.stake, insurance: pool.insurance, paused: pool.paused, queue: append([]SecurityExit(nil), pool.queue...)}
	}
	return out
}

func pendingSecurityExits(queue []SecurityExit) int64 {
	total := int64(0)
	for _, exit := range queue {
		if exit.Status == "queued" {
			total += exit.ClaimYNXT
		}
	}
	return total
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func minInt64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}
