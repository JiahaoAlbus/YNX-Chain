package economics

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

const (
	StakingRiskSchemaVersion = 1
	StakingRiskPolicyVersion = 1
)

const (
	CodeStakingRiskInvalidPolicy        = "YNX_STAKING_RISK_INVALID_POLICY"
	CodeStakingRiskInvalidState         = "YNX_STAKING_RISK_INVALID_STATE"
	CodeStakingRiskInvalidDecision      = "YNX_STAKING_RISK_INVALID_DECISION"
	CodeStakingRiskAuthorization        = "YNX_STAKING_RISK_AUTHORIZATION_FAILED"
	CodeStakingRiskTimelock             = "YNX_STAKING_RISK_TIMELOCK_ACTIVE"
	CodeStakingRiskValidatorMissing     = "YNX_STAKING_RISK_VALIDATOR_MISSING"
	CodeStakingRiskInsufficientExposure = "YNX_STAKING_RISK_INSUFFICIENT_EXPOSURE"
	CodeStakingRiskRecoveryUnavailable  = "YNX_STAKING_RISK_RECOVERY_UNAVAILABLE"
	CodeStakingRiskDuplicateDecision    = "YNX_STAKING_RISK_DUPLICATE_DECISION"
)

const (
	StakingInfractionDowntime     = "downtime"
	StakingInfractionDoubleSign   = "double_sign"
	StakingInfractionInvalidState = "invalid_state_transition"
	StakingValidatorStatusActive  = "active"
	StakingValidatorStatusJailed  = "jailed"
	StakingRiskActionPenalty      = "penalty"
	StakingRiskActionRecovery     = "recovery"
)

type StakingRiskPolicy struct {
	Version                     int   `json:"version"`
	DowntimeMaximumSlashBPS     int64 `json:"downtimeMaximumSlashBps"`
	DoubleSignMaximumSlashBPS   int64 `json:"doubleSignMaximumSlashBps"`
	InvalidStateMaximumSlashBPS int64 `json:"invalidStateMaximumSlashBps"`
	GlobalMaximumSlashBPS       int64 `json:"globalMaximumSlashBps"`
	JailSeconds                 int64 `json:"jailSeconds"`
	GovernanceTimelockSeconds   int64 `json:"governanceTimelockSeconds"`
}

func DefaultStakingRiskPolicy() StakingRiskPolicy {
	return StakingRiskPolicy{
		Version:                     StakingRiskPolicyVersion,
		DowntimeMaximumSlashBPS:     100,
		DoubleSignMaximumSlashBPS:   5_000,
		InvalidStateMaximumSlashBPS: 2_000,
		GlobalMaximumSlashBPS:       5_000,
		JailSeconds:                 7 * 24 * 60 * 60,
		GovernanceTimelockSeconds:   2 * 24 * 60 * 60,
	}
}

func (p StakingRiskPolicy) Validate() error {
	if p.Version != StakingRiskPolicyVersion || p.JailSeconds < 60*60 || p.GovernanceTimelockSeconds < 60*60 {
		return runtimeError(CodeStakingRiskInvalidPolicy, "staking risk policy version, jail, or timelock is invalid")
	}
	for name, value := range map[string]int64{
		"downtime maximum slash":      p.DowntimeMaximumSlashBPS,
		"double-sign maximum slash":   p.DoubleSignMaximumSlashBPS,
		"invalid-state maximum slash": p.InvalidStateMaximumSlashBPS,
		"global maximum slash":        p.GlobalMaximumSlashBPS,
	} {
		if value < 0 || value > BasisPoints {
			return runtimeError(CodeStakingRiskInvalidPolicy, fmt.Sprintf("%s must be between 0 and %d bps", name, BasisPoints))
		}
	}
	if p.DowntimeMaximumSlashBPS > p.GlobalMaximumSlashBPS || p.DoubleSignMaximumSlashBPS > p.GlobalMaximumSlashBPS || p.InvalidStateMaximumSlashBPS > p.GlobalMaximumSlashBPS {
		return runtimeError(CodeStakingRiskInvalidPolicy, "infraction slash limits cannot exceed the global maximum")
	}
	return nil
}

type StakingGovernanceCommittee struct {
	Version    int      `json:"version"`
	PublicKeys []string `json:"publicKeys"`
	Threshold  int      `json:"threshold"`
}

