package governance

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

type UpgradeStatus string

const (
	UpgradeRegistered      UpgradeStatus = "registered"
	UpgradeRejected        UpgradeStatus = "rejected"
	UpgradeCancelled       UpgradeStatus = "cancelled"
	UpgradeExpired         UpgradeStatus = "expired"
	UpgradeTimelocked      UpgradeStatus = "timelocked"
	UpgradeEmergencyPaused UpgradeStatus = "emergency_paused"
	UpgradeCorrected       UpgradeStatus = "corrected"
	UpgradeSubmitted       UpgradeStatus = "execution_submitted"
	UpgradeVerified        UpgradeStatus = "verified"
	UpgradeFailed          UpgradeStatus = "failed"
	UpgradeRolledBack      UpgradeStatus = "rolled_back"
)

type UpgradeTransition struct {
	Sequence  uint64        `json:"sequence"`
	From      UpgradeStatus `json:"from,omitempty"`
	To        UpgradeStatus `json:"to"`
	Actor     string        `json:"actor"`
	Reason    string        `json:"reason"`
	Evidence  []string      `json:"evidence"`
	At        time.Time     `json:"at"`
	Previous  string        `json:"previousAuditHash,omitempty"`
	AuditHash string        `json:"auditHash"`
}

type UpgradeRecord struct {
	ID                      string              `json:"id"`
	ProposalID              string              `json:"proposalId"`
	ProposalType            string              `json:"proposalType"`
	Scope                   Scope               `json:"scope"`
	ActionHash              string              `json:"actionHash"`
	SourceCommit            string              `json:"sourceCommit"`
	Release                 string              `json:"release"`
	ManifestHash            string              `json:"manifestHash"`
	Migration               string              `json:"migration"`
	MigrationHash           string              `json:"migrationHash"`
	Rollback                string              `json:"rollback"`
	RollbackPlanHash        string              `json:"rollbackPlanHash"`
	CanaryPlan              string              `json:"canaryPlan"`
	CanaryPlanHash          string              `json:"canaryPlanHash"`
	VerificationPlan        string              `json:"verificationPlan"`
	VerificationPlanHash    string              `json:"verificationPlanHash"`
	CanaryRequired          bool                `json:"canaryRequired"`
	CanaryEligible          bool                `json:"canaryEligible"`
	CanaryStatus            string              `json:"canaryStatus"`
	CanaryRecordID          string              `json:"canaryRecordId,omitempty"`
	CanaryAuditHash         string              `json:"canaryAuditHash,omitempty"`
	Status                  UpgradeStatus       `json:"status"`
	RegisteredAt            time.Time           `json:"registeredAt"`
	ExecutionManifestHash   string              `json:"executionManifestHash,omitempty"`
	ExecutionReceiptAuditID string              `json:"executionReceiptAuditId,omitempty"`
	RollbackManifestHash    string              `json:"rollbackManifestHash,omitempty"`
	RollbackReceiptAuditID  string              `json:"rollbackReceiptAuditId,omitempty"`
	Transitions             []UpgradeTransition `json:"transitions"`
	AuditHash               string              `json:"auditHash"`
}

var upgradeTransitions = map[UpgradeStatus]map[UpgradeStatus]bool{
	"":                     {UpgradeRegistered: true},
	UpgradeRegistered:      {UpgradeRejected: true, UpgradeCancelled: true, UpgradeExpired: true, UpgradeTimelocked: true, UpgradeEmergencyPaused: true},
	UpgradeTimelocked:      {UpgradeCancelled: true, UpgradeExpired: true, UpgradeEmergencyPaused: true, UpgradeSubmitted: true},
	UpgradeEmergencyPaused: {UpgradeCorrected: true, UpgradeCancelled: true, UpgradeExpired: true},
	UpgradeSubmitted:       {UpgradeVerified: true, UpgradeFailed: true, UpgradeEmergencyPaused: true},
	UpgradeFailed:          {UpgradeRolledBack: true},
}

func isUpgradeProposal(proposal *Proposal) bool {
	return proposal != nil && (proposal.Input.Scope == ScopeProtocolUpgrade || proposal.Input.Scope == ScopeConsensusUpgrade)
}

