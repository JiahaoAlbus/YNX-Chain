package economics

import (
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
	SafetyModuleRuntimeSchemaVersion = 1
	SafetyModuleRuntimePolicyVersion = 1
)

const (
	CodeSafetyRuntimeInvalidPolicy    = "YNX_SAFETY_RUNTIME_INVALID_POLICY"
	CodeSafetyRuntimeInvalidState     = "YNX_SAFETY_RUNTIME_INVALID_STATE"
	CodeSafetyRuntimeInvalidAction    = "YNX_SAFETY_RUNTIME_INVALID_ACTION"
	CodeSafetyRuntimeAuthorization    = "YNX_SAFETY_RUNTIME_AUTHORIZATION_FAILED"
	CodeSafetyRuntimeTimelock         = "YNX_SAFETY_RUNTIME_TIMELOCK_ACTIVE"
	CodeSafetyRuntimeDuplicateAction  = "YNX_SAFETY_RUNTIME_DUPLICATE_ACTION"
	CodeSafetyRuntimeStakeCap         = "YNX_SAFETY_RUNTIME_STAKE_CAP_EXCEEDED"
	CodeSafetyRuntimeParticipant      = "YNX_SAFETY_RUNTIME_PARTICIPANT_INVALID"
	CodeSafetyRuntimeExitUnavailable  = "YNX_SAFETY_RUNTIME_EXIT_UNAVAILABLE"
	CodeSafetyRuntimeShortfallInvalid = "YNX_SAFETY_RUNTIME_SHORTFALL_INVALID"
	CodeSafetyRuntimeReconciliation   = "YNX_SAFETY_RUNTIME_RECONCILIATION_FAILED"
)

const (
	SafetyStakeStatusActive  = "active"
	SafetyStakeStatusCooling = "cooling"
	SafetyStakeStatusExited  = "exited"

	SafetyRuntimeActionDeposit          = "deposit"
	SafetyRuntimeActionExitRequest      = "exit_request"
	SafetyRuntimeActionExitComplete     = "exit_complete"
	SafetyRuntimeActionInsuranceFunding = "insurance_funding"
	SafetyRuntimeActionShortfall        = "shortfall"
)

type SafetyModuleRuntimePolicy struct {
	Version                     int                `json:"version"`
	Module                      SafetyModulePolicy `json:"module"`
	GovernanceTimelockSeconds   int64              `json:"governanceTimelockSeconds"`
	MaximumInsuranceDrawBPS     int64              `json:"maximumInsuranceDrawBps"`
	RequireNativeWalletEvidence bool               `json:"requireNativeWalletEvidence"`
}

func DefaultSafetyModuleRuntimePolicy() SafetyModuleRuntimePolicy {
	return SafetyModuleRuntimePolicy{
		Version:                     SafetyModuleRuntimePolicyVersion,
		Module:                      DefaultSafetyModulePolicy(),
		GovernanceTimelockSeconds:   2 * 24 * 60 * 60,
		MaximumInsuranceDrawBPS:     BasisPoints,
		RequireNativeWalletEvidence: true,
	}
}

func (p SafetyModuleRuntimePolicy) Validate() error {
	if p.Version != SafetyModuleRuntimePolicyVersion {
		return runtimeError(CodeSafetyRuntimeInvalidPolicy, fmt.Sprintf("unsupported safety runtime policy version %d", p.Version))
	}
	if err := p.Module.Validate(); err != nil {
		return runtimeError(CodeSafetyRuntimeInvalidPolicy, err.Error())
	}
	if p.GovernanceTimelockSeconds < 60*60 || p.GovernanceTimelockSeconds > 365*24*60*60 || p.MaximumInsuranceDrawBPS < 0 || p.MaximumInsuranceDrawBPS > BasisPoints || !p.RequireNativeWalletEvidence {
		return runtimeError(CodeSafetyRuntimeInvalidPolicy, "safety runtime timelock, insurance draw, or wallet evidence policy is outside bounds")
	}
	return nil
}

type SafetyModuleRuntimeStake struct {
	Participant                string     `json:"participant"`
	PrincipalYNXT              int64      `json:"principalYnxt"`
	AmountYNXT                 int64      `json:"amountYnxt"`
	CumulativeSlashYNXT        int64      `json:"cumulativeSlashYnxt"`
	Provenance                 string     `json:"provenance"`
	Status                     string     `json:"status"`
	CooldownRequestedAt        *time.Time `json:"cooldownRequestedAt,omitempty"`
	WalletApprovalEvidenceHash string     `json:"walletApprovalEvidenceHash"`
	CustodyReceiptHash         string     `json:"custodyReceiptHash"`
	UpdatedAt                  time.Time  `json:"updatedAt"`
}

func (s SafetyModuleRuntimeStake) LifetimeSlashCapacityYNXT(policy SafetyModulePolicy) (int64, error) {
	maximum, err := safeMulDiv(s.PrincipalYNXT, policy.MaximumSlashBPS, BasisPoints)
	if err != nil {
		return 0, err
	}
	if s.CumulativeSlashYNXT > maximum {
		return 0, runtimeError(CodeSafetyRuntimeReconciliation, "stake cumulative slash exceeds the published lifetime maximum")
	}
	capacity := maximum - s.CumulativeSlashYNXT
	if capacity > s.AmountYNXT {
		capacity = s.AmountYNXT
	}
	return capacity, nil
}

type SafetyStakeDepositAction struct {
	Version                    int       `json:"version"`
	ActionID                   string    `json:"actionId"`
	Participant                string    `json:"participant"`
	AmountYNXT                 int64     `json:"amountYnxt"`
	Provenance                 string    `json:"provenance"`
	WalletApprovalEvidenceHash string    `json:"walletApprovalEvidenceHash"`
	CustodyReceiptHash         string    `json:"custodyReceiptHash"`
	ApprovedAt                 time.Time `json:"approvedAt"`
	ExpiresAt                  time.Time `json:"expiresAt"`
}

