package economics

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
	"testing"
	"time"
)

func TestStakingPenaltyRequiresThresholdAndReconcilesAllExposure(t *testing.T) {
	state, privateKeys := stakingRiskFixture(t)
	decision := stakingPenaltyFixture(state, "proposal-slash-1", StakingInfractionDowntime, 100)
	actionHash := stakingPenaltyDecisionHash(decision)

	_, _, err := ApplyStakingPenalty(state, decision, signStakingAction(t, actionHash, privateKeys, 1), decision.ExecuteAfter)
	assertRuntimeErrorCode(t, err, CodeStakingRiskAuthorization)

	next, event, err := ApplyStakingPenalty(state, decision, signStakingAction(t, actionHash, privateKeys, 2), decision.ExecuteAfter)
	if err != nil {
		t.Fatal(err)
	}
	if event.TotalSlashYNXT != 100 || event.OperatorSlashYNXT != 10 || event.DelegatorSlashYNXT != 80 || event.QueuedUnbondingSlashYNXT != 10 {
		t.Fatalf("unexpected slash allocation: %+v", event)
	}
	if event.OpeningExposureYNXT-event.TotalSlashYNXT != event.ClosingExposureYNXT {
		t.Fatal("slash event did not reconcile opening and closing exposure")
	}
	position := next.Validators[0]
	if position.Status != StakingValidatorStatusJailed || position.JailedUntil == nil || position.OperatorStakeYNXT != 990 || position.DelegatedStakeYNXT != 7_920 || position.QueuedUnbondingYNXT != 990 {
		t.Fatalf("unexpected jailed position: %+v", position)
	}
	if err := ValidateStakingRiskState(next); err != nil {
		t.Fatal(err)
	}
}

func TestStakingPenaltyRejectsEarlyOverLimitDuplicateAndUnknownSignatures(t *testing.T) {
	state, privateKeys := stakingRiskFixture(t)
	decision := stakingPenaltyFixture(state, "proposal-slash-attack", StakingInfractionDowntime, 100)
	actionHash := stakingPenaltyDecisionHash(decision)
	validAuthorization := signStakingAction(t, actionHash, privateKeys, 2)

	_, _, err := ApplyStakingPenalty(state, decision, validAuthorization, decision.ExecuteAfter.Add(-time.Second))
	assertRuntimeErrorCode(t, err, CodeStakingRiskTimelock)

	overLimit := decision
	overLimit.ProposalID = "proposal-over-limit"
	overLimit.SlashBPS = state.Policy.DowntimeMaximumSlashBPS + 1
	_, _, err = ApplyStakingPenalty(state, overLimit, signStakingAction(t, stakingPenaltyDecisionHash(overLimit), privateKeys, 2), overLimit.ExecuteAfter)
	assertRuntimeErrorCode(t, err, CodeStakingRiskInvalidDecision)

	duplicateSignature := StakingGovernanceAuthorization{ActionHash: validAuthorization.ActionHash, Signatures: append([]GovernanceSignature(nil), validAuthorization.Signatures...)}
	duplicateSignature.Signatures = append(duplicateSignature.Signatures, duplicateSignature.Signatures[0])
	_, _, err = ApplyStakingPenalty(state, decision, duplicateSignature, decision.ExecuteAfter)
	assertRuntimeErrorCode(t, err, CodeStakingRiskAuthorization)

	unknownPublic, unknownPrivate, generateErr := ed25519.GenerateKey(rand.Reader)
	if generateErr != nil {
		t.Fatal(generateErr)
	}
	unknown := GovernanceSignature{PublicKey: hex.EncodeToString(unknownPublic), Signature: hex.EncodeToString(ed25519.Sign(unknownPrivate, []byte(actionHash)))}
	unknownAuthorization := StakingGovernanceAuthorization{ActionHash: validAuthorization.ActionHash, Signatures: append([]GovernanceSignature(nil), validAuthorization.Signatures...)}
	unknownAuthorization.Signatures[1] = unknown
	_, _, err = ApplyStakingPenalty(state, decision, unknownAuthorization, decision.ExecuteAfter)
	assertRuntimeErrorCode(t, err, CodeStakingRiskAuthorization)

	next, _, err := ApplyStakingPenalty(state, decision, validAuthorization, decision.ExecuteAfter)
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = ApplyStakingPenalty(next, decision, validAuthorization, decision.ExecuteAfter.Add(time.Second))
	assertRuntimeErrorCode(t, err, CodeStakingRiskInvalidDecision)
}

