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
	ScopeProtocolUpgrade Scope = "protocol_upgrade"
	ScopeGenesis         Scope = "genesis_validator_parameters"
	ScopeEconomics       Scope = "fee_burn_issuance"
	ScopeTreasury        Scope = "treasury"
	ScopeStablecoin      Scope = "stablecoin_reserve_provider"
	ScopeOracle          Scope = "oracle_provider_threshold"
	ScopeBridge          Scope = "bridge_provider_limits"
	ScopeExchange        Scope = "exchange_market"
	ScopeDEX             Scope = "dex_fee_pool"
	ScopeVault           Scope = "quant_vault_bounds"
	ScopeSafety          Scope = "safety_module"
	ScopeResource        Scope = "resource_provider"
	ScopeProductRegistry Scope = "product_registry"
	ScopeGrants          Scope = "public_grants_incentives"
)

type Status string

const (
	StatusDeposit    Status = "deposit"
	StatusDiscussion Status = "discussion"
	StatusVoting     Status = "voting"
	StatusRejected   Status = "rejected"
	StatusTimelocked Status = "timelocked"
	StatusExecuting  Status = "executing"
	StatusExecuted   Status = "executed"
	StatusRolledBack Status = "rolled_back"
	StatusCancelled  Status = "cancelled"
	StatusExpired    Status = "expired"
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
	Nonce          string            `json:"nonce"`
	Scope          Scope             `json:"scope"`
	Proposer       string            `json:"proposer"`
	Owner          string            `json:"owner"`
	Summary        string            `json:"summary"`
	EconomicImpact string            `json:"economicImpact"`
	SecurityRisk   string            `json:"securityRisk"`
	Migration      string            `json:"migration"`
	Rollback       string            `json:"rollback"`
	Evidence       []string          `json:"evidence"`
	Changes        []ParameterChange `json:"changes"`
	ExpiresAt      time.Time         `json:"expiresAt"`
	UpgradeHash    string            `json:"upgradeHash,omitempty"`
}

type Simulation struct {
	TechnicalEvidence string    `json:"technicalEvidence"`
	EconomicEvidence  string    `json:"economicEvidence"`
	Passed            bool      `json:"passed"`
	CompletedAt       time.Time `json:"completedAt"`
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
	Voter     string    `json:"voter"`
	Choice    string    `json:"choice"`
	Power     uint64    `json:"power"`
	CastAt    time.Time `json:"castAt"`
	AuditHash string    `json:"auditHash"`
}

type VotingSnapshot struct {
	BasePower   map[string]uint64 `json:"basePower"`
	Delegations map[string]string `json:"delegations"`
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
	ID               string                        `json:"id"`
	Input            ProposalInput                 `json:"input"`
	Status           Status                        `json:"status"`
	Deposit          uint64                        `json:"deposit"`
	Simulation       *Simulation                   `json:"simulation,omitempty"`
	Cancellation     *Cancellation                 `json:"cancellation,omitempty"`
	Conflicts        map[string]ConflictDisclosure `json:"conflicts"`
	Votes            map[string]Vote               `json:"votes"`
	EligiblePower    uint64                        `json:"eligiblePower"`
	VotingPower      map[string]uint64             `json:"votingPower"`
	BasePower        map[string]uint64             `json:"basePower"`
	Delegations      map[string]string             `json:"delegations"`
	Electorate       *ElectorateRecord             `json:"electorate,omitempty"`
	VotingEndsAt     time.Time                     `json:"votingEndsAt,omitempty"`
	ExecuteAfter     time.Time                     `json:"executeAfter,omitempty"`
	ExecutionHash    string                        `json:"executionHash,omitempty"`
	ExecutionReceipt *ExecutionReceipt             `json:"executionReceipt,omitempty"`
	RollbackHash     string                        `json:"rollbackHash,omitempty"`
	RollbackReceipt  *ExecutionReceipt             `json:"rollbackReceipt,omitempty"`
	CreatedAt        time.Time                     `json:"createdAt"`
	UpdatedAt        time.Time                     `json:"updatedAt"`
}

type Policy struct {
	MinimumDeposit              uint64
	QuorumBPS                   uint64
	ThresholdBPS                uint64
	VotingPeriod                time.Duration
	Timelock                    time.Duration
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
	mu               sync.RWMutex
	policy           Policy
	proposals        map[string]*Proposal
	nonces           map[string]struct{}
	emergencies      map[string]*EmergencyAction
	emergencyNonces  map[string]struct{}
	roles            map[string]*RoleAssignment
	appeals          map[string]*Appeal
	appealNonces     map[string]struct{}
	discussions      map[string]*DiscussionEntry
	discussionNonces map[string]struct{}
}