type SafetyStakeExitAction struct {
	Version                    int       `json:"version"`
	ActionID                   string    `json:"actionId"`
	Participant                string    `json:"participant"`
	WalletApprovalEvidenceHash string    `json:"walletApprovalEvidenceHash"`
	RequestedAt                time.Time `json:"requestedAt"`
}

type SafetyInsuranceFundingDecision struct {
	Version            int       `json:"version"`
	ProposalID         string    `json:"proposalId"`
	AmountYNXT         int64     `json:"amountYnxt"`
	CustodyReceiptHash string    `json:"custodyReceiptHash"`
	ProposedAt         time.Time `json:"proposedAt"`
	ExecuteAfter       time.Time `json:"executeAfter"`
	Reason             string    `json:"reason"`
}

type SafetyShortfallDecision struct {
	Version       int       `json:"version"`
	ProposalID    string    `json:"proposalId"`
	ShortfallYNXT int64     `json:"shortfallYnxt"`
	Trigger       string    `json:"trigger"`
	EvidenceHash  string    `json:"evidenceHash"`
	ProposedAt    time.Time `json:"proposedAt"`
	ExecuteAfter  time.Time `json:"executeAfter"`
	Reason        string    `json:"reason"`
}

type SafetySlashAllocation struct {
	Participant   string `json:"participant"`
	OpeningYNXT   int64  `json:"openingYnxt"`
	SlashYNXT     int64  `json:"slashYnxt"`
	RemainingYNXT int64  `json:"remainingYnxt"`
	Status        string `json:"status"`
}

type SafetyModuleRuntimeEvent struct {
	ID                       string                  `json:"id"`
	Type                     string                  `json:"type"`
	Version                  int                     `json:"version"`
	ActionID                 string                  `json:"actionId"`
	Participant              string                  `json:"participant,omitempty"`
	OccurredAt               time.Time               `json:"occurredAt"`
	AmountYNXT               int64                   `json:"amountYnxt,omitempty"`
	Trigger                  string                  `json:"trigger,omitempty"`
	EvidenceHash             string                  `json:"evidenceHash,omitempty"`
	OpeningInsuranceYNXT     int64                   `json:"openingInsuranceYnxt,omitempty"`
	InsuranceFundedYNXT      int64                   `json:"insuranceFundedYnxt,omitempty"`
	InsuranceUsedYNXT        int64                   `json:"insuranceUsedYnxt,omitempty"`
	StakeSlashedYNXT         int64                   `json:"stakeSlashedYnxt,omitempty"`
	UncoveredShortfallYNXT   int64                   `json:"uncoveredShortfallYnxt,omitempty"`
	ClosingInsuranceYNXT     int64                   `json:"closingInsuranceYnxt,omitempty"`
	SlashAllocations         []SafetySlashAllocation `json:"slashAllocations,omitempty"`
	Threshold                int                     `json:"threshold,omitempty"`
	VerifiedSignatures       int                     `json:"verifiedSignatures,omitempty"`
	ExternalTransferExecuted bool                    `json:"externalTransferExecuted"`
	Source                   string                  `json:"source"`
	AuditHash                string                  `json:"auditHash"`
}

type SafetyModuleRuntimeState struct {
	SchemaVersion                    int                        `json:"schemaVersion"`
	StateVersion                     int64                      `json:"stateVersion"`
	GenesisAsOf                      time.Time                  `json:"genesisAsOf"`
	LastAsOf                         time.Time                  `json:"lastAsOf"`
	Policy                           SafetyModuleRuntimePolicy  `json:"policy"`
	PolicyHash                       string                     `json:"policyHash"`
	Committee                        StakingGovernanceCommittee `json:"committee"`
	CommitteeHash                    string                     `json:"committeeHash"`
	GenesisInsuranceReserveYNXT      int64                      `json:"genesisInsuranceReserveYnxt"`
	InsuranceReserveYNXT             int64                      `json:"insuranceReserveYnxt"`
	CumulativeInsuranceFundingYNXT   int64                      `json:"cumulativeInsuranceFundingYnxt"`
	CumulativeInsuranceUsedYNXT      int64                      `json:"cumulativeInsuranceUsedYnxt"`
	CumulativeStakeSlashedYNXT       int64                      `json:"cumulativeStakeSlashedYnxt"`
	CumulativeUncoveredShortfallYNXT int64                      `json:"cumulativeUncoveredShortfallYnxt"`
	Stakes                           []SafetyModuleRuntimeStake `json:"stakes"`
	Events                           []SafetyModuleRuntimeEvent `json:"events"`
	ExecutionEnabled                 bool                       `json:"executionEnabled"`
	Production                       bool                       `json:"production"`
	RiskDisclosure                   []string                   `json:"riskDisclosure"`
	StateHash                        string                     `json:"stateHash"`
}

type SafetyModuleRuntimeReplayAction struct {
	Type          string                          `json:"type"`
	ExecutedAt    time.Time                       `json:"executedAt"`
	Deposit       *SafetyStakeDepositAction       `json:"deposit,omitempty"`
	Exit          *SafetyStakeExitAction          `json:"exit,omitempty"`
	Funding       *SafetyInsuranceFundingDecision `json:"funding,omitempty"`
	Shortfall     *SafetyShortfallDecision        `json:"shortfall,omitempty"`
	Authorization StakingGovernanceAuthorization  `json:"authorization,omitempty"`
}

type SafetyModuleRuntimeReplayInput struct {
	GenesisAsOf          time.Time                         `json:"genesisAsOf"`
	GenesisInsuranceYNXT int64                             `json:"genesisInsuranceYnxt"`
	Policy               *SafetyModuleRuntimePolicy        `json:"policy,omitempty"`
	Committee            StakingGovernanceCommittee        `json:"committee"`
	Actions              []SafetyModuleRuntimeReplayAction `json:"actions"`
}

