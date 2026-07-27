package governance

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
)

var (
	ErrInvalid   = errors.New("invalid governance request")
	ErrConflict  = errors.New("governance conflict")
	ErrForbidden = errors.New("governance action forbidden")
	ErrNotReady  = errors.New("governance action not ready")
	ErrNotFound  = errors.New("governance record not found")
	ErrReplay    = errors.New("governance replay")
)

type Scope string

const (
	ScopeProtocolUpgrade  Scope = "protocol_upgrade"
	ScopeConsensusUpgrade Scope = "consensus_upgrade"
	ScopeGenesis          Scope = "genesis_validator_parameters"
	ScopeEconomics        Scope = "fee_burn_issuance"
	ScopeTreasury         Scope = "treasury"
	ScopeStablecoin       Scope = "stablecoin_reserve_provider"
	ScopeOracle           Scope = "oracle_provider_threshold"
	ScopeBridge           Scope = "bridge_provider_limits"
	ScopeExchange         Scope = "exchange_market"
	ScopeDEX              Scope = "dex_fee_pool"
	ScopeVault            Scope = "quant_vault_bounds"
	ScopeSafety           Scope = "safety_module"
	ScopeServiceSecurity  Scope = "service_security_pool"
	ScopeResource         Scope = "resource_provider"
	ScopeProductRegistry  Scope = "product_registry"
	ScopeGrants           Scope = "public_grants_incentives"
	ScopeRetentionPolicy  Scope = "retention_policy"
	ScopeSecurityPolicy   Scope = "security_policy"
	ScopeReleasePolicy    Scope = "release_policy"
)

type ParameterChange struct {
	Path    string `json:"path"`
	Before  string `json:"before"`
	After   string `json:"after"`
	Minimum int64  `json:"minimum,omitempty"`
	Maximum int64  `json:"maximum,omitempty"`
	Numeric *int64 `json:"numeric,omitempty"`
}

type ProposalInput struct {
	Nonce              string            `json:"nonce"`
	ProposalType       string            `json:"proposalType"`
	Scope              Scope             `json:"scope"`
	Proposer           string            `json:"proposer"`
	Owner              string            `json:"owner"`
	Summary            string            `json:"summary"`
	Motivation         string            `json:"motivation"`
	TechnicalImpact    string            `json:"technicalImpact"`
	EconomicImpact     string            `json:"economicImpact"`
	SecurityRisk       string            `json:"securityRisk"`
	UserImpact         string            `json:"userImpact"`
	ProviderImpact     string            `json:"providerImpact"`
	Migration          string            `json:"migration"`
	Rollback           string            `json:"rollback"`
	CanaryPlan         string            `json:"canaryPlan"`
	VerificationPlan   string            `json:"verificationPlan"`
	ConflictDisclosure string            `json:"conflictDisclosure"`
	Dependencies       []string          `json:"dependencies"`
	Evidence           []string          `json:"evidence"`
	Changes            []ParameterChange `json:"changes"`
	SourceCommit       string            `json:"sourceCommit"`
	Release            string            `json:"release"`
	ExpiresAt          time.Time         `json:"expiresAt"`
	UpgradeHash        string            `json:"upgradeHash,omitempty"`
}

type Simulation struct {
	TechnicalEvidence  string    `json:"technicalEvidence"`
	EconomicEvidence   string    `json:"economicEvidence"`
	SecurityEvidence   string    `json:"securityEvidence"`
	UserImpactEvidence string    `json:"userImpactEvidence"`
	Passed             bool      `json:"passed"`
	CompletedAt        time.Time `json:"completedAt"`
}

type Cancellation struct {
	Actor       string    `json:"actor"`
	Reason      string    `json:"reason"`
	Evidence    []string  `json:"evidence"`
	CancelledAt time.Time `json:"cancelledAt"`
	AuditHash   string    `json:"auditHash"`
}

type ExecutionReceipt struct {
	TxHash       string    `json:"txHash"`
	BlockHeight  uint64    `json:"blockHeight"`
	BlockHash    string    `json:"blockHash"`
	StateRoot    string    `json:"stateRoot"`
	ManifestHash string    `json:"manifestHash"`
	Source       string    `json:"source"`
	Version      string    `json:"version"`
	Outcome      string    `json:"outcome"`
	AsOf         time.Time `json:"asOf"`
	AuditHash    string    `json:"auditHash"`
}

type ConflictDisclosure struct {
	Actor       string    `json:"actor"`
	Description string    `json:"description"`
	Recused     bool      `json:"recused"`
	DisclosedAt time.Time `json:"disclosedAt"`
}

type Vote struct {
	ProposalID             string    `json:"proposalId"`
	ChainID                string    `json:"chainId"`
	Domain                 string    `json:"domain"`
	Voter                  string    `json:"voter"`
	Choice                 string    `json:"choice,omitempty"`
	Power                  uint64    `json:"power"`
	Operation              string    `json:"operation"`
	Revision               uint64    `json:"revision"`
	Nonce                  string    `json:"nonce"`
	PublicKey              string    `json:"publicKey"`
	Signature              string    `json:"signature"`
	ElectorateEvidenceHash string    `json:"electorateEvidenceHash"`
	SignedAt               time.Time `json:"signedAt"`
	ExpiresAt              time.Time `json:"expiresAt"`
	CastAt                 time.Time `json:"castAt"`
	SupersedesAuditHash    string    `json:"supersedesAuditHash,omitempty"`
	AuditHash              string    `json:"auditHash"`
}

type VotingSnapshot struct {
	BasePower           map[string]uint64 `json:"basePower"`
	Delegations         map[string]string `json:"delegations"`
	DelegatedPower      map[string]uint64 `json:"delegatedPower,omitempty"`
	DelegationOverrides map[string]bool   `json:"delegationOverrides,omitempty"`
}

type ElectorateApproval struct {
	Approver   string    `json:"approver"`
	ApprovedAt time.Time `json:"approvedAt"`
	AuditHash  string    `json:"auditHash"`
}
type ElectorateRecord struct {
	Snapshot      VotingSnapshot                `json:"snapshot"`
	EvidenceHash  string                        `json:"evidenceHash"`
	SourceVersion string                        `json:"sourceVersion"`
	SnapshotAsOf  time.Time                     `json:"snapshotAsOf"`
	SubmittedBy   string                        `json:"submittedBy"`
	SubmittedAt   time.Time                     `json:"submittedAt"`
	Approvals     map[string]ElectorateApproval `json:"approvals"`
	Status        string                        `json:"status"`
	AuditHash     string                        `json:"auditHash"`
}

