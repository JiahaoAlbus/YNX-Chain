package governance

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

type TimelockStatus string

const (
	TimelockScheduled      TimelockStatus = "scheduled"
	TimelockActive         TimelockStatus = "active"
	TimelockCancelled      TimelockStatus = "cancelled"
	TimelockExpired        TimelockStatus = "expired"
	TimelockPaused         TimelockStatus = "emergency_paused"
	TimelockCorrected      TimelockStatus = "corrected"
	TimelockExecutionReady TimelockStatus = "execution_ready"
	TimelockSubmitted      TimelockStatus = "submitted"
	TimelockExecuted       TimelockStatus = "executed"
	TimelockFailed         TimelockStatus = "failed"
	TimelockRolledBack     TimelockStatus = "rolled_back"
)

type TimelockTransition struct {
	Sequence  uint64         `json:"sequence"`
	From      TimelockStatus `json:"from,omitempty"`
	To        TimelockStatus `json:"to"`
	Actor     string         `json:"actor"`
	Reason    string         `json:"reason"`
	Evidence  []string       `json:"evidence"`
	At        time.Time      `json:"at"`
	Previous  string         `json:"previousAuditHash,omitempty"`
	AuditHash string         `json:"auditHash"`
}

type TimelockRecord struct {
	ID                    string               `json:"id"`
	ProposalID            string               `json:"proposalId"`
	ActionHash            string               `json:"actionHash"`
	Status                TimelockStatus       `json:"status"`
	ScheduledAt           time.Time            `json:"scheduledAt"`
	EarliestExecution     time.Time            `json:"earliestExecution"`
	GraceEndsAt           time.Time            `json:"graceEndsAt"`
	PublicNotice          string               `json:"publicNotice"`
	NoticeEvidence        []string             `json:"noticeEvidence"`
	ExecutionManifestHash string               `json:"executionManifestHash,omitempty"`
	ExecutionStartedAt    time.Time            `json:"executionStartedAt,omitempty"`
	CancelledBy           string               `json:"cancelledBy,omitempty"`
	CancellationReason    string               `json:"cancellationReason,omitempty"`
	CancellationEvidence  []string             `json:"cancellationEvidence,omitempty"`
	CancelledAt           time.Time            `json:"cancelledAt,omitempty"`
	Transitions           []TimelockTransition `json:"transitions"`
	AuditHash             string               `json:"auditHash"`
}

var timelockTransitions = map[TimelockStatus]map[TimelockStatus]bool{
	"":                     {TimelockScheduled: true},
	TimelockScheduled:      {TimelockActive: true},
	TimelockActive:         {TimelockCancelled: true, TimelockExpired: true, TimelockPaused: true, TimelockExecutionReady: true},
	TimelockPaused:         {TimelockCorrected: true, TimelockExpired: true},
	TimelockExecutionReady: {TimelockSubmitted: true},
	TimelockSubmitted:      {TimelockExecuted: true, TimelockFailed: true},
	TimelockFailed:         {TimelockRolledBack: true},
}

func (s *Service) createTimelockLocked(proposal *Proposal, evidence []string, now time.Time) (*TimelockRecord, error) {
	if proposal == nil || proposal.Status != StatusApproved || !validHash(proposal.ActionHash) || len(evidence) == 0 {
		return nil, ErrNotReady
	}
	id := hash("timelock", proposal.ID, proposal.ActionHash)
	if _, exists := s.timelocks[proposal.ID]; exists {
		return nil, ErrReplay
	}
	earliest := now.UTC().Add(s.policy.Timelock)
	graceEnds := earliest.Add(s.policy.TimelockGrace)
	if proposal.Input.ExpiresAt.Before(graceEnds) {
		graceEnds = proposal.Input.ExpiresAt.UTC()
	}
	if !graceEnds.After(earliest) {
		return nil, fmt.Errorf("%w: proposal expiry does not leave a timelock grace window", ErrNotReady)
	}
	record := &TimelockRecord{
		ID: id, ProposalID: proposal.ID, ActionHash: proposal.ActionHash, ScheduledAt: now.UTC(),
		EarliestExecution: earliest, GraceEndsAt: graceEnds,
		PublicNotice:   timelockPublicNotice(proposal.ActionHash),
		NoticeEvidence: append([]string(nil), evidence...),
	}
	if err := transitionTimelock(record, TimelockScheduled, "ynx-governance-runtime", "approved action was scheduled with an exact action hash and public notice", evidence, now); err != nil {
		return nil, err
	}
	if err := transitionTimelock(record, TimelockActive, "ynx-governance-runtime", "timelock review window became active and no execution was inferred", evidence, now); err != nil {
		return nil, err
	}
	s.timelocks[proposal.ID] = record
	proposal.ExecuteAfter = earliest
	return record, nil
}

