package governance

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func executedProposal(t *testing.T, s *Service, now time.Time) Proposal {
	t.Helper()
	p, err := s.Create(proposalInput(now), now)
	if err != nil {
		t.Fatal(err)
	}
	p, err = s.Deposit(p.ID, 100, now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	p, err = s.RecordSimulation(p.ID, Simulation{TechnicalEvidence: "technical simulation evidence", EconomicEvidence: "economic simulation evidence", Passed: true}, now.Add(2*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	p, err = openVoting(t, s, p.ID, VotingSnapshot{BasePower: map[string]uint64{"validator-1": 100}}, now.Add(3*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	p, err = s.Vote(p.ID, "validator-1", "yes", now.Add(4*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	p, err = s.Finalize(p.ID, p.VotingEndsAt)
	if err != nil {
		t.Fatal(err)
	}
	p, err = s.BeginExecution(p.ID, strings.Repeat("a", 64), p.ExecuteAfter)
	if err != nil {
		t.Fatal(err)
	}
	receipt := NewExecutionReceipt("0x"+strings.Repeat("b", 64), 20, "0x"+strings.Repeat("c", 64), "0x"+strings.Repeat("d", 64), strings.Repeat("a", 64), "verified", p.ExecuteAfter.Add(time.Minute))
	p, err = s.VerifyExecution(p.ID, receipt, nil, p.ExecuteAfter.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestRolesRequireExecutedProposalHaveTermsAndCanBeRemoved(t *testing.T) {
	now := time.Date(2026, 7, 22, 8, 0, 0, 0, time.UTC)
	s := testService(t)
	input := RoleAssignmentInput{Account: "ynx1securitymember", Role: RoleSecurityCouncil, Scopes: []Scope{ScopeBridge, ScopeOracle}, TermStartsAt: now.Add(4 * time.Hour), TermEndsAt: now.Add(180 * 24 * time.Hour), DecisionThreshold: 3, ConflictDisclosure: "No provider ownership or compensation interests.", Evidence: []string{"sha256:public-role-nomination"}}
	if _, err := s.AssignRole(input, "missing", now); !errors.Is(err, ErrForbidden) {
		t.Fatalf("unapproved role: %v", err)
	}
	p := executedProposal(t, s, now)
	assignment, err := s.AssignRole(input, p.ID, now.Add(4*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	roles := s.ActiveRoleNames(input.Account, now.Add(5*time.Hour))
	if !roles["emergency_signer"] || roles["executor"] {
		t.Fatalf("bad permissions: %v", roles)
	}
	if _, err = s.AssignRole(input, p.ID, now.Add(4*time.Hour)); !errors.Is(err, ErrConflict) {
		t.Fatalf("duplicate role: %v", err)
	}
	removed, err := s.RemoveRole(assignment.ID, p.ID, now.Add(6*time.Hour))
	if err != nil || removed.Status != "removed" || len(s.ActiveRoleNames(input.Account, now.Add(7*time.Hour))) != 0 {
		t.Fatalf("remove: %+v %v", removed, err)
	}
}

func TestRolesPersistAndRejectAuditTamper(t *testing.T) {
	now := time.Date(2026, 7, 22, 8, 0, 0, 0, time.UTC)
	s := testService(t)
	p := executedProposal(t, s, now)
	input := RoleAssignmentInput{Account: "ynx1observer", Role: RoleObserver, Scopes: []Scope{ScopeBridge}, TermStartsAt: now.Add(4 * time.Hour), TermEndsAt: now.Add(30 * 24 * time.Hour), DecisionThreshold: 1, ConflictDisclosure: "Independent observer with no disclosed conflicts.", Evidence: []string{"sha256:observer-appointment"}}
	a, err := s.AssignRole(input, p.ID, now.Add(4*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	path := t.TempDir() + "/state.json"
	if err = s.Save(path, now.Add(5*time.Hour)); err != nil {
		t.Fatal(err)
	}
	restored, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	items := restored.ListRoles()
	found := false
	for _, item := range items {
		if item.ID == a.ID {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("roles=%+v", items)
	}
}

func TestGenesisRolesRequirePinnedDistributedManifestAndRunOnce(t *testing.T) {
	now := time.Date(2026, 7, 22, 8, 0, 0, 0, time.UTC)
	allScopes := []Scope{ScopeBridge, ScopeOracle, ScopeTreasury}
	mk := func(account string, role GovernanceRole, threshold uint64) RoleAssignmentInput {
		return RoleAssignmentInput{Account: account, Role: role, Scopes: allScopes, TermStartsAt: now, TermEndsAt: now.Add(365 * 24 * time.Hour), DecisionThreshold: threshold, ConflictDisclosure: "No provider ownership or compensation conflict disclosed.", Evidence: []string{"sha256:public-genesis-nomination"}}
	}
	inputs := []RoleAssignmentInput{mk("tech-1", RoleTechnicalCouncil, 2), mk("tech-2", RoleTechnicalCouncil, 2), mk("security-1", RoleSecurityCouncil, 3), mk("security-2", RoleSecurityCouncil, 3), mk("security-3", RoleSecurityCouncil, 3), mk("treasury-1", RoleTreasuryCouncil, 2), mk("treasury-2", RoleTreasuryCouncil, 2)}
	manifestHash, err := GenesisRoleManifestHash(inputs)
	if err != nil {
		t.Fatal(err)
	}
	policy := testService(t).policy
	policy.GenesisRoleManifestHash = manifestHash
	s, err := NewService(policy)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.BootstrapRoles(inputs, strings.Repeat("0", 64), now); !errors.Is(err, ErrForbidden) {
		t.Fatalf("wrong manifest: %v", err)
	}
	roles, err := s.BootstrapRoles(inputs, manifestHash, now)
	if err != nil || len(roles) != 7 {
		t.Fatalf("bootstrap: %d %v", len(roles), err)
	}
	if _, err = s.BootstrapRoles(inputs, manifestHash, now); !errors.Is(err, ErrConflict) {
		t.Fatalf("second bootstrap: %v", err)
	}
}
