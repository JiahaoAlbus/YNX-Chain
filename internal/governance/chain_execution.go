package governance

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

type ChainExecutionClient interface {
	GovernanceExecution(context.Context, string) (consensus.BFTGovernanceExecution, bool, error)
	BroadcastGovernanceAction(context.Context, []byte) error
	GovernanceBlockHash(context.Context, int64) (string, error)
}

type ChainExecutionOwner interface {
	Submit(context.Context, consensus.GovernanceExecutionBeginPayload, json.RawMessage) (consensus.BFTGovernanceExecution, error)
	Verify(context.Context, consensus.GovernanceExecutionVerifyPayload, json.RawMessage) (consensus.BFTGovernanceExecution, string, error)
}

func (a *CanonicalChainExecutionAdapter) Verify(ctx context.Context, intent consensus.GovernanceExecutionVerifyPayload, signedAction json.RawMessage) (consensus.BFTGovernanceExecution, string, error) {
	if a == nil || a.client == nil {
		return consensus.BFTGovernanceExecution{}, "", errors.New("canonical Chain Core execution adapter is unavailable")
	}
	tx, err := consensus.DecodeSignedApplicationAction(signedAction)
	if err != nil || tx.Verify(a.chainID) != nil || tx.Action != consensus.ActionGovernanceExecutionVerify || tx.Signer != a.signer {
		return consensus.BFTGovernanceExecution{}, "", fmt.Errorf("%w: signed Chain Core verification action is invalid or unauthorized", ErrForbidden)
	}
	expected, err := json.Marshal(intent)
	if err != nil || !bytes.Equal(tx.Payload, expected) {
		return consensus.BFTGovernanceExecution{}, "", fmt.Errorf("%w: signed Chain Core verification does not match the prepared intent", ErrForbidden)
	}
	record, found, err := a.client.GovernanceExecution(ctx, intent.ProposalID)
	if err != nil {
		return consensus.BFTGovernanceExecution{}, "", fmt.Errorf("query canonical Chain Core execution: %w", err)
	}
	if !found {
		return consensus.BFTGovernanceExecution{}, "", fmt.Errorf("%w: canonical Chain Core execution begin record is missing", ErrForbidden)
	}
	if canonicalVerificationComplete(record, intent) {
		if err = validateCanonicalVerificationRecord(record, intent, "", a.signer); err != nil {
			return consensus.BFTGovernanceExecution{}, "", err
		}
		return a.verificationWithBlock(ctx, record, intent)
	}
	if !canonicalVerificationPending(record, intent) {
		return consensus.BFTGovernanceExecution{}, "", fmt.Errorf("%w: canonical Chain Core execution is in a conflicting terminal state", ErrForbidden)
	}
	if err = a.client.BroadcastGovernanceAction(ctx, signedAction); err != nil {
		return consensus.BFTGovernanceExecution{}, "", fmt.Errorf("broadcast canonical Chain Core verification: %w", err)
	}
	record, found, err = a.client.GovernanceExecution(ctx, intent.ProposalID)
	if err != nil {
		return consensus.BFTGovernanceExecution{}, "", fmt.Errorf("confirm canonical Chain Core verification: %w", err)
	}
	if !found || validateCanonicalVerificationRecord(record, intent, consensus.ApplicationActionHash(signedAction), a.signer) != nil {
		return consensus.BFTGovernanceExecution{}, "", fmt.Errorf("%w: canonical Chain Core did not commit the exact verification intent", ErrForbidden)
	}
	return a.verificationWithBlock(ctx, record, intent)
}

func (a *CanonicalChainExecutionAdapter) verificationWithBlock(ctx context.Context, record consensus.BFTGovernanceExecution, intent consensus.GovernanceExecutionVerifyPayload) (consensus.BFTGovernanceExecution, string, error) {
	height := record.VerifiedHeight
	if intent.Outcome == "failed" {
		height = record.FailedHeight
	}
	blockHash, err := a.client.GovernanceBlockHash(ctx, height)
	if err != nil {
		return consensus.BFTGovernanceExecution{}, "", fmt.Errorf("query canonical verification block: %w", err)
	}
	if !validCanonicalChainTxHash(blockHash) {
		return consensus.BFTGovernanceExecution{}, "", fmt.Errorf("%w: canonical verification block hash is invalid", ErrForbidden)
	}
	return record, blockHash, nil
}

