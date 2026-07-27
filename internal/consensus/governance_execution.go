package consensus

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	abcitypes "github.com/cometbft/cometbft/abci/types"
)

const maxGovernanceExecutionWindow = 7 * 24 * time.Hour

type GovernanceExecutionBeginPayload struct {
	ProposalID          string    `json:"proposalId"`
	ActionHash          string    `json:"actionHash"`
	ManifestHash        string    `json:"manifestHash"`
	GovernanceAuditHash string    `json:"governanceAuditHash"`
	TimelockAuditHash   string    `json:"timelockAuditHash"`
	CanaryAuditHash     string    `json:"canaryAuditHash"`
	EvidenceHash        string    `json:"evidenceHash"`
	Scope               string    `json:"scope"`
	EarliestExecution   time.Time `json:"earliestExecution"`
	LatestExecution     time.Time `json:"latestExecution"`
}

type GovernanceExecutionVerifyPayload struct {
	ProposalID       string `json:"proposalId"`
	BeginTxHash      string `json:"beginTxHash"`
	ActionHash       string `json:"actionHash"`
	ManifestHash     string `json:"manifestHash"`
	Outcome          string `json:"outcome"`
	StateRoot        string `json:"stateRoot"`
	EvidenceHash     string `json:"evidenceHash"`
	RollbackManifest string `json:"rollbackManifestHash,omitempty"`
}

type BFTGovernanceExecution struct {
	ProposalID          string     `json:"proposalId"`
	ActionHash          string     `json:"actionHash"`
	ManifestHash        string     `json:"manifestHash"`
	GovernanceAuditHash string     `json:"governanceAuditHash"`
	TimelockAuditHash   string     `json:"timelockAuditHash"`
	CanaryAuditHash     string     `json:"canaryAuditHash"`
	EvidenceHash        string     `json:"evidenceHash"`
	Scope               string     `json:"scope"`
	Signer              string     `json:"signer"`
	Status              string     `json:"status"`
	EarliestExecution   time.Time  `json:"earliestExecution"`
	LatestExecution     time.Time  `json:"latestExecution"`
	SubmittedAt         time.Time  `json:"submittedAt"`
	SubmittedHeight     int64      `json:"submittedHeight"`
	BeginTxHash         string     `json:"beginTxHash"`
	VerifiedAt          *time.Time `json:"verifiedAt,omitempty"`
	VerifiedHeight      int64      `json:"verifiedHeight,omitempty"`
	VerifyTxHash        string     `json:"verifyTxHash,omitempty"`
	StateRoot           string     `json:"stateRoot,omitempty"`
	OutcomeEvidenceHash string     `json:"outcomeEvidenceHash,omitempty"`
	RollbackManifest    string     `json:"rollbackManifestHash,omitempty"`
	FailedAt            *time.Time `json:"failedAt,omitempty"`
	FailedHeight        int64      `json:"failedHeight,omitempty"`
	FailureTxHash       string     `json:"failureTxHash,omitempty"`
	FailureStateRoot    string     `json:"failureStateRoot,omitempty"`
	FailureEvidenceHash string     `json:"failureEvidenceHash,omitempty"`
	AuditHash           string     `json:"auditHash"`
}

type BFTGovernanceExecutionAudit struct {
	Sequence     uint64    `json:"sequence"`
	ID           string    `json:"id"`
	ProposalID   string    `json:"proposalId"`
	Action       string    `json:"action"`
	Status       string    `json:"status"`
	Signer       string    `json:"signer"`
	PreviousHash string    `json:"previousHash,omitempty"`
	BlockHeight  int64     `json:"blockHeight"`
	CreatedAt    time.Time `json:"createdAt"`
	TxHash       string    `json:"txHash"`
	AuditHash    string    `json:"auditHash"`
}

func isProtocolGovernanceAction(action string) bool {
	return action == ActionGovernanceExecutionBegin || action == ActionGovernanceExecutionVerify
}