func TestStakingRecoveryRequiresJailExpiryAndThresholdAuthorization(t *testing.T) {
	state, privateKeys := stakingRiskFixture(t)
	penalty := stakingPenaltyFixture(state, "proposal-slash-recovery", StakingInfractionInvalidState, 500)
	slashed, _, err := ApplyStakingPenalty(state, penalty, signStakingAction(t, stakingPenaltyDecisionHash(penalty), privateKeys, 2), penalty.ExecuteAfter)
	if err != nil {
		t.Fatal(err)
	}
	position := slashed.Validators[0]
	proposedAt := slashed.LastAsOf.Add(time.Hour)
	recovery := StakingRecoveryDecision{
		Version:      1,
		ProposalID:   "proposal-recovery-1",
		Validator:    position.Validator,
		EvidenceHash: stakingEvidenceHash("validator recovery drill passed"),
		ProposedAt:   proposedAt,
		ExecuteAfter: proposedAt.Add(time.Duration(slashed.Policy.GovernanceTimelockSeconds) * time.Second),
		Reason:       "operator remediation and replay evidence reviewed",
	}
	authorization := signStakingAction(t, stakingRecoveryDecisionHash(recovery), privateKeys, 2)
	early := position.JailedUntil.Add(-time.Second)
	if early.Before(recovery.ExecuteAfter) {
		early = recovery.ExecuteAfter
	}
	_, _, err = ApplyStakingRecovery(slashed, recovery, authorization, early)
	assertRuntimeErrorCode(t, err, CodeStakingRiskRecoveryUnavailable)

	executedAt := position.JailedUntil.Add(time.Second)
	if executedAt.Before(recovery.ExecuteAfter) {
		executedAt = recovery.ExecuteAfter.Add(time.Second)
	}
	recovered, event, err := ApplyStakingRecovery(slashed, recovery, authorization, executedAt)
	if err != nil {
		t.Fatal(err)
	}
	if event.Type != "ynx.staking.validator_unjailed.v1" || event.TotalSlashYNXT != 0 || recovered.Validators[0].Status != StakingValidatorStatusActive || recovered.Validators[0].JailedUntil != nil {
		t.Fatalf("unexpected recovery result: event=%+v position=%+v", event, recovered.Validators[0])
	}
	if err := ValidateStakingRiskState(recovered); err != nil {
		t.Fatal(err)
	}
}

func TestStakingRiskStateSurvivesRestartAndRejectsTampering(t *testing.T) {
	state, privateKeys := stakingRiskFixture(t)
	decision := stakingPenaltyFixture(state, "proposal-restart", StakingInfractionDoubleSign, 1_000)
	state, _, err := ApplyStakingPenalty(state, decision, signStakingAction(t, stakingPenaltyDecisionHash(decision), privateKeys, 2), decision.ExecuteAfter)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	var restored StakingRiskState
	if err := json.Unmarshal(encoded, &restored); err != nil {
		t.Fatal(err)
	}
	if restored.StateHash != state.StateHash {
		t.Fatal("restart changed the committed staking risk state hash")
	}
	if err := ValidateStakingRiskState(restored); err != nil {
		t.Fatal(err)
	}
	restored.Validators[0].DelegatedStakeYNXT++
	if err := ValidateStakingRiskState(restored); err == nil {
		t.Fatal("tampered validator exposure was accepted")
	}
}

func TestStakingCommitteeRejectsUnsortedAndDuplicateKeys(t *testing.T) {
	state, _ := stakingRiskFixture(t)
	unsorted := state.Committee
	unsorted.PublicKeys[0], unsorted.PublicKeys[1] = unsorted.PublicKeys[1], unsorted.PublicKeys[0]
	if err := unsorted.Validate(); err == nil {
		t.Fatal("unsorted governance committee was accepted")
	}
	duplicate := state.Committee
	duplicate.PublicKeys[1] = duplicate.PublicKeys[0]
	if err := duplicate.Validate(); err == nil {
		t.Fatal("duplicate governance key was accepted")
	}
}