type Proposal struct {
	ID                  string                        `json:"id"`
	ActionHash          string                        `json:"actionHash"`
	Input               ProposalInput                 `json:"input"`
	Status              Status                        `json:"status"`
	Transitions         []StateTransition             `json:"transitions"`
	Deposit             uint64                        `json:"deposit"`
	Simulation          *Simulation                   `json:"simulation,omitempty"`
	Cancellation        *Cancellation                 `json:"cancellation,omitempty"`
	Conflicts           map[string]ConflictDisclosure `json:"conflicts"`
	Votes               map[string]Vote               `json:"votes"`
	VoteHistory         map[string][]Vote             `json:"voteHistory"`
	EligiblePower       uint64                        `json:"eligiblePower"`
	VotingPower         map[string]uint64             `json:"votingPower"`
	BasePower           map[string]uint64             `json:"basePower"`
	Delegations         map[string]string             `json:"delegations"`
	DelegatedPower      map[string]uint64             `json:"delegatedPower"`
	DelegationOverrides map[string]bool               `json:"delegationOverrides"`
	Electorate          *ElectorateRecord             `json:"electorate,omitempty"`
	VotingEndsAt        time.Time                     `json:"votingEndsAt,omitempty"`
	ExecuteAfter        time.Time                     `json:"executeAfter,omitempty"`
	ExecutionHash       string                        `json:"executionHash,omitempty"`
	ExecutionReceipt    *ExecutionReceipt             `json:"executionReceipt,omitempty"`
	RollbackHash        string                        `json:"rollbackHash,omitempty"`
	RollbackReceipt     *ExecutionReceipt             `json:"rollbackReceipt,omitempty"`
	CreatedAt           time.Time                     `json:"createdAt"`
	UpdatedAt           time.Time                     `json:"updatedAt"`
}

type Policy struct {
	ChainID                     string
	VoteDomain                  string
	VoteReplacementPolicy       string
	VoteWithdrawalPolicy        string
	VoteMaxClockSkew            time.Duration
	MinimumDeposit              uint64
	QuorumBPS                   uint64
	ThresholdBPS                uint64
	VotingPeriod                time.Duration
	Timelock                    time.Duration
	TimelockGrace               time.Duration
	MaxLifetime                 time.Duration
	EmergencyThreshold          uint64
	EmergencyMaxDuration        time.Duration
	ParameterRules              map[string]ParameterRule
	GenesisRoleManifestHash     string
	ElectorateApprovalThreshold uint64
}

type ParameterRule struct {
	Scope   Scope `json:"scope"`
	Numeric bool  `json:"numeric"`
	Minimum int64 `json:"minimum,omitempty"`
	Maximum int64 `json:"maximum,omitempty"`
}

type Service struct {
	mu                sync.RWMutex
	policy            Policy
	registries        RegistrySet
	proposals         map[string]*Proposal
	nonces            map[string]struct{}
	voteNonces        map[string]struct{}
	delegations       map[string]Delegation
	delegationHistory map[string][]Delegation
	delegationNonces  map[string]struct{}
	timelocks         map[string]*TimelockRecord
	upgrades          map[string]*UpgradeRecord
	canaries          map[string]*CanaryRecord
	canaryNonces      map[string]struct{}
	emergencies       map[string]*EmergencyAction
	emergencyNonces   map[string]struct{}
	roles             map[string]*RoleAssignment
	appeals           map[string]*Appeal
	appealNonces      map[string]struct{}
	discussions       map[string]*DiscussionEntry
	discussionNonces  map[string]struct{}
}

func NewService(policy Policy) (*Service, error) {
	if len(strings.TrimSpace(policy.ChainID)) < 3 || len(strings.TrimSpace(policy.VoteDomain)) < 8 || policy.VoteReplacementPolicy != "replace_before_deadline" || policy.VoteWithdrawalPolicy != "withdraw_before_deadline" || policy.VoteMaxClockSkew <= 0 || policy.VoteMaxClockSkew > 15*time.Minute || policy.MinimumDeposit == 0 || policy.QuorumBPS == 0 || policy.QuorumBPS > 10000 || policy.ThresholdBPS == 0 || policy.ThresholdBPS > 10000 || policy.VotingPeriod <= 0 || policy.Timelock <= 0 || policy.TimelockGrace <= 0 || policy.TimelockGrace > 30*24*time.Hour || policy.MaxLifetime <= policy.VotingPeriod+policy.Timelock+policy.TimelockGrace || policy.EmergencyThreshold < 2 || policy.EmergencyMaxDuration <= 0 || policy.EmergencyMaxDuration > 7*24*time.Hour || len(policy.ParameterRules) == 0 || !validHash(policy.GenesisRoleManifestHash) || policy.ElectorateApprovalThreshold < 2 {
		return nil, fmt.Errorf("%w: unsafe governance policy", ErrInvalid)
	}
	for path, rule := range policy.ParameterRules {
		if !strings.HasPrefix(path, "/") || rule.Scope == "" || (rule.Numeric && rule.Minimum >= rule.Maximum) {
			return nil, fmt.Errorf("%w: unsafe parameter rule", ErrInvalid)
		}
	}
	registries, err := LoadEmbeddedRegistries()
	if err != nil {
		return nil, fmt.Errorf("%w: governance registry startup gate: %v", ErrInvalid, err)
	}
	return &Service{policy: policy, registries: registries, proposals: map[string]*Proposal{}, nonces: map[string]struct{}{}, voteNonces: map[string]struct{}{}, delegations: map[string]Delegation{}, delegationHistory: map[string][]Delegation{}, delegationNonces: map[string]struct{}{}, timelocks: map[string]*TimelockRecord{}, upgrades: map[string]*UpgradeRecord{}, canaries: map[string]*CanaryRecord{}, canaryNonces: map[string]struct{}{}, emergencies: map[string]*EmergencyAction{}, emergencyNonces: map[string]struct{}{}, roles: map[string]*RoleAssignment{}, appeals: map[string]*Appeal{}, appealNonces: map[string]struct{}{}, discussions: map[string]*DiscussionEntry{}, discussionNonces: map[string]struct{}{}}, nil
}

func (s *Service) Create(input ProposalInput, now time.Time) (Proposal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now = now.UTC()
	if err := validateProposal(input, now, s.policy.VotingPeriod+s.policy.Timelock+s.policy.TimelockGrace, s.policy.MaxLifetime, s.policy.ParameterRules); err != nil {
		return Proposal{}, err
	}
	if _, exists := s.nonces[input.Nonce]; exists {
		return Proposal{}, ErrReplay
	}
	fingerprint := proposalFingerprint(input)
	for _, current := range s.proposals {
		if current.Status != StatusCancelled && current.Status != StatusRejected && current.Status != StatusExpired && proposalFingerprint(current.Input) == fingerprint {
			return Proposal{}, fmt.Errorf("%w: duplicate active machine diff", ErrConflict)
		}
	}
	id := hash("proposal", input.Nonce, input.Proposer, fingerprint)
	actionHash := hash("action", fingerprint, strings.ToLower(input.SourceCommit), input.Release, strings.ToLower(input.UpgradeHash))
	p := &Proposal{ID: id, ActionHash: actionHash, Input: input, Conflicts: map[string]ConflictDisclosure{}, Votes: map[string]Vote{}, VoteHistory: map[string][]Vote{}, VotingPower: map[string]uint64{}, BasePower: map[string]uint64{}, Delegations: map[string]string{}, DelegatedPower: map[string]uint64{}, DelegationOverrides: map[string]bool{}, CreatedAt: now, UpdatedAt: now}
	for _, step := range []struct {
		to     Status
		reason string
	}{
		{StatusDraft, "proposal draft accepted into the governance record"},
		{StatusEligibilityCheck, "proposal identity, scope, evidence, and machine diff passed eligibility checks"},
		{StatusDepositPending, "eligible proposal awaits the public deposit requirement"},
	} {
		if err := transitionProposal(p, step.to, input.Proposer, step.reason, input.Evidence, now); err != nil {
			return Proposal{}, err
		}
	}
	if isUpgradeProposal(p) {
		if _, err := s.createUpgradeLocked(p, now); err != nil {
			return Proposal{}, err
		}
	}
	s.proposals[id], s.nonces[input.Nonce] = p, struct{}{}
	return clone(p), nil
}