func canonicalProtocolGovernancePayload(action string, raw []byte) ([]byte, error) {
	switch action {
	case ActionGovernanceExecutionBegin:
		var p GovernanceExecutionBeginPayload
		if err := decodeCanonicalPayload(raw, &p); err != nil {
			return nil, err
		}
		p.ProposalID = strings.ToLower(strings.TrimSpace(p.ProposalID))
		p.ActionHash = strings.ToLower(strings.TrimSpace(p.ActionHash))
		p.ManifestHash = strings.ToLower(strings.TrimSpace(p.ManifestHash))
		p.GovernanceAuditHash = strings.ToLower(strings.TrimSpace(p.GovernanceAuditHash))
		p.TimelockAuditHash = strings.ToLower(strings.TrimSpace(p.TimelockAuditHash))
		p.CanaryAuditHash = strings.ToLower(strings.TrimSpace(p.CanaryAuditHash))
		p.EvidenceHash = strings.ToLower(strings.TrimSpace(p.EvidenceHash))
		p.Scope = strings.ToLower(strings.TrimSpace(p.Scope))
		p.EarliestExecution, p.LatestExecution = p.EarliestExecution.UTC(), p.LatestExecution.UTC()
		if !validGovernanceHash(p.ProposalID) || !validGovernanceHash(p.ActionHash) || !validGovernanceHash(p.ManifestHash) ||
			!validGovernanceHash(p.GovernanceAuditHash) || !validGovernanceHash(p.TimelockAuditHash) ||
			!validGovernanceHash(p.CanaryAuditHash) || !validGovernanceHash(p.EvidenceHash) {
			return nil, errors.New("governance execution begin requires canonical sha256 bindings")
		}
		if p.Scope == "" || len(p.Scope) > 128 || p.EarliestExecution.IsZero() || !p.LatestExecution.After(p.EarliestExecution) ||
			p.LatestExecution.Sub(p.EarliestExecution) > maxGovernanceExecutionWindow {
			return nil, errors.New("governance execution begin has invalid scope or bounded execution window")
		}
		return json.Marshal(p)
	case ActionGovernanceExecutionVerify:
		var p GovernanceExecutionVerifyPayload
		if err := decodeCanonicalPayload(raw, &p); err != nil {
			return nil, err
		}
		p.ProposalID = strings.ToLower(strings.TrimSpace(p.ProposalID))
		p.BeginTxHash = strings.ToLower(strings.TrimSpace(p.BeginTxHash))
		p.ActionHash = strings.ToLower(strings.TrimSpace(p.ActionHash))
		p.ManifestHash = strings.ToLower(strings.TrimSpace(p.ManifestHash))
		p.Outcome = strings.ToLower(strings.TrimSpace(p.Outcome))
		p.StateRoot = strings.ToLower(strings.TrimSpace(p.StateRoot))
		p.EvidenceHash = strings.ToLower(strings.TrimSpace(p.EvidenceHash))
		p.RollbackManifest = strings.ToLower(strings.TrimSpace(p.RollbackManifest))
		if !validGovernanceHash(p.ProposalID) || !validGovernanceTxHash(p.BeginTxHash) || !validGovernanceHash(p.ActionHash) ||
			!validGovernanceHash(p.ManifestHash) || !validGovernanceHash(p.StateRoot) || !validGovernanceHash(p.EvidenceHash) {
			return nil, errors.New("governance execution verification requires canonical sha256 bindings")
		}
		if p.Outcome != "verified" && p.Outcome != "failed" && p.Outcome != "rolled_back" {
			return nil, errors.New("governance execution verification outcome is invalid")
		}
		if (p.Outcome == "rolled_back") != validGovernanceHash(p.RollbackManifest) {
			return nil, errors.New("rollback outcome requires exactly one rollback manifest hash")
		}
		return json.Marshal(p)
	default:
		return nil, errors.New("unsupported protocol governance action")
	}
}