func (s *Service) createUpgradeLocked(proposal *Proposal, now time.Time) (*UpgradeRecord, error) {
	if !isUpgradeProposal(proposal) || !validHash(strings.ToLower(proposal.Input.SourceCommit)) || !validHash(strings.ToLower(proposal.Input.UpgradeHash)) ||
		len(strings.TrimSpace(proposal.Input.Release)) < 3 || len(strings.TrimSpace(proposal.Input.Migration)) < 16 ||
		len(strings.TrimSpace(proposal.Input.Rollback)) < 16 || len(strings.TrimSpace(proposal.Input.CanaryPlan)) < 16 || len(strings.TrimSpace(proposal.Input.VerificationPlan)) < 16 {
		return nil, ErrInvalid
	}
	for _, existing := range s.upgrades {
		if existing.ProposalID == proposal.ID {
			return nil, ErrReplay
		}
		if strings.EqualFold(existing.ManifestHash, proposal.Input.UpgradeHash) {
			return nil, fmt.Errorf("%w: upgrade manifest is already registered", ErrConflict)
		}
		if existing.SourceCommit == strings.ToLower(proposal.Input.SourceCommit) && existing.Release == proposal.Input.Release {
			return nil, fmt.Errorf("%w: release identity points to a different manifest", ErrConflict)
		}
		if existing.Scope == proposal.Input.Scope && !terminalUpgradeStatus(existing.Status) {
			return nil, fmt.Errorf("%w: another upgrade is active in this scope", ErrConflict)
		}
	}
	record := &UpgradeRecord{
		ID: hash("upgrade", proposal.ID, strings.ToLower(proposal.Input.UpgradeHash)), ProposalID: proposal.ID,
		ProposalType: proposal.Input.ProposalType, Scope: proposal.Input.Scope, ActionHash: proposal.ActionHash,
		SourceCommit: strings.ToLower(proposal.Input.SourceCommit), Release: proposal.Input.Release, ManifestHash: strings.ToLower(proposal.Input.UpgradeHash),
		Migration: proposal.Input.Migration, MigrationHash: hash("upgrade-migration", proposal.Input.Migration),
		Rollback: proposal.Input.Rollback, RollbackPlanHash: hash("upgrade-rollback", proposal.Input.Rollback),
		CanaryPlan: proposal.Input.CanaryPlan, CanaryPlanHash: hash("upgrade-canary", proposal.Input.CanaryPlan),
		VerificationPlan: proposal.Input.VerificationPlan, VerificationPlanHash: hash("upgrade-verification", proposal.Input.VerificationPlan),
		CanaryRequired: true, CanaryStatus: "not_started", RegisteredAt: now.UTC(),
	}
	if err := transitionUpgrade(record, UpgradeRegistered, proposal.Input.Proposer, "versioned upgrade source, manifest, migration, rollback, canary, and verification identity registered", proposal.Input.Evidence, now); err != nil {
		return nil, err
	}
	s.upgrades[proposal.ID] = record
	return record, nil
}

func (s *Service) transitionUpgradeLocked(proposal *Proposal, to UpgradeStatus, actor, reason string, evidence []string, now time.Time) error {
	if !isUpgradeProposal(proposal) {
		return nil
	}
	record, ok := s.upgrades[proposal.ID]
	if !ok {
		return fmt.Errorf("%w: first-class upgrade record missing", ErrForbidden)
	}
	previousEligible, previousStatus := record.CanaryEligible, record.CanaryStatus
	if to == UpgradeTimelocked {
		record.CanaryEligible = true
		record.CanaryStatus = "eligible_not_run"
	}
	if err := transitionUpgrade(record, to, actor, reason, evidence, now); err != nil {
		record.CanaryEligible, record.CanaryStatus = previousEligible, previousStatus
		return err
	}
	return nil
}

func (s *Service) ListUpgrades() []UpgradeRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]UpgradeRecord, 0, len(s.upgrades))
	for _, record := range s.upgrades {
		out = append(out, cloneUpgrade(record))
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].RegisteredAt.Equal(out[j].RegisteredAt) {
			return out[i].ID < out[j].ID
		}
		return out[i].RegisteredAt.Before(out[j].RegisteredAt)
	})
	return out
}

func transitionUpgrade(record *UpgradeRecord, to UpgradeStatus, actor, reason string, evidence []string, now time.Time) error {
	if record == nil || !upgradeTransitions[record.Status][to] || len(strings.TrimSpace(actor)) < 3 || len(strings.TrimSpace(reason)) < 16 || len(evidence) == 0 {
		return ErrInvalid
	}
	transition := UpgradeTransition{
		Sequence: uint64(len(record.Transitions) + 1), From: record.Status, To: to, Actor: strings.TrimSpace(actor),
		Reason: strings.TrimSpace(reason), Evidence: append([]string(nil), evidence...), At: now.UTC(),
	}
	if len(record.Transitions) > 0 {
		transition.Previous = record.Transitions[len(record.Transitions)-1].AuditHash
	}
	transition.AuditHash = upgradeTransitionAudit(record.ID, transition)
	record.Transitions = append(record.Transitions, transition)
	record.Status = to
	record.AuditHash = upgradeAudit(record)
	return nil
}