func NewSafetyModuleRuntimeState(asOf time.Time, insuranceReserveYNXT int64, policy SafetyModuleRuntimePolicy, committee StakingGovernanceCommittee) (SafetyModuleRuntimeState, error) {
	if asOf.IsZero() || insuranceReserveYNXT < 0 {
		return SafetyModuleRuntimeState{}, runtimeError(CodeSafetyRuntimeInvalidState, "safety runtime genesis time and non-negative insurance reserve are required")
	}
	if err := policy.Validate(); err != nil {
		return SafetyModuleRuntimeState{}, err
	}
	if err := committee.Validate(); err != nil {
		return SafetyModuleRuntimeState{}, runtimeError(CodeSafetyRuntimeAuthorization, err.Error())
	}
	policyHash, err := safetyRuntimePolicyHash(policy)
	if err != nil {
		return SafetyModuleRuntimeState{}, err
	}
	committeeHash, err := stakingCommitteeHash(committee)
	if err != nil {
		return SafetyModuleRuntimeState{}, err
	}
	state := SafetyModuleRuntimeState{
		SchemaVersion:               SafetyModuleRuntimeSchemaVersion,
		StateVersion:                1,
		GenesisAsOf:                 asOf.UTC(),
		LastAsOf:                    asOf.UTC(),
		Policy:                      policy,
		PolicyHash:                  policyHash,
		Committee:                   committee,
		CommitteeHash:               committeeHash,
		GenesisInsuranceReserveYNXT: insuranceReserveYNXT,
		InsuranceReserveYNXT:        insuranceReserveYNXT,
		Stakes:                      []SafetyModuleRuntimeStake{},
		Events:                      []SafetyModuleRuntimeEvent{},
		ExecutionEnabled:            false,
		Production:                  false,
		RiskDisclosure: []string{
			"Candidate runtime only; it records deterministic accounting and never signs or executes Treasury, custody, insurance, or withdrawal transfers.",
			"Insurance is consumed before capped voluntary stake; uncovered shortfall remains explicit.",
			"Cooling stake remains slashable until cooldown completion, and no yield, loss protection, recovery, price, or liquidity is guaranteed.",
		},
	}
	state.StateHash = safetyRuntimeStateHash(state)
	return state, ValidateSafetyModuleRuntimeState(state)
}

func ReplaySafetyModuleRuntime(input SafetyModuleRuntimeReplayInput) (SafetyModuleRuntimeState, error) {
	policy := DefaultSafetyModuleRuntimePolicy()
	if input.Policy != nil {
		policy = *input.Policy
	}
	state, err := NewSafetyModuleRuntimeState(input.GenesisAsOf, input.GenesisInsuranceYNXT, policy, input.Committee)
	if err != nil {
		return SafetyModuleRuntimeState{}, err
	}
	for index, action := range input.Actions {
		switch action.Type {
		case SafetyRuntimeActionDeposit:
			if action.Deposit == nil || action.Exit != nil || action.Funding != nil || action.Shortfall != nil {
				return SafetyModuleRuntimeState{}, runtimeError(CodeSafetyRuntimeInvalidAction, fmt.Sprintf("replay action %d has invalid deposit shape", index))
			}
			state, _, err = ApplySafetyStakeDeposit(state, *action.Deposit, action.ExecutedAt)
		case SafetyRuntimeActionExitRequest:
			if action.Exit == nil || action.Deposit != nil || action.Funding != nil || action.Shortfall != nil {
				return SafetyModuleRuntimeState{}, runtimeError(CodeSafetyRuntimeInvalidAction, fmt.Sprintf("replay action %d has invalid exit request shape", index))
			}
			state, _, err = ApplySafetyStakeExitRequest(state, *action.Exit, action.ExecutedAt)
		case SafetyRuntimeActionExitComplete:
			if action.Exit == nil || action.Deposit != nil || action.Funding != nil || action.Shortfall != nil {
				return SafetyModuleRuntimeState{}, runtimeError(CodeSafetyRuntimeInvalidAction, fmt.Sprintf("replay action %d has invalid exit completion shape", index))
			}
			state, _, err = ApplySafetyStakeExitCompletion(state, *action.Exit, action.ExecutedAt)
		case SafetyRuntimeActionInsuranceFunding:
			if action.Funding == nil || action.Deposit != nil || action.Exit != nil || action.Shortfall != nil {
				return SafetyModuleRuntimeState{}, runtimeError(CodeSafetyRuntimeInvalidAction, fmt.Sprintf("replay action %d has invalid insurance funding shape", index))
			}
			state, _, err = ApplySafetyInsuranceFunding(state, *action.Funding, action.Authorization, action.ExecutedAt)
		case SafetyRuntimeActionShortfall:
			if action.Shortfall == nil || action.Deposit != nil || action.Exit != nil || action.Funding != nil {
				return SafetyModuleRuntimeState{}, runtimeError(CodeSafetyRuntimeInvalidAction, fmt.Sprintf("replay action %d has invalid shortfall shape", index))
			}
			state, _, err = ApplySafetyShortfall(state, *action.Shortfall, action.Authorization, action.ExecutedAt)
		default:
			return SafetyModuleRuntimeState{}, runtimeError(CodeSafetyRuntimeInvalidAction, fmt.Sprintf("replay action %d type is unsupported", index))
		}
		if err != nil {
			return SafetyModuleRuntimeState{}, err
		}
	}
	return state, ValidateSafetyModuleRuntimeState(state)
}