func (c StakingGovernanceCommittee) Validate() error {
	if c.Version != 1 || len(c.PublicKeys) < 1 || len(c.PublicKeys) > 31 || c.Threshold < 1 || c.Threshold > len(c.PublicKeys) {
		return runtimeError(CodeStakingRiskAuthorization, "governance committee size or threshold is invalid")
	}
	previous := ""
	for _, encoded := range c.PublicKeys {
		if encoded <= previous {
			return runtimeError(CodeStakingRiskAuthorization, "governance public keys must be unique and lexicographically sorted")
		}
		key, err := hex.DecodeString(encoded)
		if err != nil || len(key) != ed25519.PublicKeySize {
			return runtimeError(CodeStakingRiskAuthorization, "governance public key is not a canonical Ed25519 key")
		}
		previous = encoded
	}
	return nil
}

type ValidatorRiskPosition struct {
	Validator           string     `json:"validator"`
	OperatorStakeYNXT   int64      `json:"operatorStakeYnxt"`
	DelegatedStakeYNXT  int64      `json:"delegatedStakeYnxt"`
	QueuedUnbondingYNXT int64      `json:"queuedUnbondingYnxt"`
	Status              string     `json:"status"`
	JailedUntil         *time.Time `json:"jailedUntil,omitempty"`
	CumulativeSlashYNXT int64      `json:"cumulativeSlashYnxt"`
	LastDecisionID      string     `json:"lastDecisionId,omitempty"`
	UpdatedAt           time.Time  `json:"updatedAt"`
}

func (p ValidatorRiskPosition) SlashableExposureYNXT() (int64, error) {
	return checkedSum(p.OperatorStakeYNXT, p.DelegatedStakeYNXT, p.QueuedUnbondingYNXT)
}

type StakingPenaltyDecision struct {
	Version      int       `json:"version"`
	ProposalID   string    `json:"proposalId"`
	Validator    string    `json:"validator"`
	Infraction   string    `json:"infraction"`
	SlashBPS     int64     `json:"slashBps"`
	EvidenceHash string    `json:"evidenceHash"`
	ObservedAt   time.Time `json:"observedAt"`
	ProposedAt   time.Time `json:"proposedAt"`
	ExecuteAfter time.Time `json:"executeAfter"`
	Reason       string    `json:"reason"`
}

type StakingRecoveryDecision struct {
	Version      int       `json:"version"`
	ProposalID   string    `json:"proposalId"`
	Validator    string    `json:"validator"`
	EvidenceHash string    `json:"evidenceHash"`
	ProposedAt   time.Time `json:"proposedAt"`
	ExecuteAfter time.Time `json:"executeAfter"`
	Reason       string    `json:"reason"`
}

type GovernanceSignature struct {
	PublicKey string `json:"publicKey"`
	Signature string `json:"signature"`
}

type StakingGovernanceAuthorization struct {
	ActionHash string                `json:"actionHash"`
	Signatures []GovernanceSignature `json:"signatures"`
}

type StakingRiskEvent struct {
	ID                       string     `json:"id"`
	Type                     string     `json:"type"`
	Version                  int        `json:"version"`
	ProposalID               string     `json:"proposalId"`
	Validator                string     `json:"validator"`
	Infraction               string     `json:"infraction,omitempty"`
	EvidenceHash             string     `json:"evidenceHash"`
	ActionHash               string     `json:"actionHash"`
	ExecutedAt               time.Time  `json:"executedAt"`
	OpeningExposureYNXT      int64      `json:"openingExposureYnxt"`
	SlashBPS                 int64      `json:"slashBps"`
	OperatorSlashYNXT        int64      `json:"operatorSlashYnxt"`
	DelegatorSlashYNXT       int64      `json:"delegatorSlashYnxt"`
	QueuedUnbondingSlashYNXT int64      `json:"queuedUnbondingSlashYnxt"`
	TotalSlashYNXT           int64      `json:"totalSlashYnxt"`
	ClosingExposureYNXT      int64      `json:"closingExposureYnxt"`
	JailedUntil              *time.Time `json:"jailedUntil,omitempty"`
	Threshold                int        `json:"threshold"`
	VerifiedSignatures       int        `json:"verifiedSignatures"`
	Source                   string     `json:"source"`
	AuditHash                string     `json:"auditHash"`
}

