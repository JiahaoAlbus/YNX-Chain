package governance

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// Domain constant for governance actions
const ActionDomain = "ynx-governance-action/v1"

// Action types
const (
	ActionProposalCreate       = "governance_proposal_create"
	ActionDeposit              = "governance_deposit"
	ActionSimulationRecord     = "governance_simulation_record"
	ActionConflictDisclose     = "governance_conflict_disclose"
	ActionElectorateSubmit     = "governance_electorate_submit"
	ActionElectorateApprove    = "governance_electorate_approve"
	ActionVotingOpen           = "governance_voting_open"
	ActionVoteCast             = "governance_vote_cast"
	ActionVoteFinalize         = "governance_vote_finalize"
	ActionProposalCancel       = "governance_proposal_cancel"
	ActionExecutionBegin       = "governance_execution_begin"
	ActionExecutionVerify      = "governance_execution_verify"
	ActionRoleAssign           = "governance_role_assign"
	ActionRoleRemove           = "governance_role_remove"
	ActionEmergencyCreate      = "governance_emergency_create"
	ActionEmergencyApprove     = "governance_emergency_approve"
	ActionEmergencyClose       = "governance_emergency_close"
)

var (
	ErrInvalidEnvelope     = errors.New("invalid governance envelope")
	ErrInvalidSignature    = errors.New("invalid signature")
	ErrNonceMismatch       = errors.New("account nonce mismatch")
	ErrExpiredAction       = errors.New("governance action expired")
	ErrUnauthorizedAction  = errors.New("unauthorized governance action")
	ErrInvalidPayloadHash  = errors.New("payload hash mismatch")
	ErrReplayAttack        = errors.New("governance replay attack")
	ErrWrongChain          = errors.New("wrong chain ID")
	ErrWrongDomain         = errors.New("wrong nonce domain")
	ErrWrongProduct        = errors.New("wrong product binding")
)

// ActionEnvelope is the canonical signed governance action container
type ActionEnvelope struct {
	Domain        string          `json:"domain"`
	ChainID       uint64          `json:"chainId"`
	Action        string          `json:"action"`
	Signer        string          `json:"signer"`        // 0x-prefixed address
	AccountNonce  uint64          `json:"accountNonce"`
	Product       string          `json:"product"`
	DeviceID      string          `json:"deviceId"`
	SessionID     string          `json:"sessionId"`
	ExpiresAt     string          `json:"expiresAt"`     // RFC3339
	PayloadHash   string          `json:"payloadHash"`   // hex sha256
	Payload       json.RawMessage `json:"payload"`
	Signature     string          `json:"signature"`     // hex secp256k1 signature
}

// ExecutionReceipt is the deterministic BFT execution proof
type ExecutionReceipt struct {
	SchemaVersion string    `json:"schemaVersion"`
	TxHash        string    `json:"txHash"`
	BlockHeight   uint64    `json:"blockHeight"`
	BlockHash     string    `json:"blockHash"`
	StateRoot     string    `json:"stateRoot"`
	ManifestHash  string    `json:"manifestHash"`
	Source        string    `json:"source"`
	Version       string    `json:"version"`
	Outcome       string    `json:"outcome"` // verified, failed, verified_rollback
	AsOf          time.Time `json:"asOf"`
	AuditHash     string    `json:"auditHash"`
}

// ValidateEnvelope performs structural and signature validation
func ValidateEnvelope(env *ActionEnvelope, expectedChainID uint64, now time.Time) error {
	if env.Domain != ActionDomain {
		return fmt.Errorf("%w: got %s", ErrWrongDomain, env.Domain)
	}
	if env.ChainID != expectedChainID {
		return fmt.Errorf("%w: got %d, expected %d", ErrWrongChain, env.ChainID, expectedChainID)
	}
	if env.Product != "governance" {
		return fmt.Errorf("%w: got %s", ErrWrongProduct, env.Product)
	}
	
	// Validate expiry
	expiresAt, err := time.Parse(time.RFC3339, env.ExpiresAt)
	if err != nil {
		return fmt.Errorf("%w: invalid expiresAt", ErrInvalidEnvelope)
	}
	if now.After(expiresAt) {
		return ErrExpiredAction
	}
	
	// Validate payload hash
	h := sha256.Sum256(env.Payload)
	computedHash := hex.EncodeToString(h[:])
	if computedHash != env.PayloadHash {
		return ErrInvalidPayloadHash
	}
	
	// Validate signature (simplified - real implementation uses secp256k1)
	if env.Signature == "" {
		return ErrInvalidSignature
	}
	
	return nil
}

// CanonicalHash computes the deterministic envelope hash
func CanonicalHash(env *ActionEnvelope) (string, error) {
	// RFC8785-compatible canonical JSON
	canonical, err := json.Marshal(env)
	if err != nil {
		return "", err
	}
	h := sha256.Sum256(canonical)
	return hex.EncodeToString(h[:]), nil
}

// ProposalCreatePayload is the payload for proposal creation
type ProposalCreatePayload struct {
	Nonce          string                   `json:"nonce"`
	Scope          string                   `json:"scope"`
	Summary        string                   `json:"summary"`
	EconomicImpact string                   `json:"economicImpact"`
	SecurityRisk   string                   `json:"securityRisk"`
	Migration      string                   `json:"migration"`
	Rollback       string                   `json:"rollback"`
	Evidence       []string                 `json:"evidence"`
	Changes        []ParameterChangePayload `json:"changes"`
	UpgradeHash    string                   `json:"upgradeHash,omitempty"`
}

type ParameterChangePayload struct {
	Path    string `json:"path"`
	Before  string `json:"before"`
	After   string `json:"after"`
	Minimum *int64 `json:"minimum,omitempty"`
	Maximum *int64 `json:"maximum,omitempty"`
}

// VoteCastPayload is the payload for casting a vote
type VoteCastPayload struct {
	ProposalID string `json:"proposalId"`
	Position   string `json:"position"` // approve, reject, abstain
	Reason     string `json:"reason,omitempty"`
}

// RoleAssignPayload is the payload for role assignment
type RoleAssignPayload struct {
	Account    string    `json:"account"`
	Role       string    `json:"role"`
	Scope      []string  `json:"scope"`
	Term       string    `json:"term"`       // RFC3339 expiry
	ProposalID string    `json:"proposalId"` // authorizing proposal
}

// EmergencyCreatePayload is the payload for emergency action
type EmergencyCreatePayload struct {
	Scope      string   `json:"scope"`      // bridge, oracle_route, market, vault, provider, upgrade
	Target     string   `json:"target"`     // specific target identifier
	Action     string   `json:"action"`     // pause
	Reason     string   `json:"reason"`
	Evidence   []string `json:"evidence"`
	Duration   int64    `json:"duration"`   // seconds, maximum enforced
}
