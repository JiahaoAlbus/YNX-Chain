package governance

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func cloneParameterRules(in map[string]ParameterRule) map[string]ParameterRule {
	out := make(map[string]ParameterRule, len(in))
	for path, rule := range in {
		out[path] = rule
	}
	return out
}

func raiseBridgeExposureMinimum(t *testing.T, service *Service, minimum int64) {
	t.Helper()
	service.mu.Lock()
	defer service.mu.Unlock()
	found := false
	for index := range service.registries.Parameters.Parameters {
		parameter := &service.registries.Parameters.Parameters[index]
		if parameter.Path != "/bridge/exposureLimit" {
			continue
		}
		parameter.AllowedRange.Minimum = &minimum
		found = true
		break
	}
	if !found {
		t.Fatal("bridge exposure parameter missing from authoritative registry")
	}
	digest, err := canonicalRegistryDigest(service.registries)
	if err != nil {
		t.Fatal(err)
	}
	service.registries.Digest = digest
}

func prepareVotingPendingProposal(t *testing.T, service *Service, now time.Time) Proposal {
	t.Helper()
	proposal, err := service.Create(proposalInput(now), now)
	if err != nil {
		t.Fatal(err)
	}
	proposal, err = service.Deposit(proposal.ID, 100, now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	proposal, err = service.RecordSimulation(proposal.ID, Simulation{
		TechnicalEvidence:  "sha256:parameter-registry-technical-simulation",
		EconomicEvidence:   "sha256:parameter-registry-economic-simulation",
		SecurityEvidence:   "sha256:parameter-registry-security-simulation",
		UserImpactEvidence: "sha256:parameter-registry-user-impact-simulation",
		Passed:             true,
	}, now.Add(2*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	snapshot := normalizeTestSnapshot(VotingSnapshot{BasePower: map[string]uint64{"validator": 100}})
	proposal, err = service.SubmitElectorate(proposal.ID, snapshot, strings.Repeat("9", 64), "ynx-electorate-snapshot/v1", "technical-1", now.Add(3*time.Minute), now.Add(3*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	proposal, err = service.ApproveElectorate(proposal.ID, "technical-1", now.Add(4*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	proposal, err = service.ApproveElectorate(proposal.ID, "technical-2", now.Add(5*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	return proposal
}

func TestPolicyParameterRulesCannotDivergeFromAuthoritativeRegistry(t *testing.T) {
	base := testService(t).policy
	base.ParameterRules = cloneParameterRules(base.ParameterRules)
	base.ParameterRules["/bridge/exposureLimit"] = ParameterRule{Scope: ScopeBridge, Numeric: true, Minimum: 0, Maximum: 600_000_000}
	if _, err := NewService(base); !errors.Is(err, ErrForbidden) || !strings.Contains(err.Error(), "authoritative bounds") {
		t.Fatalf("widened runtime policy was accepted: %v", err)
	}

	base = testService(t).policy
	base.ParameterRules = cloneParameterRules(base.ParameterRules)
	base.ParameterRules["/bridge/legacyLimit"] = ParameterRule{Scope: ScopeBridge, Numeric: true, Minimum: 0, Maximum: 100}
	if _, err := NewService(base); !errors.Is(err, ErrForbidden) || !strings.Contains(err.Error(), "absent from the authoritative registry") {
		t.Fatalf("unregistered runtime policy path was accepted: %v", err)
	}
}

func TestAuthoritativeRegistryIsRevalidatedBeforeVoting(t *testing.T) {
	now := time.Date(2026, 7, 27, 8, 0, 0, 0, time.UTC)
	service := testService(t)
	proposal := prepareVotingPendingProposal(t, service, now)
	raiseBridgeExposureMinimum(t, service, 46_000_000)

	if _, err := service.OpenVoting(proposal.ID, now.Add(6*time.Minute)); !errors.Is(err, ErrForbidden) || !strings.Contains(err.Error(), "registry bounds") {
		t.Fatalf("registry drift did not stop voting: %v", err)
	}
	stored, err := service.Get(proposal.ID)
	if err != nil || stored.Status != StatusVotingPending {
		t.Fatalf("failed voting gate mutated proposal state: %+v err=%v", stored, err)
	}
}

func TestAuthoritativeRegistryIsRevalidatedBeforeFinalization(t *testing.T) {
	now := time.Date(2026, 7, 27, 9, 0, 0, 0, time.UTC)
	service := testService(t)
	proposal := prepareVotingPendingProposal(t, service, now)
	proposal, err := service.OpenVoting(proposal.ID, now.Add(6*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	proposal, err = castTestVote(t, service, proposal.ID, "validator", "yes", now.Add(7*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	raiseBridgeExposureMinimum(t, service, 46_000_000)

	if _, err = service.Finalize(proposal.ID, proposal.VotingEndsAt); !errors.Is(err, ErrForbidden) || !strings.Contains(err.Error(), "registry bounds") {
		t.Fatalf("registry drift did not stop finalization: %v", err)
	}
	stored, getErr := service.Get(proposal.ID)
	if getErr != nil || stored.Status != StatusVotingActive {
		t.Fatalf("failed finalization gate mutated proposal state: %+v err=%v", stored, getErr)
	}
}

func TestAuthoritativeRegistryIsRevalidatedBeforeExecution(t *testing.T) {
	now := time.Date(2026, 7, 27, 10, 0, 0, 0, time.UTC)
	service := testService(t)
	proposal := prepareVotingPendingProposal(t, service, now)
	proposal, err := service.OpenVoting(proposal.ID, now.Add(6*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	proposal, err = castTestVote(t, service, proposal.ID, "validator", "yes", now.Add(7*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	proposal, err = service.Finalize(proposal.ID, proposal.VotingEndsAt)
	if err != nil {
		t.Fatal(err)
	}
	manifest := strings.Repeat("a", 64)
	passTestCanary(t, service, proposal, manifest)
	raiseBridgeExposureMinimum(t, service, 46_000_000)

	if _, err = service.BeginExecution(proposal.ID, manifest, proposal.ExecuteAfter); !errors.Is(err, ErrForbidden) || !strings.Contains(err.Error(), "registry bounds") {
		t.Fatalf("registry drift did not stop execution preparation: %v", err)
	}
	stored, getErr := service.Get(proposal.ID)
	if getErr != nil || stored.Status != StatusTimelockActive || stored.ExecutionHash != "" {
		t.Fatalf("failed execution gate mutated proposal state: %+v err=%v", stored, getErr)
	}
	timelocks := service.ListTimelocks(proposal.ExecuteAfter)
	if len(timelocks) != 1 || timelocks[0].Status != TimelockActive || timelocks[0].ExecutionManifestHash != "" {
		t.Fatalf("failed execution gate mutated timelock state: %+v", timelocks)
	}
}