func (s *Service) Deposit(id string, amount uint64, now time.Time) (Proposal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.mutable(id, now)
	if err != nil {
		return Proposal{}, err
	}
	if p.Status != StatusDepositPending || amount == 0 {
		return Proposal{}, ErrNotReady
	}
	p.Deposit += amount
	p.UpdatedAt = now.UTC()
	if p.Deposit >= s.policy.MinimumDeposit {
		evidence := []string{fmt.Sprintf("deposit://%s/%d", p.ID, p.Deposit)}
		if err = transitionProposal(p, StatusDepositAccepted, p.Input.Proposer, "minimum governance deposit has been accepted", evidence, now); err != nil {
			return Proposal{}, err
		}
		if err = transitionProposal(p, StatusDiscussion, p.Input.Proposer, "accepted proposal entered the public discussion phase", evidence, now); err != nil {
			return Proposal{}, err
		}
	}
	return clone(p), nil
}

func (s *Service) RecordSimulation(id string, simulation Simulation, now time.Time) (Proposal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.mutable(id, now)
	if err != nil {
		return Proposal{}, err
	}
	if p.Status != StatusDiscussion || len(simulation.TechnicalEvidence) < 16 || len(simulation.EconomicEvidence) < 16 || len(simulation.SecurityEvidence) < 16 || len(simulation.UserImpactEvidence) < 16 {
		return Proposal{}, ErrInvalid
	}
	evidence := []string{simulation.TechnicalEvidence, simulation.EconomicEvidence, simulation.SecurityEvidence, simulation.UserImpactEvidence}
	for _, step := range []struct {
		to     Status
		reason string
	}{
		{StatusTechnicalReview, "technical review began against the machine-readable proposal diff"},
		{StatusEconomicReview, "technical review completed and economic review began"},
		{StatusSecurityReview, "economic review completed and security review began"},
		{StatusConflictDisclosure, "security review completed and conflicts were disclosed for review"},
		{StatusSimulationPending, "required technical, economic, security, and user-impact simulations were queued"},
	} {
		if err = transitionProposal(p, step.to, p.Input.Owner, step.reason, evidence, now); err != nil {
			return Proposal{}, err
		}
	}
	simulation.CompletedAt = now.UTC()
	p.Simulation = &simulation
	if err = transitionProposal(p, StatusSimulationCompleted, p.Input.Owner, "all required proposal simulations completed with recorded evidence", evidence, now); err != nil {
		return Proposal{}, err
	}
	if simulation.Passed {
		err = transitionProposal(p, StatusVotingPending, p.Input.Owner, "simulation gates passed and the proposal awaits an approved electorate snapshot", evidence, now)
	} else {
		err = transitionProposal(p, StatusRejected, p.Input.Owner, "proposal simulations failed one or more mandatory safety gates", evidence, now)
	}
	if err != nil {
		return Proposal{}, err
	}
	if !simulation.Passed {
		if err = s.transitionUpgradeLocked(p, UpgradeRejected, p.Input.Owner, "upgrade simulations failed one or more mandatory safety gates", evidence, now); err != nil {
			return Proposal{}, err
		}
	}
	return clone(p), nil
}

func (s *Service) CancelProposal(id, actor, reason string, evidence []string, now time.Time) (Proposal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.mutable(id, now)
	if err != nil {
		return Proposal{}, err
	}
	if (p.Status != StatusDepositPending && p.Status != StatusDiscussion && p.Status != StatusVotingPending) || actor != p.Input.Proposer || len(strings.TrimSpace(reason)) < 16 || len(evidence) == 0 {
		return Proposal{}, ErrForbidden
	}
	c := &Cancellation{Actor: actor, Reason: strings.TrimSpace(reason), Evidence: append([]string(nil), evidence...), CancelledAt: now.UTC()}
	c.AuditHash = hash(id, c.Actor, c.Reason, c.CancelledAt.Format(time.RFC3339Nano), strings.Join(c.Evidence, "|"))
	p.Cancellation = c
	if err = s.transitionUpgradeLocked(p, UpgradeCancelled, actor, c.Reason, c.Evidence, now); err != nil {
		return Proposal{}, err
	}
	if err = transitionProposal(p, StatusCancelled, actor, c.Reason, c.Evidence, now); err != nil {
		return Proposal{}, err
	}
	return clone(p), nil
}

func (s *Service) DiscloseConflict(id string, disclosure ConflictDisclosure, now time.Time) (Proposal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.mutable(id, now)
	if err != nil {
		return Proposal{}, err
	}
	if strings.TrimSpace(disclosure.Actor) == "" || len(strings.TrimSpace(disclosure.Description)) < 8 {
		return Proposal{}, ErrInvalid
	}
	disclosure.DisclosedAt = now.UTC()
	p.Conflicts[disclosure.Actor] = disclosure
	p.UpdatedAt = now.UTC()
	return clone(p), nil
}

func (s *Service) SubmitElectorate(id string, snapshot VotingSnapshot, evidenceHash, sourceVersion, actor string, snapshotAsOf, now time.Time) (Proposal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.mutable(id, now)
	if err != nil {
		return Proposal{}, err
	}
	snapshot, err = s.bindPersistentDelegationsLocked(p.Input.Scope, snapshot, snapshotAsOf)
	if err != nil {
		return Proposal{}, err
	}
	_, total, err := effectiveVotingPower(snapshot)
	if err != nil || total == 0 {
		return Proposal{}, ErrInvalid
	}
	if p.Status != StatusVotingPending || p.Simulation == nil || !p.Simulation.Passed || p.Electorate != nil || !validHash(evidenceHash) || len(strings.TrimSpace(sourceVersion)) < 3 || len(strings.TrimSpace(actor)) < 3 || snapshotAsOf.IsZero() || snapshotAsOf.After(now.UTC()) || !s.hasRoleAt(actor, RoleTechnicalCouncil, p.Input.Scope, now) {
		return Proposal{}, ErrNotReady
	}
	record := &ElectorateRecord{Snapshot: cloneVotingSnapshot(snapshot), EvidenceHash: strings.ToLower(evidenceHash), SourceVersion: sourceVersion, SnapshotAsOf: snapshotAsOf.UTC(), SubmittedBy: actor, SubmittedAt: now.UTC(), Approvals: map[string]ElectorateApproval{}, Status: "pending_approval"}
	record.AuditHash = electorateAudit(record)
	p.Electorate = record
	p.UpdatedAt = now.UTC()
	return clone(p), nil
}