type StakingRiskState struct {
	SchemaVersion int                        `json:"schemaVersion"`
	StateVersion  int64                      `json:"stateVersion"`
	GenesisAsOf   time.Time                  `json:"genesisAsOf"`
	LastAsOf      time.Time                  `json:"lastAsOf"`
	Policy        StakingRiskPolicy          `json:"policy"`
	PolicyHash    string                     `json:"policyHash"`
	Committee     StakingGovernanceCommittee `json:"committee"`
	CommitteeHash string                     `json:"committeeHash"`
	Validators    []ValidatorRiskPosition    `json:"validators"`
	Events        []StakingRiskEvent         `json:"events"`
	StateHash     string                     `json:"stateHash"`
}

type StakingRiskReplayAction struct {
	Type          string                         `json:"type"`
	ExecutedAt    time.Time                      `json:"executedAt"`
	Penalty       *StakingPenaltyDecision        `json:"penalty,omitempty"`
	Recovery      *StakingRecoveryDecision       `json:"recovery,omitempty"`
	Authorization StakingGovernanceAuthorization `json:"authorization"`
}

type StakingRiskReplayInput struct {
	GenesisAsOf time.Time                  `json:"genesisAsOf"`
	Policy      *StakingRiskPolicy         `json:"policy,omitempty"`
	Committee   StakingGovernanceCommittee `json:"committee"`
	Validators  []ValidatorRiskPosition    `json:"validators"`
	Actions     []StakingRiskReplayAction  `json:"actions"`
}

func NewStakingRiskState(asOf time.Time, policy StakingRiskPolicy, committee StakingGovernanceCommittee, validators []ValidatorRiskPosition) (StakingRiskState, error) {
	if asOf.IsZero() {
		return StakingRiskState{}, runtimeError(CodeStakingRiskInvalidState, "staking risk genesis time is required")
	}
	if err := policy.Validate(); err != nil {
		return StakingRiskState{}, err
	}
	if err := committee.Validate(); err != nil {
		return StakingRiskState{}, err
	}
	positions := append([]ValidatorRiskPosition(nil), validators...)
	sort.Slice(positions, func(i, j int) bool { return positions[i].Validator < positions[j].Validator })
	for index := range positions {
		positions[index].Validator = strings.TrimSpace(positions[index].Validator)
		if positions[index].Status == "" {
			positions[index].Status = StakingValidatorStatusActive
		}
		if positions[index].UpdatedAt.IsZero() {
			positions[index].UpdatedAt = asOf.UTC()
		}
	}
	policyHash, err := stakingRiskPolicyHash(policy)
	if err != nil {
		return StakingRiskState{}, err
	}
	committeeHash, err := stakingCommitteeHash(committee)
	if err != nil {
		return StakingRiskState{}, err
	}
	state := StakingRiskState{SchemaVersion: StakingRiskSchemaVersion, StateVersion: 1, GenesisAsOf: asOf.UTC(), LastAsOf: asOf.UTC(), Policy: policy, PolicyHash: policyHash, Committee: committee, CommitteeHash: committeeHash, Validators: positions, Events: []StakingRiskEvent{}}
	state.StateHash = stakingRiskStateHash(state)
	if err := ValidateStakingRiskState(state); err != nil {
		return StakingRiskState{}, err
	}
	return state, nil
}

func ReplayStakingRiskRuntime(input StakingRiskReplayInput) (StakingRiskState, error) {
	policy := DefaultStakingRiskPolicy()
	if input.Policy != nil {
		policy = *input.Policy
	}
	state, err := NewStakingRiskState(input.GenesisAsOf, policy, input.Committee, input.Validators)
	if err != nil {
		return StakingRiskState{}, err
	}
	for index, action := range input.Actions {
		switch action.Type {
		case StakingRiskActionPenalty:
			if action.Penalty == nil || action.Recovery != nil {
				return StakingRiskState{}, runtimeError(CodeStakingRiskInvalidDecision, fmt.Sprintf("staking replay action %d must contain exactly one penalty decision", index))
			}
			state, _, err = ApplyStakingPenalty(state, *action.Penalty, action.Authorization, action.ExecutedAt)
		case StakingRiskActionRecovery:
			if action.Recovery == nil || action.Penalty != nil {
				return StakingRiskState{}, runtimeError(CodeStakingRiskInvalidDecision, fmt.Sprintf("staking replay action %d must contain exactly one recovery decision", index))
			}
			state, _, err = ApplyStakingRecovery(state, *action.Recovery, action.Authorization, action.ExecutedAt)
		default:
			return StakingRiskState{}, runtimeError(CodeStakingRiskInvalidDecision, fmt.Sprintf("staking replay action %d has unsupported type %q", index, action.Type))
		}
		if err != nil {
			return StakingRiskState{}, fmt.Errorf("staking replay action %d: %w", index, err)
		}
	}
	return state, nil
}

