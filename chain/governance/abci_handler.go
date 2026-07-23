package governance

import (
	"encoding/json"
	"fmt"
	"time"
)

// ABCIHandler processes governance transactions in the ABCI application
type ABCIHandler struct {
	state           *ChainState
	chainID         uint64
	timelockSeconds int64
	votingDuration  int64
}

// NewABCIHandler creates a new governance ABCI handler
func NewABCIHandler(chainID uint64) *ABCIHandler {
	return &ABCIHandler{
		state:           NewChainState(),
		chainID:         chainID,
		timelockSeconds: 86400,  // 24 hours
		votingDuration:  604800, // 7 days
	}
}

// CheckTx validates a governance transaction without mutating state
func (h *ABCIHandler) CheckTx(txBytes []byte, now time.Time) error {
	var env ActionEnvelope
	if err := json.Unmarshal(txBytes, &env); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidEnvelope, err)
	}

	// Validate envelope structure and signature
	if err := ValidateEnvelope(&env, h.chainID, now); err != nil {
		return err
	}

	// Check nonce
	h.state.mu.RLock()
	expectedNonce := h.state.AccountNonces[env.Signer]
	h.state.mu.RUnlock()

	if env.AccountNonce != expectedNonce {
		return fmt.Errorf("%w: expected %d, got %d", ErrNonceMismatch, expectedNonce, env.AccountNonce)
	}

	// Check for replay
	txHash, err := CanonicalHash(&env)
	if err != nil {
		return err
	}

	h.state.mu.RLock()
	if h.state.ProcessedTxHashes[txHash] {
		return ErrReplayAttack
	}
	h.state.mu.RUnlock()

	// Action-specific validation
	switch env.Action {
	case ActionProposalCreate:
		var payload ProposalCreatePayload
		if err := json.Unmarshal(env.Payload, &payload); err != nil {
			return fmt.Errorf("%w: invalid payload", ErrInvalidEnvelope)
		}
		// TODO: Validate proposer has role, scope bounds, etc.
	case ActionVoteCast:
		var payload VoteCastPayload
		if err := json.Unmarshal(env.Payload, &payload); err != nil {
			return fmt.Errorf("%w: invalid payload", ErrInvalidEnvelope)
		}
		// TODO: Validate voter eligibility
	}

	return nil
}

// DeliverTx executes a governance transaction and mutates state
func (h *ABCIHandler) DeliverTx(txBytes []byte, now time.Time, height uint64) (*ExecutionReceipt, error) {
	var env ActionEnvelope
	if err := json.Unmarshal(txBytes, &env); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidEnvelope, err)
	}

	// Validate first
	if err := h.CheckTx(txBytes, now); err != nil {
		return nil, err
	}

	txHash, err := CanonicalHash(&env)
	if err != nil {
		return nil, err
	}

	// Mark as processed
	h.state.mu.Lock()
	h.state.ProcessedTxHashes[txHash] = true
	h.state.Height = height
	h.state.mu.Unlock()

	// Execute action
	var outcome string
	switch env.Action {
	case ActionProposalCreate:
		var payload ProposalCreatePayload
		if err := json.Unmarshal(env.Payload, &payload); err != nil {
			return nil, fmt.Errorf("%w: invalid payload", ErrInvalidEnvelope)
		}
		_, err := h.state.ApplyProposalCreate(&env, &payload, now, height)
		if err != nil {
			outcome = "failed"
		} else {
			outcome = "verified"
		}

	case ActionVoteCast:
		var payload VoteCastPayload
		if err := json.Unmarshal(env.Payload, &payload); err != nil {
			return nil, fmt.Errorf("%w: invalid payload", ErrInvalidEnvelope)
		}
		// TODO: Compute voting power from staked balance or delegation
		votingPower := int64(1)
		err := h.state.ApplyVoteCast(&env, &payload, votingPower, now, height, txHash)
		if err != nil {
			outcome = "failed"
		} else {
			outcome = "verified"
		}

	case ActionRoleAssign:
		var payload RoleAssignPayload
		if err := json.Unmarshal(env.Payload, &payload); err != nil {
			return nil, fmt.Errorf("%w: invalid payload", ErrInvalidEnvelope)
		}
		err := h.state.ApplyRoleAssign(&env, &payload, now)
		if err != nil {
			outcome = "failed"
		} else {
			outcome = "verified"
		}

	default:
		return nil, fmt.Errorf("%w: unsupported action %s", ErrUnauthorizedAction, env.Action)
	}

	// Compute new state root
	stateRoot, err := h.state.ComputeStateRoot()
	if err != nil {
		return nil, err
	}

	receipt := &ExecutionReceipt{
		SchemaVersion: "ynx-governance-execution-receipt/v1",
		TxHash:        txHash,
		BlockHeight:   height,
		BlockHash:     "", // Filled by consensus layer
		StateRoot:     stateRoot,
		ManifestHash:  "", // Filled for upgrades
		Source:        "ynx-bft-consensus",
		Version:       "1.0.0",
		Outcome:       outcome,
		AsOf:          now,
		AuditHash:     "", // Computed from full receipt
	}

	return receipt, nil
}

// Query handles read-only governance queries
func (h *ABCIHandler) Query(path string, data []byte) ([]byte, error) {
	switch path {
	case "proposal":
		var req struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			return nil, err
		}
		proposal, err := h.state.GetProposal(req.ID)
		if err != nil {
			return nil, err
		}
		return json.Marshal(proposal)

	case "votes":
		var req struct {
			ProposalID string `json:"proposalId"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			return nil, err
		}
		votes, err := h.state.GetVotes(req.ProposalID)
		if err != nil {
			return nil, err
		}
		return json.Marshal(votes)

	case "role":
		var req struct {
			Account string `json:"account"`
		}
		if err := json.Unmarshal(data, &req); err != nil {
			return nil, err
		}
		role, err := h.state.GetRole(req.Account)
		if err != nil {
			return nil, err
		}
		return json.Marshal(role)

	default:
		return nil, fmt.Errorf("unknown query path: %s", path)
	}
}

// GetState returns the current governance state (for testing/debugging)
func (h *ABCIHandler) GetState() *ChainState {
	return h.state
}
