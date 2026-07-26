package governance

import (
	"strings"
	"testing"
	"time"
)

func TestPublicViewsAreDerivedFromCanonicalProposalState(t *testing.T) {
	now := time.Date(2026, 7, 25, 14, 0, 0, 0, time.UTC)
	s := testService(t)
	p := proposalAtVoting(t, s, now, VotingSnapshot{BasePower: map[string]uint64{"alice": 40, "bob": 60}, Delegations: map[string]string{"alice": "bob"}})
	var err error
	if p, err = s.DiscloseConflict(p.ID, ConflictDisclosure{Actor: "provider-owner", Description: "Related bridge provider ownership was disclosed before voting.", Recused: true}, now.Add(4*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if p, err = castTestVote(t, s, p.ID, "bob", "yes", now.Add(5*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if p, err = s.Finalize(p.ID, p.VotingEndsAt); err != nil {
		t.Fatal(err)
	}
	if len(s.PublicVotes()) != 1 || len(s.PublicElectorateDelegations()) != 1 || len(s.PublicTimelocks()) != 1 || len(s.PublicConflicts()) != 1 {
		t.Fatalf("derived views missing: votes=%v delegations=%v timelocks=%v conflicts=%v", s.PublicVotes(), s.PublicElectorateDelegations(), s.PublicTimelocks(), s.PublicConflicts())
	}
	timelock := s.PublicTimelocks()[0]
	if timelock.ActionHash != p.ActionHash || timelock.EarliestExecution != p.ExecuteAfter || timelock.LatestExecution != p.Input.ExpiresAt || timelock.ExecutionAuthority != string(RoleExecutionOperator) {
		t.Fatalf("invalid timelock view: %+v", timelock)
	}
	if len(s.PublicExecutions()) != 0 {
		t.Fatal("timelocked proposal was reported as submitted execution")
	}
	manifest := strings.Repeat("d", 64)
	if p, err = s.BeginExecution(p.ID, manifest, p.ExecuteAfter); err != nil {
		t.Fatal(err)
	}
	if len(s.PublicExecutions()) != 1 || s.PublicExecutions()[0].ExecutionReceipt != nil {
		t.Fatalf("execution submission view invalid: %+v", s.PublicExecutions())
	}
	receipt := NewExecutionReceipt("0x"+strings.Repeat("1", 64), 91, "0x"+strings.Repeat("2", 64), "0x"+strings.Repeat("3", 64), manifest, "verified", p.ExecuteAfter.Add(time.Minute))
	if _, err = s.VerifyExecution(p.ID, receipt, nil, p.ExecuteAfter.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	executions := s.PublicExecutions()
	if len(executions) != 1 || executions[0].ExecutionReceipt == nil || executions[0].Status != StatusVerified {
		t.Fatalf("verified execution view invalid: %+v", executions)
	}
	if len(s.PublicAudit()) < len(p.Transitions)+2 {
		t.Fatalf("audit records incomplete: %d", len(s.PublicAudit()))
	}
}

func TestActionHashBindsDiffCommitReleaseAndUpgradeManifest(t *testing.T) {
	now := time.Date(2026, 7, 25, 15, 0, 0, 0, time.UTC)
	s := testService(t)
	base := proposalInput(now)
	first, err := s.Create(base, now)
	if err != nil {
		t.Fatal(err)
	}
	if !validHash(first.ActionHash) {
		t.Fatalf("invalid action hash: %s", first.ActionHash)
	}
	secondInput := proposalInput(now)
	secondInput.Nonce = "proposal-action-hash-02"
	secondInput.Release = "governance-test-v2"
	secondInput.Changes[0].Path = "/bridge/dailyLimit"
	secondInput.Changes[0].After = "24"
	value := int64(24)
	secondInput.Changes[0].Numeric = &value
	second, err := s.Create(secondInput, now)
	if err != nil {
		t.Fatal(err)
	}
	if first.ActionHash == second.ActionHash {
		t.Fatal("materially different governance action produced the same action hash")
	}
}