func ApplyStakingPenalty(state StakingRiskState, decision StakingPenaltyDecision, authorization StakingGovernanceAuthorization, executedAt time.Time) (StakingRiskState, StakingRiskEvent, error) {
	if err := ValidateStakingRiskState(state); err != nil {
		return StakingRiskState{}, StakingRiskEvent{}, err
	}
	if err := validateStakingPenaltyDecision(state, decision); err != nil {
		return StakingRiskState{}, StakingRiskEvent{}, err
	}
	if executedAt.IsZero() || executedAt.UTC().Before(decision.ExecuteAfter) {
		return StakingRiskState{}, StakingRiskEvent{}, runtimeError(CodeStakingRiskTimelock, "staking penalty cannot execute before the governance timelock")
	}
	if !executedAt.UTC().After(state.LastAsOf) {
		return StakingRiskState{}, StakingRiskEvent{}, runtimeError(CodeStakingRiskInvalidDecision, "staking penalty execution must advance committed time")
	}
	actionHash := stakingPenaltyDecisionHash(decision)
	verified, err := verifyStakingAuthorization(state.Committee, actionHash, authorization)
	if err != nil {
		return StakingRiskState{}, StakingRiskEvent{}, err
	}
	if stakingProposalExists(state.Events, decision.ProposalID) {
		return StakingRiskState{}, StakingRiskEvent{}, runtimeError(CodeStakingRiskDuplicateDecision, "staking governance proposal was already executed")
	}
	index, ok := stakingValidatorIndex(state.Validators, decision.Validator)
	if !ok {
		return StakingRiskState{}, StakingRiskEvent{}, runtimeError(CodeStakingRiskValidatorMissing, "validator is not present in the staking risk state")
	}
	position := state.Validators[index]
	exposure, err := position.SlashableExposureYNXT()
	if err != nil || exposure <= 0 {
		return StakingRiskState{}, StakingRiskEvent{}, runtimeError(CodeStakingRiskInsufficientExposure, "validator has no slashable stake exposure")
	}
	totalSlash, err := safeMulDiv(exposure, decision.SlashBPS, BasisPoints)
	if err != nil || totalSlash <= 0 {
		return StakingRiskState{}, StakingRiskEvent{}, runtimeError(CodeStakingRiskInsufficientExposure, "slash amount rounds to zero or overflows")
	}
	operatorSlash, delegatorSlash, queuedSlash, err := allocateSlashAcrossExposure(totalSlash, position)
	if err != nil {
		return StakingRiskState{}, StakingRiskEvent{}, err
	}
	position.OperatorStakeYNXT -= operatorSlash
	position.DelegatedStakeYNXT -= delegatorSlash
	position.QueuedUnbondingYNXT -= queuedSlash
	position.CumulativeSlashYNXT, err = checkedSum(position.CumulativeSlashYNXT, totalSlash)
	if err != nil {
		return StakingRiskState{}, StakingRiskEvent{}, err
	}
	position.Status = StakingValidatorStatusJailed
	jailUntil := executedAt.UTC().Add(time.Duration(state.Policy.JailSeconds) * time.Second)
	if position.JailedUntil != nil && position.JailedUntil.After(jailUntil) {
		jailUntil = position.JailedUntil.UTC()
	}
	position.JailedUntil = &jailUntil
	position.LastDecisionID = decision.ProposalID
	position.UpdatedAt = executedAt.UTC()
	closing, _ := position.SlashableExposureYNXT()
	event := StakingRiskEvent{
		Type:                     "ynx.staking.validator_slashed.v1",
		Version:                  1,
		ProposalID:               decision.ProposalID,
		Validator:                decision.Validator,
		Infraction:               decision.Infraction,
		EvidenceHash:             decision.EvidenceHash,
		ActionHash:               actionHash,
		ExecutedAt:               executedAt.UTC(),
		OpeningExposureYNXT:      exposure,
		SlashBPS:                 decision.SlashBPS,
		OperatorSlashYNXT:        operatorSlash,
		DelegatorSlashYNXT:       delegatorSlash,
		QueuedUnbondingSlashYNXT: queuedSlash,
		TotalSlashYNXT:           totalSlash,
		ClosingExposureYNXT:      closing,
		JailedUntil:              &jailUntil,
		Threshold:                state.Committee.Threshold,
		VerifiedSignatures:       verified,
		Source:                   "ynx-staking-risk-runtime-candidate-v1",
	}
	event.ID = stakingRiskEventID(event)
	event.AuditHash = stakingRiskEventAuditHash(event)
	position.LastDecisionID = event.ID
	state.Validators[index] = position
	state.Events = append(state.Events, event)
	state.LastAsOf = executedAt.UTC()
	state.StateVersion++
	state.StateHash = stakingRiskStateHash(state)
	if err := ValidateStakingRiskState(state); err != nil {
		return StakingRiskState{}, StakingRiskEvent{}, err
	}
	return state, event, nil
}