func NewService(policy Policy) (*Service, error) {
	if policy.MinimumDeposit == 0 || policy.QuorumBPS == 0 || policy.QuorumBPS > 10000 || policy.ThresholdBPS == 0 || policy.ThresholdBPS > 10000 || policy.VotingPeriod <= 0 || policy.Timelock <= 0 || policy.MaxLifetime <= policy.VotingPeriod+policy.Timelock || policy.EmergencyThreshold < 2 || policy.EmergencyMaxDuration <= 0 || policy.EmergencyMaxDuration > 7*24*time.Hour || len(policy.ParameterRules) == 0 || !validHash(policy.GenesisRoleManifestHash) || policy.ElectorateApprovalThreshold < 2 {
		return nil, fmt.Errorf("%w: unsafe governance policy", ErrInvalid)
	}
	for path, rule := range policy.ParameterRules {
		if !strings.HasPrefix(path, "/") || rule.Scope == "" || (rule.Numeric && rule.Minimum >= rule.Maximum) {
			return nil, fmt.Errorf("%w: unsafe parameter rule", ErrInvalid)
		}
	}
	return &Service{policy: policy, proposals: map[string]*Proposal{}, nonces: map[string]struct{}{}, emergencies: map[string]*EmergencyAction{}, emergencyNonces: map[string]struct{}{}, roles: map[string]*RoleAssignment{}, appeals: map[string]*Appeal{}, appealNonces: map[string]struct{}{}, discussions: map[string]*DiscussionEntry{}, discussionNonces: map[string]struct{}{}}, nil
}

