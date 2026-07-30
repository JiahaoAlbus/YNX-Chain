package economics

import (
	"errors"
	"testing"
	"time"
)

func TestRuntimeEpochReconcilesIssuanceBurnAndRevenue(t *testing.T) {
	genesis := time.Unix(1_800_000_000, 0).UTC()
	state, err := NewEconomicRuntimeState(genesis, 1_000_000_000, DefaultGovernedRuntimePolicy())
	if err != nil {
		t.Fatal(err)
	}
	input := runtimeEpochFixture(1, genesis.Add(24*time.Hour), false)
	next, event, err := ApplyRuntimeEpoch(state, input)
	if err != nil {
		t.Fatal(err)
	}
	if event.IssuanceAllocation.Total() != event.IssuanceYNXT {
		t.Fatalf("issuance allocation mismatch: %+v", event.IssuanceAllocation)
	}
	if event.FeeAccounting.BurnYNXT()+event.FeeAccounting.RevenueYNXT() != event.FeeAccounting.GrossFeeYNXT {
		t.Fatal("burn and revenue do not reconcile to gross fee")
	}
	if event.ClosingSupplyYNXT != event.OpeningSupplyYNXT+event.IssuanceYNXT-event.FeeAccounting.BurnYNXT() {
		t.Fatal("supply equation failed")
	}
	if next.TotalSupplyYNXT != state.GenesisSupplyYNXT+next.CumulativeIssuanceYNXT-next.CumulativeBurnYNXT {
		t.Fatal("runtime cumulative supply invariant failed")
	}
	if err := ValidateEconomicRuntimeState(next); err != nil {
		t.Fatal(err)
	}
}

func TestRuntimeRejectsBurnMisclassifiedAsRevenue(t *testing.T) {
	genesis := time.Unix(1_800_000_000, 0).UTC()
	state, err := NewEconomicRuntimeState(genesis, 1_000_000_000, DefaultGovernedRuntimePolicy())
	if err != nil {
		t.Fatal(err)
	}
	input := runtimeEpochFixture(1, genesis.Add(24*time.Hour), false)
	input.Fees.TreasuryYNXT++
	_, _, err = ApplyRuntimeEpoch(state, input)
	assertRuntimeErrorCode(t, err, CodeRuntimeFeeReconciliation)
}

func TestRuntimePolicyChangeRequiresGovernanceTimelockAndRateLimit(t *testing.T) {
	genesis := time.Unix(1_800_000_000, 0).UTC()
	policy := DefaultGovernedRuntimePolicy()
	state, err := NewEconomicRuntimeState(genesis, 1_000_000_000, policy)
	if err != nil {
		t.Fatal(err)
	}
	candidate := policy
	candidate.Economics.AnnualIssuanceCeilingBPS += 50
	_, _, err = ScheduleRuntimePolicyChange(state, "proposal-17", "ynx-governance-testnet", false, genesis.Add(time.Hour), candidate)
	assertRuntimeErrorCode(t, err, CodeRuntimeGovernanceRequired)
	scheduled, _, err := ScheduleRuntimePolicyChange(state, "proposal-17", "ynx-governance-testnet", true, genesis.Add(time.Hour), candidate)
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = ActivateScheduledRuntimePolicy(scheduled, scheduled.PendingPolicy.ActivateAfter.Add(-time.Second))
	assertRuntimeErrorCode(t, err, CodeRuntimeTimelockActive)
	activated, _, err := ActivateScheduledRuntimePolicy(scheduled, scheduled.PendingPolicy.ActivateAfter)
	if err != nil {
		t.Fatal(err)
	}
	if activated.Policy.Economics.AnnualIssuanceCeilingBPS != candidate.Economics.AnnualIssuanceCeilingBPS || activated.PendingPolicy != nil {
		t.Fatal("scheduled policy did not activate exactly")
	}
	unsafe := activated.Policy
	unsafe.Economics.AnnualIssuanceCeilingBPS += activated.Policy.Economics.MaxAnnualParameterDeltaBPS + 1
	_, _, err = ScheduleRuntimePolicyChange(activated, "proposal-18", "ynx-governance-testnet", true, runtimeLatestCommittedAsOf(activated).Add(time.Hour), unsafe)
	assertRuntimeErrorCode(t, err, CodeRuntimeInvalidTransition)
}

func TestRuntimeEmergencyModeCapsIssuanceAndRequiresPublicReason(t *testing.T) {
	genesis := time.Unix(1_800_000_000, 0).UTC()
	policy := DefaultGovernedRuntimePolicy()
	state, err := NewEconomicRuntimeState(genesis, 1_000_000_000, policy)
	if err != nil {
		t.Fatal(err)
	}
	input := runtimeEpochFixture(1, genesis.Add(24*time.Hour), true)
	input.StakedSupplyYNXT = 1
	input.ValidatorCount = 1
	input.LargestOperatorBPS = 10_000
	input.TargetAnnualSecurityBudgetYNXT = state.TotalSupplyYNXT
	input.EmergencyReason = ""
	_, _, err = ApplyRuntimeEpoch(state, input)
	assertRuntimeErrorCode(t, err, CodeRuntimeEmergencyBound)
	input.EmergencyReason = "validator quorum degradation drill"
	_, event, err := ApplyRuntimeEpoch(state, input)
	if err != nil {
		t.Fatal(err)
	}
	if event.AnnualIssuanceRateBPS > policy.EmergencyIssuanceCeilingBPS {
		t.Fatalf("emergency issuance %d exceeds ceiling %d", event.AnnualIssuanceRateBPS, policy.EmergencyIssuanceCeilingBPS)
	}
}

