package governance

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func testService(t *testing.T) *Service {
	t.Helper()
	now := time.Date(2026, 7, 22, 8, 0, 0, 0, time.UTC)
	mk := func(account string, role GovernanceRole, threshold uint64) RoleAssignmentInput {
		return RoleAssignmentInput{Account: account, Role: role, Scopes: []Scope{ScopeBridge}, TermStartsAt: now, TermEndsAt: now.Add(365 * 24 * time.Hour), DecisionThreshold: threshold, ConflictDisclosure: "No provider ownership or compensation conflict disclosed.", Evidence: []string{"sha256:test-genesis-role-evidence"}}
	}
	roles := []RoleAssignmentInput{mk("technical-1", RoleTechnicalCouncil, 2), mk("technical-2", RoleTechnicalCouncil, 2), mk("security-1", RoleSecurityCouncil, 3), mk("security-2", RoleSecurityCouncil, 3), mk("security-3", RoleSecurityCouncil, 3), mk("treasury-1", RoleTreasuryCouncil, 2), mk("treasury-2", RoleTreasuryCouncil, 2)}
	manifest, err := GenesisRoleManifestHash(roles)
	if err != nil {
		t.Fatal(err)
	}
	s, err := NewService(Policy{MinimumDeposit: 100, QuorumBPS: 5000, ThresholdBPS: 6667, VotingPeriod: time.Hour, Timelock: 2 * time.Hour, MaxLifetime: 30 * 24 * time.Hour, EmergencyThreshold: 3, EmergencyMaxDuration: 24 * time.Hour, ParameterRules: map[string]ParameterRule{"/bridge/dailyLimit": {Scope: ScopeBridge, Numeric: true, Minimum: 10, Maximum: 100}}, GenesisRoleManifestHash: manifest, ElectorateApprovalThreshold: 2})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.BootstrapRoles(roles, manifest, now); err != nil {
		t.Fatal(err)
	}
	return s
}

func proposalInput(now time.Time) ProposalInput {
	value := int64(25)
	return ProposalInput{Nonce: "proposal-nonce-0001", Scope: ScopeBridge, Proposer: "delegator-01", Owner: "protocol-team", Summary: "Reduce the public testnet bridge daily limit", EconomicImpact: "Caps aggregate bridge exposure during testnet operations.", SecurityRisk: "Reduces loss radius while provider monitoring is evaluated.", Migration: "Apply the versioned policy after canary verification.", Rollback: "Restore the prior signed policy manifest if verification fails.", Evidence: []string{"sha256:bridge-risk-analysis"}, Changes: []ParameterChange{{Path: "/bridge/dailyLimit", Before: "100", After: "25", Minimum: 10, Maximum: 100, Numeric: &value}}, ExpiresAt: now.Add(7 * 24 * time.Hour)}
}

func openVoting(t *testing.T, s *Service, id string, snapshot VotingSnapshot, now time.Time) (Proposal, error) {
	t.Helper()
	_, err := s.SubmitElectorate(id, snapshot, strings.Repeat("9", 64), "ynx-electorate-snapshot/v1", "technical-1", now, now)
	if err != nil {
		return Proposal{}, err
	}
	_, err = s.ApproveElectorate(id, "technical-1", now.Add(time.Second))
	if err != nil {
		return Proposal{}, err
	}
	_, err = s.ApproveElectorate(id, "technical-2", now.Add(2*time.Second))
	if err != nil {
		return Proposal{}, err
	}
	return s.OpenVoting(id, now.Add(3*time.Second))
}

