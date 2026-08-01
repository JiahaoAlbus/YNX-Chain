package economics

import (
	"crypto/ed25519"
	"encoding/json"
	"testing"
	"time"
)

func TestSafetyRuntimeVoluntaryStakeExitQueueAndCooldown(t *testing.T) {
	state, _ := safetyRuntimeFixture(t, 100)
	depositAt := state.LastAsOf.Add(time.Hour)
	deposit := safetyDepositFixture("deposit-alpha", "wallet-alpha", 1_000, depositAt)
	state, event, err := ApplySafetyStakeDeposit(state, deposit, depositAt)
	if err != nil {
		t.Fatal(err)
	}
	if event.Type != "ynx.safety.stake_registered.v1" || event.ExternalTransferExecuted || state.Stakes[0].AmountYNXT != 1_000 || state.ExecutionEnabled || state.Production {
		t.Fatalf("unexpected deposit state: event=%+v state=%+v", event, state)
	}

	requestAt := depositAt.Add(time.Hour)
	request := SafetyStakeExitAction{Version: 1, ActionID: "exit-request-alpha", Participant: "wallet-alpha", WalletApprovalEvidenceHash: stakingEvidenceHash("exit-request-alpha"), RequestedAt: requestAt}
	state, _, err = ApplySafetyStakeExitRequest(state, request, requestAt)
	if err != nil {
		t.Fatal(err)
	}
	if state.Stakes[0].Status != SafetyStakeStatusCooling || state.Stakes[0].CooldownRequestedAt == nil {
		t.Fatalf("exit request did not enter cooling: %+v", state.Stakes[0])
	}

	early := requestAt.Add(time.Duration(state.Policy.Module.CooldownSeconds)*time.Second - time.Second)
	complete := SafetyStakeExitAction{Version: 1, ActionID: "exit-complete-alpha", Participant: "wallet-alpha", WalletApprovalEvidenceHash: stakingEvidenceHash("exit-complete-alpha"), RequestedAt: requestAt}
	_, _, err = ApplySafetyStakeExitCompletion(state, complete, early)
	assertRuntimeErrorCode(t, err, CodeSafetyRuntimeExitUnavailable)

	completedAt := requestAt.Add(time.Duration(state.Policy.Module.CooldownSeconds) * time.Second)
	state, completed, err := ApplySafetyStakeExitCompletion(state, complete, completedAt)
	if err != nil {
		t.Fatal(err)
	}
	if completed.AmountYNXT != 1_000 || completed.ExternalTransferExecuted || state.Stakes[0].Status != SafetyStakeStatusExited || state.Stakes[0].AmountYNXT != 0 {
		t.Fatalf("unexpected completed exit: event=%+v stake=%+v", completed, state.Stakes[0])
	}
	if err := ValidateSafetyModuleRuntimeState(state); err != nil {
		t.Fatal(err)
	}
}