func TestStakingRiskReplayIsDeterministicAndRejectsAmbiguousActions(t *testing.T) {
	state, privateKeys := stakingRiskFixture(t)
	penalty := stakingPenaltyFixture(state, "proposal-replay-slash", StakingInfractionDoubleSign, 1_000)
	penaltyAuthorization := signStakingAction(t, stakingPenaltyDecisionHash(penalty), privateKeys, 2)
	slashed, _, err := ApplyStakingPenalty(state, penalty, penaltyAuthorization, penalty.ExecuteAfter)
	if err != nil {
		t.Fatal(err)
	}
	proposedAt := slashed.LastAsOf.Add(time.Hour)
	recovery := StakingRecoveryDecision{
		Version:      1,
		ProposalID:   "proposal-replay-recovery",
		Validator:    state.Validators[0].Validator,
		EvidenceHash: stakingEvidenceHash("replay recovery evidence"),
		ProposedAt:   proposedAt,
		ExecuteAfter: proposedAt.Add(time.Duration(state.Policy.GovernanceTimelockSeconds) * time.Second),
		Reason:       "deterministic recovery replay",
	}
	recoveryAuthorization := signStakingAction(t, stakingRecoveryDecisionHash(recovery), privateKeys, 2)
	recoveryExecutedAt := slashed.Validators[0].JailedUntil.Add(time.Second)
	input := StakingRiskReplayInput{
		GenesisAsOf: state.GenesisAsOf,
		Policy:      &state.Policy,
		Committee:   state.Committee,
		Validators:  []ValidatorRiskPosition{{Validator: state.Validators[0].Validator, OperatorStakeYNXT: 1_000, DelegatedStakeYNXT: 8_000, QueuedUnbondingYNXT: 1_000}},
		Actions: []StakingRiskReplayAction{
			{Type: StakingRiskActionPenalty, ExecutedAt: penalty.ExecuteAfter, Penalty: &penalty, Authorization: penaltyAuthorization},
			{Type: StakingRiskActionRecovery, ExecutedAt: recoveryExecutedAt, Recovery: &recovery, Authorization: recoveryAuthorization},
		},
	}
	first, err := ReplayStakingRiskRuntime(input)
	if err != nil {
		t.Fatal(err)
	}
	second, err := ReplayStakingRiskRuntime(input)
	if err != nil {
		t.Fatal(err)
	}
	if first.StateHash != second.StateHash || len(first.Events) != 2 || first.Validators[0].Status != StakingValidatorStatusActive {
		t.Fatalf("staking replay was not deterministic: first=%+v second=%+v", first, second)
	}
	ambiguous := input
	ambiguous.Actions = append([]StakingRiskReplayAction(nil), input.Actions...)
	ambiguous.Actions[0].Recovery = &recovery
	_, err = ReplayStakingRiskRuntime(ambiguous)
	assertRuntimeErrorCode(t, err, CodeStakingRiskInvalidDecision)
}

func TestStakingRecoveryRejectsProposalPredatingCommittedState(t *testing.T) {
	state, privateKeys := stakingRiskFixture(t)
	penalty := stakingPenaltyFixture(state, "proposal-slash-predated-recovery", StakingInfractionInvalidState, 500)
	slashed, _, err := ApplyStakingPenalty(state, penalty, signStakingAction(t, stakingPenaltyDecisionHash(penalty), privateKeys, 2), penalty.ExecuteAfter)
	if err != nil {
		t.Fatal(err)
	}
	recovery := StakingRecoveryDecision{
		Version:      1,
		ProposalID:   "proposal-predated-recovery",
		Validator:    state.Validators[0].Validator,
		EvidenceHash: stakingEvidenceHash("predated recovery evidence"),
		ProposedAt:   slashed.LastAsOf.Add(-time.Second),
		ExecuteAfter: slashed.LastAsOf.Add(time.Duration(slashed.Policy.GovernanceTimelockSeconds) * time.Second),
		Reason:       "must be rejected because proposal predates committed slash",
	}
	executedAt := slashed.Validators[0].JailedUntil.Add(time.Second)
	_, _, err = ApplyStakingRecovery(slashed, recovery, signStakingAction(t, stakingRecoveryDecisionHash(recovery), privateKeys, 2), executedAt)
	assertRuntimeErrorCode(t, err, CodeStakingRiskInvalidDecision)
}