func (s *Service) ApproveElectorate(id, actor string, now time.Time) (Proposal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.mutable(id, now)
	if err != nil {
		return Proposal{}, err
	}
	if p.Status != StatusVotingPending || p.Electorate == nil || p.Electorate.Status != "pending_approval" || len(strings.TrimSpace(actor)) < 3 || !s.hasRoleAt(actor, RoleTechnicalCouncil, p.Input.Scope, now) {
		return Proposal{}, ErrNotReady
	}
	if _, ok := p.Electorate.Approvals[actor]; ok {
		return Proposal{}, ErrReplay
	}
	approval := ElectorateApproval{Approver: actor, ApprovedAt: now.UTC()}
	approval.AuditHash = hash(id, approval.Approver, approval.ApprovedAt.Format(time.RFC3339Nano), p.Electorate.EvidenceHash)
	p.Electorate.Approvals[actor] = approval
	if uint64(len(p.Electorate.Approvals)) >= s.policy.ElectorateApprovalThreshold {
		p.Electorate.Status = "approved"
	}
	p.Electorate.AuditHash = electorateAudit(p.Electorate)
	p.UpdatedAt = now.UTC()
	return clone(p), nil
}

func (s *Service) OpenVoting(id string, now time.Time) (Proposal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.mutable(id, now)
	if err != nil {
		return Proposal{}, err
	}
	if p.Electorate == nil || p.Electorate.Status != "approved" || uint64(len(p.Electorate.Approvals)) < s.policy.ElectorateApprovalThreshold {
		return Proposal{}, ErrNotReady
	}
	snapshot := p.Electorate.Snapshot
	power, eligiblePower, err := effectiveVotingPower(snapshot)
	if err != nil {
		return Proposal{}, err
	}
	if p.Status != StatusVotingPending || p.Simulation == nil || !p.Simulation.Passed || eligiblePower == 0 {
		return Proposal{}, ErrNotReady
	}
	p.EligiblePower, p.VotingPower, p.BasePower, p.Delegations, p.DelegatedPower, p.DelegationOverrides, p.VotingEndsAt = eligiblePower, power, clonePowers(snapshot.BasePower), cloneStrings(snapshot.Delegations), clonePowers(snapshot.DelegatedPower), cloneBools(snapshot.DelegationOverrides), now.UTC().Add(s.policy.VotingPeriod)
	if err = transitionProposal(p, StatusVotingActive, "ynx-governance-runtime", "approved electorate snapshot opened the bounded voting window", []string{p.Electorate.EvidenceHash}, now); err != nil {
		return Proposal{}, err
	}
	return clone(p), nil
}

func (s *Service) Finalize(id string, now time.Time) (Proposal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.mutable(id, now)
	if err != nil {
		return Proposal{}, err
	}
	if p.Status != StatusVotingActive || now.Before(p.VotingEndsAt) {
		return Proposal{}, ErrNotReady
	}
	var participated, yes, no, veto uint64
	participated, yes, no, veto = proposalTally(p)
	decisive := yes + no + veto
	tallyEvidence := []string{fmt.Sprintf("tally://%s/participated=%d/yes=%d/no=%d/veto=%d/eligible=%d", p.ID, participated, yes, no, veto, p.EligiblePower)}
	if err = transitionProposal(p, StatusVotingClosed, "ynx-governance-runtime", "the bounded voting window closed and the final tally was frozen", tallyEvidence, now); err != nil {
		return Proposal{}, err
	}
	quorumReached := participated*10000 >= p.EligiblePower*s.policy.QuorumBPS
	thresholdReached := decisive > 0 && yes*10000 >= decisive*s.policy.ThresholdBPS && veto*3 < decisive
	if !quorumReached {
		if err = s.transitionUpgradeLocked(p, UpgradeRejected, "ynx-governance-runtime", "upgrade proposal did not meet the versioned minimum quorum", tallyEvidence, now); err != nil {
			return Proposal{}, err
		}
		if err = transitionProposal(p, StatusQuorumFailed, "ynx-governance-runtime", "final participation did not meet the versioned minimum quorum", tallyEvidence, now); err != nil {
			return Proposal{}, err
		}
		return clone(p), nil
	}
	if !thresholdReached {
		if err = s.transitionUpgradeLocked(p, UpgradeRejected, "ynx-governance-runtime", "upgrade proposal did not meet approval or veto thresholds", tallyEvidence, now); err != nil {
			return Proposal{}, err
		}
		if err = transitionProposal(p, StatusThresholdFailed, "ynx-governance-runtime", "final approval or veto thresholds were not satisfied", tallyEvidence, now); err != nil {
			return Proposal{}, err
		}
		return clone(p), nil
	}
	if err = transitionProposal(p, StatusApproved, "ynx-governance-runtime", "quorum and approval thresholds passed; no execution has occurred", tallyEvidence, now); err != nil {
		return Proposal{}, err
	}
	if _, err = s.createTimelockLocked(p, tallyEvidence, now); err != nil {
		return Proposal{}, err
	}
	if err = s.transitionUpgradeLocked(p, UpgradeTimelocked, "ynx-governance-runtime", "approved upgrade entered the exact-manifest timelock and became eligible for canary evaluation", tallyEvidence, now); err != nil {
		return Proposal{}, err
	}
	if _, err = s.createCanaryLocked(p, tallyEvidence, now); err != nil {
		return Proposal{}, err
	}
	if err = transitionProposal(p, StatusTimelockPending, "ynx-governance-runtime", "approved action was bound to a persistent public timelock record", tallyEvidence, now); err != nil {
		return Proposal{}, err
	}
	if err = transitionProposal(p, StatusTimelockActive, "ynx-governance-runtime", "timelock became active and the parameter change remains unapplied", tallyEvidence, now); err != nil {
		return Proposal{}, err
	}
	return clone(p), nil
}

// BeginExecution reserves an exact execution intent but never infers that
// Chain Core accepted it. Canonical submission must be completed through
// ConfirmChainExecution after post-commit reconciliation.
func (s *Service) BeginExecution(id, manifestHash string, now time.Time) (Proposal, error) {
	_, proposal, err := s.PrepareChainExecution(id, manifestHash, now)
	return proposal, err
}

