package governance

import (
	"encoding/json"
	"fmt"
	"strings"
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

	if err := ValidateEnvelope(&env, h.chainID, now); err != nil {
		return err
	}

	// Replay is classified before nonce so a byte-identical delivered action
	// cannot be disguised as a stale nonce failure.
	txHash, err := CanonicalHash(&env)
	if err != nil {
		return err
	}
	h.state.mu.RLock()
	processed := h.state.ProcessedTxHashes[txHash]
	expectedNonce := h.state.AccountNonces[env.Signer]
	h.state.mu.RUnlock()
	if processed {
		return ErrReplayAttack
	}
	if env.AccountNonce != expectedNonce {
		return ErrNonceMismatch
	}

	switch env.Action {
	case ActionProposalCreate:
		var payload ProposalCreatePayload
		if err := json.Unmarshal(env.Payload, &payload); err != nil {
			return fmt.Errorf("%w: invalid payload", ErrInvalidEnvelope)
		}
		if strings.TrimSpace(payload.Nonce) == "" || strings.TrimSpace(payload.Scope) == "" || len(strings.TrimSpace(payload.Summary)) < 8 {
			return fmt.Errorf("%w: incomplete proposal payload", ErrInvalidEnvelope)
		}
	case ActionVoteCast:
		var payload VoteCastPayload
		if err := json.Unmarshal(env.Payload, &payload); err != nil {
			return fmt.Errorf("%w: invalid payload", ErrInvalidEnvelope)
		}
		position := strings.ToLower(strings.TrimSpace(payload.Position))
		if strings.TrimSpace(payload.ProposalID) == "" || (position != "approve" && position != "reject" && position != "abstain" && position != "veto") {
			return fmt.Errorf("%w: invalid vote binding or position", ErrInvalidEnvelope)
		}
		h.state.mu.RLock()
		proposal := h.state.Proposals[payload.ProposalID]
		var duplicate bool
		if h.state.Votes[payload.ProposalID] != nil {
			_, duplicate = h.state.Votes[payload.ProposalID][env.Signer]
		}
		h.state.mu.RUnlock()
		if proposal == nil || proposal.Status != "voting" {
			return fmt.Errorf("%w: proposal is not open for voting", ErrUnauthorizedAction)
		}
		if duplicate {
			return ErrReplayAttack
		}
	case ActionRoleAssign:
		var payload RoleAssignPayload
		if err := json.Unmarshal(env.Payload, &payload); err != nil {
			return fmt.Errorf("%w: invalid payload", ErrInvalidEnvelope)
		}
		term, err := time.Parse(time.RFC3339, payload.Term)
		if err != nil || !term.After(now) || strings.TrimSpace(payload.Account) == "" || strings.TrimSpace(payload.Role) == "" || len(payload.Scope) == 0 || strings.TrimSpace(payload.ProposalID) == "" {
			return fmt.Errorf("%w: invalid scoped role assignment", ErrInvalidEnvelope)
		}
	default:
		return fmt.Errorf("%w: unsupported action %s", ErrUnauthorizedAction, env.Action)
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

	// Execute before committing replay or height state. A failed action must not
	// consume a nonce or poison the processed transaction registry.
	outcome := "verified"
	switch env.Action {
	case ActionProposalCreate:
		var payload ProposalCreatePayload
		if err := json.Unmarshal(env.Payload, &payload); err != nil {
			return nil, fmt.Errorf("%w: invalid payload", ErrInvalidEnvelope)
		}
		if _, err := h.state.ApplyProposalCreate(&env, &payload, now, height); err != nil {
			return nil, err
		}

	case ActionVoteCast:
		var payload VoteCastPayload
		if err := json.Unmarshal(env.Payload, &payload); err != nil {
			return nil, fmt.Errorf("%w: invalid payload", ErrInvalidEnvelope)
		}
		// The canonical electorate adapter will provide snapshot power when this
		// handler is wired into the central ABCI application. This chain record
		// is intentionally non-authoritative for tallying until then.
		votingPower := int64(1)
		if err := h.state.ApplyVoteCast(&env, &payload, votingPower, now, height, txHash); err != nil {
			return nil, err
		}

	case ActionRoleAssign:
		var payload RoleAssignPayload
		if err := json.Unmarshal(env.Payload, &payload); err != nil {
			return nil, fmt.Errorf("%w: invalid payload", ErrInvalidEnvelope)
		}
		if err := h.state.ApplyRoleAssign(&env, &payload, now); err != nil {
			return nil, err
		}

	default:
		return nil, fmt.Errorf("%w: unsupported action %s", ErrUnauthorizedAction, env.Action)
	}

	// Commit replay protection only after the action mutation succeeds.
	h.state.mu.Lock()
	h.state.ProcessedTxHashes[txHash] = true
	h.state.Height = height
	h.state.mu.Unlock()

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
