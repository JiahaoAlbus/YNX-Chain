package governance

import (
	"fmt"
	"strings"
	"time"
)

type Status string

const (
	StatusDraft               Status = "draft"
	StatusEligibilityCheck    Status = "eligibility_check"
	StatusDepositPending      Status = "deposit_pending"
	StatusDepositAccepted     Status = "deposit_accepted"
	StatusDiscussion          Status = "discussion"
	StatusTechnicalReview     Status = "technical_review"
	StatusEconomicReview      Status = "economic_review"
	StatusSecurityReview      Status = "security_review"
	StatusConflictDisclosure  Status = "conflict_disclosure"
	StatusSimulationPending   Status = "simulation_pending"
	StatusSimulationCompleted Status = "simulation_completed"
	StatusVotingPending       Status = "voting_pending"
	StatusVotingActive        Status = "voting_active"
	StatusVotingClosed        Status = "voting_closed"
	StatusQuorumFailed        Status = "quorum_failed"
	StatusThresholdFailed     Status = "threshold_failed"
	StatusApproved            Status = "approved"
	StatusRejected            Status = "rejected"
	StatusCancelled           Status = "cancelled"
	StatusExpired             Status = "expired"
	StatusTimelockPending     Status = "timelock_pending"
	StatusTimelockActive      Status = "timelock_active"
	StatusExecutionReady      Status = "execution_ready"
	StatusExecutionSubmitted  Status = "execution_submitted"
	StatusExecuted            Status = "executed"
	StatusVerificationPending Status = "verification_pending"
	StatusVerified            Status = "verified"
	StatusExecutionFailed     Status = "execution_failed"
	StatusRollbackPending     Status = "rollback_pending"
	StatusRolledBack          Status = "rolled_back"
	StatusEmergencyPaused     Status = "emergency_paused"
	StatusCorrected           Status = "corrected"
	StatusArchived            Status = "archived"

	// Source-level compatibility identifiers. These do not preserve legacy
	// serialized values; every runtime and API response uses the canonical
	// state-machine value above.
	StatusDeposit    Status = StatusDepositPending
	StatusVoting     Status = StatusVotingActive
	StatusTimelocked Status = StatusTimelockActive
	StatusExecuting  Status = StatusExecutionSubmitted
)

var allProposalStatuses = []Status{
	StatusDraft,
	StatusEligibilityCheck,
	StatusDepositPending,
	StatusDepositAccepted,
	StatusDiscussion,
	StatusTechnicalReview,
	StatusEconomicReview,
	StatusSecurityReview,
	StatusConflictDisclosure,
	StatusSimulationPending,
	StatusSimulationCompleted,
	StatusVotingPending,
	StatusVotingActive,
	StatusVotingClosed,
	StatusQuorumFailed,
	StatusThresholdFailed,
	StatusApproved,
	StatusRejected,
	StatusCancelled,
	StatusExpired,
	StatusTimelockPending,
	StatusTimelockActive,
	StatusExecutionReady,
	StatusExecutionSubmitted,
	StatusExecuted,
	StatusVerificationPending,
	StatusVerified,
	StatusExecutionFailed,
	StatusRollbackPending,
	StatusRolledBack,
	StatusEmergencyPaused,
	StatusCorrected,
	StatusArchived,
}

var proposalTransitions = map[Status]map[Status]bool{
	"":                        {StatusDraft: true},
	StatusDraft:               {StatusEligibilityCheck: true},
	StatusEligibilityCheck:    {StatusDepositPending: true, StatusRejected: true},
	StatusDepositPending:      {StatusDepositAccepted: true, StatusCancelled: true, StatusExpired: true},
	StatusDepositAccepted:     {StatusDiscussion: true},
	StatusDiscussion:          {StatusTechnicalReview: true, StatusCancelled: true, StatusExpired: true, StatusEmergencyPaused: true},
	StatusTechnicalReview:     {StatusEconomicReview: true, StatusRejected: true, StatusExpired: true},
	StatusEconomicReview:      {StatusSecurityReview: true, StatusRejected: true, StatusExpired: true},
	StatusSecurityReview:      {StatusConflictDisclosure: true, StatusRejected: true, StatusExpired: true},
	StatusConflictDisclosure:  {StatusSimulationPending: true, StatusRejected: true, StatusExpired: true},
	StatusSimulationPending:   {StatusSimulationCompleted: true, StatusRejected: true, StatusExpired: true},
	StatusSimulationCompleted: {StatusVotingPending: true, StatusRejected: true, StatusExpired: true},
	StatusVotingPending:       {StatusVotingActive: true, StatusCancelled: true, StatusExpired: true, StatusEmergencyPaused: true},
	StatusVotingActive:        {StatusVotingClosed: true, StatusExpired: true, StatusEmergencyPaused: true},
	StatusVotingClosed:        {StatusQuorumFailed: true, StatusThresholdFailed: true, StatusApproved: true},
	StatusApproved:            {StatusTimelockPending: true},
	StatusTimelockPending:     {StatusTimelockActive: true, StatusCancelled: true, StatusExpired: true, StatusEmergencyPaused: true},
	StatusTimelockActive:      {StatusExecutionReady: true, StatusCancelled: true, StatusExpired: true, StatusEmergencyPaused: true},
	StatusExecutionReady:      {StatusExecutionSubmitted: true, StatusExpired: true, StatusEmergencyPaused: true},
	StatusExecutionSubmitted:  {StatusExecuted: true, StatusExecutionFailed: true, StatusEmergencyPaused: true},
	StatusExecuted:            {StatusVerificationPending: true},
	StatusVerificationPending: {StatusVerified: true, StatusExecutionFailed: true},
	StatusExecutionFailed:     {StatusRollbackPending: true},
	StatusRollbackPending:     {StatusRolledBack: true},
	StatusEmergencyPaused:     {StatusCorrected: true, StatusCancelled: true, StatusExpired: true},
	StatusCorrected:           {StatusArchived: true},
	StatusVerified:            {StatusArchived: true},
	StatusRolledBack:          {StatusArchived: true},
	StatusRejected:            {StatusArchived: true},
	StatusQuorumFailed:        {StatusArchived: true},
	StatusThresholdFailed:     {StatusArchived: true},
	StatusCancelled:           {StatusArchived: true},
	StatusExpired:             {StatusArchived: true},
}