func canonicalVerificationPending(record consensus.BFTGovernanceExecution, intent consensus.GovernanceExecutionVerifyPayload) bool {
	return record.ProposalID == intent.ProposalID && record.BeginTxHash == intent.BeginTxHash &&
		record.ActionHash == intent.ActionHash && record.ManifestHash == intent.ManifestHash &&
		(record.Status == "submitted" && (intent.Outcome == "verified" || intent.Outcome == "failed") ||
			record.Status == "failed" && intent.Outcome == "rolled_back")
}

func canonicalVerificationComplete(record consensus.BFTGovernanceExecution, intent consensus.GovernanceExecutionVerifyPayload) bool {
	return record.Status == intent.Outcome && (intent.Outcome == "verified" || intent.Outcome == "failed" || intent.Outcome == "rolled_back")
}

func validateCanonicalVerificationRecord(record consensus.BFTGovernanceExecution, intent consensus.GovernanceExecutionVerifyPayload, txHash, signer string) error {
	if record.ProposalID != intent.ProposalID || record.BeginTxHash != intent.BeginTxHash ||
		record.ActionHash != intent.ActionHash || record.ManifestHash != intent.ManifestHash ||
		record.Signer != signer || !consensus.IsNativeAddress(record.Signer) || record.Status != intent.Outcome {
		return ErrForbidden
	}
	switch intent.Outcome {
	case "verified":
		if record.StateRoot != intent.StateRoot || record.OutcomeEvidenceHash != intent.EvidenceHash ||
			record.RollbackManifest != "" || record.VerifiedAt == nil || record.VerifiedHeight <= record.SubmittedHeight ||
			!validCanonicalChainTxHash(record.VerifyTxHash) || txHash != "" && record.VerifyTxHash != txHash {
			return ErrForbidden
		}
	case "failed":
		if record.FailureStateRoot != intent.StateRoot || record.FailureEvidenceHash != intent.EvidenceHash ||
			record.FailedAt == nil || record.FailedHeight <= record.SubmittedHeight ||
			!validCanonicalChainTxHash(record.FailureTxHash) || txHash != "" && record.FailureTxHash != txHash {
			return ErrForbidden
		}
	case "rolled_back":
		if record.StateRoot != intent.StateRoot || record.OutcomeEvidenceHash != intent.EvidenceHash ||
			record.RollbackManifest != intent.RollbackManifest || record.VerifiedAt == nil ||
			record.VerifiedHeight <= record.FailedHeight || !validCanonicalChainTxHash(record.VerifyTxHash) ||
			!validCanonicalChainTxHash(record.FailureTxHash) || txHash != "" && record.VerifyTxHash != txHash {
			return ErrForbidden
		}
	default:
		return ErrForbidden
	}
	if !validHash(record.AuditHash) {
		return ErrForbidden
	}
	return nil
}

// CanonicalChainExecutionAdapter verifies an externally signed Chain Core
// action, reconciles an existing commit before broadcasting, and accepts only
// a canonical post-commit record with the exact governance bindings.
type CanonicalChainExecutionAdapter struct {
	chainID int64
	signer  string
	client  ChainExecutionClient
}

func NewCanonicalChainExecutionAdapter(chainID int64, signer string, client ChainExecutionClient) (*CanonicalChainExecutionAdapter, error) {
	signer = strings.TrimSpace(signer)
	if chainID <= 0 || !consensus.IsNativeAddress(signer) || client == nil {
		return nil, ErrInvalid
	}
	return &CanonicalChainExecutionAdapter{chainID: chainID, signer: signer, client: client}, nil
}

