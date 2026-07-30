package economics

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/big"
	"strings"
	"time"
)

const (
	EconomicRuntimeSchemaVersion = 1
	EconomicRuntimePolicyVersion = 1
	secondsPerYear               = int64(365 * 24 * 60 * 60)
)

const (
	CodeRuntimeInvalidPolicy        = "YNX_ECONOMICS_INVALID_POLICY"
	CodeRuntimeInvalidTransition    = "YNX_ECONOMICS_INVALID_POLICY_TRANSITION"
	CodeRuntimeGovernanceRequired   = "YNX_ECONOMICS_GOVERNANCE_REQUIRED"
	CodeRuntimeTimelockActive       = "YNX_ECONOMICS_TIMELOCK_ACTIVE"
	CodeRuntimeSequenceInvalid      = "YNX_ECONOMICS_SEQUENCE_INVALID"
	CodeRuntimeFeeReconciliation    = "YNX_ECONOMICS_FEE_RECONCILIATION_FAILED"
	CodeRuntimeSupplyReconciliation = "YNX_ECONOMICS_SUPPLY_RECONCILIATION_FAILED"
	CodeRuntimeEmergencyBound       = "YNX_ECONOMICS_EMERGENCY_BOUND_INVALID"
	CodeRuntimeStateTampered        = "YNX_ECONOMICS_STATE_TAMPERED"
)

type RuntimeError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *RuntimeError) Error() string { return e.Code + ": " + e.Message }

func runtimeError(code, message string) error {
	return &RuntimeError{Code: code, Message: message}
}

type IssuanceAllocationPolicy struct {
	NetworkSecurityBPS    int64 `json:"networkSecurityBps"`
	PublicGoodsBPS        int64 `json:"publicGoodsBps"`
	GovernanceGrantsBPS   int64 `json:"governanceGrantsBps"`
	AdoptionIncentivesBPS int64 `json:"adoptionIncentivesBps"`
}

type GovernedRuntimePolicy struct {
	Version                     int                      `json:"version"`
	Economics                   Policy                   `json:"economics"`
	SecurityBudgetResponseBPS   int64                    `json:"securityBudgetResponseBps"`
	BurnRateOffsetBPS           int64                    `json:"burnRateOffsetBps"`
	EmergencyIssuanceCeilingBPS int64                    `json:"emergencyIssuanceCeilingBps"`
	AdoptionIncentiveCapBPS     int64                    `json:"adoptionIncentiveCapBps"`
	IssuanceAllocation          IssuanceAllocationPolicy `json:"issuanceAllocation"`
}

func DefaultGovernedRuntimePolicy() GovernedRuntimePolicy {
	return GovernedRuntimePolicy{
		Version:                     EconomicRuntimePolicyVersion,
		Economics:                   DefaultCandidatePolicy(),
		SecurityBudgetResponseBPS:   5_000,
		BurnRateOffsetBPS:           2_500,
		EmergencyIssuanceCeilingBPS: 300,
		AdoptionIncentiveCapBPS:     1_000,
		IssuanceAllocation: IssuanceAllocationPolicy{
			NetworkSecurityBPS:    7_000,
			PublicGoodsBPS:        1_500,
			GovernanceGrantsBPS:   1_000,
			AdoptionIncentivesBPS: 500,
		},
	}
}

func (p GovernedRuntimePolicy) Validate() error {
	if p.Version != EconomicRuntimePolicyVersion {
		return runtimeError(CodeRuntimeInvalidPolicy, fmt.Sprintf("unsupported runtime policy version %d", p.Version))
	}
	if err := p.Economics.Validate(); err != nil {
		return runtimeError(CodeRuntimeInvalidPolicy, err.Error())
	}
	for name, value := range map[string]int64{
		"security budget response":       p.SecurityBudgetResponseBPS,
		"burn rate offset":               p.BurnRateOffsetBPS,
		"emergency issuance ceiling":     p.EmergencyIssuanceCeilingBPS,
		"adoption incentive cap":         p.AdoptionIncentiveCapBPS,
		"network security allocation":    p.IssuanceAllocation.NetworkSecurityBPS,
		"public goods allocation":        p.IssuanceAllocation.PublicGoodsBPS,
		"governance grants allocation":   p.IssuanceAllocation.GovernanceGrantsBPS,
		"adoption incentives allocation": p.IssuanceAllocation.AdoptionIncentivesBPS,
	} {
		if value < 0 || value > BasisPoints {
			return runtimeError(CodeRuntimeInvalidPolicy, fmt.Sprintf("%s must be between 0 and %d bps", name, BasisPoints))
		}
	}
	allocationTotal := p.IssuanceAllocation.NetworkSecurityBPS + p.IssuanceAllocation.PublicGoodsBPS + p.IssuanceAllocation.GovernanceGrantsBPS + p.IssuanceAllocation.AdoptionIncentivesBPS
	if allocationTotal != BasisPoints {
		return runtimeError(CodeRuntimeInvalidPolicy, "issuance allocation must total 10000 bps")
	}
	if p.IssuanceAllocation.AdoptionIncentivesBPS > p.AdoptionIncentiveCapBPS {
		return runtimeError(CodeRuntimeInvalidPolicy, "adoption incentives exceed the public policy cap")
	}
	if p.EmergencyIssuanceCeilingBPS < p.Economics.AnnualIssuanceFloorBPS || p.EmergencyIssuanceCeilingBPS > p.Economics.AnnualIssuanceCeilingBPS {
		return runtimeError(CodeRuntimeEmergencyBound, "emergency issuance ceiling must stay inside the public annual issuance bounds")
	}
	return nil
}