func ApplyStakingRecovery(state StakingRiskState, decision StakingRecoveryDecision, authorization StakingGovernanceAuthorization, executedAt time.Time) (StakingRiskState, StakingRiskEvent, error) {
	if err := ValidateStakingRiskState(state); err != nil {
		return StakingRiskState{}, StakingRiskEvent{}, err
	}
	if decision.Version != 1 || strings.TrimSpace(decision.ProposalID) == "" || !validValidatorIdentifier(decision.Validator) || !validEvidenceHash(decision.EvidenceHash) || decision.ProposedAt.IsZero() || decision.ProposedAt.Before(state.LastAsOf) || decision.ExecuteAfter.IsZero() || decision.ExecuteAfter.Before(decision.ProposedAt.Add(time.Duration(state.Policy.GovernanceTimelockSeconds)*time.Second)) || strings.TrimSpace(decision.Reason) == "" {
		return StakingRiskState{}, StakingRiskEvent{}, runtimeError(CodeStakingRiskInvalidDecision, "staking recovery decision is incomplete or outside governance bounds")
	}
	if executedAt.IsZero() || executedAt.UTC().Before(decision.ExecuteAfter) || !executedAt.UTC().After(state.LastAsOf) {
		return StakingRiskState{}, StakingRiskEvent{}, runtimeError(CodeStakingRiskTimelock, "staking recovery cannot execute before timelock or committed state time")
	}
	actionHash := stakingRecoveryDecisionHash(decision)
	verified, err := verifyStakingAuthorization(state.Committee, actionHash, authorization)
	if err != nil {
		return StakingRiskState{}, StakingRiskEvent{}, err
	}
	if stakingProposalExists(state.Events, decision.ProposalID) {
		return StakingRiskState{}, StakingRiskEvent{}, runtimeError(CodeStakingRiskDuplicateDecision, "staking governance proposal was already executed")
	}
	index, ok := stakingValidatorIndex(state.Validators, decision.Validator)
	if !ok {
		return StakingRiskState{}, StakingRiskEvent{}, runtimeError(CodeStakingRiskValidatorMissing, "validator is not present in the staking risk state")
	}
	position := state.Validators[index]
	if position.Status != StakingValidatorStatusJailed || position.JailedUntil == nil || executedAt.UTC().Before(*position.JailedUntil) {
		return StakingRiskState{}, StakingRiskEvent{}, runtimeError(CodeStakingRiskRecoveryUnavailable, "validator is not eligible for governed recovery")
	}
	exposure, _ := position.SlashableExposureYNXT()
	position.Status = StakingValidatorStatusActive
	position.JailedUntil = nil
	position.UpdatedAt = executedAt.UTC()
	event := StakingRiskEvent{Type: "ynx.staking.validator_unjailed.v1", Version: 1, ProposalID: decision.ProposalID, Validator: decision.Validator, EvidenceHash: decision.EvidenceHash, ActionHash: actionHash, ExecutedAt: executedAt.UTC(), OpeningExposureYNXT: exposure, ClosingExposureYNXT: exposure, Threshold: state.Committee.Threshold, VerifiedSignatures: verified, Source: "ynx-staking-risk-runtime-candidate-v1"}
	event.ID = stakingRiskEventID(event)
	event.AuditHash = stakingRiskEventAuditHash(event)
	position.LastDecisionID = event.ID
	state.Validators[index] = position
	state.Events = append(state.Events, event)
	state.LastAsOf = executedAt.UTC()
	state.StateVersion++
	state.StateHash = stakingRiskStateHash(state)
	if err := ValidateStakingRiskState(state); err != nil {
		return StakingRiskState{}, StakingRiskEvent{}, err
	}
	return state, event, nil
}

