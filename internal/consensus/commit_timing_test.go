package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
)

func TestCommitTimingObservesRealStorageWithoutChangingReplay(t *testing.T) {
	migration, _ := journalFixture(t)
	for _, tc := range []struct {
		name   string
		open   func(chain.ConsensusMigrationState, string) (*Application, error)
		encode string
	}{
		{"atomic-json", NewPersistentApplication, "json_encode"},
		{"snapshot-journal-v1", NewJournaledApplication, "json_encode"},
		{"block-journal-v2", NewBlockJournaledApplication, "delta_encode"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "state")
			app, err := tc.open(migration, path)
			if err != nil {
				t.Fatal(err)
			}
			if _, ok := app.LastCommitTiming(); ok || app.commitTimings != nil {
				t.Fatal("diagnostics enabled by default")
			}
			app.SetCommitTimingEnabled(true)
			ctx := context.Background()
			height := int64(migration.Height) + 1
			response, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: height, Time: time.Unix(1802736000+height, 0), Txs: [][]byte{journalTransfer(t, 1)}})
			if err != nil || len(response.TxResults) != 1 || response.TxResults[0].Code != 0 {
				t.Fatalf("real signed execution: %v", err)
			}
			if _, err = app.Commit(ctx, &abci.RequestCommit{}); err != nil {
				t.Fatal(err)
			}
			sample, ok := app.LastCommitTiming()
			if !ok || !sample.Durable || sample.Height != height || sample.Storage != tc.name || sample.ElapsedNs <= 0 || sample.PayloadBytes <= 0 {
				t.Fatalf("missing real persistence measurement: %+v", sample)
			}
			var sum int64
			for stage, ns := range sample.StagesNs {
				if ns < 0 {
					t.Fatalf("negative %s", stage)
				}
				sum += ns
			}
			if sum > sample.ElapsedNs || sample.StagesNs[tc.encode] <= 0 || sample.StagesNs["file_sync"] <= 0 {
				t.Fatalf("invalid measured intervals: %+v", sample)
			}
			if tc.name == "atomic-json" && sample.StagesNs["directory_sync"] <= 0 {
				t.Fatal("directory sync missing")
			}
			sample.StagesNs["file_sync"] = -1
			again, _ := app.LastCommitTiming()
			if again.StagesNs["file_sync"] <= 0 {
				t.Fatal("caller mutated retained diagnostic")
			}
			restored, err := tc.open(migration, path)
			if err != nil || !journalStateEqual(t, app.committed, restored.committed) {
				t.Fatalf("actual durable replay differs: %v", err)
			}
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: height + 1, Time: time.Unix(1802736001+height, 0), Txs: [][]byte{journalTransfer(t, 2)}}); err != nil {
				t.Fatal(err)
			}
			app.pending.AppHash = "invalid-hash"
			if _, err = app.Commit(ctx, &abci.RequestCommit{}); err == nil {
				t.Fatal("invalid pending state committed")
			}
			failed, ok := app.LastCommitTiming()
			if !ok || failed.Durable || failed.Height != height+1 || app.committed.Height != height {
				t.Fatal("failed attempt reused previous successful sample", failed)
			}
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatal("rejected state changed durable bytes", err)
			}
			app.SetCommitTimingEnabled(false)
			if _, ok = app.LastCommitTiming(); ok || app.commitTimings != nil {
				t.Fatal("disabled diagnostics retained state")
			}
		})
	}
}

func TestCommitTimingNeverLabelsMemoryOnlyExecutionDurable(t *testing.T) {
	migration, _ := journalFixture(t)
	app, err := NewApplication(migration)
	if err != nil {
		t.Fatal(err)
	}
	app.SetCommitTimingEnabled(true)
	if err := app.SetCommitValidationTimingEnabled(true); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if _, err = app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: int64(migration.Height) + 1}); err != nil {
		t.Fatal(err)
	}
	if _, err = app.Commit(ctx, &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	sample, ok := app.LastCommitTiming()
	if !ok || sample.Durable || sample.PayloadBytes != 0 || len(sample.StagesNs) != 0 {
		t.Fatal("memory-only path labeled durable", sample)
	}
	if _, ok := app.LastCommitValidationTiming(); ok {
		t.Fatal("memory-only execution manufactured persistence validation detail")
	}
	if _, err = app.Commit(ctx, &abci.RequestCommit{}); err == nil {
		t.Fatal("commit without pending succeeded")
	}
	if _, ok = app.LastCommitTiming(); ok {
		t.Fatal("missing pending state retained old sample")
	}
}