type EpochFeeAccounting struct {
	GrossFeeYNXT    int64 `json:"grossFeeYnxt"`
	BaseFeeBurnYNXT int64 `json:"baseFeeBurnYnxt"`
	ServiceBurnYNXT int64 `json:"serviceBurnYnxt"`
	ValidatorYNXT   int64 `json:"validatorYnxt"`
	ProviderYNXT    int64 `json:"providerYnxt"`
	ProtocolYNXT    int64 `json:"protocolYnxt"`
	TreasuryYNXT    int64 `json:"treasuryYnxt"`
}

func (f EpochFeeAccounting) Validate() error {
	values := []int64{f.GrossFeeYNXT, f.BaseFeeBurnYNXT, f.ServiceBurnYNXT, f.ValidatorYNXT, f.ProviderYNXT, f.ProtocolYNXT, f.TreasuryYNXT}
	for _, value := range values {
		if value < 0 {
			return runtimeError(CodeRuntimeFeeReconciliation, "fee accounting cannot contain negative values")
		}
	}
	allocated, err := checkedSum(values[1:]...)
	if err != nil || allocated != f.GrossFeeYNXT {
		return runtimeError(CodeRuntimeFeeReconciliation, "gross fee must equal burns plus validator, provider, protocol, and Treasury revenue")
	}
	return nil
}

func (f EpochFeeAccounting) BurnYNXT() int64 {
	return f.BaseFeeBurnYNXT + f.ServiceBurnYNXT
}

func (f EpochFeeAccounting) RevenueYNXT() int64 {
	return f.ValidatorYNXT + f.ProviderYNXT + f.ProtocolYNXT + f.TreasuryYNXT
}

type RuntimeEpochInput struct {
	Epoch                          int64              `json:"epoch"`
	AsOf                           time.Time          `json:"asOf"`
	DurationSeconds                int64              `json:"durationSeconds"`
	StakedSupplyYNXT               int64              `json:"stakedSupplyYnxt"`
	ValidatorCount                 int64              `json:"validatorCount"`
	LargestOperatorBPS             int64              `json:"largestOperatorBps"`
	TargetAnnualSecurityBudgetYNXT int64              `json:"targetAnnualSecurityBudgetYnxt"`
	Fees                           EpochFeeAccounting `json:"fees"`
	EmergencyMode                  bool               `json:"emergencyMode"`
	EmergencyReason                string             `json:"emergencyReason,omitempty"`
}

type IssuanceAllocation struct {
	NetworkSecurityYNXT    int64 `json:"networkSecurityYnxt"`
	PublicGoodsYNXT        int64 `json:"publicGoodsYnxt"`
	GovernanceGrantsYNXT   int64 `json:"governanceGrantsYnxt"`
	AdoptionIncentivesYNXT int64 `json:"adoptionIncentivesYnxt"`
}

func (a IssuanceAllocation) Total() int64 {
	return a.NetworkSecurityYNXT + a.PublicGoodsYNXT + a.GovernanceGrantsYNXT + a.AdoptionIncentivesYNXT
}

type CanonicalEconomicEvent struct {
	ID                    string             `json:"id"`
	Type                  string             `json:"type"`
	Version               int                `json:"version"`
	Epoch                 int64              `json:"epoch"`
	AsOf                  time.Time          `json:"asOf"`
	DurationSeconds       int64              `json:"durationSeconds"`
	PolicyHash            string             `json:"policyHash"`
	OpeningSupplyYNXT     int64              `json:"openingSupplyYnxt"`
	AnnualIssuanceRateBPS int64              `json:"annualIssuanceRateBps"`
	IssuanceYNXT          int64              `json:"issuanceYnxt"`
	IssuanceAllocation    IssuanceAllocation `json:"issuanceAllocation"`
	FeeAccounting         EpochFeeAccounting `json:"feeAccounting"`
	ClosingSupplyYNXT     int64              `json:"closingSupplyYnxt"`
	EmergencyMode         bool               `json:"emergencyMode"`
	EmergencyReason       string             `json:"emergencyReason,omitempty"`
	Source                string             `json:"source"`
	AuditHash             string             `json:"auditHash"`
}

type PolicyGovernanceEvent struct {
	ID               string    `json:"id"`
	Type             string    `json:"type"`
	Version          int       `json:"version"`
	ProposalID       string    `json:"proposalId"`
	PreviousHash     string    `json:"previousHash"`
	CandidateHash    string    `json:"candidateHash"`
	OccurredAt       time.Time `json:"occurredAt"`
	ActivateAfter    time.Time `json:"activateAfter"`
	GovernanceSource string    `json:"governanceSource"`
	AuditHash        string    `json:"auditHash"`
}

