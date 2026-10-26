package consensus

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	abci "github.com/cometbft/cometbft/abci/types"
)

// Use real independent pairs and two actual registration blocks. The later
// event makes a schedule's narrower prefix-height check observable without
// introducing a fabricated membership source or a signature-verification spy.
func spacedValidationRegistryFixture(t *testing.T) (*validatorRegistryFixture, *Application, []engineTestKey) {
	t.Helper()
	f := newValidatorRegistryFixture(t)
	app := newPinnedRegistryApp(t, f, "")
	var keys []engineTestKey
	for i := range f.bootstrap.record.Members {
		height := f.doc.InitialHeight + int64(i)
		key, wire := engineRegistration(t, f, i, height)
		tx, err := EncodeValidatorRegistryTransaction(wire)
		if err != nil {
			t.Fatal(err)
		}
		response, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: height, NextValidatorsHash: bytes.Clone(f.bootstrap.validatorSetHash), Txs: [][]byte{tx}})
		if err != nil || len(response.TxResults) != 1 || response.TxResults[0].Code != 0 {
			t.Fatalf("real spaced registration failed: %+v %v", response, err)
		}
		if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
		keys = append(keys, key)
	}
	return f, app, keys
}

// Preserve the canonical envelopes and operation identities so a damaged
// branch reaches the real ML-DSA/SLH-DSA verifier, rather than an outer hash gate.
func damageValidationRegistrationBranch(t *testing.T, registry *ValidatorRegistryState, branch string) {
	t.Helper()
	event := &registry.Events[0]
	registration, err := ynxconsensusauth.DecodeRegistration(event.Wire)
	if err != nil {
		t.Fatal(err)
	}
	switch branch {
	case "ML-DSA-87":
		registration.PossessionMLDSA87[0] ^= 1
	case "SLH-DSA-SHA2-256f":
		registration.PossessionSLHDSASHA2256f[0] ^= 1
	default:
		t.Fatal("unknown test branch")
	}
	wire, err := registration.MarshalBinary()
	if err != nil {
		t.Fatal(err)
	}
	payload, err := EncodeValidatorRegistryTransaction(wire)
	if err != nil {
		t.Fatal(err)
	}
	operation, err := ynxconsensusauth.RegistrationHash(wire)
	if err != nil {
		t.Fatal(err)
	}
	event.Wire, event.ABCIHash, event.OperationHash = wire, SignedTransactionHash(payload), "0x"+hex.EncodeToString(operation[:])
}

func sameValidationError(t *testing.T, want, got error) {
	t.Helper()
	if want == nil && got == nil {
		return
	}
	if want == nil || got == nil || want.Error() != got.Error() {
		t.Fatalf("validation changed original error: want %v, got %v", want, got)
	}
}

func TestStateValidationFactsPreserveOriginalErrorsAndBothRealProofBranches(t *testing.T) {
	f, app, _ := spacedValidationRegistryFixture(t)
	h := app.committed.Height
	schedule, err := NewPQEngineSchedule(f.bootstrap, app.committed.ValidatorRegistry, h, h+4)
	if err != nil {
		t.Fatal(err)
	}
	facts, err := validateValidatorRegistryStateOwnedHistory(app.committed, app.validatedMigration)
	if err != nil || facts.history == nil {
		t.Fatal("original complete history was not authenticated:", err)
	}
	// A fact's height belongs to the candidate being sealed, not to the previous
	// committed height. This separate replay is only a test of the helper's API.
	facts, err = replayOwnedValidatorRegistry(app.committed.ValidatorRegistry, app.bootstrap, schedule.AuthorizedAt)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name   string
		mutate func(*PQEngineSchedule)
	}{
		{"valid", func(*PQEngineSchedule) {}},
		{"genesis", func(s *PQEngineSchedule) { s.GenesisID[0] ^= 1 }},
		{"chain", func(s *PQEngineSchedule) { s.ChainID += "-other" }},
		{"root", func(s *PQEngineSchedule) { s.RegistryRoot = strings.Repeat("00", 32) }},
		{"missing member prefix", func(s *PQEngineSchedule) { s.RegistryEventCount-- }},
		{"activation membership", func(s *PQEngineSchedule) { s.ActivationValidatorSetHash = s.OriginalValidatorSetHash }},
		{"height before root", func(s *PQEngineSchedule) {
			s.RegistryHeight--
			s.AuthorizedAt--
			s.ParamsUpdateHeight--
			s.RegistryRoot = strings.Repeat("00", 32)
		}},
		{"params timing", func(s *PQEngineSchedule) { s.ParamsUpdateHeight++ }},
		{"key timing", func(s *PQEngineSchedule) { s.ValidatorUpdateHeight++ }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			candidate := clonePQEngineSchedule(schedule)
			tc.mutate(candidate)
			// The standalone path still really replays the prefix, with no prior
			// history capability. Compare its original first error to reuse.
			want := validatePQEngineSchedule(candidate, app.bootstrap, app.committed.ValidatorRegistry, schedule.AuthorizedAt)
			_, got := facts.validateSchedule(candidate)
			sameValidationError(t, want, got)
		})
	}
	for _, branch := range []string{"ML-DSA-87", "SLH-DSA-SHA2-256f"} {
		t.Run(branch, func(t *testing.T) {
			candidate := app.committed
			candidate.Height, candidate.Version = schedule.AuthorizedAt, PQEngineScheduleStateVersion
			candidate.ValidatorRegistry = cloneValidatorRegistry(candidate.ValidatorRegistry)
			candidate.PQEngineSchedule = clonePQEngineSchedule(schedule)
			damageValidationRegistrationBranch(t, candidate.ValidatorRegistry, branch)
			// Simultaneously invalid later data must not hide the earlier
			// cryptographic failure, including after a successful prior attempt.
			candidate.PQEngineSchedule.RegistryRoot = strings.Repeat("00", 32)
			want := validateValidatorRegistryStateOwned(candidate, app.validatedMigration)
			if want == nil || !strings.Contains(want.Error(), "validator-key proof rejected") {
				t.Fatalf("did not reach real damaged branch: %v", want)
			}
			timings := &commitValidationTimings{}
			got := candidate.validateOwnedWithTimings(app.validatedMigration, timings)
			sameValidationError(t, want, got)
			if timings.valid || timings.failedPhase != "validator_registry" {
				t.Fatal("failed registry proof was bypassed by prior facts", timings.failedPhase)
			}
		})
	}
}