func (s *Service) CancelTimelock(proposalID, actionHash, actor, reason string, evidence []string, now time.Time) (Proposal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now = now.UTC()
	proposal, ok := s.proposals[proposalID]
	if !ok {
		return Proposal{}, ErrNotFound
	}
	record, ok := s.timelocks[proposalID]
	if !ok {
		return Proposal{}, ErrNotFound
	}
	if err := s.expireTimelockLocked(proposal, record, now); err != nil {
		return Proposal{}, err
	}
	if record.Status != TimelockActive || proposal.Status != StatusTimelockActive || !strings.EqualFold(actionHash, record.ActionHash) || !strings.EqualFold(actionHash, proposal.ActionHash) ||
		(actor != proposal.Input.Proposer && !s.hasRoleAt(actor, RoleTechnicalCouncil, proposal.Input.Scope, now)) || len(strings.TrimSpace(reason)) < 16 || len(evidence) == 0 {
		return Proposal{}, ErrForbidden
	}
	cancellation := &Cancellation{Actor: actor, Reason: strings.TrimSpace(reason), Evidence: append([]string(nil), evidence...), CancelledAt: now}
	cancellation.AuditHash = hash(proposal.ID, cancellation.Actor, cancellation.Reason, cancellation.CancelledAt.Format(time.RFC3339Nano), strings.Join(cancellation.Evidence, "|"))
	if err := s.transitionCanaryLocked(proposal, CanaryCancelled, actor, cancellation.Reason, cancellation.Evidence, now); err != nil {
		return Proposal{}, err
	}
	if err := s.transitionUpgradeLocked(proposal, UpgradeCancelled, actor, cancellation.Reason, cancellation.Evidence, now); err != nil {
		return Proposal{}, err
	}
	if err := transitionTimelock(record, TimelockCancelled, actor, cancellation.Reason, cancellation.Evidence, now); err != nil {
		return Proposal{}, err
	}
	record.CancelledBy, record.CancellationReason, record.CancellationEvidence, record.CancelledAt = actor, cancellation.Reason, append([]string(nil), evidence...), now
	record.AuditHash = timelockAudit(record)
	proposal.Cancellation = cancellation
	if err := transitionProposal(proposal, StatusCancelled, actor, cancellation.Reason, cancellation.Evidence, now); err != nil {
		return Proposal{}, err
	}
	return clone(proposal), nil
}

func (s *Service) expireTimelockLocked(proposal *Proposal, record *TimelockRecord, now time.Time) error {
	if record == nil || proposal == nil {
		return nil
	}
	deadline := record.GraceEndsAt
	if record.Status == TimelockPaused {
		deadline = proposal.Input.ExpiresAt
	} else if record.Status != TimelockActive {
		return nil
	}
	if !now.After(deadline) {
		return nil
	}
	evidence := []string{"timelock-expired://" + record.ID + "/" + deadline.Format(time.RFC3339Nano)}
	if err := s.transitionCanaryLocked(proposal, CanaryExpired, "ynx-governance-runtime", "canary and timelock execution window expired without submission", evidence, now); err != nil {
		return err
	}
	if err := s.transitionUpgradeLocked(proposal, UpgradeExpired, "ynx-governance-runtime", "upgrade timelock execution window expired without submission", evidence, now); err != nil {
		return err
	}
	if err := transitionTimelock(record, TimelockExpired, "ynx-governance-runtime", "timelock execution window expired without submission", evidence, now); err != nil {
		return err
	}
	if proposal.Status == StatusTimelockActive || proposal.Status == StatusEmergencyPaused {
		return transitionProposal(proposal, StatusExpired, "ynx-governance-runtime", "timelock execution window expired before submission", evidence, now)
	}
	return nil
}