type ScheduledRuntimePolicy struct {
	ProposalID       string                `json:"proposalId"`
	GovernanceSource string                `json:"governanceSource"`
	ApprovedAt       time.Time             `json:"approvedAt"`
	ActivateAfter    time.Time             `json:"activateAfter"`
	Policy           GovernedRuntimePolicy `json:"policy"`
	PolicyHash       string                `json:"policyHash"`
}

type EconomicRuntimeState struct {
	SchemaVersion          int                      `json:"schemaVersion"`
	StateVersion           int64                    `json:"stateVersion"`
	GenesisAsOf            time.Time                `json:"genesisAsOf"`
	GenesisSupplyYNXT      int64                    `json:"genesisSupplyYnxt"`
	TotalSupplyYNXT        int64                    `json:"totalSupplyYnxt"`
	CumulativeIssuanceYNXT int64                    `json:"cumulativeIssuanceYnxt"`
	CumulativeBurnYNXT     int64                    `json:"cumulativeBurnYnxt"`
	LastEpoch              int64                    `json:"lastEpoch"`
	LastAsOf               time.Time                `json:"lastAsOf"`
	LastIssuanceRateBPS    int64                    `json:"lastIssuanceRateBps"`
	Policy                 GovernedRuntimePolicy    `json:"policy"`
	PolicyHash             string                   `json:"policyHash"`
	PendingPolicy          *ScheduledRuntimePolicy  `json:"pendingPolicy,omitempty"`
	EconomicEvents         []CanonicalEconomicEvent `json:"economicEvents"`
	GovernanceEvents       []PolicyGovernanceEvent  `json:"governanceEvents"`
	StateHash              string                   `json:"stateHash"`
}

type RuntimeReplayInput struct {
	GenesisAsOf       time.Time              `json:"genesisAsOf"`
	GenesisSupplyYNXT int64                  `json:"genesisSupplyYnxt"`
	Policy            *GovernedRuntimePolicy `json:"policy,omitempty"`
	Epochs            []RuntimeEpochInput    `json:"epochs"`
}

func NewEconomicRuntimeState(genesisAsOf time.Time, genesisSupplyYNXT int64, policy GovernedRuntimePolicy) (EconomicRuntimeState, error) {
	if genesisAsOf.IsZero() || genesisSupplyYNXT <= 0 {
		return EconomicRuntimeState{}, runtimeError(CodeRuntimeSupplyReconciliation, "genesis time and positive genesis supply are required")
	}
	if err := policy.Validate(); err != nil {
		return EconomicRuntimeState{}, err
	}
	policyHash, err := runtimePolicyHash(policy)
	if err != nil {
		return EconomicRuntimeState{}, err
	}
	state := EconomicRuntimeState{
		SchemaVersion:     EconomicRuntimeSchemaVersion,
		StateVersion:      1,
		GenesisAsOf:       genesisAsOf.UTC(),
		GenesisSupplyYNXT: genesisSupplyYNXT,
		TotalSupplyYNXT:   genesisSupplyYNXT,
		LastAsOf:          genesisAsOf.UTC(),
		Policy:            policy,
		PolicyHash:        policyHash,
		EconomicEvents:    []CanonicalEconomicEvent{},
		GovernanceEvents:  []PolicyGovernanceEvent{},
	}
	state.StateHash = runtimeStateHash(state)
	return state, nil
}

func ReplayEconomicRuntime(input RuntimeReplayInput) (EconomicRuntimeState, error) {
	policy := DefaultGovernedRuntimePolicy()
	if input.Policy != nil {
		policy = *input.Policy
	}
	state, err := NewEconomicRuntimeState(input.GenesisAsOf, input.GenesisSupplyYNXT, policy)
	if err != nil {
		return EconomicRuntimeState{}, err
	}
	for _, epoch := range input.Epochs {
		state, _, err = ApplyRuntimeEpoch(state, epoch)
		if err != nil {
			return EconomicRuntimeState{}, err
		}
	}
	return state, nil
}