func TestStakingRiskStateRejectsVersionAndEventBoundaryTampering(t *testing.T) {
	state, privateKeys := stakingRiskFixture(t)
	penalty := stakingPenaltyFixture(state, "proposal-event-boundary", StakingInfractionDowntime, 100)
	state, _, err := ApplyStakingPenalty(state, penalty, signStakingAction(t, stakingPenaltyDecisionHash(penalty), privateKeys, 2), penalty.ExecuteAfter)
	if err != nil {
		t.Fatal(err)
	}
	versionTampered := state
	versionTampered.StateVersion++
	versionTampered.StateHash = stakingRiskStateHash(versionTampered)
	assertRuntimeErrorCode(t, ValidateStakingRiskState(versionTampered), CodeStakingRiskInvalidState)

	eventTampered := state
	eventTampered.Events = append([]StakingRiskEvent(nil), state.Events...)
	eventTampered.Events[0].Source = "untrusted-source"
	eventTampered.Events[0].ID = stakingRiskEventID(eventTampered.Events[0])
	eventTampered.Events[0].AuditHash = stakingRiskEventAuditHash(eventTampered.Events[0])
	eventTampered.StateHash = stakingRiskStateHash(eventTampered)
	assertRuntimeErrorCode(t, ValidateStakingRiskState(eventTampered), CodeStakingRiskInvalidState)
}

func stakingRiskFixture(t *testing.T) (StakingRiskState, map[string]ed25519.PrivateKey) {
	t.Helper()
	committee, privateKeys := generateStakingCommittee(t, 3, 2)
	genesis := time.Unix(1_800_000_000, 0).UTC()
	state, err := NewStakingRiskState(genesis, DefaultStakingRiskPolicy(), committee, []ValidatorRiskPosition{{Validator: "ynx-validator-alpha", OperatorStakeYNXT: 1_000, DelegatedStakeYNXT: 8_000, QueuedUnbondingYNXT: 1_000}})
	if err != nil {
		t.Fatal(err)
	}
	return state, privateKeys
}

func generateStakingCommittee(t *testing.T, members, threshold int) (StakingGovernanceCommittee, map[string]ed25519.PrivateKey) {
	t.Helper()
	privateKeys := make(map[string]ed25519.PrivateKey, members)
	publicKeys := make([]string, 0, members)
	for index := 0; index < members; index++ {
		publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		encoded := hex.EncodeToString(publicKey)
		publicKeys = append(publicKeys, encoded)
		privateKeys[encoded] = privateKey
	}
	sort.Strings(publicKeys)
	return StakingGovernanceCommittee{Version: 1, PublicKeys: publicKeys, Threshold: threshold}, privateKeys
}

func signStakingAction(t *testing.T, actionHash string, privateKeys map[string]ed25519.PrivateKey, count int) StakingGovernanceAuthorization {
	t.Helper()
	publicKeys := make([]string, 0, len(privateKeys))
	for publicKey := range privateKeys {
		publicKeys = append(publicKeys, publicKey)
	}
	sort.Strings(publicKeys)
	if count > len(publicKeys) {
		t.Fatalf("cannot sign with %d of %d keys", count, len(publicKeys))
	}
	authorization := StakingGovernanceAuthorization{ActionHash: actionHash, Signatures: make([]GovernanceSignature, 0, count)}
	for _, publicKey := range publicKeys[:count] {
		signature := ed25519.Sign(privateKeys[publicKey], []byte(actionHash))
		authorization.Signatures = append(authorization.Signatures, GovernanceSignature{PublicKey: publicKey, Signature: hex.EncodeToString(signature)})
	}
	return authorization
}

func stakingPenaltyFixture(state StakingRiskState, proposalID, infraction string, slashBPS int64) StakingPenaltyDecision {
	proposedAt := state.LastAsOf.Add(2 * time.Hour)
	return StakingPenaltyDecision{
		Version:      1,
		ProposalID:   proposalID,
		Validator:    state.Validators[0].Validator,
		Infraction:   infraction,
		SlashBPS:     slashBPS,
		EvidenceHash: stakingEvidenceHash(proposalID + infraction),
		ObservedAt:   state.LastAsOf.Add(time.Hour),
		ProposedAt:   proposedAt,
		ExecuteAfter: proposedAt.Add(time.Duration(state.Policy.GovernanceTimelockSeconds) * time.Second),
		Reason:       "testnet fault evidence was independently reviewed",
	}
}

func stakingEvidenceHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return "sha256:" + hex.EncodeToString(sum[:])
}