func ApplySafetyStakeDeposit(state SafetyModuleRuntimeState, action SafetyStakeDepositAction, executedAt time.Time) (SafetyModuleRuntimeState, SafetyModuleRuntimeEvent, error) {
	if err := ValidateSafetyModuleRuntimeState(state); err != nil {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, err
	}
	if err := validateSafetyRuntimeTime(state, executedAt); err != nil {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, err
	}
	if action.Version != 1 || !validSafetyActionID(action.ActionID) || !validSafetyParticipant(action.Participant) || action.AmountYNXT <= 0 || strings.ToLower(strings.TrimSpace(action.Provenance)) != "native_wallet_ynxt" || !validEvidenceHash(action.WalletApprovalEvidenceHash) || !validEvidenceHash(action.CustodyReceiptHash) || action.ApprovedAt.IsZero() || action.ExpiresAt.IsZero() || action.ExpiresAt.Before(action.ApprovedAt) || executedAt.UTC().Before(action.ApprovedAt) || executedAt.UTC().After(action.ExpiresAt) {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, runtimeError(CodeSafetyRuntimeInvalidAction, "safety stake deposit requires a current Wallet approval, custody receipt, native YNXT provenance, and positive amount")
	}
	if safetyActionExists(state.Events, action.ActionID) {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, runtimeError(CodeSafetyRuntimeDuplicateAction, "safety runtime action already exists")
	}
	total, err := safetyRuntimeTotalPrincipal(state.Stakes)
	if err != nil || total > state.Policy.Module.StakeCapYNXT-action.AmountYNXT {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, runtimeError(CodeSafetyRuntimeStakeCap, "safety stake deposit exceeds the public module cap")
	}
	participant := strings.TrimSpace(action.Participant)
	index, found := safetyStakeIndex(state.Stakes, participant)
	if found && state.Stakes[index].Status == SafetyStakeStatusCooling {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, runtimeError(CodeSafetyRuntimeParticipant, "cooling safety stake cannot receive a deposit")
	}
	if found {
		stake := state.Stakes[index]
		stake.PrincipalYNXT, err = checkedSum(stake.PrincipalYNXT, action.AmountYNXT)
		if err != nil {
			return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, err
		}
		stake.AmountYNXT, err = checkedSum(stake.AmountYNXT, action.AmountYNXT)
		if err != nil {
			return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, err
		}
		stake.Provenance = "native_wallet_ynxt"
		stake.Status = SafetyStakeStatusActive
		stake.CooldownRequestedAt = nil
		stake.WalletApprovalEvidenceHash = action.WalletApprovalEvidenceHash
		stake.CustodyReceiptHash = action.CustodyReceiptHash
		stake.UpdatedAt = executedAt.UTC()
		state.Stakes[index] = stake
	} else {
		stake := SafetyModuleRuntimeStake{Participant: participant, PrincipalYNXT: action.AmountYNXT, AmountYNXT: action.AmountYNXT, Provenance: "native_wallet_ynxt", Status: SafetyStakeStatusActive, WalletApprovalEvidenceHash: action.WalletApprovalEvidenceHash, CustodyReceiptHash: action.CustodyReceiptHash, UpdatedAt: executedAt.UTC()}
		state.Stakes = insertSafetyStake(state.Stakes, stake)
	}
	event := SafetyModuleRuntimeEvent{Type: "ynx.safety.stake_registered.v1", Version: 1, ActionID: action.ActionID, Participant: participant, OccurredAt: executedAt.UTC(), AmountYNXT: action.AmountYNXT, EvidenceHash: action.CustodyReceiptHash, ExternalTransferExecuted: false, Source: "ynx-safety-module-runtime-candidate-v1"}
	return sealSafetyRuntimeEvent(state, event)
}

func ApplySafetyStakeExitRequest(state SafetyModuleRuntimeState, action SafetyStakeExitAction, executedAt time.Time) (SafetyModuleRuntimeState, SafetyModuleRuntimeEvent, error) {
	if err := ValidateSafetyModuleRuntimeState(state); err != nil {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, err
	}
	if err := validateSafetyRuntimeTime(state, executedAt); err != nil {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, err
	}
	if action.Version != 1 || !validSafetyActionID(action.ActionID) || !validSafetyParticipant(action.Participant) || !validEvidenceHash(action.WalletApprovalEvidenceHash) || action.RequestedAt.IsZero() || !action.RequestedAt.UTC().Equal(executedAt.UTC()) {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, runtimeError(CodeSafetyRuntimeInvalidAction, "safety exit request requires a canonical Wallet approval and execution time")
	}
	if safetyActionExists(state.Events, action.ActionID) {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, runtimeError(CodeSafetyRuntimeDuplicateAction, "safety runtime action already exists")
	}
	index, found := safetyStakeIndex(state.Stakes, strings.TrimSpace(action.Participant))
	if !found || state.Stakes[index].Status != SafetyStakeStatusActive || state.Stakes[index].AmountYNXT <= 0 {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, runtimeError(CodeSafetyRuntimeExitUnavailable, "participant has no active safety stake eligible for cooldown")
	}
	stake := state.Stakes[index]
	now := executedAt.UTC()
	stake.Status = SafetyStakeStatusCooling
	stake.CooldownRequestedAt = &now
	stake.WalletApprovalEvidenceHash = action.WalletApprovalEvidenceHash
	stake.UpdatedAt = now
	state.Stakes[index] = stake
	event := SafetyModuleRuntimeEvent{Type: "ynx.safety.exit_requested.v1", Version: 1, ActionID: action.ActionID, Participant: stake.Participant, OccurredAt: now, AmountYNXT: stake.AmountYNXT, EvidenceHash: action.WalletApprovalEvidenceHash, ExternalTransferExecuted: false, Source: "ynx-safety-module-runtime-candidate-v1"}
	return sealSafetyRuntimeEvent(state, event)
}