func ScheduleRuntimePolicyChange(state EconomicRuntimeState, proposalID, governanceSource string, governanceApproved bool, approvedAt time.Time, candidate GovernedRuntimePolicy) (EconomicRuntimeState, PolicyGovernanceEvent, error) {
	if err := ValidateEconomicRuntimeState(state); err != nil {
		return EconomicRuntimeState{}, PolicyGovernanceEvent{}, err
	}
	proposalID = strings.TrimSpace(proposalID)
	governanceSource = strings.TrimSpace(governanceSource)
	if !governanceApproved || proposalID == "" || governanceSource == "" || approvedAt.IsZero() {
		return EconomicRuntimeState{}, PolicyGovernanceEvent{}, runtimeError(CodeRuntimeGovernanceRequired, "an approved proposal ID, governance source, and approval time are required")
	}
	if approvedAt.UTC().Before(runtimeLatestCommittedAsOf(state)) {
		return EconomicRuntimeState{}, PolicyGovernanceEvent{}, runtimeError(CodeRuntimeSequenceInvalid, "governance approval cannot predate the latest committed runtime state")
	}
	if state.PendingPolicy != nil {
		return EconomicRuntimeState{}, PolicyGovernanceEvent{}, runtimeError(CodeRuntimeGovernanceRequired, "a policy change is already pending")
	}
	if err := ValidateRuntimePolicyTransition(state.Policy, candidate); err != nil {
		return EconomicRuntimeState{}, PolicyGovernanceEvent{}, err
	}
	candidateHash, err := runtimePolicyHash(candidate)
	if err != nil {
		return EconomicRuntimeState{}, PolicyGovernanceEvent{}, err
	}
	activateAfter := approvedAt.UTC().Add(time.Duration(state.Policy.Economics.GovernanceTimelockSeconds) * time.Second)
	state.PendingPolicy = &ScheduledRuntimePolicy{ProposalID: proposalID, GovernanceSource: governanceSource, ApprovedAt: approvedAt.UTC(), ActivateAfter: activateAfter, Policy: candidate, PolicyHash: candidateHash}
	event := PolicyGovernanceEvent{Type: "ynx.economics.policy_change_scheduled.v1", Version: 1, ProposalID: proposalID, PreviousHash: state.PolicyHash, CandidateHash: candidateHash, OccurredAt: approvedAt.UTC(), ActivateAfter: activateAfter, GovernanceSource: governanceSource}
	event.ID = governanceEventID(event)
	event.AuditHash = governanceEventAuditHash(event)
	state.GovernanceEvents = append(state.GovernanceEvents, event)
	state.StateVersion++
	state.StateHash = runtimeStateHash(state)
	return state, event, nil
}

func ActivateScheduledRuntimePolicy(state EconomicRuntimeState, activatedAt time.Time) (EconomicRuntimeState, PolicyGovernanceEvent, error) {
	if err := ValidateEconomicRuntimeState(state); err != nil {
		return EconomicRuntimeState{}, PolicyGovernanceEvent{}, err
	}
	if state.PendingPolicy == nil {
		return EconomicRuntimeState{}, PolicyGovernanceEvent{}, runtimeError(CodeRuntimeGovernanceRequired, "no scheduled policy change exists")
	}
	if activatedAt.IsZero() || activatedAt.UTC().Before(state.PendingPolicy.ActivateAfter) {
		return EconomicRuntimeState{}, PolicyGovernanceEvent{}, runtimeError(CodeRuntimeTimelockActive, "the governance timelock has not expired")
	}
	if err := ValidateRuntimePolicyTransition(state.Policy, state.PendingPolicy.Policy); err != nil {
		return EconomicRuntimeState{}, PolicyGovernanceEvent{}, err
	}
	pending := *state.PendingPolicy
	event := PolicyGovernanceEvent{Type: "ynx.economics.policy_change_activated.v1", Version: 1, ProposalID: pending.ProposalID, PreviousHash: state.PolicyHash, CandidateHash: pending.PolicyHash, OccurredAt: activatedAt.UTC(), ActivateAfter: pending.ActivateAfter, GovernanceSource: pending.GovernanceSource}
	event.ID = governanceEventID(event)
	event.AuditHash = governanceEventAuditHash(event)
	state.Policy = pending.Policy
	state.PolicyHash = pending.PolicyHash
	state.PendingPolicy = nil
	state.GovernanceEvents = append(state.GovernanceEvents, event)
	state.StateVersion++
	state.StateHash = runtimeStateHash(state)
	return state, event, nil
}

