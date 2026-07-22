package governance

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func executeInput(t *testing.T, s *Service, in ProposalInput, now time.Time) Proposal {
	t.Helper()
	p, err := s.Create(in, now)
	if err != nil {
		t.Fatal(err)
	}
	p, _ = s.Deposit(p.ID, 100, now.Add(time.Minute))
	p, _ = s.RecordSimulation(p.ID, Simulation{TechnicalEvidence: "technical simulation evidence", EconomicEvidence: "economic simulation evidence", Passed: true}, now.Add(2*time.Minute))
	p, _ = openVoting(t, s, p.ID, VotingSnapshot{BasePower: map[string]uint64{"validator": 100}}, now.Add(3*time.Minute))
	p, _ = s.Vote(p.ID, "validator", "yes", now.Add(4*time.Minute))
	p, _ = s.Finalize(p.ID, p.VotingEndsAt)
	manifest := strings.Repeat("a", 64)
	p, _ = s.BeginExecution(p.ID, manifest, p.ExecuteAfter)
	receipt := NewExecutionReceipt("0x"+strings.Repeat("b", 64), 30, "0x"+strings.Repeat("c", 64), "0x"+strings.Repeat("d", 64), manifest, "verified", p.ExecuteAfter.Add(time.Minute))
	p, err = s.VerifyExecution(p.ID, receipt, nil, p.ExecuteAfter.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestAppealCorrectionRequiresExecutedFollowUpAndPersists(t *testing.T) {
	now := time.Date(2026, 7, 22, 8, 0, 0, 0, time.UTC)
	s := testService(t)
	original := executeInput(t, s, proposalInput(now), now)
	appeal, err := s.SubmitAppeal(AppealInput{Nonce: "appeal-nonce-0001", ProposalID: original.ID, Submitter: "ynx1observer", Kind: "correction", Explanation: "The published economic impact omits a provider concentration risk.", Evidence: []string{"sha256:provider-concentration-analysis"}}, now.Add(4*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.ResolveAppeal(appeal.ID, original.ID, "observer", "accepted", "Correction reviewed with public evidence.", []string{"sha256:review-record"}, now.Add(5*time.Hour)); !errors.Is(err, ErrForbidden) {
		t.Fatalf("same proposal resolved appeal: %v", err)
	}
	in := proposalInput(now.Add(4 * time.Hour))
	in.Nonce = "proposal-nonce-correction"
	value := int64(30)
	in.Changes[0].After = "30"
	in.Changes[0].Numeric = &value
	followUp := executeInput(t, s, in, now.Add(4*time.Hour))
	appeal, err = s.ResolveAppeal(appeal.ID, followUp.ID, "ynx1observer", "accepted", "Correction accepted through an executed public follow-up proposal.", []string{"sha256:public-correction-resolution"}, now.Add(8*time.Hour))
	if err != nil || appeal.Status != "resolved_accepted" || appeal.Resolution == nil {
		t.Fatalf("resolution: %+v %v", appeal, err)
	}
	path := t.TempDir() + "/state.json"
	if err = s.Save(path, now.Add(9*time.Hour)); err != nil {
		t.Fatal(err)
	}
	restored, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	got, err := restored.Appeal(appeal.ID)
	if err != nil || got.Resolution.AuditHash != appeal.Resolution.AuditHash {
		t.Fatalf("restore: %+v %v", got, err)
	}
}