func (s *Service) prepareExecutionLocked(id, manifestHash string, now time.Time) (*Proposal, *TimelockRecord, *CanaryRecord, error) {
	record, ok := s.timelocks[id]
	if !ok {
		return nil, nil, nil, ErrNotFound
	}
	if record.Status == TimelockSubmitted || record.Status == TimelockExecuted || record.Status == TimelockFailed || record.Status == TimelockRolledBack {
		return nil, nil, nil, ErrReplay
	}
	p, err := s.mutable(id, now)
	if err != nil {
		return nil, nil, nil, err
	}
	if err = s.expireTimelockLocked(p, record, now.UTC()); err != nil {
		return nil, nil, nil, err
	}
	if record.Status == TimelockExecutionReady {
		if p.Status != StatusExecutionReady || !strings.EqualFold(p.ExecutionHash, manifestHash) {
			return nil, nil, nil, ErrNotReady
		}
		canary := s.canaries[p.ID]
		if canary == nil || canary.Status != CanaryPassed || canary.Envelope == nil || !strings.EqualFold(canary.Envelope.ManifestHash, manifestHash) {
			return nil, nil, nil, fmt.Errorf("%w: execution requires a passed canary bound to the exact manifest", ErrForbidden)
		}
		return p, record, canary, nil
	}
	if record.Status != TimelockActive || record.ActionHash != p.ActionHash || p.Status != StatusTimelockActive || now.Before(record.EarliestExecution) || now.After(record.GraceEndsAt) || !validHash(manifestHash) {
		return nil, nil, nil, ErrNotReady
	}
	canary := s.canaries[p.ID]
	if canary == nil || canary.Status != CanaryPassed || canary.Envelope == nil || !strings.EqualFold(canary.Envelope.ManifestHash, manifestHash) {
		return nil, nil, nil, fmt.Errorf("%w: execution requires a passed canary bound to the exact manifest", ErrForbidden)
	}
	if (p.Input.Scope == ScopeProtocolUpgrade || p.Input.Scope == ScopeConsensusUpgrade) && !strings.EqualFold(p.Input.UpgradeHash, manifestHash) {
		return nil, nil, nil, fmt.Errorf("%w: upgrade manifest mismatch", ErrForbidden)
	}
	p.ExecutionHash = strings.ToLower(manifestHash)
	evidence := []string{"manifest://sha256/" + p.ExecutionHash}
	if err = transitionTimelock(record, TimelockExecutionReady, "ynx-governance-runtime", "timelock elapsed and the exact action hash entered its bounded execution window", evidence, now); err != nil {
		return nil, nil, nil, err
	}
	if err = transitionProposal(p, StatusExecutionReady, "ynx-governance-runtime", "timelock elapsed and the exact action hash entered its bounded execution window", evidence, now); err != nil {
		return nil, nil, nil, err
	}
	record.ExecutionManifestHash, record.ExecutionStartedAt = p.ExecutionHash, now.UTC()
	record.AuditHash = timelockAudit(record)
	return p, record, canary, nil
}