// These are validation intervals, not additional persistence stages. Keep this
// independent list explicit so a missing or overlapping probe cannot look like
// a successful observation merely because it agrees with its own recorder.
var commitValidationTestPhases = []string{
	"anchor", "validator_registry", "engine_schedule", "engine_snapshot", "pq_state",
	"migration_trace_lots", "legacy_sponsor", "legacy_resource_market", "legacy_contracts",
	"legacy_pay", "legacy_ai", "legacy_trust", "ledger_records", "pay", "resource",
	"resource_sponsor", "trust", "ide", "pq_resources", "pq_dex", "pq_contracts",
	"pq_native_actions", "pq_ethereum", "pq_ordered_resources", "fee_events", "governance",
	"dex", "asset_auth", "account_abstraction", "account_abstraction_policy",
	"ownership_and_vault_supply", "staking", "supply", "app_hash",
}

func TestCommitValidationTimingTracksSameRealAttemptAndOriginalWire(t *testing.T) {
	migration, _ := journalFixture(t)
	for _, tc := range []struct {
		name string
		open func(chain.ConsensusMigrationState, string) (*Application, error)
	}{
		{"atomic-json", NewPersistentApplication},
		{"snapshot-journal-v1", NewJournaledApplication},
		{"block-journal-v2", NewBlockJournaledApplication},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "state")
			app, err := tc.open(migration, path)
			if err != nil {
				t.Fatal(err)
			}
			if err := app.SetCommitValidationTimingEnabled(true); err == nil {
				t.Fatal("detail enabled without original Commit opt-in")
			}
			if _, ok := app.LastCommitValidationTiming(); ok {
				t.Fatal("validation detail enabled by default")
			}
			app.SetCommitTimingEnabled(true)
			if err := app.SetCommitValidationTimingEnabled(true); err != nil {
				t.Fatal(err)
			}
			ctx := context.Background()
			height := int64(migration.Height) + 1
			response, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: height, Time: time.Unix(1802736000+height, 0), Txs: [][]byte{journalTransfer(t, 1)}})
			if err != nil || len(response.TxResults) != 1 || response.TxResults[0].Code != 0 {
				t.Fatalf("real signed execution: %v", err)
			}
			if _, err := app.Commit(ctx, &abci.RequestCommit{}); err != nil {
				t.Fatal(err)
			}
			outer, outerOK := app.LastCommitTiming()
			detail, ok := app.LastCommitValidationTiming()
			if !outerOK || !outer.Durable || !ok || !detail.Valid || detail.Height != height || detail.Height != outer.Height || detail.FailedPhase != "" || detail.ElapsedNs <= 0 || detail.ElapsedNs > outer.StagesNs["validate"] {
				t.Fatalf("validation detail is not aligned to its real Commit: %+v / %+v", detail, outer)
			}
			assertCommitValidationPartitions(t, detail, len(commitValidationTestPhases))
			if detail.HashDocumentNs <= 0 || detail.HashEncodeDigestNs <= 0 {
				t.Fatal("actual hash document/combined encode-digest intervals missing")
			}
			wire, err := json.Marshal(outer)
			if err != nil {
				t.Fatal(err)
			}
			var fields map[string]json.RawMessage
			if err := json.Unmarshal(wire, &fields); err != nil || len(fields) != 6 {
				t.Fatal("original Commit JSON shape changed", err)
			}
			for _, field := range []string{"height", "storage", "durable", "elapsedNs", "payloadBytes", "stagesNs"} {
				if _, exists := fields[field]; !exists {
					t.Fatal("original Commit JSON field missing", field)
				}
			}
			for stage := range outer.StagesNs {
				switch stage {
				case "validate", "json_encode", "delta_encode", "journal_maintenance", "prepare_file", "write", "file_sync", "close_file", "rename", "directory_sync", "version_checkpoint":
				default:
					t.Fatal("validation detail leaked into outer stage sum", stage)
				}
			}
			wire, err = json.Marshal(detail)
			if err != nil || string(wire) != "{}" {
				t.Fatal("owned detail unexpectedly added a public JSON format", err)
			}
			detail.PhaseNs["anchor"] = -1
			again, _ := app.LastCommitValidationTiming()
			if again.PhaseNs["anchor"] < 0 {
				t.Fatal("caller mutated retained validation intervals")
			}
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: height + 1, Time: time.Unix(1802736001+height, 0), Txs: [][]byte{journalTransfer(t, 2)}}); err != nil {
				t.Fatal(err)
			}
			app.pending.AppHash = "invalid-hash"
			if _, err := app.Commit(ctx, &abci.RequestCommit{}); err == nil {
				t.Fatal("observation permitted invalid pending hash")
			}
			outer, _ = app.LastCommitTiming()
			failed, ok := app.LastCommitValidationTiming()
			if !ok || failed.Valid || failed.FailedPhase != "app_hash" || failed.Height != height+1 || failed.Height != outer.Height || outer.Durable || app.committed.Height != height {
				t.Fatalf("failed validation reused a prior attempt: %+v / %+v", failed, outer)
			}
			assertCommitValidationPartitions(t, failed, len(commitValidationTestPhases))
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatal("failed validation changed durable original bytes", err)
			}
			// A failure before storage validation must not expose the last detail.
			app.pending = nil
			if _, err := app.Commit(ctx, &abci.RequestCommit{}); err == nil {
				t.Fatal("Commit without pending state succeeded")
			}
			if _, ok := app.LastCommitValidationTiming(); ok {
				t.Fatal("early failed attempt retained prior validation detail")
			}
			app.SetCommitTimingEnabled(false)
			if _, ok := app.LastCommitValidationTiming(); ok || app.commitValidationTimingEnabled {
				t.Fatal("disabling original timing retained validation opt-in")
			}
		})
	}
}