func (s *Service) ListTimelocks(now time.Time) []TimelockRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]TimelockRecord, 0, len(s.timelocks))
	for _, record := range s.timelocks {
		copy := cloneTimelock(record)
		if copy.Status == TimelockActive && now.UTC().After(copy.GraceEndsAt) {
			copy.Status = TimelockExpired
		}
		out = append(out, copy)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].ScheduledAt.Equal(out[j].ScheduledAt) {
			return out[i].ID < out[j].ID
		}
		return out[i].ScheduledAt.Before(out[j].ScheduledAt)
	})
	return out
}

func transitionTimelock(record *TimelockRecord, to TimelockStatus, actor, reason string, evidence []string, now time.Time) error {
	if record == nil || !timelockTransitions[record.Status][to] || len(strings.TrimSpace(actor)) < 3 || len(strings.TrimSpace(reason)) < 16 || len(evidence) == 0 {
		return ErrInvalid
	}
	transition := TimelockTransition{
		Sequence: uint64(len(record.Transitions) + 1), From: record.Status, To: to, Actor: strings.TrimSpace(actor),
		Reason: strings.TrimSpace(reason), Evidence: append([]string(nil), evidence...), At: now.UTC(),
	}
	if len(record.Transitions) > 0 {
		transition.Previous = record.Transitions[len(record.Transitions)-1].AuditHash
	}
	transition.AuditHash = timelockTransitionAudit(record.ID, transition)
	record.Transitions = append(record.Transitions, transition)
	record.Status = to
	record.AuditHash = timelockAudit(record)
	return nil
}

func timelockTransitionAudit(id string, transition TimelockTransition) string {
	return hash(id, fmt.Sprint(transition.Sequence), string(transition.From), string(transition.To), transition.Actor, transition.Reason,
		strings.Join(transition.Evidence, "|"), transition.At.Format(time.RFC3339Nano), transition.Previous)
}

func timelockAudit(record *TimelockRecord) string {
	parts := []string{record.ID, record.ProposalID, record.ActionHash, string(record.Status), record.ScheduledAt.Format(time.RFC3339Nano),
		record.EarliestExecution.Format(time.RFC3339Nano), record.GraceEndsAt.Format(time.RFC3339Nano), record.PublicNotice,
		strings.Join(record.NoticeEvidence, "|"), record.ExecutionManifestHash, record.ExecutionStartedAt.Format(time.RFC3339Nano),
		record.CancelledBy, record.CancellationReason, strings.Join(record.CancellationEvidence, "|"), record.CancelledAt.Format(time.RFC3339Nano)}
	for _, transition := range record.Transitions {
		parts = append(parts, transition.AuditHash)
	}
	return hash(parts...)
}

func timelockPublicNotice(actionHash string) string {
	return "Approved governance action " + actionHash + " is delayed for public review before execution."
}

func cloneTimelock(record *TimelockRecord) TimelockRecord {
	out := *record
	out.NoticeEvidence = append([]string(nil), record.NoticeEvidence...)
	out.CancellationEvidence = append([]string(nil), record.CancellationEvidence...)
	out.Transitions = make([]TimelockTransition, len(record.Transitions))
	for i, transition := range record.Transitions {
		out.Transitions[i] = transition
		out.Transitions[i].Evidence = append([]string(nil), transition.Evidence...)
	}
	return out
}