func TestStateValidationFactsOwnBytesAndKeepPrefixAndFutureMembershipChecks(t *testing.T) {
	f, app, keys := spacedValidationRegistryFixture(t)
	h := app.committed.Height
	schedule, err := NewPQEngineSchedule(f.bootstrap, app.committed.ValidatorRegistry, h, h+4)
	if err != nil {
		t.Fatal(err)
	}
	registry := cloneValidatorRegistry(app.committed.ValidatorRegistry)
	facts, err := replayOwnedValidatorRegistry(registry, app.bootstrap, schedule.ActivationHeight)
	if err != nil {
		t.Fatal(err)
	}
	validated, err := facts.validateSchedule(schedule)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := validated.newSnapshot()
	if err != nil || snapshot.history != facts.history || snapshot.registry != facts.registry || snapshot.schedule != validated.schedule {
		t.Fatal("snapshot did not consume the same immutable validation result:", err)
	}
	wantHash, err := snapshot.ExpectedValidatorHash(schedule.ActivationHeight)
	if err != nil {
		t.Fatal(err)
	}
	registry.Events[0].Wire[0] ^= 1
	registry.Bootstrap.Members[0].Ed25519[0] ^= 1
	schedule.GenesisID[0] ^= 1
	gotHash, err := snapshot.ExpectedValidatorHash(snapshot.schedule.ActivationHeight)
	if err != nil || !bytes.Equal(wantHash, gotHash) || !reflect.DeepEqual(facts.registry.Bootstrap, app.bootstrap.record) {
		t.Fatal("validated view aliases caller's registry/schedule bytes:", err)
	}
	if _, err := newPQEngineSnapshot(app.bootstrap, registry, snapshot.schedule, snapshot.through); err == nil {
		t.Fatal("a separate attempt reused a fact instead of rejecting changed bytes")
	}
	// A proper (shorter) schedule prefix must be replayed independently of the
	// full history; a later lawful revocation cannot be mistaken for that prefix.
	schedule = clonePQEngineSchedule(snapshot.schedule)
	approved := schedule.ActivationHeight + 1
	next := appendEngineRevocation(t, f, app.committed.ValidatorRegistry, keys[0], approved, approved+2)
	full, err := replayOwnedValidatorRegistry(next, app.bootstrap, approved)
	if err != nil {
		t.Fatal(err)
	}
	checked, err := full.validateSchedule(schedule)
	if err != nil {
		t.Fatal("valid original shorter prefix was rejected:", err)
	}
	// A schedule-only check really authenticates just its shorter prefix. Even
	// a package-local misuse of that view must not mint engine authority without
	// the complete registry replay that normal constructors always perform.
	prefixOnly, err := (&validatedValidatorRegistry{bootstrap: app.bootstrap, registry: next, through: approved}).validateSchedule(schedule)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := prefixOnly.newSnapshot(); err == nil || err.Error() != "engine snapshot requires complete authenticated registry history" {
		t.Fatal("prefix-only validation became full engine authority:", err)
	}
	after, err := checked.newSnapshot()
	if err != nil || after.history != full.history {
		t.Fatal("full history was lost while checking a shorter prefix:", err)
	}
	if _, err := after.ConsensusKeysAt(f.doc.ChainID, keys[0].address, approved+2); err == nil {
		t.Fatal("prefix reuse bypassed effective revocation")
	}
	badRoot := clonePQEngineSchedule(schedule)
	badRoot.RegistryRoot = next.Root
	_, got := full.validateSchedule(badRoot)
	want := validatePQEngineSchedule(badRoot, app.bootstrap, next, approved)
	if want == nil {
		t.Fatal("full-history root was accepted as the different prefix root")
	}
	sameValidationError(t, want, got)
	conflict := appendEngineRevocation(t, f, app.committed.ValidatorRegistry, keys[0], schedule.ActivationHeight-2, schedule.ActivationHeight)
	conflictingFacts, err := replayOwnedValidatorRegistry(conflict, app.bootstrap, schedule.ActivationHeight-2)
	if err != nil {
		t.Fatal(err)
	}
	_, err = conflictingFacts.validateSchedule(schedule)
	if err == nil || err.Error() != "later key event conflicts with committed initial activation" {
		t.Fatal("schedule skipped a signed conflicting later event:", err)
	}
	empty := appendEngineRevocation(t, f, next, keys[1], approved+1, approved+100)
	emptyFacts, err := replayOwnedValidatorRegistry(empty, app.bootstrap, approved+1)
	if err != nil {
		t.Fatal(err)
	}
	emptySchedule, err := emptyFacts.validateSchedule(schedule)
	if err != nil {
		t.Fatal("future-empty counterexample should first pass initial schedule:", err)
	}
	if _, err := emptySchedule.newSnapshot(); err == nil || err.Error() != "PQ history removes every validator" {
		t.Fatal("snapshot fact skipped the distant empty-membership boundary:", err)
	}
}