func ApplySafetyStakeExitCompletion(state SafetyModuleRuntimeState, action SafetyStakeExitAction, executedAt time.Time) (SafetyModuleRuntimeState, SafetyModuleRuntimeEvent, error) {
	if err := ValidateSafetyModuleRuntimeState(state); err != nil {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, err
	}
	if err := validateSafetyRuntimeTime(state, executedAt); err != nil {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, err
	}
	if action.Version != 1 || !validSafetyActionID(action.ActionID) || !validSafetyParticipant(action.Participant) || !validEvidenceHash(action.WalletApprovalEvidenceHash) {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, runtimeError(CodeSafetyRuntimeInvalidAction, "safety exit completion requires canonical participant approval evidence")
	}
	if safetyActionExists(state.Events, action.ActionID) {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, runtimeError(CodeSafetyRuntimeDuplicateAction, "safety runtime action already exists")
	}
	index, found := safetyStakeIndex(state.Stakes, strings.TrimSpace(action.Participant))
	if !found || state.Stakes[index].Status != SafetyStakeStatusCooling || state.Stakes[index].CooldownRequestedAt == nil || executedAt.UTC().Before(state.Stakes[index].CooldownRequestedAt.Add(time.Duration(state.Policy.Module.CooldownSeconds)*time.Second)) {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, runtimeError(CodeSafetyRuntimeExitUnavailable, "safety stake cooldown is incomplete")
	}
	stake := state.Stakes[index]
	exitAmount := stake.AmountYNXT
	stake.AmountYNXT = 0
	stake.PrincipalYNXT = 0
	stake.CumulativeSlashYNXT = 0
	stake.Status = SafetyStakeStatusExited
	stake.CooldownRequestedAt = nil
	stake.WalletApprovalEvidenceHash = action.WalletApprovalEvidenceHash
	stake.UpdatedAt = executedAt.UTC()
	state.Stakes[index] = stake
	event := SafetyModuleRuntimeEvent{Type: "ynx.safety.exit_completed.v1", Version: 1, ActionID: action.ActionID, Participant: stake.Participant, OccurredAt: executedAt.UTC(), AmountYNXT: exitAmount, EvidenceHash: action.WalletApprovalEvidenceHash, ExternalTransferExecuted: false, Source: "ynx-safety-module-runtime-candidate-v1"}
	return sealSafetyRuntimeEvent(state, event)
}

func ApplySafetyInsuranceFunding(state SafetyModuleRuntimeState, decision SafetyInsuranceFundingDecision, authorization StakingGovernanceAuthorization, executedAt time.Time) (SafetyModuleRuntimeState, SafetyModuleRuntimeEvent, error) {
	if err := ValidateSafetyModuleRuntimeState(state); err != nil {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, err
	}
	if err := validateSafetyRuntimeTime(state, executedAt); err != nil {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, err
	}
	if decision.Version != 1 || !validSafetyActionID(decision.ProposalID) || decision.AmountYNXT <= 0 || !validEvidenceHash(decision.CustodyReceiptHash) || decision.ProposedAt.IsZero() || decision.ExecuteAfter.IsZero() || decision.ExecuteAfter.Before(decision.ProposedAt.Add(time.Duration(state.Policy.GovernanceTimelockSeconds)*time.Second)) || strings.TrimSpace(decision.Reason) == "" {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, runtimeError(CodeSafetyRuntimeInvalidAction, "insurance funding decision is incomplete or outside governance bounds")
	}
	if executedAt.UTC().Before(decision.ExecuteAfter) {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, runtimeError(CodeSafetyRuntimeTimelock, "insurance funding governance timelock is active")
	}
	if safetyActionExists(state.Events, decision.ProposalID) {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, runtimeError(CodeSafetyRuntimeDuplicateAction, "insurance funding proposal already executed")
	}
	actionHash := safetyFundingDecisionHash(decision)
	verified, err := verifyStakingAuthorization(state.Committee, actionHash, authorization)
	if err != nil {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, runtimeError(CodeSafetyRuntimeAuthorization, err.Error())
	}
	opening := state.InsuranceReserveYNXT
	state.InsuranceReserveYNXT, err = checkedSum(state.InsuranceReserveYNXT, decision.AmountYNXT)
	if err != nil {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, err
	}
	state.CumulativeInsuranceFundingYNXT, err = checkedSum(state.CumulativeInsuranceFundingYNXT, decision.AmountYNXT)
	if err != nil {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, err
	}
	event := SafetyModuleRuntimeEvent{Type: "ynx.safety.insurance_funding_recorded.v1", Version: 1, ActionID: decision.ProposalID, OccurredAt: executedAt.UTC(), AmountYNXT: decision.AmountYNXT, EvidenceHash: decision.CustodyReceiptHash, OpeningInsuranceYNXT: opening, InsuranceFundedYNXT: decision.AmountYNXT, ClosingInsuranceYNXT: state.InsuranceReserveYNXT, Threshold: state.Committee.Threshold, VerifiedSignatures: verified, ExternalTransferExecuted: false, Source: "ynx-safety-module-runtime-candidate-v1"}
	return sealSafetyRuntimeEvent(state, event)
}

