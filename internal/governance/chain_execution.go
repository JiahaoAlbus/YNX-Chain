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
}

type ChainExecutionOwner interface {
	Submit(context.Context, consensus.GovernanceExecutionBeginPayload, json.RawMessage) (consensus.BFTGovernanceExecution, error)
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

func (s *Service) ConfirmChainExecution(id string, intent consensus.GovernanceExecutionBeginPayload, record consensus.BFTGovernanceExecution, now time.Time) (Proposal, error) {
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