func (s *Service) Create(input ProposalInput, now time.Time) (Proposal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now = now.UTC()
	if err := validateProposal(input, now, s.policy.MaxLifetime, s.policy.ParameterRules); err != nil {
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
	p := &Proposal{ID: id, Input: input, Status: StatusDeposit, Conflicts: map[string]ConflictDisclosure{}, Votes: map[string]Vote{}, VotingPower: map[string]uint64{}, BasePower: map[string]uint64{}, Delegations: map[string]string{}, CreatedAt: now, UpdatedAt: now}
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
	if p.Status != StatusDeposit || amount == 0 {
		return Proposal{}, ErrNotReady
	}
	p.Deposit += amount
	p.UpdatedAt = now.UTC()
	if p.Deposit >= s.policy.MinimumDeposit {
		p.Status = StatusDiscussion
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
	if p.Status != StatusDiscussion || len(simulation.TechnicalEvidence) < 16 || len(simulation.EconomicEvidence) < 16 {
		return Proposal{}, ErrInvalid
	}
	simulation.CompletedAt = now.UTC()
	p.Simulation = &simulation
	p.UpdatedAt = now.UTC()
	if !simulation.Passed {
		p.Status = StatusRejected
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
	if (p.Status != StatusDeposit && p.Status != StatusDiscussion) || actor != p.Input.Proposer || len(strings.TrimSpace(reason)) < 16 || len(evidence) == 0 {
		return Proposal{}, ErrForbidden
	}
	c := &Cancellation{Actor: actor, Reason: strings.TrimSpace(reason), Evidence: append([]string(nil), evidence...), CancelledAt: now.UTC()}
	c.AuditHash = hash(id, c.Actor, c.Reason, c.CancelledAt.Format(time.RFC3339Nano), strings.Join(c.Evidence, "|"))
	p.Cancellation = c
	p.Status = StatusCancelled
	p.UpdatedAt = now.UTC()
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
	_, total, err := effectiveVotingPower(snapshot)
	if err != nil || total == 0 {
		return Proposal{}, ErrInvalid
	}
	if p.Status != StatusDiscussion || p.Simulation == nil || !p.Simulation.Passed || p.Electorate != nil || !validHash(evidenceHash) || len(strings.TrimSpace(sourceVersion)) < 3 || len(strings.TrimSpace(actor)) < 3 || snapshotAsOf.IsZero() || snapshotAsOf.After(now.UTC()) || !s.hasRoleAt(actor, RoleTechnicalCouncil, p.Input.Scope, now) {
		return Proposal{}, ErrNotReady
	}
	record := &ElectorateRecord{Snapshot: VotingSnapshot{BasePower: clonePowers(snapshot.BasePower), Delegations: cloneStrings(snapshot.Delegations)}, EvidenceHash: strings.ToLower(evidenceHash), SourceVersion: sourceVersion, SnapshotAsOf: snapshotAsOf.UTC(), SubmittedBy: actor, SubmittedAt: now.UTC(), Approvals: map[string]ElectorateApproval{}, Status: "pending_approval"}
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
	if p.Status != StatusDiscussion || p.Electorate == nil || p.Electorate.Status != "pending_approval" || len(strings.TrimSpace(actor)) < 3 || !s.hasRoleAt(actor, RoleTechnicalCouncil, p.Input.Scope, now) {
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
	if p.Status != StatusDiscussion || p.Simulation == nil || !p.Simulation.Passed || eligiblePower == 0 {
		return Proposal{}, ErrNotReady
	}
	p.Status, p.EligiblePower, p.VotingPower, p.BasePower, p.Delegations, p.VotingEndsAt, p.UpdatedAt = StatusVoting, eligiblePower, power, clonePowers(snapshot.BasePower), cloneStrings(snapshot.Delegations), now.UTC().Add(s.policy.VotingPeriod), now.UTC()
	return clone(p), nil
}

func (s *Service) Vote(id, voter, choice string, now time.Time) (Proposal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.mutable(id, now)
	if err != nil {
		return Proposal{}, err
	}
	choice = strings.ToLower(strings.TrimSpace(choice))
	power := p.VotingPower[voter]
	if p.Status != StatusVoting || !now.Before(p.VotingEndsAt) || (choice != "yes" && choice != "no" && choice != "abstain" && choice != "veto") || power == 0 || strings.TrimSpace(voter) == "" {
		return Proposal{}, ErrInvalid
	}
	if _, exists := p.Votes[voter]; exists {
		return Proposal{}, ErrReplay
	}
	if conflict, exists := p.Conflicts[voter]; exists && conflict.Recused {
		return Proposal{}, ErrForbidden
	}
	p.Votes[voter] = Vote{Voter: voter, Choice: choice, Power: power, CastAt: now.UTC(), AuditHash: hash(id, voter, choice, fmt.Sprint(power))}
	p.UpdatedAt = now.UTC()
	return clone(p), nil
}

func (s *Service) Finalize(id string, now time.Time) (Proposal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.mutable(id, now)
	if err != nil {
		return Proposal{}, err
	}
	if p.Status != StatusVoting || now.Before(p.VotingEndsAt) {
		return Proposal{}, ErrNotReady
	}
	var participated, yes, no, veto uint64
	for _, vote := range p.Votes {
		participated += vote.Power
		switch vote.Choice {
		case "yes":
			yes += vote.Power
		case "no":
			no += vote.Power
		case "veto":
			veto += vote.Power
		}
	}
	decisive := yes + no + veto
	passed := participated*10000 >= p.EligiblePower*s.policy.QuorumBPS && decisive > 0 && yes*10000 >= decisive*s.policy.ThresholdBPS && veto*3 < decisive
	if passed {
		p.Status, p.ExecuteAfter = StatusTimelocked, now.UTC().Add(s.policy.Timelock)
	} else {
		p.Status = StatusRejected
	}
	p.UpdatedAt = now.UTC()
	return clone(p), nil
}

func (s *Service) BeginExecution(id, manifestHash string, now time.Time) (Proposal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.mutable(id, now)
	if err != nil {
		return Proposal{}, err
	}
	if p.Status != StatusTimelocked || now.Before(p.ExecuteAfter) || !validHash(manifestHash) {
		return Proposal{}, ErrNotReady
	}
	if p.Input.Scope == ScopeProtocolUpgrade && !strings.EqualFold(p.Input.UpgradeHash, manifestHash) {
		return Proposal{}, fmt.Errorf("%w: upgrade manifest mismatch", ErrForbidden)
	}
	p.Status, p.ExecutionHash, p.UpdatedAt = StatusExecuting, strings.ToLower(manifestHash), now.UTC()
	return clone(p), nil
}

func (s *Service) VerifyExecution(id string, receipt ExecutionReceipt, rollbackReceipt *ExecutionReceipt, now time.Time) (Proposal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.mutable(id, now)
	if err != nil {
		return Proposal{}, err
	}
	if p.Status != StatusExecuting {
		return Proposal{}, ErrInvalid
	}
	if err = validateExecutionReceipt(receipt, p.ExecutionHash); err != nil {
		return Proposal{}, err
	}
	p.ExecutionReceipt = &receipt
	p.UpdatedAt = now.UTC()
	if receipt.Outcome == "verified" {
		if rollbackReceipt != nil {
			return Proposal{}, ErrInvalid
		}
		p.Status = StatusExecuted
	} else if receipt.Outcome == "failed" && rollbackReceipt != nil {
		if err = validateExecutionReceipt(*rollbackReceipt, rollbackReceipt.ManifestHash); err != nil || rollbackReceipt.Outcome != "verified_rollback" || strings.EqualFold(rollbackReceipt.ManifestHash, p.ExecutionHash) {
			return Proposal{}, fmt.Errorf("%w: invalid rollback receipt", ErrForbidden)
		}
		p.Status, p.RollbackHash, p.RollbackReceipt = StatusRolledBack, strings.ToLower(rollbackReceipt.ManifestHash), rollbackReceipt
	} else {
		return Proposal{}, fmt.Errorf("%w: failed execution requires verified rollback receipt", ErrNotReady)
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
	if now.UTC().After(p.Input.ExpiresAt) && p.Status != StatusExecuted && p.Status != StatusRolledBack {
		p.Status, p.UpdatedAt = StatusExpired, now.UTC()
	}
	if p.Status == StatusExpired || p.Status == StatusCancelled || p.Status == StatusRejected || p.Status == StatusExecuted || p.Status == StatusRolledBack {
		return nil, ErrNotReady
	}
	return p, nil
}

func validateProposal(input ProposalInput, now time.Time, maxLifetime time.Duration, rules map[string]ParameterRule) error {
	validScopes := map[Scope]bool{ScopeProtocolUpgrade: true, ScopeGenesis: true, ScopeEconomics: true, ScopeTreasury: true, ScopeStablecoin: true, ScopeOracle: true, ScopeBridge: true, ScopeExchange: true, ScopeDEX: true, ScopeVault: true, ScopeSafety: true, ScopeResource: true, ScopeProductRegistry: true, ScopeGrants: true}
	if !validScopes[input.Scope] || len(strings.TrimSpace(input.Nonce)) < 8 || len(strings.TrimSpace(input.Proposer)) < 3 || len(strings.TrimSpace(input.Owner)) < 3 || len(strings.TrimSpace(input.Summary)) < 16 || len(strings.TrimSpace(input.EconomicImpact)) < 16 || len(strings.TrimSpace(input.SecurityRisk)) < 16 || len(strings.TrimSpace(input.Migration)) < 16 || len(strings.TrimSpace(input.Rollback)) < 16 || len(input.Evidence) == 0 || len(input.Changes) == 0 || !input.ExpiresAt.After(now) || input.ExpiresAt.After(now.Add(maxLifetime)) {
		return ErrInvalid
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
	if input.Scope == ScopeProtocolUpgrade && !validHash(input.UpgradeHash) {
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
	out.VotingPower = map[string]uint64{}
	for k, v := range p.VotingPower {
		out.VotingPower[k] = v
	}
	out.BasePower = clonePowers(p.BasePower)
	out.Delegations = cloneStrings(p.Delegations)
	out.Input.Evidence = append([]string(nil), p.Input.Evidence...)
	out.Input.Changes = append([]ParameterChange(nil), p.Input.Changes...)
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
		v.Snapshot.BasePower = clonePowers(p.Electorate.Snapshot.BasePower)
		v.Snapshot.Delegations = cloneStrings(p.Electorate.Snapshot.Delegations)
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
		target := account
		seen := map[string]bool{account: true}
		for {
			next, ok := snapshot.Delegations[target]
			if !ok || next == "" {
				break
			}
			if snapshot.BasePower[next] == 0 || seen[next] {
				return nil, 0, fmt.Errorf("%w: delegation cycle or unknown delegate", ErrForbidden)
			}
			seen[next] = true
			target = next
		}
		if effective[target] > ^uint64(0)-power {
			return nil, 0, ErrInvalid
		}
		effective[target] += power
	}
	for from, to := range snapshot.Delegations {
		if snapshot.BasePower[from] == 0 || snapshot.BasePower[to] == 0 || from == to {
			return nil, 0, fmt.Errorf("%w: invalid delegation", ErrForbidden)
		}
	}
	return effective, total, nil
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
		parts = append(parts, account, fmt.Sprint(record.Snapshot.BasePower[account]), record.Snapshot.Delegations[account])
	}
	return hash(parts...)
}