func ApplySafetyShortfall(state SafetyModuleRuntimeState, decision SafetyShortfallDecision, authorization StakingGovernanceAuthorization, executedAt time.Time) (SafetyModuleRuntimeState, SafetyModuleRuntimeEvent, error) {
	if err := ValidateSafetyModuleRuntimeState(state); err != nil {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, err
	}
	if err := validateSafetyRuntimeTime(state, executedAt); err != nil {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, err
	}
	trigger := strings.ToLower(strings.TrimSpace(decision.Trigger))
	if decision.Version != 1 || !validSafetyActionID(decision.ProposalID) || decision.ShortfallYNXT <= 0 || (trigger != "protocol_shortfall" && trigger != "consensus_safety_failure") || !validEvidenceHash(decision.EvidenceHash) || decision.ProposedAt.IsZero() || decision.ExecuteAfter.IsZero() || decision.ExecuteAfter.Before(decision.ProposedAt.Add(time.Duration(state.Policy.GovernanceTimelockSeconds)*time.Second)) || strings.TrimSpace(decision.Reason) == "" {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, runtimeError(CodeSafetyRuntimeShortfallInvalid, "shortfall decision is incomplete or trigger is not explicitly allowed")
	}
	if executedAt.UTC().Before(decision.ExecuteAfter) {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, runtimeError(CodeSafetyRuntimeTimelock, "shortfall governance timelock is active")
	}
	if safetyActionExists(state.Events, decision.ProposalID) {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, runtimeError(CodeSafetyRuntimeDuplicateAction, "shortfall proposal already executed")
	}
	actionHash := safetyShortfallDecisionHash(decision)
	verified, err := verifyStakingAuthorization(state.Committee, actionHash, authorization)
	if err != nil {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, runtimeError(CodeSafetyRuntimeAuthorization, err.Error())
	}
	openingInsurance := state.InsuranceReserveYNXT
	insuranceCapacity, err := safeMulDiv(state.InsuranceReserveYNXT, state.Policy.MaximumInsuranceDrawBPS, BasisPoints)
	if err != nil {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, err
	}
	insuranceUsed := decision.ShortfallYNXT
	if insuranceUsed > insuranceCapacity {
		insuranceUsed = insuranceCapacity
	}
	state.InsuranceReserveYNXT -= insuranceUsed
	remaining := decision.ShortfallYNXT - insuranceUsed
	capacities := make([]int64, len(state.Stakes))
	var capacityTotal int64
	for index, stake := range state.Stakes {
		if stake.Status != SafetyStakeStatusActive && stake.Status != SafetyStakeStatusCooling {
			continue
		}
		capacity, err := stake.LifetimeSlashCapacityYNXT(state.Policy.Module)
		if err != nil {
			return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, err
		}
		capacities[index] = capacity
		capacityTotal, err = checkedSum(capacityTotal, capacity)
		if err != nil {
			return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, err
		}
	}
	target := remaining
	if target > capacityTotal {
		target = capacityTotal
	}
	allocations, err := allocateSafetyRuntimeSlash(target, capacities)
	if err != nil {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, err
	}
	slashAllocations := make([]SafetySlashAllocation, 0, len(state.Stakes))
	var slashed int64
	for index, amount := range allocations {
		if amount == 0 {
			continue
		}
		stake := state.Stakes[index]
		opening := stake.AmountYNXT
		stake.AmountYNXT -= amount
		stake.CumulativeSlashYNXT, err = checkedSum(stake.CumulativeSlashYNXT, amount)
		if err != nil {
			return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, err
		}
		stake.UpdatedAt = executedAt.UTC()
		state.Stakes[index] = stake
		slashed, err = checkedSum(slashed, amount)
		if err != nil {
			return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, err
		}
		slashAllocations = append(slashAllocations, SafetySlashAllocation{Participant: stake.Participant, OpeningYNXT: opening, SlashYNXT: amount, RemainingYNXT: stake.AmountYNXT, Status: stake.Status})
	}
	uncovered := remaining - slashed
	state.CumulativeInsuranceUsedYNXT, err = checkedSum(state.CumulativeInsuranceUsedYNXT, insuranceUsed)
	if err != nil {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, err
	}
	state.CumulativeStakeSlashedYNXT, err = checkedSum(state.CumulativeStakeSlashedYNXT, slashed)
	if err != nil {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, err
	}
	state.CumulativeUncoveredShortfallYNXT, err = checkedSum(state.CumulativeUncoveredShortfallYNXT, uncovered)
	if err != nil {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, err
	}
	event := SafetyModuleRuntimeEvent{Type: "ynx.safety.shortfall_processed.v1", Version: 1, ActionID: decision.ProposalID, OccurredAt: executedAt.UTC(), AmountYNXT: decision.ShortfallYNXT, Trigger: trigger, EvidenceHash: decision.EvidenceHash, OpeningInsuranceYNXT: openingInsurance, InsuranceUsedYNXT: insuranceUsed, StakeSlashedYNXT: slashed, UncoveredShortfallYNXT: uncovered, ClosingInsuranceYNXT: state.InsuranceReserveYNXT, SlashAllocations: slashAllocations, Threshold: state.Committee.Threshold, VerifiedSignatures: verified, ExternalTransferExecuted: false, Source: "ynx-safety-module-runtime-candidate-v1"}
	return sealSafetyRuntimeEvent(state, event)
}