func ValidateStakingRiskState(state StakingRiskState) error {
	if state.SchemaVersion != StakingRiskSchemaVersion || state.StateVersion != int64(1+len(state.Events)) || state.GenesisAsOf.IsZero() || state.LastAsOf.Before(state.GenesisAsOf) {
		return runtimeError(CodeStakingRiskInvalidState, "staking risk state metadata is invalid")
	}
	if err := state.Policy.Validate(); err != nil {
		return err
	}
	if err := state.Committee.Validate(); err != nil {
		return err
	}
	policyHash, err := stakingRiskPolicyHash(state.Policy)
	if err != nil || policyHash != state.PolicyHash {
		return runtimeError(CodeStakingRiskInvalidState, "staking risk policy hash mismatch")
	}
	committeeHash, err := stakingCommitteeHash(state.Committee)
	if err != nil || committeeHash != state.CommitteeHash {
		return runtimeError(CodeStakingRiskInvalidState, "staking governance committee hash mismatch")
	}
	previousValidator := ""
	for _, position := range state.Validators {
		if !validValidatorIdentifier(position.Validator) || position.Validator <= previousValidator || position.OperatorStakeYNXT < 0 || position.DelegatedStakeYNXT < 0 || position.QueuedUnbondingYNXT < 0 || position.CumulativeSlashYNXT < 0 || position.UpdatedAt.IsZero() || position.UpdatedAt.After(state.LastAsOf) {
			return runtimeError(CodeStakingRiskInvalidState, "validator risk positions are not canonical")
		}
		switch position.Status {
		case StakingValidatorStatusActive:
			if position.JailedUntil != nil {
				return runtimeError(CodeStakingRiskInvalidState, "active validator cannot have a jail deadline")
			}
		case StakingValidatorStatusJailed:
			if position.JailedUntil == nil {
				return runtimeError(CodeStakingRiskInvalidState, "jailed validator requires a jail deadline")
			}
		default:
			return runtimeError(CodeStakingRiskInvalidState, "validator risk status is unsupported")
		}
		previousValidator = position.Validator
	}
	seenProposals := map[string]bool{}
	var previousEventAt time.Time
	for _, event := range state.Events {
		if event.Version != 1 || event.ID != stakingRiskEventID(event) || event.AuditHash != stakingRiskEventAuditHash(event) || strings.TrimSpace(event.ProposalID) == "" || !validValidatorIdentifier(event.Validator) || !validEvidenceHash(event.EvidenceHash) || !validEvidenceHash(event.ActionHash) || event.Source != "ynx-staking-risk-runtime-candidate-v1" || seenProposals[event.ProposalID] || event.ExecutedAt.IsZero() || (!previousEventAt.IsZero() && !event.ExecutedAt.After(previousEventAt)) || event.VerifiedSignatures < event.Threshold || event.Threshold != state.Committee.Threshold {
			return runtimeError(CodeStakingRiskInvalidState, "staking risk event sequence or authorization evidence is invalid")
		}
		seenProposals[event.ProposalID] = true
		switch event.Type {
		case "ynx.staking.validator_slashed.v1":
			allocated, err := checkedSum(event.OperatorSlashYNXT, event.DelegatorSlashYNXT, event.QueuedUnbondingSlashYNXT)
			maximum, validInfraction := stakingInfractionMaximum(state.Policy, event.Infraction)
			if err != nil || !validInfraction || allocated != event.TotalSlashYNXT || event.TotalSlashYNXT <= 0 || event.OpeningExposureYNXT-event.TotalSlashYNXT != event.ClosingExposureYNXT || event.SlashBPS <= 0 || event.SlashBPS > maximum || event.SlashBPS > state.Policy.GlobalMaximumSlashBPS || event.JailedUntil == nil || !event.JailedUntil.After(event.ExecutedAt) {
				return runtimeError(CodeStakingRiskInvalidState, "staking slash event does not reconcile")
			}
		case "ynx.staking.validator_unjailed.v1":
			if event.Infraction != "" || event.TotalSlashYNXT != 0 || event.OperatorSlashYNXT != 0 || event.DelegatorSlashYNXT != 0 || event.QueuedUnbondingSlashYNXT != 0 || event.SlashBPS != 0 || event.OpeningExposureYNXT != event.ClosingExposureYNXT || event.JailedUntil != nil {
				return runtimeError(CodeStakingRiskInvalidState, "staking recovery event does not reconcile")
			}
		default:
			return runtimeError(CodeStakingRiskInvalidState, "staking risk event type is unsupported")
		}
		previousEventAt = event.ExecutedAt
	}
	if len(state.Events) == 0 {
		if !state.LastAsOf.Equal(state.GenesisAsOf) {
			return runtimeError(CodeStakingRiskInvalidState, "empty staking risk state changed committed time")
		}
	} else if !state.Events[len(state.Events)-1].ExecutedAt.Equal(state.LastAsOf) {
		return runtimeError(CodeStakingRiskInvalidState, "staking risk last event time mismatch")
	}
	if state.StateHash != stakingRiskStateHash(state) {
		return runtimeError(CodeStakingRiskInvalidState, "staking risk state hash mismatch")
	}
	return nil
}

