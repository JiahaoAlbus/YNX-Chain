package economics

import (
	"strings"
	"testing"
	"time"
)

func TestSecurityPoolsIsolationWaterfallCooldownAndHaircut(t *testing.T) {
	in := securityPoolScenario()
	result, err := SimulateSecurityPools(DefaultSecurityPoolsPolicy(), in)
	if err != nil {
		t.Fatal(err)
	}
	if result.MainnetReady || result.ContractExecution || result.RecursiveRestaking || result.CrossServiceContagion || result.GuaranteedCoverage {
		t.Fatalf("candidate overclaimed: %+v", result)
	}
	if !result.Steps[0].Accepted || poolByID(t, result.Steps[0], "oracle").StakeYNXT != 600_000 {
		t.Fatalf("voluntary stake failed: %+v", result.Steps[0])
	}
	restaked := result.Steps[1]
	if restaked.Accepted || restaked.Failure != "recursive_or_encumbered_stake_rejected" || poolByID(t, restaked, "bridge").StakeYNXT != 600_000 {
		t.Fatalf("recursive stake did not fail atomically: %+v", restaked)
	}
	wrongCondition := result.Steps[3]
	if wrongCondition.Accepted || wrongCondition.Failure != "incident_condition_not_authorized_for_pool" || poolByID(t, wrongCondition, "oracle").StakeYNXT != 600_000 {
		t.Fatalf("cross-service condition accepted: %+v", wrongCondition)
	}
	incident := result.Steps[4]
	if !incident.Accepted || incident.InsuranceUsedYNXT != 100_000 || incident.StakeSlashedYNXT != 180_000 || incident.UncoveredLossYNXT != 20_000 || incident.ExitHaircutYNXT != 60_000 || incident.CrossPoolTransfersYNXT != 0 {
		t.Fatalf("waterfall mismatch: %+v", incident)
	}
	oracle := poolByID(t, incident, "oracle")
	bridge := poolByID(t, incident, "bridge")
	if oracle.StakeYNXT != 420_000 || oracle.PendingExitYNXT != 140_000 || bridge.StakeYNXT != 600_000 {
		t.Fatalf("pool isolation or haircut mismatch: oracle=%+v bridge=%+v", oracle, bridge)
	}
	early := result.Steps[5]
	if early.Accepted || early.Failure != "exit_not_mature" || poolByID(t, early, "oracle").StakeYNXT != 420_000 {
		t.Fatalf("early exit mutated state: %+v", early)
	}
	fulfilled := poolByID(t, result.Steps[6], "oracle")
	if !result.Steps[6].Accepted || fulfilled.StakeYNXT != 280_000 || fulfilled.PendingExitYNXT != 0 || fulfilled.ExitQueue[0].Status != "fulfilled" {
		t.Fatalf("mature exit failed: %+v", result.Steps[6])
	}
	bridgeIncident := result.Steps[7]
	if !bridgeIncident.Accepted || poolByID(t, bridgeIncident, "oracle").StakeYNXT != 280_000 || bridgeIncident.UncoveredLossYNXT != 220_000 {
		t.Fatalf("bridge incident contaminated oracle pool: %+v", bridgeIncident)
	}
}

func TestSecurityPoolGovernanceTimelockAndPauseExit(t *testing.T) {
	in := securityPoolScenario()
	in.Actions = []SecurityPoolAction{
		{Epoch: 3, Type: "pause", Pool: "storage", GovernanceApproved: true, DecisionEpoch: 0, EvidenceHash: strings.Repeat("b", 64)},
		{Epoch: 7, Type: "pause", Pool: "storage", GovernanceApproved: true, DecisionEpoch: 0, EvidenceHash: strings.Repeat("b", 64)},
		{Epoch: 8, Type: "stake", Pool: "storage", Amount: 10, FundingSource: "external_unencumbered"},
		{Epoch: 8, Type: "request_exit", Pool: "storage", Amount: 100},
		{Epoch: 29, Type: "fulfill_exit", Pool: "storage", QueueID: "storage-exit-000001"},
	}
	result, err := SimulateSecurityPools(DefaultSecurityPoolsPolicy(), in)
	if err != nil {
		t.Fatal(err)
	}
	if result.Steps[0].Accepted || result.Steps[0].Failure != "control_governance_evidence_or_timelock_invalid" {
		t.Fatalf("early governance control accepted: %+v", result.Steps[0])
	}
	if !result.Steps[1].Accepted || !poolByID(t, result.Steps[1], "storage").Paused {
		t.Fatalf("mature governance pause failed: %+v", result.Steps[1])
	}
	if result.Steps[2].Accepted || result.Steps[2].Failure != "pool_paused" {
		t.Fatalf("paused stake accepted: %+v", result.Steps[2])
	}
	if !result.Steps[3].Accepted || !result.Steps[4].Accepted || poolByID(t, result.Steps[4], "storage").StakeYNXT != 399_900 {
		t.Fatalf("pause blocked exit path: %+v", result.Steps)
	}
}

func securityPoolScenario() SecurityPoolsInputs {
	initial := map[string]InitialSecurityPool{}
	for _, id := range CanonicalSecurityPoolIDs {
		initial[id] = InitialSecurityPool{StakeYNXT: 400_000, InsuranceYNXT: 50_000}
	}
	initial["safety_module"] = InitialSecurityPool{StakeYNXT: 1_000_000, InsuranceYNXT: 200_000}
	initial["oracle"] = InitialSecurityPool{StakeYNXT: 500_000, InsuranceYNXT: 100_000}
	initial["bridge"] = InitialSecurityPool{StakeYNXT: 600_000, InsuranceYNXT: 100_000}
	evidence := strings.Repeat("a", 64)
	return SecurityPoolsInputs{AsOf: time.Date(2026, 7, 22, 0, 0, 0, 0, time.UTC), InitialPools: initial, Actions: []SecurityPoolAction{
		{Epoch: 1, Type: "stake", Pool: "oracle", Amount: 100_000, FundingSource: "external_unencumbered"},
		{Epoch: 1, Type: "stake", Pool: "bridge", Amount: 100_000, FundingSource: "oracle_pool_receipt"},
		{Epoch: 2, Type: "request_exit", Pool: "oracle", Amount: 200_000},
		{Epoch: 10, Type: "incident", Pool: "oracle", Amount: 300_000, Condition: "bridge_failure", GovernanceApproved: true, DecisionEpoch: 0, EvidenceHash: evidence},
		{Epoch: 10, Type: "incident", Pool: "oracle", Amount: 300_000, Condition: "oracle_failure", GovernanceApproved: true, DecisionEpoch: 0, EvidenceHash: evidence},
		{Epoch: 15, Type: "fulfill_exit", Pool: "oracle", QueueID: "oracle-exit-000001"},
		{Epoch: 23, Type: "fulfill_exit", Pool: "oracle", QueueID: "oracle-exit-000001"},
		{Epoch: 30, Type: "incident", Pool: "bridge", Amount: 500_000, Condition: "bridge_failure", GovernanceApproved: true, DecisionEpoch: 20, EvidenceHash: evidence},
	}}
}

func poolByID(t *testing.T, step SecurityPoolsStep, id string) SecurityPoolSnapshot {
	t.Helper()
	for _, pool := range step.Pools {
		if pool.Pool == id {
			return pool
		}
	}
	t.Fatalf("pool %s missing", id)
	return SecurityPoolSnapshot{}
}