func TestSafetyRuntimeInsuranceFirstCoolingSlashLifetimeCapAndResidual(t *testing.T) {
	state, privateKeys := safetyRuntimeFixture(t, 100)
	firstAt := state.LastAsOf.Add(time.Hour)
	state = mustSafetyDeposit(t, state, safetyDepositFixture("deposit-a", "wallet-a", 400, firstAt), firstAt)
	secondAt := firstAt.Add(time.Hour)
	state = mustSafetyDeposit(t, state, safetyDepositFixture("deposit-b", "wallet-b", 600, secondAt), secondAt)

	requestAt := secondAt.Add(time.Hour)
	request := SafetyStakeExitAction{Version: 1, ActionID: "exit-request-b", Participant: "wallet-b", WalletApprovalEvidenceHash: stakingEvidenceHash("exit-request-b"), RequestedAt: requestAt}
	state, _, _ = ApplySafetyStakeExitRequest(state, request, requestAt)

	decision := safetyShortfallFixture(state, "shortfall-1", 500)
	authorization := signStakingAction(t, safetyShortfallDecisionHash(decision), privateKeys, 2)
	state, event, err := ApplySafetyShortfall(state, decision, authorization, decision.ExecuteAfter)
	if err != nil {
		t.Fatal(err)
	}
	if event.InsuranceUsedYNXT != 100 || event.StakeSlashedYNXT != 300 || event.UncoveredShortfallYNXT != 100 || len(event.SlashAllocations) != 2 {
		t.Fatalf("unexpected safety waterfall: %+v", event)
	}
	if event.SlashAllocations[0].Participant != "wallet-a" || event.SlashAllocations[0].SlashYNXT != 120 || event.SlashAllocations[1].Participant != "wallet-b" || event.SlashAllocations[1].SlashYNXT != 180 || event.SlashAllocations[1].Status != SafetyStakeStatusCooling {
		t.Fatalf("slash allocation is not deterministic or cooling stake escaped: %+v", event.SlashAllocations)
	}
	if state.CumulativeStakeSlashedYNXT != 300 || state.CumulativeUncoveredShortfallYNXT != 100 || state.InsuranceReserveYNXT != 0 {
		t.Fatalf("unexpected cumulative state: %+v", state)
	}

	second := safetyShortfallFixture(state, "shortfall-2", 50)
	state, secondEvent, err := ApplySafetyShortfall(state, second, signStakingAction(t, safetyShortfallDecisionHash(second), privateKeys, 2), second.ExecuteAfter)
	if err != nil {
		t.Fatal(err)
	}
	if secondEvent.StakeSlashedYNXT != 0 || secondEvent.UncoveredShortfallYNXT != 50 {
		t.Fatalf("lifetime slash maximum was bypassed: %+v", secondEvent)
	}
	if err := ValidateSafetyModuleRuntimeState(state); err != nil {
		t.Fatal(err)
	}
}

func TestSafetyRuntimeGovernanceThresholdTimelockAndReplayProtection(t *testing.T) {
	state, privateKeys := safetyRuntimeFixture(t, 50)
	at := state.LastAsOf.Add(time.Hour)
	state = mustSafetyDeposit(t, state, safetyDepositFixture("deposit-governance", "wallet-governance", 1_000, at), at)
	decision := safetyShortfallFixture(state, "shortfall-governance", 100)
	actionHash := safetyShortfallDecisionHash(decision)

	_, _, err := ApplySafetyShortfall(state, decision, signStakingAction(t, actionHash, privateKeys, 1), decision.ExecuteAfter)
	assertRuntimeErrorCode(t, err, CodeSafetyRuntimeAuthorization)
	_, _, err = ApplySafetyShortfall(state, decision, signStakingAction(t, actionHash, privateKeys, 2), decision.ExecuteAfter.Add(-time.Second))
	assertRuntimeErrorCode(t, err, CodeSafetyRuntimeTimelock)

	next, _, err := ApplySafetyShortfall(state, decision, signStakingAction(t, actionHash, privateKeys, 2), decision.ExecuteAfter)
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = ApplySafetyShortfall(next, decision, signStakingAction(t, actionHash, privateKeys, 2), decision.ExecuteAfter.Add(time.Second))
	assertRuntimeErrorCode(t, err, CodeSafetyRuntimeDuplicateAction)
}

func TestSafetyRuntimeInsuranceFundingRestartAndTamperRejection(t *testing.T) {
	state, privateKeys := safetyRuntimeFixture(t, 10)
	proposedAt := state.LastAsOf.Add(time.Hour)
	decision := SafetyInsuranceFundingDecision{Version: 1, ProposalID: "insurance-funding-1", AmountYNXT: 90, CustodyReceiptHash: stakingEvidenceHash("insurance-funding-receipt"), ProposedAt: proposedAt, ExecuteAfter: proposedAt.Add(time.Duration(state.Policy.GovernanceTimelockSeconds) * time.Second), Reason: "governance-approved insurance reserve funding evidence"}
	authorization := signStakingAction(t, safetyFundingDecisionHash(decision), privateKeys, 2)

	state, event, err := ApplySafetyInsuranceFunding(state, decision, authorization, decision.ExecuteAfter)
	if err != nil {
		t.Fatal(err)
	}
	if event.InsuranceFundedYNXT != 90 || event.ExternalTransferExecuted || state.InsuranceReserveYNXT != 100 || state.CumulativeInsuranceFundingYNXT != 90 {
		t.Fatalf("unexpected insurance funding state: event=%+v state=%+v", event, state)
	}

	raw, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	var restored SafetyModuleRuntimeState
	if err := json.Unmarshal(raw, &restored); err != nil {
		t.Fatal(err)
	}
	if restored.StateHash != state.StateHash {
		t.Fatal("restart changed safety runtime state hash")
	}
	if err := ValidateSafetyModuleRuntimeState(restored); err != nil {
		t.Fatal(err)
	}
	restored.InsuranceReserveYNXT++
	if err := ValidateSafetyModuleRuntimeState(restored); err == nil {
		t.Fatal("tampered insurance reserve was accepted")
	}
}