func (s *Service) markExecutionSubmittedLocked(p *Proposal, record *TimelockRecord, evidence []string, now time.Time) error {
	if p == nil || record == nil || p.Status != StatusExecutionReady || record.Status != TimelockExecutionReady || len(evidence) == 0 {
		return ErrNotReady
	}
	if err := transitionTimelock(record, TimelockSubmitted, "execution-operator", "the exact authorized action hash was submitted once to the canonical execution owner", evidence, now); err != nil {
		return err
	}
	if err := transitionProposal(p, StatusExecutionSubmitted, "execution-operator", "the exact authorized action hash was submitted to the canonical execution owner", evidence, now); err != nil {
		return err
	}
	if isUpgradeProposal(p) {
		record, exists := s.upgrades[p.ID]
		if !exists {
			return fmt.Errorf("%w: first-class upgrade record missing", ErrForbidden)
		}
		record.ExecutionManifestHash = p.ExecutionHash
		if err := s.transitionUpgradeLocked(p, UpgradeSubmitted, "execution-operator", "exact upgrade manifest was submitted to the canonical execution owner", evidence, now); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) VerifyExecution(id string, receipt ExecutionReceipt, rollbackReceipt *ExecutionReceipt, now time.Time) (Proposal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.mutable(id, now)
	if err != nil {
		return Proposal{}, err
	}
	if p.Status != StatusExecutionSubmitted {
		return Proposal{}, ErrInvalid
	}
	record, ok := s.timelocks[id]
	if !ok || record.Status != TimelockSubmitted || record.ActionHash != p.ActionHash {
		return Proposal{}, fmt.Errorf("%w: execution is not bound to the persistent timelock", ErrForbidden)
	}
	if err = validateExecutionReceipt(receipt, p.ExecutionHash); err != nil {
		return Proposal{}, err
	}
	p.ExecutionReceipt = &receipt
	executionEvidence := []string{"execution-tx://" + receipt.TxHash, "execution-audit://" + receipt.AuditHash}
	if receipt.Outcome == "verified" {
		if rollbackReceipt != nil {
			return Proposal{}, ErrInvalid
		}
		for _, step := range []struct {
			to     Status
			reason string
		}{
			{StatusExecuted, "canonical execution owner returned a successful transaction receipt"},
			{StatusVerificationPending, "successful transaction receipt entered independent system-health verification"},
			{StatusVerified, "transaction, state root, manifest, and post-execution verification all passed"},
		} {
			if err = transitionProposal(p, step.to, "ynx-governance-verifier", step.reason, executionEvidence, now); err != nil {
				return Proposal{}, err
			}
		}
		if err = transitionTimelock(record, TimelockExecuted, "ynx-governance-verifier", "canonical execution receipt and post-execution verification both succeeded", executionEvidence, now); err != nil {
			return Proposal{}, err
		}
		if isUpgradeProposal(p) {
			upgrade := s.upgrades[p.ID]
			upgrade.ExecutionReceiptAuditID = receipt.AuditHash
			if err = s.transitionUpgradeLocked(p, UpgradeVerified, "ynx-governance-verifier", "upgrade execution receipt and post-upgrade verification both succeeded", executionEvidence, now); err != nil {
				return Proposal{}, err
			}
		}
		return clone(p), nil
	}
	if receipt.Outcome != "failed" {
		return Proposal{}, ErrInvalid
	}
	if err = transitionProposal(p, StatusExecutionFailed, "ynx-governance-verifier", "canonical execution receipt reported failure and no healthy state was inferred", executionEvidence, now); err != nil {
		return Proposal{}, err
	}
	if err = transitionTimelock(record, TimelockFailed, "ynx-governance-verifier", "canonical execution receipt reported failure and no healthy state was inferred", executionEvidence, now); err != nil {
		return Proposal{}, err
	}
	if isUpgradeProposal(p) {
		upgrade := s.upgrades[p.ID]
		upgrade.ExecutionReceiptAuditID = receipt.AuditHash
		if err = s.transitionUpgradeLocked(p, UpgradeFailed, "ynx-governance-verifier", "upgrade execution receipt reported failure and requires verified rollback", executionEvidence, now); err != nil {
			return Proposal{}, err
		}
	}
	if rollbackReceipt == nil {
		return clone(p), nil
	}
	if err = validateExecutionReceipt(*rollbackReceipt, rollbackReceipt.ManifestHash); err != nil || rollbackReceipt.Outcome != "verified_rollback" || strings.EqualFold(rollbackReceipt.ManifestHash, p.ExecutionHash) {
		return Proposal{}, fmt.Errorf("%w: invalid rollback receipt", ErrForbidden)
	}
	p.RollbackHash, p.RollbackReceipt = strings.ToLower(rollbackReceipt.ManifestHash), rollbackReceipt
	rollbackEvidence := []string{"rollback-tx://" + rollbackReceipt.TxHash, "rollback-audit://" + rollbackReceipt.AuditHash}
	if err = transitionProposal(p, StatusRollbackPending, "execution-operator", "failed execution entered bounded rollback processing", rollbackEvidence, now); err != nil {
		return Proposal{}, err
	}
	if err = transitionProposal(p, StatusRolledBack, "ynx-governance-verifier", "rollback receipt restored the approved rollback manifest and verified state", rollbackEvidence, now); err != nil {
		return Proposal{}, err
	}
	if err = transitionTimelock(record, TimelockRolledBack, "ynx-governance-verifier", "verified rollback restored the approved recovery manifest", rollbackEvidence, now); err != nil {
		return Proposal{}, err
	}
	if isUpgradeProposal(p) {
		upgrade := s.upgrades[p.ID]
		upgrade.RollbackManifestHash, upgrade.RollbackReceiptAuditID = p.RollbackHash, rollbackReceipt.AuditHash
		if err = s.transitionUpgradeLocked(p, UpgradeRolledBack, "ynx-governance-verifier", "verified upgrade rollback restored the approved recovery manifest", rollbackEvidence, now); err != nil {
			return Proposal{}, err
		}
	}
	return clone(p), nil
}

func (s *Service) VerifyRollback(id string, rollbackReceipt ExecutionReceipt, now time.Time) (Proposal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.mutable(id, now)
	if err != nil {
		return Proposal{}, err
	}
	if p.Status != StatusExecutionFailed || rollbackReceipt.Outcome != "verified_rollback" || strings.EqualFold(rollbackReceipt.ManifestHash, p.ExecutionHash) {
		return Proposal{}, ErrNotReady
	}
	record, ok := s.timelocks[id]
	if !ok || record.Status != TimelockFailed {
		return Proposal{}, fmt.Errorf("%w: failed execution timelock record missing", ErrForbidden)
	}
	if err = validateExecutionReceipt(rollbackReceipt, rollbackReceipt.ManifestHash); err != nil {
		return Proposal{}, err
	}
	p.RollbackHash, p.RollbackReceipt = strings.ToLower(rollbackReceipt.ManifestHash), &rollbackReceipt
	evidence := []string{"rollback-tx://" + rollbackReceipt.TxHash, "rollback-audit://" + rollbackReceipt.AuditHash}
	if err = transitionProposal(p, StatusRollbackPending, "execution-operator", "failed execution entered bounded rollback processing", evidence, now); err != nil {
		return Proposal{}, err
	}
	if err = transitionProposal(p, StatusRolledBack, "ynx-governance-verifier", "rollback receipt restored the approved rollback manifest and verified state", evidence, now); err != nil {
		return Proposal{}, err
	}
	if err = transitionTimelock(record, TimelockRolledBack, "ynx-governance-verifier", "verified rollback restored the approved recovery manifest", evidence, now); err != nil {
		return Proposal{}, err
	}
	if isUpgradeProposal(p) {
		upgrade := s.upgrades[p.ID]
		upgrade.RollbackManifestHash, upgrade.RollbackReceiptAuditID = p.RollbackHash, rollbackReceipt.AuditHash
		if err = s.transitionUpgradeLocked(p, UpgradeRolledBack, "ynx-governance-verifier", "verified upgrade rollback restored the approved recovery manifest", evidence, now); err != nil {
			return Proposal{}, err
		}
	}
	return clone(p), nil
}

func (s *Service) PauseProposal(id, emergencyActionID, actor string, now time.Time) (Proposal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.mutable(id, now)
	if err != nil {
		return Proposal{}, err
	}
	action, ok := s.emergencies[emergencyActionID]
	if !ok {
		return Proposal{}, ErrNotFound
	}
	s.expireEmergency(action, now.UTC())
	if action.Status != "active" || action.Input.Target != id || uint64(len(action.Approvals)) < s.policy.EmergencyThreshold || !s.hasRoleAt(actor, RoleEmergencyCouncil, p.Input.Scope, now) {
		return Proposal{}, ErrForbidden
	}
	evidence := append([]string{"emergency-action://" + action.ID}, action.Input.Evidence...)
	if record, exists := s.timelocks[id]; exists {
		if record.Status != TimelockActive {
			return Proposal{}, ErrNotReady
		}
		if err = transitionTimelock(record, TimelockPaused, actor, "active scoped emergency action paused the scheduled governance action", evidence, now); err != nil {
			return Proposal{}, err
		}
	}
	if err = s.transitionCanaryLocked(p, CanaryPaused, actor, "active scoped emergency action invalidated and paused this canary authorization", evidence, now); err != nil {
		return Proposal{}, err
	}
	if err = s.transitionUpgradeLocked(p, UpgradeEmergencyPaused, actor, "active scoped emergency action paused this upgrade", evidence, now); err != nil {
		return Proposal{}, err
	}
	if err = transitionProposal(p, StatusEmergencyPaused, actor, "active scoped emergency action temporarily paused this proposal", evidence, now); err != nil {
		return Proposal{}, err
	}
	return clone(p), nil
}

func (s *Service) CorrectProposal(id, correctionProposalID, actor string, now time.Time) (Proposal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.proposals[id]
	if !ok {
		return Proposal{}, ErrNotFound
	}
	correction, ok := s.proposals[correctionProposalID]
	if !ok {
		return Proposal{}, ErrNotFound
	}
	if p.Status != StatusEmergencyPaused || correction.Status != StatusVerified || correction.ID == p.ID || correction.Input.Scope != p.Input.Scope || !s.hasRoleAt(actor, RoleTechnicalCouncil, p.Input.Scope, now) {
		return Proposal{}, ErrForbidden
	}
	if record, exists := s.timelocks[id]; exists {
		if record.Status != TimelockPaused {
			return Proposal{}, ErrNotReady
		}
		if err := transitionTimelock(record, TimelockCorrected, actor, "verified correction proposal closed the paused timelock without execution", []string{"correction-proposal://" + correction.ID}, now); err != nil {
			return Proposal{}, err
		}
	}
	if err := s.transitionCanaryLocked(p, CanaryCorrected, actor, "verified correction proposal closed the paused canary without execution", []string{"correction-proposal://" + correction.ID}, now); err != nil {
		return Proposal{}, err
	}
	if err := s.transitionUpgradeLocked(p, UpgradeCorrected, actor, "verified correction proposal closed the paused upgrade without execution", []string{"correction-proposal://" + correction.ID}, now); err != nil {
		return Proposal{}, err
	}
	if err := transitionProposal(p, StatusCorrected, actor, "a separately approved and verified correction proposal resolved the emergency pause", []string{"correction-proposal://" + correction.ID}, now); err != nil {
		return Proposal{}, err
	}
	return clone(p), nil
}

func (s *Service) ArchiveProposal(id, actor string, evidence []string, now time.Time) (Proposal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.proposals[id]
	if !ok {
		return Proposal{}, ErrNotFound
	}
	if p.Status == StatusArchived || !terminalProposalStatus(p.Status) || len(evidence) == 0 {
		return Proposal{}, ErrNotReady
	}
	if err := transitionProposal(p, StatusArchived, actor, "terminal proposal record was sealed into the public governance archive", evidence, now); err != nil {
		return Proposal{}, err
	}
	return clone(p), nil
}

func (s *Service) Get(id string) (Proposal, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	p, ok := s.proposals[id]
	if !ok {
		return Proposal{}, ErrNotFound
	}
	return clone(p), nil
}

func (s *Service) ListProposals() []Proposal {
	s.mu.RLock()
	defer s.mu.RUnlock()
	items := make([]Proposal, 0, len(s.proposals))
	for _, p := range s.proposals {
		items = append(items, clone(p))
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].CreatedAt.Equal(items[j].CreatedAt) {
			return items[i].ID < items[j].ID
		}
		return items[i].CreatedAt.After(items[j].CreatedAt)
	})
	return items
}