func ValidateSafetyModuleRuntimeState(state SafetyModuleRuntimeState) error {
	if state.SchemaVersion != SafetyModuleRuntimeSchemaVersion || state.StateVersion < 1 || state.GenesisAsOf.IsZero() || state.LastAsOf.Before(state.GenesisAsOf) || state.GenesisInsuranceReserveYNXT < 0 || state.InsuranceReserveYNXT < 0 || state.ExecutionEnabled || state.Production || len(state.RiskDisclosure) < 3 {
		return runtimeError(CodeSafetyRuntimeInvalidState, "safety runtime metadata or release boundary is invalid")
	}
	if err := state.Policy.Validate(); err != nil {
		return err
	}
	if err := state.Committee.Validate(); err != nil {
		return runtimeError(CodeSafetyRuntimeAuthorization, err.Error())
	}
	policyHash, err := safetyRuntimePolicyHash(state.Policy)
	if err != nil || policyHash != state.PolicyHash {
		return runtimeError(CodeSafetyRuntimeInvalidState, "safety runtime policy hash mismatch")
	}
	committeeHash, err := stakingCommitteeHash(state.Committee)
	if err != nil || committeeHash != state.CommitteeHash {
		return runtimeError(CodeSafetyRuntimeInvalidState, "safety runtime committee hash mismatch")
	}
	previousParticipant := ""
	var totalPrincipal int64
	for _, stake := range state.Stakes {
		if !validSafetyParticipant(stake.Participant) || stake.Participant <= previousParticipant || stake.PrincipalYNXT < 0 || stake.AmountYNXT < 0 || stake.AmountYNXT > stake.PrincipalYNXT || stake.CumulativeSlashYNXT < 0 || stake.Provenance != "native_wallet_ynxt" || !validEvidenceHash(stake.WalletApprovalEvidenceHash) || !validEvidenceHash(stake.CustodyReceiptHash) || stake.UpdatedAt.IsZero() || stake.UpdatedAt.After(state.LastAsOf) {
			return runtimeError(CodeSafetyRuntimeInvalidState, "safety stake positions are not canonical")
		}
		if _, err := stake.LifetimeSlashCapacityYNXT(state.Policy.Module); err != nil {
			return err
		}
		switch stake.Status {
		case SafetyStakeStatusActive:
			if stake.AmountYNXT <= 0 || stake.CooldownRequestedAt != nil {
				return runtimeError(CodeSafetyRuntimeInvalidState, "active safety stake has invalid amount or cooldown")
			}
		case SafetyStakeStatusCooling:
			if stake.AmountYNXT <= 0 || stake.CooldownRequestedAt == nil || stake.CooldownRequestedAt.After(state.LastAsOf) {
				return runtimeError(CodeSafetyRuntimeInvalidState, "cooling safety stake has invalid amount or request time")
			}
		case SafetyStakeStatusExited:
			if stake.AmountYNXT != 0 || stake.PrincipalYNXT != 0 || stake.CumulativeSlashYNXT != 0 || stake.CooldownRequestedAt != nil {
				return runtimeError(CodeSafetyRuntimeInvalidState, "exited safety stake retains accounting exposure")
			}
		default:
			return runtimeError(CodeSafetyRuntimeInvalidState, "safety stake status is unsupported")
		}
		totalPrincipal, err = checkedSum(totalPrincipal, stake.PrincipalYNXT)
		if err != nil {
			return err
		}
		previousParticipant = stake.Participant
	}
	if totalPrincipal > state.Policy.Module.StakeCapYNXT {
		return runtimeError(CodeSafetyRuntimeStakeCap, "safety runtime total principal exceeds the public cap")
	}
	seen := map[string]bool{}
	var previousEventAt time.Time
	var funded, insuranceUsed, slashed, uncovered int64
	for _, event := range state.Events {
		if event.Version != 1 || !validSafetyActionID(event.ActionID) || seen[event.ActionID] || event.ID != safetyRuntimeEventID(event) || event.AuditHash != safetyRuntimeEventAuditHash(event) || event.OccurredAt.IsZero() || (!previousEventAt.IsZero() && !event.OccurredAt.After(previousEventAt)) || event.ExternalTransferExecuted || event.Source != "ynx-safety-module-runtime-candidate-v1" {
			return runtimeError(CodeSafetyRuntimeInvalidState, "safety runtime event sequence, audit hash, or execution boundary is invalid")
		}
		seen[event.ActionID] = true
		switch event.Type {
		case "ynx.safety.stake_registered.v1", "ynx.safety.exit_requested.v1", "ynx.safety.exit_completed.v1":
			if !validSafetyParticipant(event.Participant) || event.AmountYNXT <= 0 || !validEvidenceHash(event.EvidenceHash) || event.Threshold != 0 || event.VerifiedSignatures != 0 {
				return runtimeError(CodeSafetyRuntimeInvalidState, "safety participant event is invalid")
			}
		case "ynx.safety.insurance_funding_recorded.v1":
			if event.InsuranceFundedYNXT <= 0 || event.AmountYNXT != event.InsuranceFundedYNXT || event.OpeningInsuranceYNXT+event.InsuranceFundedYNXT != event.ClosingInsuranceYNXT || !validEvidenceHash(event.EvidenceHash) || event.VerifiedSignatures < event.Threshold || event.Threshold != state.Committee.Threshold {
				return runtimeError(CodeSafetyRuntimeInvalidState, "safety insurance funding event does not reconcile")
			}
			funded, err = checkedSum(funded, event.InsuranceFundedYNXT)
		case "ynx.safety.shortfall_processed.v1":
			if (event.Trigger != "protocol_shortfall" && event.Trigger != "consensus_safety_failure") || event.AmountYNXT <= 0 || !validEvidenceHash(event.EvidenceHash) || event.InsuranceUsedYNXT+event.StakeSlashedYNXT+event.UncoveredShortfallYNXT != event.AmountYNXT || event.OpeningInsuranceYNXT-event.InsuranceUsedYNXT != event.ClosingInsuranceYNXT || event.VerifiedSignatures < event.Threshold || event.Threshold != state.Committee.Threshold {
				return runtimeError(CodeSafetyRuntimeInvalidState, "safety shortfall event does not reconcile")
			}
			var allocated int64
			previousAllocation := ""
			for _, allocation := range event.SlashAllocations {
				if !validSafetyParticipant(allocation.Participant) || allocation.Participant <= previousAllocation || allocation.OpeningYNXT < allocation.SlashYNXT || allocation.OpeningYNXT-allocation.SlashYNXT != allocation.RemainingYNXT || allocation.SlashYNXT <= 0 || (allocation.Status != SafetyStakeStatusActive && allocation.Status != SafetyStakeStatusCooling) {
					return runtimeError(CodeSafetyRuntimeInvalidState, "safety slash allocation is invalid")
				}
				allocated, err = checkedSum(allocated, allocation.SlashYNXT)
				if err != nil {
					return err
				}
				previousAllocation = allocation.Participant
			}
			if allocated != event.StakeSlashedYNXT {
				return runtimeError(CodeSafetyRuntimeReconciliation, "safety slash allocation total does not match event")
			}
			insuranceUsed, err = checkedSum(insuranceUsed, event.InsuranceUsedYNXT)
			if err == nil {
				slashed, err = checkedSum(slashed, event.StakeSlashedYNXT)
			}
			if err == nil {
				uncovered, err = checkedSum(uncovered, event.UncoveredShortfallYNXT)
			}
		default:
			return runtimeError(CodeSafetyRuntimeInvalidState, "unsupported safety runtime event type")
		}
		if err != nil {
			return err
		}
		previousEventAt = event.OccurredAt
	}
	if len(state.Events) == 0 {
		if !state.LastAsOf.Equal(state.GenesisAsOf) {
			return runtimeError(CodeSafetyRuntimeInvalidState, "empty safety runtime state changed committed time")
		}
	} else if !state.Events[len(state.Events)-1].OccurredAt.Equal(state.LastAsOf) {
		return runtimeError(CodeSafetyRuntimeInvalidState, "safety runtime last event time mismatch")
	}
	if funded != state.CumulativeInsuranceFundingYNXT || insuranceUsed != state.CumulativeInsuranceUsedYNXT || slashed != state.CumulativeStakeSlashedYNXT || uncovered != state.CumulativeUncoveredShortfallYNXT {
		return runtimeError(CodeSafetyRuntimeReconciliation, "safety runtime cumulative counters do not match canonical events")
	}
	expectedInsurance, err := checkedSum(state.GenesisInsuranceReserveYNXT, state.CumulativeInsuranceFundingYNXT)
	if err != nil || state.CumulativeInsuranceUsedYNXT > expectedInsurance || expectedInsurance-state.CumulativeInsuranceUsedYNXT != state.InsuranceReserveYNXT {
		return runtimeError(CodeSafetyRuntimeReconciliation, "safety runtime insurance reserve invariant failed")
	}
	if state.StateHash != safetyRuntimeStateHash(state) {
		return runtimeError(CodeSafetyRuntimeInvalidState, "safety runtime state hash mismatch")
	}
	return nil
}