func TestProposalVoteTimelockExecution(t *testing.T) {
	now := time.Date(2026, 7, 22, 8, 0, 0, 0, time.UTC)
	s := testService(t)
	p, err := s.Create(proposalInput(now), now)
	if err != nil || p.Status != StatusDeposit {
		t.Fatalf("create: %+v %v", p, err)
	}
	p, err = s.Deposit(p.ID, 100, now.Add(time.Minute))
	if err != nil || p.Status != StatusDiscussion {
		t.Fatalf("deposit: %+v %v", p, err)
	}
	p, err = s.RecordSimulation(p.ID, Simulation{TechnicalEvidence: "sha256:technical-simulation-pass", EconomicEvidence: "sha256:economic-simulation-pass", Passed: true}, now.Add(2*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	p, err = openVoting(t, s, p.ID, VotingSnapshot{BasePower: map[string]uint64{"validator-1": 40, "delegate-1": 30, "observer-1": 10, "inactive-1": 20}}, now.Add(3*time.Minute))
	if err != nil || p.Status != StatusVoting {
		t.Fatalf("open: %+v %v", p, err)
	}
	for _, vote := range []struct{ v, c string }{{"validator-1", "yes"}, {"delegate-1", "yes"}, {"observer-1", "abstain"}} {
		if _, err = s.Vote(p.ID, vote.v, vote.c, now.Add(4*time.Minute)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = s.Finalize(p.ID, p.VotingEndsAt.Add(-time.Second)); !errors.Is(err, ErrNotReady) {
		t.Fatalf("early finalize: %v", err)
	}
	p, err = s.Finalize(p.ID, p.VotingEndsAt)
	if err != nil || p.Status != StatusTimelocked {
		t.Fatalf("finalize: %+v %v", p, err)
	}
	manifest := strings.Repeat("a", 64)
	if _, err = s.BeginExecution(p.ID, manifest, p.ExecuteAfter.Add(-time.Second)); !errors.Is(err, ErrNotReady) {
		t.Fatalf("early execution: %v", err)
	}
	p, err = s.BeginExecution(p.ID, manifest, p.ExecuteAfter)
	if err != nil || p.Status != StatusExecuting {
		t.Fatalf("execute: %+v %v", p, err)
	}
	receipt := NewExecutionReceipt("0x"+strings.Repeat("d", 64), 11, "0x"+strings.Repeat("e", 64), "0x"+strings.Repeat("f", 64), manifest, "verified", p.ExecuteAfter.Add(time.Minute))
	tampered := receipt
	tampered.StateRoot = "0x" + strings.Repeat("1", 64)
	if _, err = s.VerifyExecution(p.ID, tampered, nil, p.ExecuteAfter.Add(time.Minute)); !errors.Is(err, ErrForbidden) {
		t.Fatalf("tampered execution receipt: %v", err)
	}
	p, err = s.VerifyExecution(p.ID, receipt, nil, p.ExecuteAfter.Add(time.Minute))
	if err != nil || p.Status != StatusExecuted {
		t.Fatalf("verify: %+v %v", p, err)
	}
}

func TestBoundsReplayConflictRecusalAndRollback(t *testing.T) {
	now := time.Date(2026, 7, 22, 8, 0, 0, 0, time.UTC)
	s := testService(t)
	in := proposalInput(now)
	bad := int64(101)
	in.Changes[0].Numeric = &bad
	if _, err := s.Create(in, now); !errors.Is(err, ErrForbidden) {
		t.Fatalf("bounds: %v", err)
	}
	in = proposalInput(now)
	in.Nonce = "proposal-nonce-widen"
	in.Changes[0].Maximum = 1000
	if _, err := s.Create(in, now); !errors.Is(err, ErrForbidden) {
		t.Fatalf("proposal-defined widened bound: %v", err)
	}
	in = proposalInput(now)
	in.Nonce = "proposal-nonce-path"
	in.Changes[0].Path = "/bridge/unregisteredLimit"
	if _, err := s.Create(in, now); !errors.Is(err, ErrForbidden) {
		t.Fatalf("unknown parameter path: %v", err)
	}
	in = proposalInput(now)
	p, err := s.Create(in, now)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Create(in, now); !errors.Is(err, ErrReplay) {
		t.Fatalf("nonce replay: %v", err)
	}
	in.Nonce = "proposal-nonce-0002"
	if _, err = s.Create(in, now); !errors.Is(err, ErrConflict) {
		t.Fatalf("duplicate diff: %v", err)
	}
	p, _ = s.Deposit(p.ID, 100, now.Add(time.Minute))
	p, _ = s.RecordSimulation(p.ID, Simulation{TechnicalEvidence: "technical evidence hash", EconomicEvidence: "economic evidence hash", Passed: true}, now.Add(2*time.Minute))
	p, _ = s.DiscloseConflict(p.ID, ConflictDisclosure{Actor: "delegate-conflicted", Description: "Provider ownership interest disclosed", Recused: true}, now.Add(3*time.Minute))
	p, _ = openVoting(t, s, p.ID, VotingSnapshot{BasePower: map[string]uint64{"delegate-conflicted": 30, "validator-1": 70}}, now.Add(4*time.Minute))
	if _, err = s.Vote(p.ID, "delegate-conflicted", "yes", now.Add(5*time.Minute)); !errors.Is(err, ErrForbidden) {
		t.Fatalf("recusal: %v", err)
	}
	p, _ = s.Vote(p.ID, "validator-1", "yes", now.Add(5*time.Minute))
	p, _ = s.Finalize(p.ID, p.VotingEndsAt)
	p, _ = s.BeginExecution(p.ID, strings.Repeat("b", 64), p.ExecuteAfter)
	failed := NewExecutionReceipt("0x"+strings.Repeat("d", 64), 12, "0x"+strings.Repeat("e", 64), "0x"+strings.Repeat("f", 64), strings.Repeat("b", 64), "failed", p.ExecuteAfter.Add(time.Minute))
	rollback := NewExecutionReceipt("0x"+strings.Repeat("a", 64), 13, "0x"+strings.Repeat("c", 64), "0x"+strings.Repeat("d", 64), strings.Repeat("c", 64), "verified_rollback", p.ExecuteAfter.Add(2*time.Minute))
	p, err = s.VerifyExecution(p.ID, failed, &rollback, p.ExecuteAfter.Add(2*time.Minute))
	if err != nil || p.Status != StatusRolledBack {
		t.Fatalf("rollback: %+v %v", p, err)
	}
}

func TestVotingSnapshotRejectsCyclesAndFreezesDelegatedPower(t *testing.T) {
	now := time.Date(2026, 7, 22, 8, 0, 0, 0, time.UTC)
	s := testService(t)
	p, err := s.Create(proposalInput(now), now)
	if err != nil {
		t.Fatal(err)
	}
	p, _ = s.Deposit(p.ID, 100, now.Add(time.Minute))
	p, _ = s.RecordSimulation(p.ID, Simulation{TechnicalEvidence: "technical simulation evidence", EconomicEvidence: "economic simulation evidence", Passed: true}, now.Add(2*time.Minute))
	cycle := VotingSnapshot{BasePower: map[string]uint64{"alice": 40, "bob": 60}, Delegations: map[string]string{"alice": "bob", "bob": "alice"}}
	if _, err = s.SubmitElectorate(p.ID, cycle, strings.Repeat("9", 64), "ynx-electorate-snapshot/v1", "technical-1", now.Add(3*time.Minute), now.Add(3*time.Minute)); !errors.Is(err, ErrInvalid) {
		t.Fatalf("cycle accepted: %v", err)
	}
	snapshot := VotingSnapshot{BasePower: map[string]uint64{"alice": 40, "bob": 60}, Delegations: map[string]string{"alice": "bob"}}
	p, err = openVoting(t, s, p.ID, snapshot, now.Add(3*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if p.VotingPower["bob"] != 100 || p.VotingPower["alice"] != 0 || p.EligiblePower != 100 {
		t.Fatalf("power=%v eligible=%d", p.VotingPower, p.EligiblePower)
	}
	if _, err = s.Vote(p.ID, "alice", "yes", now.Add(4*time.Minute)); !errors.Is(err, ErrInvalid) {
		t.Fatalf("delegator voted: %v", err)
	}
	p, err = s.Vote(p.ID, "bob", "yes", now.Add(4*time.Minute))
	if err != nil || p.Votes["bob"].Power != 100 {
		t.Fatalf("delegate vote: %+v %v", p.Votes, err)
	}
}

func TestElectorateRequiresDistinctApprovalThreshold(t *testing.T) {
	now := time.Date(2026, 7, 22, 8, 0, 0, 0, time.UTC)
	s := testService(t)
	p, err := s.Create(proposalInput(now), now)
	if err != nil {
		t.Fatal(err)
	}
	p, _ = s.Deposit(p.ID, 100, now.Add(time.Minute))
	p, _ = s.RecordSimulation(p.ID, Simulation{TechnicalEvidence: "technical simulation evidence", EconomicEvidence: "economic simulation evidence", Passed: true}, now.Add(2*time.Minute))
	snapshot := VotingSnapshot{BasePower: map[string]uint64{"validator": 100}}
	p, err = s.SubmitElectorate(p.ID, snapshot, strings.Repeat("8", 64), "ynx-electorate-snapshot/v1", "technical-1", now.Add(3*time.Minute), now.Add(3*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	p, err = s.ApproveElectorate(p.ID, "technical-1", now.Add(4*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.OpenVoting(p.ID, now.Add(5*time.Minute)); !errors.Is(err, ErrNotReady) {
		t.Fatalf("single approval opened voting: %v", err)
	}
	if _, err = s.ApproveElectorate(p.ID, "technical-1", now.Add(5*time.Minute)); !errors.Is(err, ErrReplay) {
		t.Fatalf("duplicate approval: %v", err)
	}
	p, err = s.ApproveElectorate(p.ID, "technical-2", now.Add(5*time.Minute))
	if err != nil || p.Electorate.Status != "approved" {
		t.Fatalf("second approval: %+v %v", p.Electorate, err)
	}
	p, err = s.OpenVoting(p.ID, now.Add(6*time.Minute))
	if err != nil || p.Status != StatusVoting {
		t.Fatalf("open: %+v %v", p, err)
	}
}

func TestFailedSimulationRejectsAndOnlyProposerCanCancel(t *testing.T) {
	now := time.Date(2026, 7, 22, 8, 0, 0, 0, time.UTC)
	s := testService(t)
	p, err := s.Create(proposalInput(now), now)
	if err != nil {
		t.Fatal(err)
	}
	p, _ = s.Deposit(p.ID, 100, now.Add(time.Minute))
	p, err = s.RecordSimulation(p.ID, Simulation{TechnicalEvidence: "technical simulation failure receipt", EconomicEvidence: "economic simulation failure receipt", Passed: false}, now.Add(2*time.Minute))
	if err != nil || p.Status != StatusRejected {
		t.Fatalf("failed simulation: %+v %v", p, err)
	}
	s = testService(t)
	p, err = s.Create(proposalInput(now), now)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.CancelProposal(p.ID, "different-account", "Proposal is withdrawn after evidence review.", []string{"sha256:withdrawal-evidence"}, now.Add(time.Minute)); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-proposer cancellation: %v", err)
	}
	p, err = s.CancelProposal(p.ID, p.Input.Proposer, "Proposal is withdrawn after evidence review.", []string{"sha256:withdrawal-evidence"}, now.Add(time.Minute))
	if err != nil || p.Status != StatusCancelled || p.Cancellation == nil || p.Cancellation.AuditHash == "" {
		t.Fatalf("cancellation: %+v %v", p, err)
	}
}
