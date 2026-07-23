package governance

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"
)

var (
	ErrStateCorrupted = errors.New("governance state corrupted")
	ErrNotFound       = errors.New("governance record not found")
	ErrConflict       = errors.New("governance state conflict")
)

// ChainState maintains the on-chain governance state
type ChainState struct {
	mu                sync.RWMutex
	Proposals         map[string]*ChainProposal         `json:"proposals"`
	Votes             map[string]map[string]*ChainVote  `json:"votes"` // proposalID -> account -> vote
	Roles             map[string]*ChainRole             `json:"roles"` // account -> role
	Emergencies       map[string]*ChainEmergency        `json:"emergencies"`
	AccountNonces     map[string]uint64                 `json:"accountNonces"`
	ProcessedTxHashes map[string]bool                   `json:"processedTxHashes"`
	Height            uint64                            `json:"height"`
	StateRoot         string                            `json:"stateRoot"`
}

// ChainProposal is the on-chain proposal record
type ChainProposal struct {
	ID             string                   `json:"id"`
	Nonce          string                   `json:"nonce"`
	Scope          string                   `json:"scope"`
	Proposer       string                   `json:"proposer"`
	Summary        string                   `json:"summary"`
	EconomicImpact string                   `json:"economicImpact"`
	SecurityRisk   string                   `json:"securityRisk"`
	Migration      string                   `json:"migration"`
	Rollback       string                   `json:"rollback"`
	Evidence       []string                 `json:"evidence"`
	Changes        []ParameterChangePayload `json:"changes"`
	UpgradeHash    string                   `json:"upgradeHash,omitempty"`
	Status         string                   `json:"status"`
	CreatedAt      time.Time                `json:"createdAt"`
	CreatedHeight  uint64                   `json:"createdHeight"`
	VotingOpensAt  time.Time                `json:"votingOpensAt,omitempty"`
	VotingClosesAt time.Time                `json:"votingClosesAt,omitempty"`
	TimelockEndsAt time.Time                `json:"timelockEndsAt,omitempty"`
	ExecutedAt     time.Time                `json:"executedAt,omitempty"`
	ExecutedHeight uint64                   `json:"executedHeight,omitempty"`
	Outcome        string                   `json:"outcome,omitempty"`
}

// ChainVote is the on-chain vote record
type ChainVote struct {
	ProposalID string    `json:"proposalId"`
	Account    string    `json:"account"`
	Position   string    `json:"position"` // approve, reject, abstain
	Reason     string    `json:"reason,omitempty"`
	Power      int64     `json:"power"`
	CastAt     time.Time `json:"castAt"`
	CastHeight uint64    `json:"castHeight"`
	TxHash     string    `json:"txHash"`
}

// ChainRole is the on-chain role assignment
type ChainRole struct {
	Account    string    `json:"account"`
	Role       string    `json:"role"`
	Scope      []string  `json:"scope"`
	AssignedAt time.Time `json:"assignedAt"`
	ExpiresAt  time.Time `json:"expiresAt"`
	ProposalID string    `json:"proposalId"`
	Active     bool      `json:"active"`
}

// ChainEmergency is the on-chain emergency action
type ChainEmergency struct {
	ID         string    `json:"id"`
	Scope      string    `json:"scope"`
	Target     string    `json:"target"`
	Action     string    `json:"action"`
	Reason     string    `json:"reason"`
	Evidence   []string  `json:"evidence"`
	Approvals  []string  `json:"approvals"` // accounts that approved
	CreatedAt  time.Time `json:"createdAt"`
	ExpiresAt  time.Time `json:"expiresAt"`
	ClosedAt   time.Time `json:"closedAt,omitempty"`
	Status     string    `json:"status"` // pending, active, closed, expired
}

// NewChainState creates a new governance chain state
func NewChainState() *ChainState {
	return &ChainState{
		Proposals:         make(map[string]*ChainProposal),
		Votes:             make(map[string]map[string]*ChainVote),
		Roles:             make(map[string]*ChainRole),
		Emergencies:       make(map[string]*ChainEmergency),
		AccountNonces:     make(map[string]uint64),
		ProcessedTxHashes: make(map[string]bool),
		Height:            0,
		StateRoot:         "",
	}
}