func ValidateRuntimePolicyTransition(previous, candidate GovernedRuntimePolicy) error {
	if err := previous.Validate(); err != nil {
		return err
	}
	if err := candidate.Validate(); err != nil {
		return err
	}
	limit := previous.Economics.MaxAnnualParameterDeltaBPS
	if limit < 1 {
		return runtimeError(CodeRuntimeInvalidTransition, "current policy has no usable parameter change limit")
	}
	absChecks := map[string][2]int64{
		"issuance floor":             {previous.Economics.AnnualIssuanceFloorBPS, candidate.Economics.AnnualIssuanceFloorBPS},
		"issuance ceiling":           {previous.Economics.AnnualIssuanceCeilingBPS, candidate.Economics.AnnualIssuanceCeilingBPS},
		"target staked ratio":        {previous.Economics.TargetStakedRatioBPS, candidate.Economics.TargetStakedRatioBPS},
		"staked ratio response":      {previous.Economics.StakedRatioResponseBPS, candidate.Economics.StakedRatioResponseBPS},
		"validator deficit response": {previous.Economics.ValidatorDeficitBPS, candidate.Economics.ValidatorDeficitBPS},
		"maximum concentration":      {previous.Economics.MaxConcentrationBPS, candidate.Economics.MaxConcentrationBPS},
		"concentration response":     {previous.Economics.ConcentrationResponseBPS, candidate.Economics.ConcentrationResponseBPS},
		"revenue offset":             {previous.Economics.RevenueOffsetBPS, candidate.Economics.RevenueOffsetBPS},
		"parameter delta limit":      {previous.Economics.MaxAnnualParameterDeltaBPS, candidate.Economics.MaxAnnualParameterDeltaBPS},
		"base fee burn":              {previous.Economics.BaseFeeBurnBPS, candidate.Economics.BaseFeeBurnBPS},
		"validator fee share":        {previous.Economics.ValidatorFeeShareBPS, candidate.Economics.ValidatorFeeShareBPS},
		"provider fee share":         {previous.Economics.ProviderFeeShareBPS, candidate.Economics.ProviderFeeShareBPS},
		"protocol fee share":         {previous.Economics.ProtocolFeeShareBPS, candidate.Economics.ProtocolFeeShareBPS},
		"treasury fee share":         {previous.Economics.TreasuryFeeShareBPS, candidate.Economics.TreasuryFeeShareBPS},
		"security budget response":   {previous.SecurityBudgetResponseBPS, candidate.SecurityBudgetResponseBPS},
		"burn rate offset":           {previous.BurnRateOffsetBPS, candidate.BurnRateOffsetBPS},
		"emergency issuance ceiling": {previous.EmergencyIssuanceCeilingBPS, candidate.EmergencyIssuanceCeilingBPS},
		"adoption incentive cap":     {previous.AdoptionIncentiveCapBPS, candidate.AdoptionIncentiveCapBPS},
		"security allocation":        {previous.IssuanceAllocation.NetworkSecurityBPS, candidate.IssuanceAllocation.NetworkSecurityBPS},
		"public goods allocation":    {previous.IssuanceAllocation.PublicGoodsBPS, candidate.IssuanceAllocation.PublicGoodsBPS},
		"grants allocation":          {previous.IssuanceAllocation.GovernanceGrantsBPS, candidate.IssuanceAllocation.GovernanceGrantsBPS},
		"adoption allocation":        {previous.IssuanceAllocation.AdoptionIncentivesBPS, candidate.IssuanceAllocation.AdoptionIncentivesBPS},
	}
	for name, values := range absChecks {
		if absoluteDelta(values[0], values[1]) > limit {
			return runtimeError(CodeRuntimeInvalidTransition, fmt.Sprintf("%s change exceeds the public %d bps limit", name, limit))
		}
	}
	for name, values := range map[string][2]int64{
		"minimum validator count": {previous.Economics.MinValidatorCount, candidate.Economics.MinValidatorCount},
		"governance timelock":     {previous.Economics.GovernanceTimelockSeconds, candidate.Economics.GovernanceTimelockSeconds},
	} {
		delta, err := relativeDeltaBPS(values[0], values[1])
		if err != nil || delta > limit {
			return runtimeError(CodeRuntimeInvalidTransition, fmt.Sprintf("%s change exceeds the public %d bps relative limit", name, limit))
		}
	}
	return nil
}

func ApplyRuntimeEpoch(state EconomicRuntimeState, input RuntimeEpochInput) (EconomicRuntimeState, CanonicalEconomicEvent, error) {
	if err := ValidateEconomicRuntimeState(state); err != nil {
		return EconomicRuntimeState{}, CanonicalEconomicEvent{}, err
	}
	if input.Epoch != state.LastEpoch+1 || input.AsOf.IsZero() || !input.AsOf.UTC().After(runtimeLatestCommittedAsOf(state)) {
		return EconomicRuntimeState{}, CanonicalEconomicEvent{}, runtimeError(CodeRuntimeSequenceInvalid, "epochs must be strictly sequential and occur after every committed runtime event")
	}
	if input.DurationSeconds < 1 || input.DurationSeconds > secondsPerYear || input.StakedSupplyYNXT < 0 || input.StakedSupplyYNXT > state.TotalSupplyYNXT || input.ValidatorCount < 1 || input.LargestOperatorBPS < 0 || input.LargestOperatorBPS > BasisPoints || input.TargetAnnualSecurityBudgetYNXT < 0 {
		return EconomicRuntimeState{}, CanonicalEconomicEvent{}, runtimeError(CodeRuntimeSequenceInvalid, "epoch inputs are outside deterministic safety bounds")
	}
	if input.EmergencyMode && strings.TrimSpace(input.EmergencyReason) == "" {
		return EconomicRuntimeState{}, CanonicalEconomicEvent{}, runtimeError(CodeRuntimeEmergencyBound, "emergency mode requires a public reason")
	}
	if err := input.Fees.Validate(); err != nil {
		return EconomicRuntimeState{}, CanonicalEconomicEvent{}, err
	}
	rate, err := runtimeIssuanceRate(state.Policy, state.TotalSupplyYNXT, input)
	if err != nil {
		return EconomicRuntimeState{}, CanonicalEconomicEvent{}, err
	}
	annualIssuance, err := safeMulDiv(state.TotalSupplyYNXT, rate, BasisPoints)
	if err != nil {
		return EconomicRuntimeState{}, CanonicalEconomicEvent{}, err
	}
	issuance, err := safeMulDiv(annualIssuance, input.DurationSeconds, secondsPerYear)
	if err != nil {
		return EconomicRuntimeState{}, CanonicalEconomicEvent{}, err
	}
	burn := input.Fees.BurnYNXT()
	available, err := checkedSum(state.TotalSupplyYNXT, issuance)
	if err != nil || burn > available {
		return EconomicRuntimeState{}, CanonicalEconomicEvent{}, runtimeError(CodeRuntimeSupplyReconciliation, "burn exceeds available supply after deterministic issuance")
	}
	closing := available - burn
	allocation, err := allocateRuntimeIssuance(issuance, state.Policy.IssuanceAllocation)
	if err != nil || allocation.Total() != issuance {
		return EconomicRuntimeState{}, CanonicalEconomicEvent{}, runtimeError(CodeRuntimeSupplyReconciliation, "issuance allocation does not reconcile")
	}
	event := CanonicalEconomicEvent{
		Type:                  "ynx.economics.epoch_settled.v1",
		Version:               1,
		Epoch:                 input.Epoch,
		AsOf:                  input.AsOf.UTC(),
		DurationSeconds:       input.DurationSeconds,
		PolicyHash:            state.PolicyHash,
		OpeningSupplyYNXT:     state.TotalSupplyYNXT,
		AnnualIssuanceRateBPS: rate,
		IssuanceYNXT:          issuance,
		IssuanceAllocation:    allocation,
		FeeAccounting:         input.Fees,
		ClosingSupplyYNXT:     closing,
		EmergencyMode:         input.EmergencyMode,
		EmergencyReason:       strings.TrimSpace(input.EmergencyReason),
		Source:                "ynx-economics-runtime-candidate-v1",
	}
	event.ID = economicEventID(event)
	event.AuditHash = economicEventAuditHash(event)
	state.TotalSupplyYNXT = closing
	state.CumulativeIssuanceYNXT, err = checkedSum(state.CumulativeIssuanceYNXT, issuance)
	if err != nil {
		return EconomicRuntimeState{}, CanonicalEconomicEvent{}, err
	}
	state.CumulativeBurnYNXT, err = checkedSum(state.CumulativeBurnYNXT, burn)
	if err != nil {
		return EconomicRuntimeState{}, CanonicalEconomicEvent{}, err
	}
	state.LastEpoch = input.Epoch
	state.LastAsOf = input.AsOf.UTC()
	state.LastIssuanceRateBPS = rate
	state.EconomicEvents = append(state.EconomicEvents, event)
	state.StateVersion++
	state.StateHash = runtimeStateHash(state)
	return state, event, nil
}