func (a *Application) applyProtocolGovernanceAction(state executionState, raw []byte, tx SignedApplicationAction, height int64, blockTime time.Time, validationOnly bool) (executionState, transactionExecution, error) {
	if err := a.chargeApplicationAction(&state, tx); err != nil {
		return executionState{}, transactionExecution{}, err
	}
	txHash := ApplicationActionHash(raw)
	status := ""
	switch tx.Action {
	case ActionGovernanceExecutionBegin:
		var p GovernanceExecutionBeginPayload
		_ = json.Unmarshal(tx.Payload, &p)
		if _, exists := governanceExecutionIndex(state.governanceExecutions, p.ProposalID); exists {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("governance proposal execution is already committed"))
		}
		if !validationOnly && (blockTime.Before(p.EarliestExecution) || blockTime.After(p.LatestExecution)) {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("governance execution is outside its signed timelock window"))
		}
		record := BFTGovernanceExecution{
			ProposalID: p.ProposalID, ActionHash: p.ActionHash, ManifestHash: p.ManifestHash,
			GovernanceAuditHash: p.GovernanceAuditHash, TimelockAuditHash: p.TimelockAuditHash,
			CanaryAuditHash: p.CanaryAuditHash, EvidenceHash: p.EvidenceHash, Scope: p.Scope,
			Signer: tx.Signer, Status: "submitted", EarliestExecution: p.EarliestExecution,
			LatestExecution: p.LatestExecution, SubmittedAt: blockTime, SubmittedHeight: height, BeginTxHash: txHash,
		}
		record.AuditHash = governanceExecutionHash(record)
		state.governanceExecutions = insertGovernanceExecution(state.governanceExecutions, record)
		status = record.Status
	case ActionGovernanceExecutionVerify:
		var p GovernanceExecutionVerifyPayload
		_ = json.Unmarshal(tx.Payload, &p)
		index, ok := governanceExecutionIndex(state.governanceExecutions, p.ProposalID)
		if !ok {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("governance execution begin record not found"))
		}
		record := state.governanceExecutions[index]
		if record.Status == "failed" && p.Outcome == "rolled_back" && !hasGovernanceFailureEvidence(record) && hasLegacyGovernanceTerminalEvidence(record) {
			record.FailedAt, record.FailedHeight = record.VerifiedAt, record.VerifiedHeight
			record.FailureTxHash, record.FailureStateRoot, record.FailureEvidenceHash = record.VerifyTxHash, record.StateRoot, record.EvidenceHash
			record.VerifiedAt, record.VerifiedHeight, record.VerifyTxHash = nil, 0, ""
			record.StateRoot, record.OutcomeEvidenceHash = "", ""
		}
		validTransition := record.Status == "submitted" && (p.Outcome == "verified" || p.Outcome == "failed") ||
			record.Status == "failed" && p.Outcome == "rolled_back"
		if !validTransition || record.Signer != tx.Signer || record.BeginTxHash != p.BeginTxHash ||
			record.ActionHash != p.ActionHash || record.ManifestHash != p.ManifestHash {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("governance execution verification does not match its immutable begin binding"))
		}
		previousHeight := record.SubmittedHeight
		if record.Status == "failed" {
			previousHeight = record.FailedHeight
		}
		if !validationOnly && height <= previousHeight {
			return executionState{}, transactionExecution{}, invalidTransaction(CodeInvalidTx, errors.New("governance execution verification requires a later committed block"))
		}
		record.Status = p.Outcome
		if p.Outcome == "failed" {
			record.FailedAt, record.FailedHeight = timePointer(blockTime), height
			record.FailureTxHash, record.FailureStateRoot, record.FailureEvidenceHash = txHash, p.StateRoot, p.EvidenceHash
		} else {
			record.StateRoot, record.OutcomeEvidenceHash = p.StateRoot, p.EvidenceHash
			record.RollbackManifest, record.VerifiedAt = p.RollbackManifest, timePointer(blockTime)
			record.VerifiedHeight, record.VerifyTxHash = height, txHash
		}
		record.AuditHash = governanceExecutionHash(record)
		state.governanceExecutions[index] = record
		status = record.Status
	}
	previous := ""
	if len(state.governanceExecutionAudit) > 0 {
		previous = state.governanceExecutionAudit[len(state.governanceExecutionAudit)-1].AuditHash
	}
	event := BFTGovernanceExecutionAudit{
		Sequence:   uint64(len(state.governanceExecutionAudit) + 1),
		ID:         ApplicationActionRecordID("governance-execution-audit", txHash),
		ProposalID: governanceProposalID(tx.Payload), Action: tx.Action, Status: status, Signer: tx.Signer,
		PreviousHash: previous, BlockHeight: height, CreatedAt: blockTime, TxHash: txHash,
	}
	event.AuditHash = governanceExecutionAuditHash(event)
	state.governanceExecutionAudit = append(state.governanceExecutionAudit, event)
	return state, transactionExecution{typeName: tx.Type, event: abcitypes.Event{Type: "ynx.governance_execution", Attributes: []abcitypes.EventAttribute{
		{Key: "proposal_id", Value: event.ProposalID, Index: true}, {Key: "action", Value: tx.Action, Index: true},
		{Key: "status", Value: status, Index: true}, {Key: "signer", Value: tx.Signer, Index: true},
	}}}, nil
}

func governanceProposalID(raw []byte) string {
	var value struct {
		ProposalID string `json:"proposalId"`
	}
	_ = json.Unmarshal(raw, &value)
	return value.ProposalID
}

func validGovernanceHash(value string) bool { return payHashPattern.MatchString(value) }
func validGovernanceTxHash(value string) bool {
	return len(value) == 66 && strings.HasPrefix(value, "0x") && validGovernanceHash(value[2:])
}

func governanceExecutionHash(value BFTGovernanceExecution) string {
	value.AuditHash = ""
	return recordAuditHash("YNX_GOVERNANCE_EXECUTION_V1", value)
}

func governanceExecutionAuditHash(value BFTGovernanceExecutionAudit) string {
	value.AuditHash = ""
	return recordAuditHash("YNX_GOVERNANCE_EXECUTION_AUDIT_V1", value)
}

func governanceExecutionIndex(values []BFTGovernanceExecution, proposalID string) (int, bool) {
	index := sort.Search(len(values), func(i int) bool { return values[i].ProposalID >= proposalID })
	return index, index < len(values) && values[index].ProposalID == proposalID
}