func validateStakingPenaltyDecision(state StakingRiskState, decision StakingPenaltyDecision) error {
	if decision.Version != 1 || strings.TrimSpace(decision.ProposalID) == "" || !validValidatorIdentifier(decision.Validator) || !validEvidenceHash(decision.EvidenceHash) || decision.ObservedAt.IsZero() || decision.ProposedAt.IsZero() || decision.ExecuteAfter.IsZero() || decision.ObservedAt.After(decision.ProposedAt) || decision.ProposedAt.Before(state.LastAsOf) || decision.ExecuteAfter.Before(decision.ProposedAt.Add(time.Duration(state.Policy.GovernanceTimelockSeconds)*time.Second)) || strings.TrimSpace(decision.Reason) == "" || decision.SlashBPS <= 0 || decision.SlashBPS > state.Policy.GlobalMaximumSlashBPS {
		return runtimeError(CodeStakingRiskInvalidDecision, "staking penalty decision is incomplete or outside governance bounds")
	}
	maximum, ok := stakingInfractionMaximum(state.Policy, decision.Infraction)
	if !ok {
		return runtimeError(CodeStakingRiskInvalidDecision, "staking infraction is unsupported")
	}
	if decision.SlashBPS > maximum {
		return runtimeError(CodeStakingRiskInvalidDecision, "staking slash exceeds the published infraction maximum")
	}
	return nil
}

func stakingInfractionMaximum(policy StakingRiskPolicy, infraction string) (int64, bool) {
	switch infraction {
	case StakingInfractionDowntime:
		return policy.DowntimeMaximumSlashBPS, true
	case StakingInfractionDoubleSign:
		return policy.DoubleSignMaximumSlashBPS, true
	case StakingInfractionInvalidState:
		return policy.InvalidStateMaximumSlashBPS, true
	default:
		return 0, false
	}
}

func verifyStakingAuthorization(committee StakingGovernanceCommittee, actionHash string, authorization StakingGovernanceAuthorization) (int, error) {
	if authorization.ActionHash != actionHash || len(authorization.Signatures) < committee.Threshold {
		return 0, runtimeError(CodeStakingRiskAuthorization, "governance authorization does not bind the required action hash or threshold")
	}
	members := map[string]bool{}
	for _, key := range committee.PublicKeys {
		members[key] = true
	}
	seen := map[string]bool{}
	verified := 0
	for _, item := range authorization.Signatures {
		if !members[item.PublicKey] || seen[item.PublicKey] {
			return 0, runtimeError(CodeStakingRiskAuthorization, "governance signature is unknown or duplicated")
		}
		publicKey, err := hex.DecodeString(item.PublicKey)
		if err != nil {
			return 0, runtimeError(CodeStakingRiskAuthorization, "governance public key encoding is invalid")
		}
		signature, err := hex.DecodeString(item.Signature)
		if err != nil || len(signature) != ed25519.SignatureSize || !ed25519.Verify(ed25519.PublicKey(publicKey), []byte(actionHash), signature) {
			return 0, runtimeError(CodeStakingRiskAuthorization, "governance signature verification failed")
		}
		seen[item.PublicKey] = true
		verified++
	}
	if verified < committee.Threshold {
		return 0, runtimeError(CodeStakingRiskAuthorization, "governance signature threshold was not met")
	}
	return verified, nil
}