func (a *CanonicalChainExecutionAdapter) Submit(ctx context.Context, intent consensus.GovernanceExecutionBeginPayload, signedAction json.RawMessage) (consensus.BFTGovernanceExecution, error) {
	if a == nil || a.client == nil {
		return consensus.BFTGovernanceExecution{}, errors.New("canonical Chain Core execution adapter is unavailable")
	}
	tx, err := consensus.DecodeSignedApplicationAction(signedAction)
	if err != nil || tx.Verify(a.chainID) != nil || tx.Action != consensus.ActionGovernanceExecutionBegin || tx.Signer != a.signer {
		return consensus.BFTGovernanceExecution{}, fmt.Errorf("%w: signed Chain Core execution action is invalid or unauthorized", ErrForbidden)
	}
	expected, err := json.Marshal(intent)
	if err != nil || !bytes.Equal(tx.Payload, expected) {
		return consensus.BFTGovernanceExecution{}, fmt.Errorf("%w: signed Chain Core action does not match the prepared governance intent", ErrForbidden)
	}
	record, found, err := a.client.GovernanceExecution(ctx, intent.ProposalID)
	if err != nil {
		return consensus.BFTGovernanceExecution{}, fmt.Errorf("query canonical Chain Core execution: %w", err)
	}
	if found {
		if err = validateCanonicalExecutionRecord(record, intent, "", a.signer); err != nil {
			return consensus.BFTGovernanceExecution{}, fmt.Errorf("%w: existing Chain Core execution conflicts with the prepared governance intent", ErrForbidden)
		}
		return record, nil
	}
	if !found {
		if err = a.client.BroadcastGovernanceAction(ctx, signedAction); err != nil {
			return consensus.BFTGovernanceExecution{}, fmt.Errorf("broadcast canonical Chain Core execution: %w", err)
		}
		record, found, err = a.client.GovernanceExecution(ctx, intent.ProposalID)
		if err != nil {
			return consensus.BFTGovernanceExecution{}, fmt.Errorf("confirm canonical Chain Core execution: %w", err)
		}
	}
	if !found || validateCanonicalExecutionRecord(record, intent, consensus.ApplicationActionHash(signedAction), a.signer) != nil {
		return consensus.BFTGovernanceExecution{}, fmt.Errorf("%w: canonical Chain Core did not commit the exact prepared governance intent", ErrForbidden)
	}
	return record, nil
}

func validateCanonicalExecutionRecord(record consensus.BFTGovernanceExecution, intent consensus.GovernanceExecutionBeginPayload, txHash, signer string) error {
	if record.ProposalID != intent.ProposalID || record.ActionHash != intent.ActionHash || record.ManifestHash != intent.ManifestHash ||
		record.GovernanceAuditHash != intent.GovernanceAuditHash || record.TimelockAuditHash != intent.TimelockAuditHash ||
		record.CanaryAuditHash != intent.CanaryAuditHash || record.EvidenceHash != intent.EvidenceHash ||
		record.Scope != intent.Scope || record.EarliestExecution != intent.EarliestExecution ||
		record.LatestExecution != intent.LatestExecution || record.Signer != signer || !consensus.IsNativeAddress(record.Signer) || record.Status != "submitted" ||
		(txHash != "" && record.BeginTxHash != txHash) || !validCanonicalChainTxHash(record.BeginTxHash) ||
		record.SubmittedHeight <= 0 || record.SubmittedAt.Before(intent.EarliestExecution) ||
		record.SubmittedAt.After(intent.LatestExecution) || !validHash(record.AuditHash) {
		return ErrForbidden
	}
	return nil
}

func (s *Service) PrepareChainExecution(id, manifestHash string, now time.Time) (consensus.GovernanceExecutionBeginPayload, Proposal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	proposal, timelock, canary, err := s.prepareExecutionLocked(id, manifestHash, now.UTC())
	if err != nil {
		return consensus.GovernanceExecutionBeginPayload{}, Proposal{}, err
	}
	intent, err := chainExecutionIntent(proposal, timelock, canary)
	if err != nil {
		return consensus.GovernanceExecutionBeginPayload{}, Proposal{}, err
	}
	return intent, clone(proposal), nil
}