func (s *Service) mutable(id string, now time.Time) (*Proposal, error) {
	p, ok := s.proposals[id]
	if !ok {
		return nil, ErrNotFound
	}
	if record, exists := s.timelocks[id]; exists {
		if err := s.expireTimelockLocked(p, record, now.UTC()); err != nil {
			return nil, err
		}
	}
	if now.UTC().After(p.Input.ExpiresAt) && !terminalProposalStatus(p.Status) && proposalTransitions[p.Status][StatusExpired] {
		if err := s.transitionUpgradeLocked(p, UpgradeExpired, "ynx-governance-runtime", "upgrade proposal execution window expired before a verified terminal outcome", []string{"expiry://" + p.Input.ExpiresAt.UTC().Format(time.RFC3339Nano)}, now); err != nil {
			return nil, err
		}
		if err := transitionProposal(p, StatusExpired, "ynx-governance-runtime", "proposal execution window expired before a terminal verified outcome", []string{"expiry://" + p.Input.ExpiresAt.UTC().Format(time.RFC3339Nano)}, now); err != nil {
			return nil, err
		}
	}
	if terminalProposalStatus(p.Status) {
		return nil, ErrNotReady
	}
	return p, nil
}

func validateProposal(input ProposalInput, now time.Time, minimumLifetime, maxLifetime time.Duration, rules map[string]ParameterRule) error {
	validScopes := map[Scope]bool{ScopeProtocolUpgrade: true, ScopeConsensusUpgrade: true, ScopeGenesis: true, ScopeEconomics: true, ScopeTreasury: true, ScopeStablecoin: true, ScopeOracle: true, ScopeBridge: true, ScopeExchange: true, ScopeDEX: true, ScopeVault: true, ScopeSafety: true, ScopeServiceSecurity: true, ScopeResource: true, ScopeProductRegistry: true, ScopeGrants: true, ScopeRetentionPolicy: true, ScopeSecurityPolicy: true, ScopeReleasePolicy: true}
	if !validScopes[input.Scope] || len(strings.TrimSpace(input.Nonce)) < 8 || len(strings.TrimSpace(input.ProposalType)) < 3 || len(strings.TrimSpace(input.Proposer)) < 3 || len(strings.TrimSpace(input.Owner)) < 3 || len(strings.TrimSpace(input.Summary)) < 16 || len(strings.TrimSpace(input.Motivation)) < 16 || len(strings.TrimSpace(input.TechnicalImpact)) < 16 || len(strings.TrimSpace(input.EconomicImpact)) < 16 || len(strings.TrimSpace(input.SecurityRisk)) < 16 || len(strings.TrimSpace(input.UserImpact)) < 16 || len(strings.TrimSpace(input.ProviderImpact)) < 16 || len(strings.TrimSpace(input.Migration)) < 16 || len(strings.TrimSpace(input.Rollback)) < 16 || len(strings.TrimSpace(input.CanaryPlan)) < 16 || len(strings.TrimSpace(input.VerificationPlan)) < 16 || len(strings.TrimSpace(input.ConflictDisclosure)) < 16 || len(input.Dependencies) == 0 || len(input.Evidence) == 0 || len(input.Changes) == 0 || !validHash(strings.ToLower(input.SourceCommit)) || len(strings.TrimSpace(input.Release)) < 3 || !input.ExpiresAt.After(now.Add(minimumLifetime)) || input.ExpiresAt.After(now.Add(maxLifetime)) {
		return ErrInvalid
	}
	for _, dependency := range input.Dependencies {
		if len(strings.TrimSpace(dependency)) < 3 {
			return ErrInvalid
		}
	}
	seen := map[string]bool{}
	for _, change := range input.Changes {
		if !strings.HasPrefix(change.Path, "/") || change.Before == change.After || seen[change.Path] {
			return ErrInvalid
		}
		seen[change.Path] = true
		rule, ok := rules[change.Path]
		if !ok || rule.Scope != input.Scope {
			return fmt.Errorf("%w: parameter path is not allowed for scope", ErrForbidden)
		}
		if rule.Numeric {
			if change.Numeric == nil || *change.Numeric < rule.Minimum || *change.Numeric > rule.Maximum {
				return fmt.Errorf("%w: parameter %s outside authoritative bounds", ErrForbidden, change.Path)
			}
		} else if change.Numeric != nil {
			return fmt.Errorf("%w: non-numeric parameter supplied numeric value", ErrInvalid)
		}
		if change.Minimum != 0 || change.Maximum != 0 {
			if change.Minimum != rule.Minimum || change.Maximum != rule.Maximum {
				return fmt.Errorf("%w: proposal cannot widen parameter bounds", ErrForbidden)
			}
		}
	}
	if (input.Scope == ScopeProtocolUpgrade || input.Scope == ScopeConsensusUpgrade) && !validHash(input.UpgradeHash) {
		return fmt.Errorf("%w: upgrade hash required", ErrInvalid)
	}
	return nil
}

func proposalFingerprint(input ProposalInput) string {
	parts := make([]string, 0, len(input.Changes))
	for _, c := range input.Changes {
		parts = append(parts, c.Path+"="+c.After)
	}
	sort.Strings(parts)
	return hash(string(input.Scope), strings.Join(parts, "|"))
}
func hash(parts ...string) string {
	h := sha256.New()
	for _, p := range parts {
		h.Write([]byte{0})
		h.Write([]byte(p))
	}
	return hex.EncodeToString(h.Sum(nil))
}
func validHash(value string) bool {
	if len(value) != 64 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}
func clone(p *Proposal) Proposal {
	out := *p
	out.Conflicts = map[string]ConflictDisclosure{}
	for k, v := range p.Conflicts {
		out.Conflicts[k] = v
	}
	out.Votes = map[string]Vote{}
	for k, v := range p.Votes {
		out.Votes[k] = v
	}
	out.VoteHistory = map[string][]Vote{}
	for voter, history := range p.VoteHistory {
		out.VoteHistory[voter] = append([]Vote(nil), history...)
	}
	out.VotingPower = map[string]uint64{}
	for k, v := range p.VotingPower {
		out.VotingPower[k] = v
	}
	out.BasePower = clonePowers(p.BasePower)
	out.Delegations = cloneStrings(p.Delegations)
	out.DelegatedPower = clonePowers(p.DelegatedPower)
	out.DelegationOverrides = cloneBools(p.DelegationOverrides)
	out.Input.Dependencies = append([]string(nil), p.Input.Dependencies...)
	out.Input.Evidence = append([]string(nil), p.Input.Evidence...)
	out.Input.Changes = append([]ParameterChange(nil), p.Input.Changes...)
	out.Transitions = make([]StateTransition, len(p.Transitions))
	for i, transition := range p.Transitions {
		out.Transitions[i] = transition
		out.Transitions[i].Evidence = append([]string(nil), transition.Evidence...)
	}
	if p.Simulation != nil {
		v := *p.Simulation
		out.Simulation = &v
	}
	if p.Cancellation != nil {
		v := *p.Cancellation
		v.Evidence = append([]string(nil), p.Cancellation.Evidence...)
		out.Cancellation = &v
	}
	if p.Electorate != nil {
		v := *p.Electorate
		v.Snapshot = cloneVotingSnapshot(p.Electorate.Snapshot)
		v.Approvals = map[string]ElectorateApproval{}
		for k, a := range p.Electorate.Approvals {
			v.Approvals[k] = a
		}
		out.Electorate = &v
	}
	if p.ExecutionReceipt != nil {
		v := *p.ExecutionReceipt
		out.ExecutionReceipt = &v
	}
	if p.RollbackReceipt != nil {
		v := *p.RollbackReceipt
		out.RollbackReceipt = &v
	}
	return out
}