func allocateSlashAcrossExposure(totalSlash int64, position ValidatorRiskPosition) (int64, int64, int64, error) {
	exposure, err := position.SlashableExposureYNXT()
	if err != nil || totalSlash <= 0 || totalSlash > exposure {
		return 0, 0, 0, runtimeError(CodeStakingRiskInsufficientExposure, "slash allocation exceeds validator exposure")
	}
	amounts := []int64{position.OperatorStakeYNXT, position.DelegatedStakeYNXT, position.QueuedUnbondingYNXT}
	allocated := make([]int64, len(amounts))
	var used int64
	for index, amount := range amounts {
		allocated[index], err = safeMulDiv(totalSlash, amount, exposure)
		if err != nil {
			return 0, 0, 0, err
		}
		used += allocated[index]
	}
	remaining := totalSlash - used
	for remaining > 0 {
		progress := false
		for index, amount := range amounts {
			if allocated[index] < amount {
				allocated[index]++
				remaining--
				progress = true
				if remaining == 0 {
					break
				}
			}
		}
		if !progress {
			return 0, 0, 0, errors.New("slash remainder cannot be allocated")
		}
	}
	return allocated[0], allocated[1], allocated[2], nil
}

func stakingValidatorIndex(values []ValidatorRiskPosition, validator string) (int, bool) {
	index := sort.Search(len(values), func(i int) bool { return values[i].Validator >= validator })
	return index, index < len(values) && values[index].Validator == validator
}

func stakingProposalExists(events []StakingRiskEvent, proposalID string) bool {
	for _, event := range events {
		if event.ProposalID == proposalID {
			return true
		}
	}
	return false
}

func validValidatorIdentifier(value string) bool {
	value = strings.TrimSpace(value)
	return value != "" && len(value) <= 128
}

func validEvidenceHash(value string) bool {
	if !strings.HasPrefix(value, "sha256:") || len(value) != len("sha256:")+sha256.Size*2 {
		return false
	}
	_, err := hex.DecodeString(strings.TrimPrefix(value, "sha256:"))
	return err == nil
}

func stakingRiskPolicyHash(policy StakingRiskPolicy) (string, error) {
	return canonicalStakingHash("YNX_STAKING_RISK_POLICY_V1", policy)
}

func stakingCommitteeHash(committee StakingGovernanceCommittee) (string, error) {
	return canonicalStakingHash("YNX_STAKING_GOVERNANCE_COMMITTEE_V1", committee)
}

func stakingPenaltyDecisionHash(decision StakingPenaltyDecision) string {
	hash, _ := canonicalStakingHash("YNX_STAKING_PENALTY_DECISION_V1", decision)
	return hash
}

func stakingRecoveryDecisionHash(decision StakingRecoveryDecision) string {
	hash, _ := canonicalStakingHash("YNX_STAKING_RECOVERY_DECISION_V1", decision)
	return hash
}

func stakingRiskStateHash(state StakingRiskState) string {
	state.StateHash = ""
	hash, _ := canonicalStakingHash("YNX_STAKING_RISK_STATE_V1", state)
	return hash
}

func stakingRiskEventID(event StakingRiskEvent) string {
	event.ID, event.AuditHash = "", ""
	raw, _ := json.Marshal(event)
	sum := sha256.Sum256(append([]byte("YNX_STAKING_RISK_EVENT_ID_V1\x00"), raw...))
	return "stakeevt_" + hex.EncodeToString(sum[:12])
}

func stakingRiskEventAuditHash(event StakingRiskEvent) string {
	event.AuditHash = ""
	hash, _ := canonicalStakingHash("YNX_STAKING_RISK_EVENT_AUDIT_V1", event)
	return hash
}

func canonicalStakingHash(domain string, value any) (string, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(append([]byte(domain+"\x00"), raw...))
	return "sha256:" + hex.EncodeToString(sum[:]), nil
}