type StateTransition struct {
	Sequence  uint64    `json:"sequence"`
	From      Status    `json:"from,omitempty"`
	To        Status    `json:"to"`
	Actor     string    `json:"actor"`
	Reason    string    `json:"reason"`
	Evidence  []string  `json:"evidence"`
	At        time.Time `json:"at"`
	AuditHash string    `json:"auditHash"`
}

func ProposalStatuses() []Status {
	return append([]Status(nil), allProposalStatuses...)
}

func validProposalStatus(status Status) bool {
	for _, candidate := range allProposalStatuses {
		if status == candidate {
			return true
		}
	}
	return false
}

func terminalProposalStatus(status Status) bool {
	switch status {
	case StatusQuorumFailed, StatusThresholdFailed, StatusRejected, StatusCancelled, StatusExpired, StatusVerified, StatusRolledBack, StatusCorrected, StatusArchived:
		return true
	default:
		return false
	}
}

func proposalReached(p *Proposal, status Status) bool {
	if p == nil {
		return false
	}
	for _, transition := range p.Transitions {
		if transition.To == status {
			return true
		}
	}
	return false
}

func transitionProposal(p *Proposal, to Status, actor, reason string, evidence []string, at time.Time) error {
	if p == nil || !validProposalStatus(to) || !proposalTransitions[p.Status][to] {
		return fmt.Errorf("%w: proposal transition %q -> %q", ErrForbidden, p.Status, to)
	}
	actor = strings.TrimSpace(actor)
	reason = strings.TrimSpace(reason)
	if len(actor) < 3 || len(reason) < 8 || len(evidence) == 0 || at.IsZero() {
		return fmt.Errorf("%w: incomplete proposal transition evidence", ErrInvalid)
	}
	at = at.UTC()
	sequence := uint64(len(p.Transitions) + 1)
	transition := StateTransition{
		Sequence: sequence,
		From:     p.Status,
		To:       to,
		Actor:    actor,
		Reason:   reason,
		Evidence: append([]string(nil), evidence...),
		At:       at,
	}
	transition.AuditHash = transitionAudit(p.ID, transition)
	p.Status = to
	p.Transitions = append(p.Transitions, transition)
	p.UpdatedAt = at
	return nil
}

func transitionAudit(proposalID string, transition StateTransition) string {
	return hash(
		proposalID,
		fmt.Sprint(transition.Sequence),
		string(transition.From),
		string(transition.To),
		transition.Actor,
		transition.Reason,
		strings.Join(transition.Evidence, "|"),
		transition.At.UTC().Format(time.RFC3339Nano),
	)
}

func validateProposalTransitions(p *Proposal) error {
	if p == nil || len(p.Transitions) == 0 {
		return fmt.Errorf("%w: proposal transition history missing; explicit state migration required", ErrForbidden)
	}
	from := Status("")
	for i, transition := range p.Transitions {
		if transition.Sequence != uint64(i+1) || transition.From != from || !proposalTransitions[from][transition.To] || transition.AuditHash != transitionAudit(p.ID, transition) || transition.At.IsZero() || len(transition.Evidence) == 0 {
			return fmt.Errorf("%w: invalid proposal transition history", ErrForbidden)
		}
		from = transition.To
	}
	if from != p.Status || !validProposalStatus(p.Status) {
		return fmt.Errorf("%w: proposal status does not match transition history", ErrForbidden)
	}
	return nil
}