func ValidateEconomicRuntimeState(state EconomicRuntimeState) error {
	if state.SchemaVersion != EconomicRuntimeSchemaVersion || state.StateVersion < 1 || state.GenesisAsOf.IsZero() || state.GenesisSupplyYNXT <= 0 || state.TotalSupplyYNXT < 0 || state.LastEpoch < 0 {
		return runtimeError(CodeRuntimeStateTampered, "runtime state metadata is invalid")
	}
	if err := state.Policy.Validate(); err != nil {
		return err
	}
	policyHash, err := runtimePolicyHash(state.Policy)
	if err != nil || policyHash != state.PolicyHash {
		return runtimeError(CodeRuntimeStateTampered, "runtime policy hash mismatch")
	}
	expectedSupply, err := checkedSum(state.GenesisSupplyYNXT, state.CumulativeIssuanceYNXT)
	if err != nil || state.CumulativeBurnYNXT > expectedSupply || expectedSupply-state.CumulativeBurnYNXT != state.TotalSupplyYNXT {
		return runtimeError(CodeRuntimeSupplyReconciliation, "runtime supply invariant failed")
	}
	var issuanceTotal, burnTotal int64
	previousEpoch := int64(0)
	previousAsOf := state.GenesisAsOf.UTC()
	for _, event := range state.EconomicEvents {
		if event.Type != "ynx.economics.epoch_settled.v1" || event.Version != 1 || event.Epoch != previousEpoch+1 || !event.AsOf.After(previousAsOf) || event.PolicyHash == "" || event.ID != economicEventID(event) || event.AuditHash != economicEventAuditHash(event) || event.OpeningSupplyYNXT+event.IssuanceYNXT-event.FeeAccounting.BurnYNXT() != event.ClosingSupplyYNXT || event.IssuanceAllocation.Total() != event.IssuanceYNXT {
			return runtimeError(CodeRuntimeStateTampered, "canonical economic event sequence or audit hash is invalid")
		}
		if err := event.FeeAccounting.Validate(); err != nil {
			return err
		}
		issuanceTotal, err = checkedSum(issuanceTotal, event.IssuanceYNXT)
		if err != nil {
			return err
		}
		burnTotal, err = checkedSum(burnTotal, event.FeeAccounting.BurnYNXT())
		if err != nil {
			return err
		}
		previousEpoch, previousAsOf = event.Epoch, event.AsOf
	}
	if previousEpoch != state.LastEpoch || !previousAsOf.Equal(state.LastAsOf) || issuanceTotal != state.CumulativeIssuanceYNXT || burnTotal != state.CumulativeBurnYNXT {
		return runtimeError(CodeRuntimeStateTampered, "runtime counters do not match canonical events")
	}
	governanceByProposal := map[string]string{}
	var previousGovernanceAt time.Time
	for _, event := range state.GovernanceEvents {
		if event.ID != governanceEventID(event) || event.AuditHash != governanceEventAuditHash(event) || strings.TrimSpace(event.ProposalID) == "" || strings.TrimSpace(event.GovernanceSource) == "" || event.Version != 1 || event.OccurredAt.IsZero() || (!previousGovernanceAt.IsZero() && event.OccurredAt.Before(previousGovernanceAt)) {
			return runtimeError(CodeRuntimeStateTampered, "governance event sequence or audit hash is invalid")
		}
		switch event.Type {
		case "ynx.economics.policy_change_scheduled.v1":
			if governanceByProposal[event.ProposalID] != "" || !event.ActivateAfter.After(event.OccurredAt) {
				return runtimeError(CodeRuntimeStateTampered, "policy schedule event is invalid or duplicated")
			}
			governanceByProposal[event.ProposalID] = "scheduled"
		case "ynx.economics.policy_change_activated.v1":
			if governanceByProposal[event.ProposalID] != "scheduled" || event.OccurredAt.Before(event.ActivateAfter) {
				return runtimeError(CodeRuntimeStateTampered, "policy activation lacks a valid prior schedule or timelock")
			}
			governanceByProposal[event.ProposalID] = "activated"
		default:
			return runtimeError(CodeRuntimeStateTampered, "unsupported governance event type")
		}
		previousGovernanceAt = event.OccurredAt
	}
	if state.PendingPolicy != nil {
		if err := ValidateRuntimePolicyTransition(state.Policy, state.PendingPolicy.Policy); err != nil {
			return err
		}
		pendingHash, err := runtimePolicyHash(state.PendingPolicy.Policy)
		if err != nil || pendingHash != state.PendingPolicy.PolicyHash || !state.PendingPolicy.ActivateAfter.After(state.PendingPolicy.ApprovedAt) {
			return runtimeError(CodeRuntimeStateTampered, "pending policy commitment is invalid")
		}
	}
	if state.StateHash != runtimeStateHash(state) {
		return runtimeError(CodeRuntimeStateTampered, "runtime state hash mismatch")
	}
	return nil
}