func TestSafetyRuntimeRejectsRecursiveProvenanceCapAndStaleEvidence(t *testing.T) {
	state, _ := safetyRuntimeFixture(t, 0)
	at := state.LastAsOf.Add(time.Hour)
	action := safetyDepositFixture("deposit-invalid", "wallet-invalid", 1, at)
	action.Provenance = "liquid_staking_share"
	_, _, err := ApplySafetyStakeDeposit(state, action, at)
	assertRuntimeErrorCode(t, err, CodeSafetyRuntimeInvalidAction)

	action = safetyDepositFixture("deposit-cap", "wallet-cap", state.Policy.Module.StakeCapYNXT+1, at)
	_, _, err = ApplySafetyStakeDeposit(state, action, at)
	assertRuntimeErrorCode(t, err, CodeSafetyRuntimeStakeCap)

	action = safetyDepositFixture("deposit-expired", "wallet-expired", 1, at)
	action.ExpiresAt = at.Add(-time.Second)
	_, _, err = ApplySafetyStakeDeposit(state, action, at)
	assertRuntimeErrorCode(t, err, CodeSafetyRuntimeInvalidAction)
}

func safetyRuntimeFixture(t *testing.T, insurance int64) (SafetyModuleRuntimeState, map[string]ed25519.PrivateKey) {
	t.Helper()
	committee, privateKeys := generateStakingCommittee(t, 3, 2)
	state, err := NewSafetyModuleRuntimeState(time.Unix(1_800_000_000, 0).UTC(), insurance, DefaultSafetyModuleRuntimePolicy(), committee)
	if err != nil {
		t.Fatal(err)
	}
	return state, privateKeys
}

func safetyDepositFixture(actionID, participant string, amount int64, at time.Time) SafetyStakeDepositAction {
	return SafetyStakeDepositAction{Version: 1, ActionID: actionID, Participant: participant, AmountYNXT: amount, Provenance: "native_wallet_ynxt", WalletApprovalEvidenceHash: stakingEvidenceHash(actionID + "-wallet"), CustodyReceiptHash: stakingEvidenceHash(actionID + "-custody"), ApprovedAt: at.Add(-time.Minute), ExpiresAt: at.Add(time.Hour)}
}

func safetyShortfallFixture(state SafetyModuleRuntimeState, proposalID string, amount int64) SafetyShortfallDecision {
	proposedAt := state.LastAsOf.Add(time.Hour)
	return SafetyShortfallDecision{Version: 1, ProposalID: proposalID, ShortfallYNXT: amount, Trigger: "protocol_shortfall", EvidenceHash: stakingEvidenceHash(proposalID + "-evidence"), ProposedAt: proposedAt, ExecuteAfter: proposedAt.Add(time.Duration(state.Policy.GovernanceTimelockSeconds) * time.Second), Reason: "independently reviewed shortfall evidence"}
}

func mustSafetyDeposit(t *testing.T, state SafetyModuleRuntimeState, action SafetyStakeDepositAction, at time.Time) SafetyModuleRuntimeState {
	t.Helper()
	next, _, err := ApplySafetyStakeDeposit(state, action, at)
	if err != nil {
		t.Fatal(err)
	}
	return next
}