func effectiveVotingPower(snapshot VotingSnapshot) (map[string]uint64, uint64, error) {
	if len(snapshot.BasePower) == 0 {
		return nil, 0, ErrInvalid
	}
	effective := map[string]uint64{}
	var total uint64
	for account, power := range snapshot.BasePower {
		if strings.TrimSpace(account) == "" || power == 0 || total > ^uint64(0)-power {
			return nil, 0, ErrInvalid
		}
		total += power
		target, delegated := snapshot.Delegations[account]
		if !delegated || target == "" {
			if effective[account] > ^uint64(0)-power {
				return nil, 0, ErrInvalid
			}
			effective[account] += power
			continue
		}
		if snapshot.BasePower[target] == 0 || target == account || snapshot.Delegations[target] != "" {
			return nil, 0, fmt.Errorf("%w: invalid, cyclic, or multi-hop delegation", ErrForbidden)
		}
		amount := snapshot.DelegatedPower[account]
		if amount == 0 {
			amount = power
		}
		if amount > power || effective[target] > ^uint64(0)-amount {
			return nil, 0, ErrInvalid
		}
		effective[account] += power - amount
		effective[target] += amount
	}
	for from, to := range snapshot.Delegations {
		if snapshot.BasePower[from] == 0 || snapshot.BasePower[to] == 0 || from == to || (snapshot.DelegatedPower[from] != 0 && snapshot.DelegatedPower[from] > snapshot.BasePower[from]) {
			return nil, 0, fmt.Errorf("%w: invalid delegation", ErrForbidden)
		}
	}
	return effective, total, nil
}

func proposalTally(proposal *Proposal) (participated, yes, no, veto uint64) {
	add := func(voter string, power uint64) {
		vote, ok := proposal.Votes[voter]
		if !ok || vote.Operation == VoteOperationWithdraw || power == 0 {
			return
		}
		participated += power
		switch vote.Choice {
		case "yes":
			yes += power
		case "no":
			no += power
		case "veto":
			veto += power
		}
	}
	for account, base := range proposal.BasePower {
		delegate := proposal.Delegations[account]
		if delegate == "" {
			add(account, base)
			continue
		}
		amount := proposal.DelegatedPower[account]
		if amount == 0 {
			amount = base
		}
		add(account, base-amount)
		if proposal.DelegationOverrides[account] {
			if vote, ok := proposal.Votes[account]; ok && vote.Operation != VoteOperationWithdraw {
				add(account, amount)
				continue
			}
		}
		add(delegate, amount)
	}
	return participated, yes, no, veto
}

func cloneVotingSnapshot(in VotingSnapshot) VotingSnapshot {
	return VotingSnapshot{BasePower: clonePowers(in.BasePower), Delegations: cloneStrings(in.Delegations), DelegatedPower: clonePowers(in.DelegatedPower), DelegationOverrides: cloneBools(in.DelegationOverrides)}
}

func cloneBools(in map[string]bool) map[string]bool {
	out := map[string]bool{}
	for k, v := range in {
		out[k] = v
	}
	return out
}
func cloneStrings(in map[string]string) map[string]string {
	out := map[string]string{}
	for k, v := range in {
		out[k] = v
	}
	return out
}

func clonePowers(in map[string]uint64) map[string]uint64 {
	out := map[string]uint64{}
	for k, v := range in {
		out[k] = v
	}
	return out
}

func validateExecutionReceipt(receipt ExecutionReceipt, expectedManifest string) error {
	if !validChainHash(receipt.TxHash) || receipt.BlockHeight == 0 || !validChainHash(receipt.BlockHash) || !validChainHash(receipt.StateRoot) || !validHash(receipt.ManifestHash) || !strings.EqualFold(receipt.ManifestHash, expectedManifest) || receipt.Source != "ynx-bft-consensus" || receipt.Version != "ynx-governance-execution-receipt/v1" || (receipt.Outcome != "verified" && receipt.Outcome != "failed" && receipt.Outcome != "verified_rollback") || receipt.AsOf.IsZero() {
		return fmt.Errorf("%w: invalid consensus execution receipt", ErrForbidden)
	}
	expected := hash(receipt.TxHash, fmt.Sprint(receipt.BlockHeight), receipt.BlockHash, receipt.StateRoot, strings.ToLower(receipt.ManifestHash), receipt.Source, receipt.Version, receipt.Outcome, receipt.AsOf.UTC().Format(time.RFC3339Nano))
	if receipt.AuditHash != expected {
		return fmt.Errorf("%w: execution receipt audit mismatch", ErrForbidden)
	}
	return nil
}
func validChainHash(value string) bool {
	value = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(value)), "0x")
	return validHash(value)
}
func NewExecutionReceipt(txHash string, height uint64, blockHash, stateRoot, manifest, outcome string, asOf time.Time) ExecutionReceipt {
	r := ExecutionReceipt{TxHash: txHash, BlockHeight: height, BlockHash: blockHash, StateRoot: stateRoot, ManifestHash: strings.ToLower(manifest), Source: "ynx-bft-consensus", Version: "ynx-governance-execution-receipt/v1", Outcome: outcome, AsOf: asOf.UTC()}
	r.AuditHash = hash(r.TxHash, fmt.Sprint(r.BlockHeight), r.BlockHash, r.StateRoot, r.ManifestHash, r.Source, r.Version, r.Outcome, r.AsOf.Format(time.RFC3339Nano))
	return r
}

func electorateAudit(record *ElectorateRecord) string {
	keys := make([]string, 0, len(record.Approvals))
	for k := range record.Approvals {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := []string{record.EvidenceHash, record.SourceVersion, record.SnapshotAsOf.Format(time.RFC3339Nano), record.SubmittedBy, record.SubmittedAt.Format(time.RFC3339Nano), record.Status}
	for _, k := range keys {
		parts = append(parts, record.Approvals[k].AuditHash)
	}
	accounts := make([]string, 0, len(record.Snapshot.BasePower))
	for account := range record.Snapshot.BasePower {
		accounts = append(accounts, account)
	}
	sort.Strings(accounts)
	for _, account := range accounts {
		parts = append(parts, account, fmt.Sprint(record.Snapshot.BasePower[account]), record.Snapshot.Delegations[account], fmt.Sprint(record.Snapshot.DelegatedPower[account]), fmt.Sprint(record.Snapshot.DelegationOverrides[account]))
	}
	return hash(parts...)
}