func runtimeIssuanceRate(policy GovernedRuntimePolicy, supply int64, input RuntimeEpochInput) (int64, error) {
	if supply <= 0 {
		return 0, runtimeError(CodeRuntimeSupplyReconciliation, "positive supply is required")
	}
	p := policy.Economics
	rate := p.AnnualIssuanceFloorBPS
	stakedRatio, err := safeMulDiv(input.StakedSupplyYNXT, BasisPoints, supply)
	if err != nil {
		return 0, err
	}
	if stakedRatio < p.TargetStakedRatioBPS {
		response, err := safeMulDiv(p.TargetStakedRatioBPS-stakedRatio, p.StakedRatioResponseBPS, BasisPoints)
		if err != nil {
			return 0, err
		}
		rate += response
	}
	if input.ValidatorCount < p.MinValidatorCount {
		response, err := safeMulDiv(p.MinValidatorCount-input.ValidatorCount, p.ValidatorDeficitBPS, p.MinValidatorCount)
		if err != nil {
			return 0, err
		}
		rate += response
	}
	if input.LargestOperatorBPS > p.MaxConcentrationBPS {
		response, err := safeMulDiv(input.LargestOperatorBPS-p.MaxConcentrationBPS, p.ConcentrationResponseBPS, BasisPoints)
		if err != nil {
			return 0, err
		}
		rate += response
	}
	annualValidatorRevenue, err := safeMulDiv(input.Fees.ValidatorYNXT, secondsPerYear, input.DurationSeconds)
	if err != nil {
		return 0, err
	}
	if input.TargetAnnualSecurityBudgetYNXT > annualValidatorRevenue {
		deficit := input.TargetAnnualSecurityBudgetYNXT - annualValidatorRevenue
		deficitBPS, err := safeMulDiv(deficit, BasisPoints, supply)
		if err != nil {
			return 0, err
		}
		if deficitBPS > BasisPoints {
			deficitBPS = BasisPoints
		}
		response, err := safeMulDiv(deficitBPS, policy.SecurityBudgetResponseBPS, BasisPoints)
		if err != nil {
			return 0, err
		}
		rate += response
	}
	annualRevenue, err := safeMulDiv(input.Fees.RevenueYNXT(), secondsPerYear, input.DurationSeconds)
	if err != nil {
		return 0, err
	}
	revenueRateBPS, err := safeMulDiv(annualRevenue, BasisPoints, supply)
	if err != nil {
		return 0, err
	}
	revenueOffset, err := safeMulDiv(revenueRateBPS, p.RevenueOffsetBPS, BasisPoints)
	if err != nil {
		return 0, err
	}
	rate -= revenueOffset
	annualBurn, err := safeMulDiv(input.Fees.BurnYNXT(), secondsPerYear, input.DurationSeconds)
	if err != nil {
		return 0, err
	}
	burnRateBPS, err := safeMulDiv(annualBurn, BasisPoints, supply)
	if err != nil {
		return 0, err
	}
	burnOffset, err := safeMulDiv(burnRateBPS, policy.BurnRateOffsetBPS, BasisPoints)
	if err != nil {
		return 0, err
	}
	rate -= burnOffset
	if rate < p.AnnualIssuanceFloorBPS {
		rate = p.AnnualIssuanceFloorBPS
	}
	ceiling := p.AnnualIssuanceCeilingBPS
	if input.EmergencyMode && policy.EmergencyIssuanceCeilingBPS < ceiling {
		ceiling = policy.EmergencyIssuanceCeilingBPS
	}
	if rate > ceiling {
		rate = ceiling
	}
	return rate, nil
}