func insertGovernanceExecution(values []BFTGovernanceExecution, value BFTGovernanceExecution) []BFTGovernanceExecution {
	index, _ := governanceExecutionIndex(values, value.ProposalID)
	values = append(values, BFTGovernanceExecution{})
	copy(values[index+1:], values[index:])
	values[index] = value
	return values
}

func validateGovernanceExecutionCommittedState(state CommittedState) error {
	previousID := ""
	for _, value := range state.GovernanceExecutions {
		if !validGovernanceHash(value.ProposalID) || previousID != "" && value.ProposalID <= previousID ||
			!validGovernanceHash(value.ActionHash) || !validGovernanceHash(value.ManifestHash) ||
			!validGovernanceHash(value.GovernanceAuditHash) || !validGovernanceHash(value.TimelockAuditHash) ||
			!validGovernanceHash(value.CanaryAuditHash) || !validGovernanceHash(value.EvidenceHash) ||
			!IsNativeAddress(value.Signer) || value.Scope == "" || value.SubmittedHeight <= 0 ||
			value.SubmittedAt.IsZero() || !value.LatestExecution.After(value.EarliestExecution) ||
			!validGovernanceTxHash(value.BeginTxHash) || value.AuditHash != governanceExecutionHash(value) {
			return errors.New("committed governance execution is incomplete, unsorted, or tampered")
		}
		if value.Status == "submitted" {
			if hasGovernanceSuccessEvidence(value) || hasGovernanceFailureEvidence(value) || hasLegacyGovernanceTerminalEvidence(value) {
				return errors.New("submitted governance execution contains terminal evidence")
			}
		} else if value.Status == "verified" {
			if (!hasGovernanceSuccessEvidence(value) && !hasLegacyGovernanceTerminalEvidence(value)) || hasGovernanceFailureEvidence(value) || value.RollbackManifest != "" {
				return errors.New("verified governance execution evidence is incomplete")
			}
		} else if value.Status == "failed" {
			if (!hasGovernanceFailureEvidence(value) && !hasLegacyGovernanceTerminalEvidence(value)) || hasGovernanceSuccessEvidence(value) || value.RollbackManifest != "" {
				return errors.New("failed governance execution evidence is incomplete")
			}
		} else if value.Status == "rolled_back" {
			legacy := hasLegacyGovernanceTerminalEvidence(value) && validGovernanceHash(value.RollbackManifest)
			current := hasGovernanceFailureEvidence(value) && hasGovernanceSuccessEvidence(value) &&
				validGovernanceHash(value.RollbackManifest) && value.VerifiedHeight > value.FailedHeight
			if !legacy && !current {
				return errors.New("rolled-back governance execution evidence is incomplete")
			}
		} else {
			return errors.New("committed governance execution status is invalid")
		}
		previousID = value.ProposalID
	}
	previousHash := ""
	for i, value := range state.GovernanceExecutionAudit {
		if value.Sequence != uint64(i+1) || value.ID == "" || !validGovernanceHash(value.ProposalID) ||
			!isProtocolGovernanceAction(value.Action) || !IsNativeAddress(value.Signer) || value.PreviousHash != previousHash ||
			value.BlockHeight <= 0 || value.CreatedAt.IsZero() || !validGovernanceTxHash(value.TxHash) ||
			value.AuditHash != governanceExecutionAuditHash(value) {
			return fmt.Errorf("committed governance execution audit event %d is incomplete or tampered", i+1)
		}
		previousHash = value.AuditHash
	}
	return nil
}

func hasGovernanceSuccessEvidence(value BFTGovernanceExecution) bool {
	return value.VerifiedAt != nil && value.VerifiedHeight > value.SubmittedHeight &&
		validGovernanceTxHash(value.VerifyTxHash) && validGovernanceHash(value.StateRoot) &&
		validGovernanceHash(value.OutcomeEvidenceHash)
}

func hasGovernanceFailureEvidence(value BFTGovernanceExecution) bool {
	return value.FailedAt != nil && value.FailedHeight > value.SubmittedHeight &&
		validGovernanceTxHash(value.FailureTxHash) && validGovernanceHash(value.FailureStateRoot) &&
		validGovernanceHash(value.FailureEvidenceHash)
}

func hasLegacyGovernanceTerminalEvidence(value BFTGovernanceExecution) bool {
	return value.OutcomeEvidenceHash == "" && value.FailedAt == nil && value.FailedHeight == 0 &&
		value.FailureTxHash == "" && value.FailureStateRoot == "" && value.FailureEvidenceHash == "" &&
		value.VerifiedAt != nil && value.VerifiedHeight > value.SubmittedHeight &&
		validGovernanceTxHash(value.VerifyTxHash) && validGovernanceHash(value.StateRoot)
}