func (s *Service) confirmChainExecution(id string, intent consensus.GovernanceExecutionBeginPayload, record consensus.BFTGovernanceExecution, now time.Time) (Proposal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	proposal, ok := s.proposals[id]
	if !ok {
		return Proposal{}, ErrNotFound
	}
	timelock := s.timelocks[id]
	canary := s.canaries[id]
	if timelock == nil || canary == nil || proposal.Status != StatusExecutionReady || timelock.Status != TimelockExecutionReady {
		return Proposal{}, ErrNotReady
	}
	expected, err := chainExecutionIntent(proposal, timelock, canary)
	if err != nil {
		return Proposal{}, err
	}
	expectedJSON, _ := json.Marshal(expected)
	actualJSON, _ := json.Marshal(intent)
	if !bytes.Equal(expectedJSON, actualJSON) || validateCanonicalExecutionRecord(record, intent, "", record.Signer) != nil {
		return Proposal{}, fmt.Errorf("%w: Chain Core execution confirmation does not match the reserved governance action", ErrForbidden)
	}
	evidence := []string{"execution-tx://" + record.BeginTxHash, "execution-audit://" + record.AuditHash}
	if err = s.markExecutionSubmittedLocked(proposal, timelock, evidence, now.UTC()); err != nil {
		return Proposal{}, err
	}
	return clone(proposal), nil
}

func validCanonicalChainTxHash(value string) bool {
	return len(value) == 66 && strings.HasPrefix(value, "0x") && validHash(value[2:])
}

func chainExecutionIntent(proposal *Proposal, timelock *TimelockRecord, canary *CanaryRecord) (consensus.GovernanceExecutionBeginPayload, error) {
	if proposal == nil || timelock == nil || canary == nil || proposal.Status != StatusExecutionReady ||
		timelock.Status != TimelockExecutionReady || canary.Status != CanaryPassed ||
		len(proposal.Transitions) == 0 || !validHash(proposal.ExecutionHash) ||
		!validHash(timelock.AuditHash) || !validHash(canary.AuditHash) {
		return consensus.GovernanceExecutionBeginPayload{}, ErrNotReady
	}
	governanceAudit := proposal.Transitions[len(proposal.Transitions)-1].AuditHash
	if !validHash(governanceAudit) {
		return consensus.GovernanceExecutionBeginPayload{}, ErrForbidden
	}
	evidenceHash := hash("chain-execution-intent", proposal.ID, proposal.ActionHash, proposal.ExecutionHash, governanceAudit, timelock.AuditHash, canary.AuditHash)
	return consensus.GovernanceExecutionBeginPayload{
		ProposalID: proposal.ID, ActionHash: proposal.ActionHash, ManifestHash: proposal.ExecutionHash,
		GovernanceAuditHash: governanceAudit, TimelockAuditHash: timelock.AuditHash,
		CanaryAuditHash: canary.AuditHash, EvidenceHash: evidenceHash, Scope: string(proposal.Input.Scope),
		EarliestExecution: timelock.EarliestExecution.UTC(), LatestExecution: timelock.GraceEndsAt.UTC(),
	}, nil
}

func (s *Service) PrepareChainVerification(id, outcome, stateRoot, evidenceHash string) (consensus.GovernanceExecutionVerifyPayload, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	proposal := s.proposals[id]
	timelock := s.timelocks[id]
	if proposal == nil || timelock == nil || !validHash(strings.ToLower(strings.TrimSpace(stateRoot))) ||
		!validHash(strings.ToLower(strings.TrimSpace(evidenceHash))) {
		return consensus.GovernanceExecutionVerifyPayload{}, ErrInvalid
	}
	outcome = strings.ToLower(strings.TrimSpace(outcome))
	if outcome == "rolled_back" {
		if proposal.Status != StatusExecutionFailed || timelock.Status != TimelockFailed {
			return consensus.GovernanceExecutionVerifyPayload{}, ErrNotReady
		}
	} else if outcome == "verified" || outcome == "failed" {
		if proposal.Status != StatusExecutionSubmitted || timelock.Status != TimelockSubmitted {
			return consensus.GovernanceExecutionVerifyPayload{}, ErrNotReady
		}
	} else {
		return consensus.GovernanceExecutionVerifyPayload{}, ErrInvalid
	}
	beginTxHash, err := chainSubmissionTxHash(timelock)
	if err != nil {
		return consensus.GovernanceExecutionVerifyPayload{}, err
	}
	intent := consensus.GovernanceExecutionVerifyPayload{
		ProposalID: proposal.ID, BeginTxHash: beginTxHash, ActionHash: proposal.ActionHash,
		ManifestHash: proposal.ExecutionHash, Outcome: outcome,
		StateRoot: strings.ToLower(stateRoot), EvidenceHash: strings.ToLower(evidenceHash),
	}
	if outcome == "rolled_back" {
		intent.RollbackManifest = expectedRollbackManifestHash(proposal)
	}
	return intent, nil
}