func TestRuntimeDeterministicReplayAcrossUsageScenarios(t *testing.T) {
	genesis := time.Unix(1_800_000_000, 0).UTC()
	input := RuntimeReplayInput{GenesisAsOf: genesis, GenesisSupplyYNXT: 1_000_000_000}
	for epoch := int64(1); epoch <= 3; epoch++ {
		item := runtimeEpochFixture(epoch, genesis.Add(time.Duration(epoch)*24*time.Hour), false)
		item.Fees.GrossFeeYNXT *= epoch
		item.Fees.BaseFeeBurnYNXT *= epoch
		item.Fees.ServiceBurnYNXT *= epoch
		item.Fees.ValidatorYNXT *= epoch
		item.Fees.ProviderYNXT *= epoch
		item.Fees.ProtocolYNXT *= epoch
		item.Fees.TreasuryYNXT *= epoch
		input.Epochs = append(input.Epochs, item)
	}
	first, err := ReplayEconomicRuntime(input)
	if err != nil {
		t.Fatal(err)
	}
	second, err := ReplayEconomicRuntime(input)
	if err != nil {
		t.Fatal(err)
	}
	if first.StateHash != second.StateHash || len(first.EconomicEvents) != 3 {
		t.Fatalf("deterministic replay mismatch: %s != %s", first.StateHash, second.StateHash)
	}
	first.TotalSupplyYNXT++
	if err := ValidateEconomicRuntimeState(first); err == nil {
		t.Fatal("tampered supply was accepted")
	}
}

func TestRuntimeUsageAndSecurityInputsMoveIssuanceWithinBounds(t *testing.T) {
	genesis := time.Unix(1_800_000_000, 0).UTC()
	policy := DefaultGovernedRuntimePolicy()
	state, err := NewEconomicRuntimeState(genesis, 1_000_000_000, policy)
	if err != nil {
		t.Fatal(err)
	}
	low := runtimeEpochFixture(1, genesis.Add(24*time.Hour), false)
	low.StakedSupplyYNXT = 300_000_000
	low.ValidatorCount = 8
	low.LargestOperatorBPS = 5_000
	low.TargetAnnualSecurityBudgetYNXT = 50_000_000
	low.Fees = EpochFeeAccounting{GrossFeeYNXT: 1_000, BaseFeeBurnYNXT: 400, ServiceBurnYNXT: 100, ValidatorYNXT: 350, ProviderYNXT: 50, ProtocolYNXT: 50, TreasuryYNXT: 50}
	_, lowEvent, err := ApplyRuntimeEpoch(state, low)
	if err != nil {
		t.Fatal(err)
	}
	high := runtimeEpochFixture(1, genesis.Add(24*time.Hour), false)
	high.StakedSupplyYNXT = 700_000_000
	high.ValidatorCount = 64
	high.LargestOperatorBPS = 1_000
	high.TargetAnnualSecurityBudgetYNXT = 1_000_000
	high.Fees = EpochFeeAccounting{GrossFeeYNXT: 2_000_000, BaseFeeBurnYNXT: 800_000, ServiceBurnYNXT: 200_000, ValidatorYNXT: 700_000, ProviderYNXT: 100_000, ProtocolYNXT: 100_000, TreasuryYNXT: 100_000}
	_, highEvent, err := ApplyRuntimeEpoch(state, high)
	if err != nil {
		t.Fatal(err)
	}
	if lowEvent.AnnualIssuanceRateBPS <= highEvent.AnnualIssuanceRateBPS {
		t.Fatalf("security-stressed scenario should issue more: low=%d high=%d", lowEvent.AnnualIssuanceRateBPS, highEvent.AnnualIssuanceRateBPS)
	}
	for _, rate := range []int64{lowEvent.AnnualIssuanceRateBPS, highEvent.AnnualIssuanceRateBPS} {
		if rate < policy.Economics.AnnualIssuanceFloorBPS || rate > policy.Economics.AnnualIssuanceCeilingBPS {
			t.Fatalf("issuance rate %d outside policy bounds", rate)
		}
	}
}

func runtimeEpochFixture(epoch int64, asOf time.Time, emergency bool) RuntimeEpochInput {
	return RuntimeEpochInput{
		Epoch:                          epoch,
		AsOf:                           asOf,
		DurationSeconds:                24 * 60 * 60,
		StakedSupplyYNXT:               600_000_000,
		ValidatorCount:                 40,
		LargestOperatorBPS:             1_800,
		TargetAnnualSecurityBudgetYNXT: 20_000_000,
		Fees: EpochFeeAccounting{
			GrossFeeYNXT:    1_000_000,
			BaseFeeBurnYNXT: 400_000,
			ServiceBurnYNXT: 100_000,
			ValidatorYNXT:   350_000,
			ProviderYNXT:    50_000,
			ProtocolYNXT:    50_000,
			TreasuryYNXT:    50_000,
		},
		EmergencyMode: emergency,
	}
}

func assertRuntimeErrorCode(t *testing.T, err error, code string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected error code %s", code)
	}
	var runtimeErr *RuntimeError
	if !errors.As(err, &runtimeErr) || runtimeErr.Code != code {
		t.Fatalf("expected error code %s, got %v", code, err)
	}
}
