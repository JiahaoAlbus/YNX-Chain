package governance

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func upgradeProposalInput(now time.Time) ProposalInput {
	input := proposalInput(now)
	input.Nonce = "proposal-upgrade-nonce-0001"
	input.ProposalType = "protocol_upgrade"
	input.Scope = ScopeProtocolUpgrade
	input.Summary = "Upgrade the public testnet protocol runtime to the signed v2 release"
	input.Changes = []ParameterChange{{Path: "/protocol/release", Before: "v1", After: "v2"}}
	input.SourceCommit = strings.Repeat("d", 64)
	input.Release = "ynx-protocol-v2"
	input.UpgradeHash = strings.Repeat("a", 64)
	return input
}

func approvedUpgrade(t *testing.T, service *Service, now time.Time) Proposal {
	t.Helper()
	proposal, err := service.Create(upgradeProposalInput(now), now)
	if err != nil {
		t.Fatal(err)
	}
	if proposal, err = service.Deposit(proposal.ID, 100, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	simulation := Simulation{
		TechnicalEvidence:  "sha256:upgrade-technical-simulation",
		EconomicEvidence:   "sha256:upgrade-economic-simulation",
		SecurityEvidence:   "sha256:upgrade-security-simulation",
		UserImpactEvidence: "sha256:upgrade-user-impact-simulation",
		Passed:             true,
	}
	if proposal, err = service.RecordSimulation(proposal.ID, simulation, now.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if proposal, err = openVoting(t, service, proposal.ID, VotingSnapshot{BasePower: map[string]uint64{"validator": 100}}, now.Add(3*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if proposal, err = castTestVote(t, service, proposal.ID, "validator", "yes", now.Add(4*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if proposal, err = service.Finalize(proposal.ID, proposal.VotingEndsAt); err != nil {
		t.Fatal(err)
	}
	return proposal
}

func TestUpgradeRegistryBindsManifestAndRejectsConflicts(t *testing.T) {
	now := time.Date(2026, 7, 26, 8, 0, 0, 0, time.UTC)
	service := testService(t)
	proposal, err := service.Create(upgradeProposalInput(now), now)
	if err != nil {
		t.Fatal(err)
	}
	upgrades := service.ListUpgrades()
	if len(upgrades) != 1 || upgrades[0].ProposalID != proposal.ID || upgrades[0].Status != UpgradeRegistered ||
		upgrades[0].ManifestHash != strings.Repeat("a", 64) || upgrades[0].MigrationHash == "" ||
		upgrades[0].RollbackPlanHash == "" || upgrades[0].CanaryPlanHash == "" ||
		upgrades[0].VerificationPlanHash == "" || !upgrades[0].CanaryRequired ||
		upgrades[0].CanaryEligible || upgrades[0].CanaryStatus != "not_started" {
		t.Fatalf("unexpected upgrade registry record: %+v", upgrades)
	}

	duplicateManifest := upgradeProposalInput(now)
	duplicateManifest.Nonce = "proposal-upgrade-nonce-0002"
	duplicateManifest.Changes[0].After = "v2.0.1"
	if _, err = service.Create(duplicateManifest, now.Add(time.Minute)); !errors.Is(err, ErrConflict) {
		t.Fatalf("duplicate upgrade manifest accepted: %v", err)
	}

	activeScope := upgradeProposalInput(now)
	activeScope.Nonce = "proposal-upgrade-nonce-0003"
	activeScope.Changes[0].After = "v3"
	activeScope.SourceCommit = strings.Repeat("e", 64)
	activeScope.Release = "ynx-protocol-v3"
	activeScope.UpgradeHash = strings.Repeat("b", 64)
	if _, err = service.Create(activeScope, now.Add(2*time.Minute)); !errors.Is(err, ErrConflict) {
		t.Fatalf("second active upgrade in one scope accepted: %v", err)
	}
}

func TestUpgradeExecutionPersistsExactManifestAndReceipt(t *testing.T) {
	now := time.Date(2026, 7, 26, 9, 0, 0, 0, time.UTC)
	service := testService(t)
	proposal := approvedUpgrade(t, service, now)
	upgrades := service.ListUpgrades()
	if len(upgrades) != 1 || upgrades[0].Status != UpgradeTimelocked || !upgrades[0].CanaryEligible || upgrades[0].CanaryStatus != "eligible_not_run" {
		t.Fatalf("approved upgrade did not become canary-eligible: %+v", upgrades)
	}
	if _, err := service.BeginExecution(proposal.ID, strings.Repeat("b", 64), proposal.ExecuteAfter); !errors.Is(err, ErrForbidden) {
		t.Fatalf("wrong upgrade manifest accepted: %v", err)
	}
	proposal, err := service.BeginExecution(proposal.ID, strings.Repeat("a", 64), proposal.ExecuteAfter)
	if err != nil {
		t.Fatal(err)
	}
	receipt := NewExecutionReceipt("0x"+strings.Repeat("1", 64), 31, "0x"+strings.Repeat("2", 64), "0x"+strings.Repeat("3", 64), strings.Repeat("a", 64), "verified", proposal.ExecuteAfter.Add(time.Minute))
	proposal, err = service.VerifyExecution(proposal.ID, receipt, nil, proposal.ExecuteAfter.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	upgrades = service.ListUpgrades()
	if upgrades[0].Status != UpgradeVerified || upgrades[0].ExecutionManifestHash != strings.Repeat("a", 64) ||
		upgrades[0].ExecutionReceiptAuditID != receipt.AuditHash {
		t.Fatalf("execution was not correlated to upgrade record: %+v", upgrades[0])
	}

	path := t.TempDir() + "/state.json"
	if err = service.Save(path, proposal.ExecuteAfter.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	restored, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	restoredUpgrades := restored.ListUpgrades()
	if len(restoredUpgrades) != 1 || restoredUpgrades[0].AuditHash != upgrades[0].AuditHash ||
		restoredUpgrades[0].ExecutionReceiptAuditID != receipt.AuditHash {
		t.Fatalf("restored upgrade record mismatch: %+v", restoredUpgrades)
	}
	public := restored.PublicUpgrades()
	if len(public) != 1 || public[0].Status != StatusVerified || public[0].UpgradeStatus != UpgradeVerified || public[0].AuditHash != upgrades[0].AuditHash {
		t.Fatalf("public upgrade view is not backed by persistent registry: %+v", public)
	}
	foundAudit := false
	for _, record := range restored.PublicAudit() {
		if record.RecordType == "upgrade_transition" && record.AuditID == upgrades[0].Transitions[len(upgrades[0].Transitions)-1].AuditHash {
			foundAudit = true
		}
	}
	if !foundAudit {
		t.Fatal("public audit omitted the persistent upgrade transition")
	}
}

func TestLoadRejectsTamperedUpgradeRecordWithValidSnapshotDigest(t *testing.T) {
	now := time.Date(2026, 7, 26, 10, 0, 0, 0, time.UTC)
	service := testService(t)
	if _, err := service.Create(upgradeProposalInput(now), now); err != nil {
		t.Fatal(err)
	}
	path := t.TempDir() + "/state.json"
	if err := service.Save(path, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	rewriteSnapshot(t, path, func(envelope *snapshotEnvelope) {
		record := &envelope.Payload.Upgrades[0]
		record.Migration = "Tampered migration plan that is not proposal-bound."
		record.MigrationHash = hash("upgrade-migration", record.Migration)
		record.AuditHash = upgradeAudit(record)
	})
	if _, err := Load(path); !errors.Is(err, ErrForbidden) || !strings.Contains(err.Error(), "upgrade identity") {
		t.Fatalf("tampered upgrade record was not rejected: %v", err)
	}
}

func TestFailedUpgradePersistsVerifiedRollbackCorrelation(t *testing.T) {
	now := time.Date(2026, 7, 26, 11, 0, 0, 0, time.UTC)
	service := testService(t)
	proposal := approvedUpgrade(t, service, now)
	proposal, err := service.BeginExecution(proposal.ID, strings.Repeat("a", 64), proposal.ExecuteAfter)
	if err != nil {
		t.Fatal(err)
	}
	failed := NewExecutionReceipt("0x"+strings.Repeat("4", 64), 41, "0x"+strings.Repeat("5", 64), "0x"+strings.Repeat("6", 64), strings.Repeat("a", 64), "failed", proposal.ExecuteAfter.Add(time.Minute))
	proposal, err = service.VerifyExecution(proposal.ID, failed, nil, proposal.ExecuteAfter.Add(time.Minute))
	if err != nil || proposal.Status != StatusExecutionFailed {
		t.Fatalf("failed execution: %+v %v", proposal, err)
	}
	rollback := NewExecutionReceipt("0x"+strings.Repeat("7", 64), 42, "0x"+strings.Repeat("8", 64), "0x"+strings.Repeat("9", 64), strings.Repeat("c", 64), "verified_rollback", proposal.ExecuteAfter.Add(2*time.Minute))
	proposal, err = service.VerifyRollback(proposal.ID, rollback, proposal.ExecuteAfter.Add(2*time.Minute))
	if err != nil || proposal.Status != StatusRolledBack {
		t.Fatalf("verified rollback: %+v %v", proposal, err)
	}
	upgrades := service.ListUpgrades()
	if len(upgrades) != 1 || upgrades[0].Status != UpgradeRolledBack ||
		upgrades[0].ExecutionReceiptAuditID != failed.AuditHash ||
		upgrades[0].RollbackManifestHash != strings.Repeat("c", 64) ||
		upgrades[0].RollbackReceiptAuditID != rollback.AuditHash {
		t.Fatalf("rollback was not correlated to persistent upgrade record: %+v", upgrades)
	}
}