func sealSafetyRuntimeEvent(state SafetyModuleRuntimeState, event SafetyModuleRuntimeEvent) (SafetyModuleRuntimeState, SafetyModuleRuntimeEvent, error) {
	event.ID = safetyRuntimeEventID(event)
	event.AuditHash = safetyRuntimeEventAuditHash(event)
	state.Events = append(state.Events, event)
	state.LastAsOf = event.OccurredAt
	state.StateVersion++
	state.StateHash = safetyRuntimeStateHash(state)
	if err := ValidateSafetyModuleRuntimeState(state); err != nil {
		return SafetyModuleRuntimeState{}, SafetyModuleRuntimeEvent{}, err
	}
	return state, event, nil
}

func validateSafetyRuntimeTime(state SafetyModuleRuntimeState, executedAt time.Time) error {
	if executedAt.IsZero() || !executedAt.UTC().After(state.LastAsOf) {
		return runtimeError(CodeSafetyRuntimeInvalidAction, "safety runtime action must advance committed time")
	}
	return nil
}

func safetyRuntimeTotalPrincipal(stakes []SafetyModuleRuntimeStake) (int64, error) {
	var total int64
	for _, stake := range stakes {
		var err error
		total, err = checkedSum(total, stake.PrincipalYNXT)
		if err != nil {
			return 0, err
		}
	}
	return total, nil
}

func allocateSafetyRuntimeSlash(target int64, capacities []int64) ([]int64, error) {
	allocations := make([]int64, len(capacities))
	if target == 0 {
		return allocations, nil
	}
	var capacityTotal int64
	for _, capacity := range capacities {
		var err error
		capacityTotal, err = checkedSum(capacityTotal, capacity)
		if err != nil {
			return nil, err
		}
	}
	if target < 0 || target > capacityTotal || capacityTotal == 0 {
		return nil, runtimeError(CodeSafetyRuntimeShortfallInvalid, "slash target exceeds eligible lifetime capacity")
	}
	var allocated int64
	for index, capacity := range capacities {
		allocation, err := safeMulDiv(target, capacity, capacityTotal)
		if err != nil {
			return nil, err
		}
		allocations[index] = allocation
		allocated, err = checkedSum(allocated, allocation)
		if err != nil {
			return nil, err
		}
	}
	for allocated < target {
		progress := false
		for index, capacity := range capacities {
			if allocations[index] < capacity && allocated < target {
				allocations[index]++
				allocated++
				progress = true
			}
		}
		if !progress {
			return nil, errors.New("safety slash remainder cannot be allocated")
		}
	}
	return allocations, nil
}

func safetyStakeIndex(values []SafetyModuleRuntimeStake, participant string) (int, bool) {
	index := sort.Search(len(values), func(i int) bool { return values[i].Participant >= participant })
	return index, index < len(values) && values[index].Participant == participant
}

func insertSafetyStake(values []SafetyModuleRuntimeStake, value SafetyModuleRuntimeStake) []SafetyModuleRuntimeStake {
	index, _ := safetyStakeIndex(values, value.Participant)
	values = append(values, SafetyModuleRuntimeStake{})
	copy(values[index+1:], values[index:])
	values[index] = value
	return values
}

func safetyActionExists(events []SafetyModuleRuntimeEvent, actionID string) bool {
	for _, event := range events {
		if event.ActionID == actionID {
			return true
		}
	}
	return false
}

func validSafetyParticipant(value string) bool {
	value = strings.TrimSpace(value)
	return value != "" && len(value) <= 128
}

func validSafetyActionID(value string) bool {
	value = strings.TrimSpace(value)
	return value != "" && len(value) <= 128
}

func safetyRuntimePolicyHash(policy SafetyModuleRuntimePolicy) (string, error) {
	return canonicalSafetyRuntimeHash("YNX_SAFETY_RUNTIME_POLICY_V1", policy)
}

func safetyFundingDecisionHash(decision SafetyInsuranceFundingDecision) string {
	hash, _ := canonicalSafetyRuntimeHash("YNX_SAFETY_INSURANCE_FUNDING_DECISION_V1", decision)
	return hash
}

func safetyShortfallDecisionHash(decision SafetyShortfallDecision) string {
	hash, _ := canonicalSafetyRuntimeHash("YNX_SAFETY_SHORTFALL_DECISION_V1", decision)
	return hash
}

func safetyRuntimeStateHash(state SafetyModuleRuntimeState) string {
	state.StateHash = ""
	hash, _ := canonicalSafetyRuntimeHash("YNX_SAFETY_RUNTIME_STATE_V1", state)
	return hash
}

func safetyRuntimeEventID(event SafetyModuleRuntimeEvent) string {
	event.ID, event.AuditHash = "", ""
	raw, _ := json.Marshal(event)
	sum := sha256.Sum256(append([]byte("YNX_SAFETY_RUNTIME_EVENT_ID_V1\x00"), raw...))
	return "safetyevt_" + hex.EncodeToString(sum[:12])
}

func safetyRuntimeEventAuditHash(event SafetyModuleRuntimeEvent) string {
	event.AuditHash = ""
	hash, _ := canonicalSafetyRuntimeHash("YNX_SAFETY_RUNTIME_EVENT_AUDIT_V1", event)
	return hash
}

func canonicalSafetyRuntimeHash(domain string, value any) (string, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(append([]byte(domain+"\x00"), raw...))
	return "sha256:" + hex.EncodeToString(sum[:]), nil
}