func (s *Service) confirmChainVerification(id string, intent consensus.GovernanceExecutionVerifyPayload, record consensus.BFTGovernanceExecution, blockHash string, now time.Time) (Proposal, error) {
	expected, err := s.PrepareChainVerification(id, intent.Outcome, intent.StateRoot, intent.EvidenceHash)
	if err != nil {
		return Proposal{}, err
	}
	expectedJSON, _ := json.Marshal(expected)
	actualJSON, _ := json.Marshal(intent)
	if !bytes.Equal(expectedJSON, actualJSON) || validateCanonicalVerificationRecord(record, intent, "", record.Signer) != nil {
		return Proposal{}, fmt.Errorf("%w: Chain Core verification confirmation does not match governance state", ErrForbidden)
	}
	receipt, err := executionReceiptFromCanonical(record, blockHash, intent.Outcome)
	if err != nil {
		return Proposal{}, err
	}
	if intent.Outcome == "rolled_back" {
		return s.verifyRollbackReceipt(id, receipt, now)
	}
	return s.verifyExecutionReceipt(id, receipt, nil, now)
}

func chainSubmissionTxHash(record *TimelockRecord) (string, error) {
	if record == nil {
		return "", ErrNotFound
	}
	for i := len(record.Transitions) - 1; i >= 0; i-- {
		if record.Transitions[i].To != TimelockSubmitted {
			continue
		}
		for _, evidence := range record.Transitions[i].Evidence {
			if value := strings.TrimPrefix(evidence, "execution-tx://"); value != evidence && validCanonicalChainTxHash(value) {
				return value, nil
			}
		}
		return "", fmt.Errorf("%w: submitted execution lacks canonical Chain Core transaction evidence", ErrForbidden)
	}
	return "", fmt.Errorf("%w: canonical Chain Core submission transition is missing", ErrForbidden)
}

func expectedRollbackManifestHash(proposal *Proposal) string {
	if proposal == nil {
		return ""
	}
	return hash("governance-rollback-manifest", proposal.ID, proposal.ActionHash, hash(proposal.Input.Rollback))
}

func executionReceiptFromCanonical(record consensus.BFTGovernanceExecution, blockHash, outcome string) (ExecutionReceipt, error) {
	if !validCanonicalChainTxHash(blockHash) {
		return ExecutionReceipt{}, fmt.Errorf("%w: canonical verification block hash is invalid", ErrForbidden)
	}
	var txHash, stateRoot, manifest, receiptOutcome string
	var height int64
	var asOf time.Time
	switch outcome {
	case "verified":
		txHash, height, stateRoot, manifest, receiptOutcome = record.VerifyTxHash, record.VerifiedHeight, record.StateRoot, record.ManifestHash, "verified"
		if record.VerifiedAt != nil {
			asOf = *record.VerifiedAt
		}
	case "failed":
		txHash, height, stateRoot, manifest, receiptOutcome = record.FailureTxHash, record.FailedHeight, record.FailureStateRoot, record.ManifestHash, "failed"
		if record.FailedAt != nil {
			asOf = *record.FailedAt
		}
	case "rolled_back":
		txHash, height, stateRoot, manifest, receiptOutcome = record.VerifyTxHash, record.VerifiedHeight, record.StateRoot, record.RollbackManifest, "verified_rollback"
		if record.VerifiedAt != nil {
			asOf = *record.VerifiedAt
		}
	default:
		return ExecutionReceipt{}, ErrInvalid
	}
	if height <= 0 || !validCanonicalChainTxHash(txHash) || !validHash(stateRoot) || !validHash(manifest) || asOf.IsZero() {
		return ExecutionReceipt{}, fmt.Errorf("%w: canonical execution record cannot produce a complete receipt", ErrForbidden)
	}
	receipt := NewExecutionReceipt(txHash, uint64(height), blockHash, stateRoot, manifest, receiptOutcome, asOf)
	if err := validateExecutionReceipt(receipt, manifest); err != nil {
		return ExecutionReceipt{}, err
	}
	return receipt, nil
}