func assertCommitValidationPartitions(t *testing.T, sample CommitValidationTimingSample, count int) {
	t.Helper()
	if len(sample.PhaseNs) != count {
		t.Fatalf("missing/extra validation phases: %+v", sample)
	}
	var sum int64
	for _, phase := range commitValidationTestPhases[:count] {
		ns, exists := sample.PhaseNs[phase]
		if !exists || ns < 0 {
			t.Fatalf("invalid phase %s: %+v", phase, sample)
		}
		sum += ns
	}
	if sum != sample.ElapsedNs || sample.HashDocumentNs < 0 || sample.HashEncodeDigestNs < 0 || sample.HashDocumentNs+sample.HashEncodeDigestNs > sample.PhaseNs["app_hash"] {
		t.Fatalf("nested or overlapping validation intervals: %+v", sample)
	}
}

func TestCommitValidationTimingOptInPreservesErrorsAndHashWithDeterministicClock(t *testing.T) {
	migration, _ := journalFixture(t)
	app, err := NewApplication(migration)
	if err != nil {
		t.Fatal(err)
	}
	height := int64(migration.Height) + 1
	if _, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: height, Txs: [][]byte{journalTransfer(t, 1)}}); err != nil {
		t.Fatal(err)
	}
	state := *app.pending
	var calls int64
	recorder := &commitTimings{validationClock: func() time.Time {
		calls++
		return time.Unix(0, calls*10)
	}}
	if err := recorder.validateStateOwned(state, app.validatedMigration); err != nil || calls != 0 || recorder.validation != nil {
		t.Fatal("disabled detail read a clock or allocated intervals", err)
	}
	var disabled *commitTimings
	if err := disabled.validateStateOwned(state, app.validatedMigration); err != nil {
		t.Fatal("default persistence validation changed", err)
	}
	wantHash, err := state.calculateHash()
	if err != nil {
		t.Fatal(err)
	}
	hashProbe := &commitValidationTimings{now: recorder.validationClock}
	gotHash, err := state.calculateHashWithTimings(hashProbe)
	if err != nil || gotHash != wantHash || hashProbe.hashDocument != 10 || hashProbe.hashEncodeDigest != 10 {
		t.Fatal("timing changed canonical hash or fused hash interval", err)
	}
	recorder.validationEnabled = true
	for _, tc := range []struct {
		name, failedPhase string
		mutate            func(*CommittedState)
		phaseCount        int
	}{
		{"valid", "", func(*CommittedState) {}, len(commitValidationTestPhases)},
		{"early-version", "anchor", func(s *CommittedState) { s.Version = 0 }, 1},
		{"ledger-record", "ledger_records", func(s *CommittedState) {
			s.NativeTransfers = append([]BFTNativeTransfer(nil), s.NativeTransfers...)
			s.NativeTransfers[0].Amount = 0
		}, 13},
		{"late-hash", "app_hash", func(s *CommittedState) { s.AppHash = "invalid-hash" }, len(commitValidationTestPhases)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			input := state
			tc.mutate(&input)
			originalErr := input.validateOwned(app.validatedMigration)
			previous := recorder.validation
			observedErr := recorder.validateStateOwned(input, app.validatedMigration)
			v := recorder.validation
			if (originalErr == nil) != (observedErr == nil) || originalErr != nil && originalErr.Error() != observedErr.Error() {
				t.Fatal("instrumentation changed original validation error")
			}
			if v == nil || v == previous || v.valid != (tc.failedPhase == "") || v.failedPhase != tc.failedPhase {
				t.Fatalf("stale or misclassified validation recorder: %+v", v)
			}
			sample := CommitValidationTimingSample{Height: height, Valid: v.valid, FailedPhase: v.failedPhase, ElapsedNs: v.elapsed.Nanoseconds(), PhaseNs: map[string]int64{}, HashDocumentNs: v.hashDocument.Nanoseconds(), HashEncodeDigestNs: v.hashEncodeDigest.Nanoseconds()}
			for phase, duration := range v.phases {
				sample.PhaseNs[phase] = duration.Nanoseconds()
			}
			assertCommitValidationPartitions(t, sample, tc.phaseCount)
			if tc.phaseCount < len(commitValidationTestPhases) && (sample.HashDocumentNs != 0 || sample.HashEncodeDigestNs != 0) {
				t.Fatal("early failure reused previous attempt's hash intervals")
			}
		})
	}
}
