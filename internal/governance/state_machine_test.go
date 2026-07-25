package governance

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func simulationPass() Simulation {
	return Simulation{
		TechnicalEvidence:  "sha256:technical-simulation-pass",
		EconomicEvidence:   "sha256:economic-simulation-pass",
		SecurityEvidence:   "sha256:security-simulation-pass",
		UserImpactEvidence: "sha256:user-impact-simulation-pass",
		Passed:             true,
	}
}

func proposalAtVoting(t *testing.T, s *Service, now time.Time, snapshot VotingSnapshot) Proposal {
	t.Helper()
	p, err := s.Create(proposalInput(now), now)
	if err != nil {
		t.Fatal(err)
	}
	if p, err = s.Deposit(p.ID, 100, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if p, err = s.RecordSimulation(p.ID, simulationPass(), now.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if p, err = openVoting(t, s, p.ID, snapshot, now.Add(3*time.Minute)); err != nil {
		t.Fatal(err)
	}
	return p
}

func transitionTargets(p Proposal) []Status {
	out := make([]Status, len(p.Transitions))
	for i, transition := range p.Transitions {
		out[i] = transition.To
	}
	return out
}

func TestCanonicalStateMachineSuccessfulExecutionSequence(t *testing.T) {
	now := time.Date(2026, 7, 25, 11, 0, 0, 0, time.UTC)
	s := testService(t)
	p := proposalAtVoting(t, s, now, VotingSnapshot{BasePower: map[string]uint64{"validator-1": 100}})
	var err error
	if p, err = s.Vote(p.ID, "validator-1", "yes", now.Add(4*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if p, err = s.Finalize(p.ID, p.VotingEndsAt); err != nil {
		t.Fatal(err)
	}
	if p.Status != StatusTimelockActive || proposalReached(&p, StatusExecuted) {
		t.Fatalf("vote passed was confused with execution: status=%s", p.Status)
	}
	manifest := strings.Repeat("a", 64)
	if p, err = s.BeginExecution(p.ID, manifest, p.ExecuteAfter); err != nil {
		t.Fatal(err)
	}
	if p.Status != StatusExecutionSubmitted || proposalReached(&p, StatusExecuted) {
		t.Fatalf("submission was confused with execution: status=%s", p.Status)
	}
	receipt := NewExecutionReceipt("0x"+strings.Repeat("1", 64), 77, "0x"+strings.Repeat("2", 64), "0x"+strings.Repeat("3", 64), manifest, "verified", p.ExecuteAfter.Add(time.Minute))
	if p, err = s.VerifyExecution(p.ID, receipt, nil, p.ExecuteAfter.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if p.Status != StatusVerified {
		t.Fatalf("expected verified, got %s", p.Status)
	}
	expected := []Status{
		StatusDraft, StatusEligibilityCheck, StatusDepositPending, StatusDepositAccepted, StatusDiscussion,
		StatusTechnicalReview, StatusEconomicReview, StatusSecurityReview, StatusConflictDisclosure,
		StatusSimulationPending, StatusSimulationCompleted, StatusVotingPending, StatusVotingActive,
		StatusVotingClosed, StatusApproved, StatusTimelockPending, StatusTimelockActive,
		StatusExecutionReady, StatusExecutionSubmitted, StatusExecuted, StatusVerificationPending, StatusVerified,
	}
	actual := transitionTargets(p)
	if len(actual) != len(expected) {
		t.Fatalf("unexpected transition count: got=%v want=%v", actual, expected)
	}
	for i := range expected {
		if actual[i] != expected[i] || p.Transitions[i].Sequence != uint64(i+1) || p.Transitions[i].AuditHash == "" || len(p.Transitions[i].Evidence) == 0 {
			t.Fatalf("transition %d invalid: %+v", i, p.Transitions[i])
		}
	}
}

func TestFinalizeSeparatesQuorumAndThresholdFailures(t *testing.T) {
	now := time.Date(2026, 7, 25, 12, 0, 0, 0, time.UTC)
	quorumService := testService(t)
	quorumProposal := proposalAtVoting(t, quorumService, now, VotingSnapshot{BasePower: map[string]uint64{"yes": 40, "silent": 60}})
	if _, err := quorumService.Vote(quorumProposal.ID, "yes", "yes", now.Add(4*time.Minute)); err != nil {
		t.Fatal(err)
	}
	quorumProposal, err := quorumService.Finalize(quorumProposal.ID, quorumProposal.VotingEndsAt)
	if err != nil || quorumProposal.Status != StatusQuorumFailed || proposalReached(&quorumProposal, StatusApproved) {
		t.Fatalf("quorum result: status=%s err=%v", quorumProposal.Status, err)
	}

	thresholdService := testService(t)
	thresholdProposal := proposalAtVoting(t, thresholdService, now, VotingSnapshot{BasePower: map[string]uint64{"yes": 60, "no": 40}})
	if _, err = thresholdService.Vote(thresholdProposal.ID, "yes", "yes", now.Add(4*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if _, err = thresholdService.Vote(thresholdProposal.ID, "no", "no", now.Add(4*time.Minute)); err != nil {
		t.Fatal(err)
	}
	thresholdProposal, err = thresholdService.Finalize(thresholdProposal.ID, thresholdProposal.VotingEndsAt)
	if err != nil || thresholdProposal.Status != StatusThresholdFailed || proposalReached(&thresholdProposal, StatusApproved) {
		t.Fatalf("threshold result: status=%s err=%v", thresholdProposal.Status, err)
	}
}

func TestFailedExecutionRemainsFailedUntilVerifiedRollback(t *testing.T) {
	now := time.Date(2026, 7, 25, 13, 0, 0, 0, time.UTC)
	s := testService(t)
	p := proposalAtVoting(t, s, now, VotingSnapshot{BasePower: map[string]uint64{"validator": 100}})
	var err error
	if p, err = s.Vote(p.ID, "validator", "yes", now.Add(4*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if p, err = s.Finalize(p.ID, p.VotingEndsAt); err != nil {
		t.Fatal(err)
	}
	manifest := strings.Repeat("b", 64)
	if p, err = s.BeginExecution(p.ID, manifest, p.ExecuteAfter); err != nil {
		t.Fatal(err)
	}
	failed := NewExecutionReceipt("0x"+strings.Repeat("4", 64), 88, "0x"+strings.Repeat("5", 64), "0x"+strings.Repeat("6", 64), manifest, "failed", p.ExecuteAfter.Add(time.Minute))
	if p, err = s.VerifyExecution(p.ID, failed, nil, p.ExecuteAfter.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if p.Status != StatusExecutionFailed || proposalReached(&p, StatusRolledBack) {
		t.Fatalf("failure was confused with rollback: status=%s", p.Status)
	}
	rollbackManifest := strings.Repeat("c", 64)
	rollback := NewExecutionReceipt("0x"+strings.Repeat("7", 64), 89, "0x"+strings.Repeat("8", 64), "0x"+strings.Repeat("9", 64), rollbackManifest, "verified_rollback", p.ExecuteAfter.Add(2*time.Minute))
	if p, err = s.VerifyRollback(p.ID, rollback, p.ExecuteAfter.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if p.Status != StatusRolledBack || !proposalReached(&p, StatusRollbackPending) {
		t.Fatalf("rollback not verified: status=%s", p.Status)
	}
	if _, err = s.VerifyRollback(p.ID, rollback, p.ExecuteAfter.Add(3*time.Minute)); !errors.Is(err, ErrNotReady) {
		t.Fatalf("duplicate rollback accepted: %v", err)
	}
}

func TestStateMachineDeclaresEveryRequiredStatus(t *testing.T) {
	statuses := ProposalStatuses()
	if len(statuses) != 33 {
		t.Fatalf("status count=%d", len(statuses))
	}
	seen := map[Status]bool{}
	for _, status := range statuses {
		if status == "" || seen[status] {
			t.Fatalf("invalid duplicate status %q", status)
		}
		seen[status] = true
	}
	for _, required := range []Status{StatusDraft, StatusEligibilityCheck, StatusDepositPending, StatusDiscussion, StatusTechnicalReview, StatusEconomicReview, StatusSecurityReview, StatusConflictDisclosure, StatusSimulationPending, StatusSimulationCompleted, StatusVotingPending, StatusVotingActive, StatusVotingClosed, StatusQuorumFailed, StatusThresholdFailed, StatusApproved, StatusTimelockPending, StatusTimelockActive, StatusExecutionReady, StatusExecutionSubmitted, StatusExecuted, StatusVerificationPending, StatusVerified, StatusExecutionFailed, StatusRollbackPending, StatusRolledBack, StatusEmergencyPaused, StatusCorrected, StatusArchived} {
		if !seen[required] {
			t.Fatalf("required status missing: %s", required)
		}
	}
}
