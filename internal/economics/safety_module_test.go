package economics

import (
	"strings"
	"testing"
	"time"
)

func TestSafetyModuleInsuranceFirstCooldownSlashAndResidual(t *testing.T) {
	asOf := time.Date(2026, 7, 22, 0, 0, 0, 0, time.UTC)
	cooling := asOf.Add(-24 * time.Hour)
	exited := asOf.Add(-8 * 24 * time.Hour)
	input := SafetyModuleInputs{AsOf: asOf, InsuranceReserveYNXT: 100, ShortfallYNXT: 500, SlashReason: "protocol_shortfall", EvidenceHash: strings.Repeat("a", 64), Stakes: []SafetyModuleStake{{Participant: "b", AmountYNXT: 600, Provenance: "native_wallet_ynxt", Status: "cooling", CooldownRequestedAt: &cooling}, {Participant: "a", AmountYNXT: 400, Provenance: "native_wallet_ynxt", Status: "active"}, {Participant: "c", AmountYNXT: 1_000, Provenance: "native_wallet_ynxt", Status: "exited", CooldownRequestedAt: &exited}}}
	result, err := SimulateSafetyModule(DefaultSafetyModulePolicy(), input)
	if err != nil {
		t.Fatal(err)
	}
	if result.ExecutionEnabled || result.ActivationEligible || result.GuaranteedYield || result.RecursiveRestaking || !result.CooldownSlashable || result.EligibleStakeYNXT != 1_000 || result.SlashCapacityYNXT != 300 || result.InsuranceUsedYNXT != 100 || result.StakeSlashedYNXT != 300 || result.UncoveredShortfallYNXT != 100 || len(result.Slashes) != 2 {
		t.Fatalf("unexpected safety waterfall: %+v", result)
	}
	if result.Slashes[0].Participant != "a" || result.Slashes[0].SlashYNXT != 120 || result.Slashes[1].Participant != "b" || result.Slashes[1].SlashYNXT != 180 {
		t.Fatalf("slash allocation was not deterministic and proportional: %+v", result.Slashes)
	}
}

func TestSafetyModuleRejectsRecursiveStakeAndMatureCoolingState(t *testing.T) {
	asOf := time.Now().UTC()
	request := asOf.Add(-8 * 24 * time.Hour)
	input := SafetyModuleInputs{AsOf: asOf, ShortfallYNXT: 1, SlashReason: "consensus_safety_failure", EvidenceHash: strings.Repeat("b", 64), Stakes: []SafetyModuleStake{{Participant: "a", AmountYNXT: 10, Provenance: "liquid_staking_share", Status: "active"}}}
	if _, err := SimulateSafetyModule(DefaultSafetyModulePolicy(), input); err == nil {
		t.Fatal("recursive stake provenance was accepted")
	}
	input.Stakes[0] = SafetyModuleStake{Participant: "a", AmountYNXT: 10, Provenance: "native_wallet_ynxt", Status: "cooling", CooldownRequestedAt: &request}
	if _, err := SimulateSafetyModule(DefaultSafetyModulePolicy(), input); err == nil {
		t.Fatal("mature cooldown remained slashable")
	}
}