func upgradeTransitionAudit(id string, transition UpgradeTransition) string {
	return hash(id, fmt.Sprint(transition.Sequence), string(transition.From), string(transition.To), transition.Actor, transition.Reason,
		strings.Join(transition.Evidence, "|"), transition.At.Format(time.RFC3339Nano), transition.Previous)
}

func upgradeAudit(record *UpgradeRecord) string {
	parts := []string{
		record.ID, record.ProposalID, record.ProposalType, string(record.Scope), record.ActionHash, record.SourceCommit, record.Release,
		record.ManifestHash, record.Migration, record.MigrationHash, record.Rollback, record.RollbackPlanHash, record.CanaryPlan,
		record.CanaryPlanHash, record.VerificationPlan, record.VerificationPlanHash, fmt.Sprint(record.CanaryRequired),
		fmt.Sprint(record.CanaryEligible), record.CanaryStatus, record.CanaryRecordID, record.CanaryAuditHash, string(record.Status), record.RegisteredAt.Format(time.RFC3339Nano),
		record.ExecutionManifestHash, record.ExecutionReceiptAuditID, record.RollbackManifestHash, record.RollbackReceiptAuditID,
	}
	for _, transition := range record.Transitions {
		parts = append(parts, transition.AuditHash)
	}
	return hash(parts...)
}

func cloneUpgrade(record *UpgradeRecord) UpgradeRecord {
	out := *record
	out.Transitions = make([]UpgradeTransition, len(record.Transitions))
	for i, transition := range record.Transitions {
		out.Transitions[i] = transition
		out.Transitions[i].Evidence = append([]string(nil), transition.Evidence...)
	}
	return out
}

func terminalUpgradeStatus(status UpgradeStatus) bool {
	switch status {
	case UpgradeRejected, UpgradeCancelled, UpgradeExpired, UpgradeCorrected, UpgradeVerified, UpgradeRolledBack:
		return true
	default:
		return false
	}
}