func allocateRuntimeIssuance(issuance int64, policy IssuanceAllocationPolicy) (IssuanceAllocation, error) {
	security, err := safeMulDiv(issuance, policy.NetworkSecurityBPS, BasisPoints)
	if err != nil {
		return IssuanceAllocation{}, err
	}
	publicGoods, err := safeMulDiv(issuance, policy.PublicGoodsBPS, BasisPoints)
	if err != nil {
		return IssuanceAllocation{}, err
	}
	grants, err := safeMulDiv(issuance, policy.GovernanceGrantsBPS, BasisPoints)
	if err != nil {
		return IssuanceAllocation{}, err
	}
	allocated, err := checkedSum(security, publicGoods, grants)
	if err != nil || allocated > issuance {
		return IssuanceAllocation{}, errors.New("issuance allocation overflow")
	}
	return IssuanceAllocation{NetworkSecurityYNXT: security, PublicGoodsYNXT: publicGoods, GovernanceGrantsYNXT: grants, AdoptionIncentivesYNXT: issuance - allocated}, nil
}

func runtimePolicyHash(policy GovernedRuntimePolicy) (string, error) {
	raw, err := json.Marshal(policy)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(append([]byte("YNX_ECONOMICS_RUNTIME_POLICY_V1\x00"), raw...))
	return "sha256:" + hex.EncodeToString(sum[:]), nil
}

func runtimeStateHash(state EconomicRuntimeState) string {
	state.StateHash = ""
	raw, _ := json.Marshal(state)
	sum := sha256.Sum256(append([]byte("YNX_ECONOMICS_RUNTIME_STATE_V1\x00"), raw...))
	return "sha256:" + hex.EncodeToString(sum[:])
}

func economicEventID(event CanonicalEconomicEvent) string {
	event.ID, event.AuditHash = "", ""
	raw, _ := json.Marshal(event)
	sum := sha256.Sum256(append([]byte("YNX_ECONOMICS_EVENT_ID_V1\x00"), raw...))
	return "econ_" + hex.EncodeToString(sum[:12])
}

func economicEventAuditHash(event CanonicalEconomicEvent) string {
	event.AuditHash = ""
	raw, _ := json.Marshal(event)
	sum := sha256.Sum256(append([]byte("YNX_ECONOMICS_EVENT_AUDIT_V1\x00"), raw...))
	return "sha256:" + hex.EncodeToString(sum[:])
}

func governanceEventID(event PolicyGovernanceEvent) string {
	event.ID, event.AuditHash = "", ""
	raw, _ := json.Marshal(event)
	sum := sha256.Sum256(append([]byte("YNX_ECONOMICS_GOVERNANCE_EVENT_ID_V1\x00"), raw...))
	return "econgov_" + hex.EncodeToString(sum[:12])
}

func governanceEventAuditHash(event PolicyGovernanceEvent) string {
	event.AuditHash = ""
	raw, _ := json.Marshal(event)
	sum := sha256.Sum256(append([]byte("YNX_ECONOMICS_GOVERNANCE_EVENT_AUDIT_V1\x00"), raw...))
	return "sha256:" + hex.EncodeToString(sum[:])
}

func safeMulDiv(a, b, divisor int64) (int64, error) {
	if a < 0 || b < 0 || divisor <= 0 {
		return 0, errors.New("economic arithmetic requires non-negative values and a positive divisor")
	}
	value := new(big.Int).Mul(big.NewInt(a), big.NewInt(b))
	value.Quo(value, big.NewInt(divisor))
	if !value.IsInt64() {
		return 0, errors.New("economic arithmetic overflow")
	}
	return value.Int64(), nil
}

func checkedSum(values ...int64) (int64, error) {
	var total int64
	for _, value := range values {
		if value < 0 || total > math.MaxInt64-value {
			return 0, errors.New("economic sum overflow or negative value")
		}
		total += value
	}
	return total, nil
}

func runtimeLatestCommittedAsOf(state EconomicRuntimeState) time.Time {
	latest := state.LastAsOf.UTC()
	for _, event := range state.GovernanceEvents {
		if event.OccurredAt.After(latest) {
			latest = event.OccurredAt
		}
	}
	return latest
}

func absoluteDelta(a, b int64) int64 {
	if a >= b {
		return a - b
	}
	return b - a
}

func relativeDeltaBPS(previous, candidate int64) (int64, error) {
	if previous <= 0 || candidate <= 0 {
		return 0, errors.New("relative policy values must be positive")
	}
	return safeMulDiv(absoluteDelta(previous, candidate), BasisPoints, previous)
}