// ApplyProposalCreate applies a proposal creation action
func (s *ChainState) ApplyProposalCreate(env *ActionEnvelope, payload *ProposalCreatePayload, now time.Time, height uint64) (*ChainProposal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Generate proposal ID from canonical envelope hash
	proposalID, err := CanonicalHash(env)
	if err != nil {
		return nil, err
	}

	// Check for duplicate
	if _, exists := s.Proposals[proposalID]; exists {
		return nil, fmt.Errorf("%w: proposal %s already exists", ErrConflict, proposalID)
	}

	proposal := &ChainProposal{
		ID:             proposalID,
		Nonce:          payload.Nonce,
		Scope:          payload.Scope,
		Proposer:       env.Signer,
		Summary:        payload.Summary,
		EconomicImpact: payload.EconomicImpact,
		SecurityRisk:   payload.SecurityRisk,
		Migration:      payload.Migration,
		Rollback:       payload.Rollback,
		Evidence:       payload.Evidence,
		Changes:        payload.Changes,
		UpgradeHash:    payload.UpgradeHash,
		Status:         "deposit",
		CreatedAt:      now,
		CreatedHeight:  height,
	}

	s.Proposals[proposalID] = proposal
	s.AccountNonces[env.Signer] = env.AccountNonce + 1
	
	return proposal, nil
}

// ApplyVoteCast applies a vote casting action
func (s *ChainState) ApplyVoteCast(env *ActionEnvelope, payload *VoteCastPayload, power int64, now time.Time, height uint64, txHash string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	proposal, exists := s.Proposals[payload.ProposalID]
	if !exists {
		return fmt.Errorf("%w: proposal %s", ErrNotFound, payload.ProposalID)
	}

	if proposal.Status != "voting" {
		return fmt.Errorf("%w: proposal not in voting state", ErrConflict)
	}

	// Initialize votes map for this proposal
	if s.Votes[payload.ProposalID] == nil {
		s.Votes[payload.ProposalID] = make(map[string]*ChainVote)
	}

	// Check for duplicate vote
	if _, exists := s.Votes[payload.ProposalID][env.Signer]; exists {
		return fmt.Errorf("%w: account %s already voted", ErrConflict, env.Signer)
	}

	vote := &ChainVote{
		ProposalID: payload.ProposalID,
		Account:    env.Signer,
		Position:   payload.Position,
		Reason:     payload.Reason,
		Power:      power,
		CastAt:     now,
		CastHeight: height,
		TxHash:     txHash,
	}

	s.Votes[payload.ProposalID][env.Signer] = vote
	s.AccountNonces[env.Signer] = env.AccountNonce + 1

	return nil
}

// ApplyRoleAssign applies a role assignment action
func (s *ChainState) ApplyRoleAssign(env *ActionEnvelope, payload *RoleAssignPayload, now time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	expiresAt, err := time.Parse(time.RFC3339, payload.Term)
	if err != nil {
		return fmt.Errorf("%w: invalid term format", ErrInvalidEnvelope)
	}

	role := &ChainRole{
		Account:    payload.Account,
		Role:       payload.Role,
		Scope:      payload.Scope,
		AssignedAt: now,
		ExpiresAt:  expiresAt,
		ProposalID: payload.ProposalID,
		Active:     true,
	}

	s.Roles[payload.Account] = role
	s.AccountNonces[env.Signer] = env.AccountNonce + 1

	return nil
}

// ComputeStateRoot computes the deterministic state root hash
func (s *ChainState) ComputeStateRoot() (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	canonical, err := json.Marshal(s)
	if err != nil {
		return "", err
	}
	h := sha256.Sum256(canonical)
	return hex.EncodeToString(h[:]), nil
}

// GetProposal retrieves a proposal by ID
func (s *ChainState) GetProposal(id string) (*ChainProposal, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	proposal, exists := s.Proposals[id]
	if !exists {
		return nil, fmt.Errorf("%w: proposal %s", ErrNotFound, id)
	}
	return proposal, nil
}

// GetVotes retrieves all votes for a proposal
func (s *ChainState) GetVotes(proposalID string) (map[string]*ChainVote, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	votes, exists := s.Votes[proposalID]
	if !exists {
		return make(map[string]*ChainVote), nil
	}
	return votes, nil
}

// GetRole retrieves a role for an account
func (s *ChainState) GetRole(account string) (*ChainRole, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	role, exists := s.Roles[account]
	if !exists {
		return nil, fmt.Errorf("%w: role for %s", ErrNotFound, account)
	}
	return role, nil
}