func validateStoredUpgrade(record *UpgradeRecord, proposal *Proposal) error {
	if record == nil || !isUpgradeProposal(proposal) ||
		record.ID != hash("upgrade", proposal.ID, strings.ToLower(proposal.Input.UpgradeHash)) || record.ProposalID != proposal.ID ||
		record.ProposalType != proposal.Input.ProposalType || record.Scope != proposal.Input.Scope || record.ActionHash != proposal.ActionHash ||
		record.SourceCommit != strings.ToLower(proposal.Input.SourceCommit) || record.Release != proposal.Input.Release ||
		record.ManifestHash != strings.ToLower(proposal.Input.UpgradeHash) || record.Migration != proposal.Input.Migration ||
		record.MigrationHash != hash("upgrade-migration", proposal.Input.Migration) || record.Rollback != proposal.Input.Rollback ||
		record.RollbackPlanHash != hash("upgrade-rollback", proposal.Input.Rollback) || record.CanaryPlan != proposal.Input.CanaryPlan ||
		record.CanaryPlanHash != hash("upgrade-canary", proposal.Input.CanaryPlan) || record.VerificationPlan != proposal.Input.VerificationPlan ||
		record.VerificationPlanHash != hash("upgrade-verification", proposal.Input.VerificationPlan) || !record.CanaryRequired ||
		record.RegisteredAt.IsZero() || len(record.Transitions) == 0 {
		return fmt.Errorf("%w: invalid stored upgrade identity", ErrForbidden)
	}
	var status UpgradeStatus
	var previous string
	for index, transition := range record.Transitions {
		if transition.Sequence != uint64(index+1) || transition.From != status || !upgradeTransitions[status][transition.To] ||
			transition.Previous != previous || transition.AuditHash != upgradeTransitionAudit(record.ID, transition) ||
			(index > 0 && transition.At.Before(record.Transitions[index-1].At)) {
			return fmt.Errorf("%w: invalid upgrade transition history", ErrForbidden)
		}
		status, previous = transition.To, transition.AuditHash
	}
	if status != record.Status || record.AuditHash != upgradeAudit(record) {
		return fmt.Errorf("%w: upgrade audit mismatch", ErrForbidden)
	}
	if record.CanaryEligible != proposalReached(proposal, StatusTimelockPending) ||
		(record.CanaryEligible && (record.CanaryRecordID == "" || !validHash(record.CanaryAuditHash))) ||
		(!record.CanaryEligible && (record.CanaryStatus != "not_started" || record.CanaryRecordID != "" || record.CanaryAuditHash != "")) {
		return fmt.Errorf("%w: upgrade canary eligibility mismatch", ErrForbidden)
	}
	switch record.Status {
	case UpgradeRegistered:
		if proposal.Status == StatusRejected || proposal.Status == StatusQuorumFailed || proposal.Status == StatusThresholdFailed || proposal.Status == StatusCancelled || proposal.Status == StatusExpired || proposalReached(proposal, StatusTimelockPending) {
			return fmt.Errorf("%w: registered upgrade proposal status mismatch", ErrForbidden)
		}
	case UpgradeRejected:
		if !proposalReached(proposal, StatusRejected) && !proposalReached(proposal, StatusQuorumFailed) && !proposalReached(proposal, StatusThresholdFailed) {
			return fmt.Errorf("%w: rejected upgrade proposal status mismatch", ErrForbidden)
		}
	case UpgradeCancelled:
		if !proposalReached(proposal, StatusCancelled) {
			return fmt.Errorf("%w: cancelled upgrade proposal status mismatch", ErrForbidden)
		}
	case UpgradeExpired:
		if !proposalReached(proposal, StatusExpired) {
			return fmt.Errorf("%w: expired upgrade proposal status mismatch", ErrForbidden)
		}
	case UpgradeTimelocked:
		if proposal.Status != StatusTimelockActive {
			return fmt.Errorf("%w: timelocked upgrade proposal status mismatch", ErrForbidden)
		}
	case UpgradeEmergencyPaused:
		if proposal.Status != StatusEmergencyPaused {
			return fmt.Errorf("%w: paused upgrade proposal status mismatch", ErrForbidden)
		}
	case UpgradeCorrected:
		if !proposalReached(proposal, StatusCorrected) {
			return fmt.Errorf("%w: corrected upgrade proposal status mismatch", ErrForbidden)
		}
	case UpgradeSubmitted:
		if proposal.Status != StatusExecutionSubmitted || record.ExecutionManifestHash != proposal.ExecutionHash {
			return fmt.Errorf("%w: submitted upgrade execution mismatch", ErrForbidden)
		}
	case UpgradeVerified:
		if !proposalReached(proposal, StatusVerified) || proposal.ExecutionReceipt == nil || record.ExecutionManifestHash != proposal.ExecutionHash || record.ExecutionReceiptAuditID != proposal.ExecutionReceipt.AuditHash {
			return fmt.Errorf("%w: verified upgrade receipt mismatch", ErrForbidden)
		}
	case UpgradeFailed:
		if !proposalReached(proposal, StatusExecutionFailed) || proposalReached(proposal, StatusRolledBack) || proposal.ExecutionReceipt == nil || record.ExecutionReceiptAuditID != proposal.ExecutionReceipt.AuditHash {
			return fmt.Errorf("%w: failed upgrade receipt mismatch", ErrForbidden)
		}
	case UpgradeRolledBack:
		if !proposalReached(proposal, StatusRolledBack) || proposal.RollbackReceipt == nil || record.RollbackManifestHash != proposal.RollbackHash || record.RollbackReceiptAuditID != proposal.RollbackReceipt.AuditHash {
			return fmt.Errorf("%w: rolled-back upgrade receipt mismatch", ErrForbidden)
		}
	default:
		return fmt.Errorf("%w: unsupported upgrade status", ErrForbidden)
	}
	return nil
}

func validateUpgradeRegistry(upgrades map[string]*UpgradeRecord, proposals map[string]*Proposal) error {
	manifestOwners := map[string]string{}
	releaseOwners := map[string]string{}
	activeScopes := map[Scope]string{}
	for proposalID, proposal := range proposals {
		record, hasRecord := upgrades[proposalID]
		if isUpgradeProposal(proposal) != hasRecord {
			return fmt.Errorf("%w: proposal and persistent upgrade records disagree", ErrForbidden)
		}
		if !hasRecord {
			continue
		}
		manifestKey := strings.ToLower(record.ManifestHash)
		if owner, exists := manifestOwners[manifestKey]; exists && owner != proposalID {
			return fmt.Errorf("%w: duplicate persisted upgrade manifest", ErrForbidden)
		}
		manifestOwners[manifestKey] = proposalID
		releaseKey := record.SourceCommit + "\x00" + record.Release
		if owner, exists := releaseOwners[releaseKey]; exists && owner != proposalID {
			return fmt.Errorf("%w: duplicate persisted upgrade release identity", ErrForbidden)
		}
		releaseOwners[releaseKey] = proposalID
		if terminalUpgradeStatus(record.Status) {
			continue
		}
		if owner, exists := activeScopes[record.Scope]; exists && owner != proposalID {
			return fmt.Errorf("%w: multiple active persisted upgrades in one scope", ErrForbidden)
		}
		activeScopes[record.Scope] = proposalID
	}
	for proposalID := range upgrades {
		if _, exists := proposals[proposalID]; !exists {
			return fmt.Errorf("%w: orphaned persistent upgrade record", ErrForbidden)
		}
	}
	return nil
}