func TestStateValidationFactsActualScheduledCommitReopensAndRechecksProofs(t *testing.T) {
	f, app, authorization, schedule, path, _ := persistentEngineAuthorizationFixture(t)
	app.SetCommitTimingEnabled(true)
	if err := app.SetCommitValidationTimingEnabled(true); err != nil {
		t.Fatal(err)
	}
	response, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: schedule.AuthorizedAt, NextValidatorsHash: bytes.Clone(f.bootstrap.validatorSetHash)})
	if err != nil || app.pending == nil || app.pending.PQEngineSchedule == nil {
		t.Fatal("normal scheduled Finalize did not produce a candidate:", err)
	}
	expected, err := json.Marshal(app.pending)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	detail, ok := app.LastCommitValidationTiming()
	if !ok || !detail.Valid || detail.Height != schedule.AuthorizedAt || detail.FailedPhase != "" || len(detail.PhaseNs) != 34 {
		t.Fatal("real Commit did not complete the original validation phases", detail)
	}
	for _, phase := range []string{"validator_registry", "engine_schedule", "engine_snapshot", "pq_state"} {
		if _, ok := detail.PhaseNs[phase]; !ok {
			t.Fatal("original diagnostic phase disappeared", phase)
		}
	}
	reopened, err := NewPersistentApplicationWithEngineAuthorization(f.migration, path, f.bootstrap, authorization)
	if err != nil {
		t.Fatal(err)
	}
	actual, err := json.Marshal(reopened.committed)
	if err != nil || !bytes.Equal(actual, expected) {
		t.Fatal("real Commit/reopen changed original JSON or AppHash:", err)
	}
	committedHash, err := hex.DecodeString(reopened.committed.AppHash)
	if err != nil || !bytes.Equal(response.AppHash, committedHash) {
		t.Fatal("real Finalize AppHash differs from reopened committed AppHash:", err)
	}
	// Facts are process/attempt-local. A new restore must reverify BOTH original
	// proof branches even after the same file has previously restored correctly.
	for _, branch := range []string{"ML-DSA-87", "SLH-DSA-SHA2-256f"} {
		t.Run(branch, func(t *testing.T) {
			candidate := reopened.committed
			candidate.ValidatorRegistry = cloneValidatorRegistry(candidate.ValidatorRegistry)
			damageValidationRegistrationBranch(t, candidate.ValidatorRegistry, branch)
			raw, err := json.Marshal(candidate)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, raw, 0o600); err != nil {
				t.Fatal(err)
			}
			if _, err := NewPersistentApplicationWithEngineAuthorization(f.migration, path, f.bootstrap, authorization); err == nil || !strings.Contains(err.Error(), "validator-key proof rejected") {
				t.Fatal("cold restore skipped the damaged original proof:", err)
			}
			if err := os.WriteFile(path, expected, 0o600); err != nil {
				t.Fatal(err)
			}
		})
	}
}