func validateStoredTimelock(record *TimelockRecord, proposal *Proposal, policy Policy) error {
	if record == nil || proposal == nil || record.ID != hash("timelock", proposal.ID, proposal.ActionHash) || record.ProposalID != proposal.ID ||
		record.ActionHash != proposal.ActionHash || record.ScheduledAt.IsZero() || record.EarliestExecution != record.ScheduledAt.Add(policy.Timelock) ||
		!record.GraceEndsAt.After(record.EarliestExecution) || record.GraceEndsAt.After(record.EarliestExecution.Add(policy.TimelockGrace)) ||
		record.GraceEndsAt.After(proposal.Input.ExpiresAt) || record.PublicNotice != timelockPublicNotice(proposal.ActionHash) || len(record.NoticeEvidence) == 0 || len(record.Transitions) < 2 {
		return fmt.Errorf("%w: invalid stored timelock", ErrForbidden)
	}
	var approvedEvidence []string
	for _, transition := range proposal.Transitions {
		if transition.To == StatusApproved {
			approvedEvidence = transition.Evidence
			break
		}
	}
	if strings.Join(approvedEvidence, "\x00") != strings.Join(record.NoticeEvidence, "\x00") ||
		strings.Join(record.Transitions[0].Evidence, "\x00") != strings.Join(record.NoticeEvidence, "\x00") ||
		strings.Join(record.Transitions[1].Evidence, "\x00") != strings.Join(record.NoticeEvidence, "\x00") ||
		record.Transitions[0].At != record.ScheduledAt {
		return fmt.Errorf("%w: timelock public notice evidence mismatch", ErrForbidden)
	}
	var status TimelockStatus
	var previous string
	for index, transition := range record.Transitions {
		if transition.Sequence != uint64(index+1) || transition.From != status || !timelockTransitions[status][transition.To] ||
			transition.Previous != previous || transition.AuditHash != timelockTransitionAudit(record.ID, transition) ||
			(index > 0 && transition.At.Before(record.Transitions[index-1].At)) {
			return fmt.Errorf("%w: invalid timelock transition history", ErrForbidden)
		}
		status, previous = transition.To, transition.AuditHash
	}
	if status != record.Status || record.AuditHash != timelockAudit(record) {
		return fmt.Errorf("%w: timelock audit mismatch", ErrForbidden)
	}
	if (record.Status == TimelockCancelled) != (proposalReached(proposal, StatusCancelled) && proposal.Cancellation != nil) {
		return fmt.Errorf("%w: timelock cancellation mismatch", ErrForbidden)
	}
	switch record.Status {
	case TimelockScheduled:
		if proposal.Status != StatusApproved && proposal.Status != StatusTimelockPending {
			return fmt.Errorf("%w: scheduled timelock proposal status mismatch", ErrForbidden)
		}
	case TimelockActive:
		if proposal.Status != StatusTimelockActive {
			return fmt.Errorf("%w: active timelock proposal status mismatch", ErrForbidden)
		}
	case TimelockCancelled:
		if record.CancelledBy != proposal.Cancellation.Actor || record.CancellationReason != proposal.Cancellation.Reason || record.CancelledAt != proposal.Cancellation.CancelledAt || len(record.CancellationEvidence) == 0 {
			return fmt.Errorf("%w: timelock cancellation audit mismatch", ErrForbidden)
		}
	case TimelockExpired:
		if !proposalReached(proposal, StatusExpired) {
			return fmt.Errorf("%w: expired timelock proposal status mismatch", ErrForbidden)
		}
	case TimelockPaused:
		if proposal.Status != StatusEmergencyPaused {
			return fmt.Errorf("%w: paused timelock proposal status mismatch", ErrForbidden)
		}
	case TimelockCorrected:
		if !proposalReached(proposal, StatusCorrected) {
			return fmt.Errorf("%w: corrected timelock proposal status mismatch", ErrForbidden)
		}
	case TimelockExecutionReady:
		if proposal.Status != StatusExecutionReady {
			return fmt.Errorf("%w: execution-ready timelock proposal status mismatch", ErrForbidden)
		}
	case TimelockSubmitted:
		if proposal.Status != StatusExecutionSubmitted {
			return fmt.Errorf("%w: submitted timelock proposal status mismatch", ErrForbidden)
		}
	case TimelockExecuted:
		if !proposalReached(proposal, StatusVerified) {
			return fmt.Errorf("%w: executed timelock proposal status mismatch", ErrForbidden)
		}
	case TimelockFailed:
		if !proposalReached(proposal, StatusExecutionFailed) || proposalReached(proposal, StatusRolledBack) {
			return fmt.Errorf("%w: failed timelock proposal status mismatch", ErrForbidden)
		}
	case TimelockRolledBack:
		if !proposalReached(proposal, StatusRolledBack) {
			return fmt.Errorf("%w: rolled-back timelock proposal status mismatch", ErrForbidden)
		}
	default:
		return fmt.Errorf("%w: unsupported timelock status", ErrForbidden)
	}
	if record.Status == TimelockSubmitted || record.Status == TimelockExecuted || record.Status == TimelockFailed || record.Status == TimelockRolledBack {
		if !validHash(record.ExecutionManifestHash) || record.ExecutionStartedAt.IsZero() {
			return fmt.Errorf("%w: timelock execution binding missing", ErrForbidden)
		}
	}
	return nil
}
