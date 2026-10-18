package consensus

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
)

func retainedSealFixture(t *testing.T) (chain.ConsensusMigrationState, CommittedState) {
	t.Helper()
	var migration chain.ConsensusMigrationState
	var state CommittedState
	for _, input := range []struct {
		path, digest string
		target       any
	}{
		{"state-hash-real-1024.json", "ea203b08c94178ec0132b71f3ec16d731de8e44595f6fd742e331b41d80caf56", &state},
		{"state-hash-real-1024-migration.json", "8a73a627990a7719ca54fdc1afc3e05a29758db7070e9d7f3cd1e859579621c1", &migration},
	} {
		raw, err := os.ReadFile(filepath.Join("..", "..", "docs", "performance", "fixtures", input.path))
		if err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(raw)
		if hex.EncodeToString(sum[:]) != input.digest {
			t.Fatal("retained input changed", input.path)
		}
		if err := json.Unmarshal(raw, input.target); err != nil {
			t.Fatal(err)
		}
	}
	if len(state.FeeEvents) != 1024 {
		t.Fatal("not the retained real 1024-transfer state")
	}
	if err := state.Validate(migration); err != nil {
		t.Fatal(err)
	}
	return migration, state
}

func TestSealWitnessRejectsEveryRecordAndValueMutation(t *testing.T) {
	_, original := retainedSealFixture(t)
	unchanged := snapshotNativeSealState(original)
	if unchanged == nil || !unchanged(original) {
		t.Fatal("native state not eligible or snapshot not exact")
	}
	// Every top-level value and every currently empty record family must be
	// detected, including future fields not listed by hasApplicationRecords.
	for i := 0; i < reflect.TypeOf(original).NumField(); i++ {
		name := reflect.TypeOf(original).Field(i).Name
		if name == "Accounts" || name == "FeeEvents" {
			continue
		}
		t.Run(name, func(t *testing.T) {
			changed := original
			field := reflect.ValueOf(&changed).Elem().Field(i)
			switch field.Kind() {
			case reflect.Bool:
				field.SetBool(!field.Bool())
			case reflect.String:
				field.SetString(field.String() + "changed")
			case reflect.Int, reflect.Int64:
				field.SetInt(field.Int() + 1)
			case reflect.Slice:
				field.Set(reflect.MakeSlice(field.Type(), 1, 1))
				if snapshotNativeSealState(changed) != nil {
					t.Fatal("non-native record family got a witness")
				}
			default:
				t.Fatal("test must cover new schema field", name)
			}
			if unchanged(changed) {
				t.Fatal("mutation retained old hash authority")
			}
		})
	}
	// Mutate the original backing storage after snapshot creation. A shallow
	// copy would incorrectly accept these cases.
	account := &original.Accounts[0]
	account.Nonce++
	if unchanged(original) {
		t.Fatal("nonce mutation was aliased")
	}
	account.Nonce--
	for key, amount := range account.Lots {
		account.Lots[key]++
		if unchanged(original) {
			t.Fatal("lot map mutation was aliased")
		}
		account.Lots[key] = amount
		break
	}
	for i := 0; i < reflect.TypeOf(BFTFeeEvent{}).NumField(); i++ {
		field := reflect.ValueOf(&original.FeeEvents[1023]).Elem().Field(i)
		before := reflect.New(field.Type()).Elem()
		before.Set(field)
		switch field.Kind() {
		case reflect.String:
			field.SetString(field.String() + "changed")
		case reflect.Bool:
			field.SetBool(!field.Bool())
		case reflect.Int, reflect.Int64:
			field.SetInt(field.Int() + 1)
		case reflect.Struct:
			field.Set(reflect.ValueOf(original.FeeEvents[1023].RecordedAt.Add(time.Second)))
		default:
			t.Fatal("test must cover new fee field")
		}
		if unchanged(original) {
			t.Fatal("fee mutation was aliased", i)
		}
		field.Set(before)
	}
	if !unchanged(original) {
		t.Fatal("restored snapshot differs")
	}
	for _, value := range []any{[]int{}, map[string]int64{}, new(int), struct{ Value *int }{}} {
		if sealValueOnlySchema(reflect.TypeOf(value)) {
			t.Fatal("mutable value schema accepted", reflect.TypeOf(value))
		}
	}
}

// This is an actual retained business state, never synthetic history or a TPS
// claim. The ABBA samples include the snapshot cost and retain all phase times.
func TestSealGuardedRealStateMatchedPhases(t *testing.T) {
	migration, fixture := retainedSealFixture(t)
	app := &Application{committed: fixture}
	execution := app.committedExecutionStateView()
	want, err := sealCommittedState(migration, fixture.Height, execution)
	if err != nil || want.AppHash != fixture.AppHash {
		t.Fatal("baseline differs from retained canonical digest", err)
	}
	wantBytes, err := json.Marshal(want)
	if err != nil {
		t.Fatal(err)
	}
	var rows []map[string]any
	for index, guarded := range []bool{false, true, true, false} {
		phases := &commitTimings{}
		var beforeAlloc, afterAlloc runtime.MemStats
		runtime.ReadMemStats(&beforeAlloc)
		started := time.Now()
		got, err := sealCommittedStateMeasured(migration, fixture.Height, execution, guarded, phases)
		elapsed := time.Since(started)
		runtime.ReadMemStats(&afterAlloc)
		if err != nil {
			t.Fatal(err)
		}
		actual, err := json.Marshal(got)
		if err != nil || !bytes.Equal(actual, wantBytes) {
			t.Fatal("complete sealed state bytes changed", err)
		}
		if err := got.Validate(migration); err != nil {
			t.Fatal("public full validation failed", err)
		}
		_, rechecked := phases.stages["final_hash"]
		if rechecked == guarded {
			t.Fatal("candidate path did not actually differ")
		}
		for _, required := range []string{"clone_and_materialize", "initial_hash", "witness_copy", "semantic_validate", "witness_compare"} {
			if phases.stages[required] <= 0 {
				t.Fatal("missing measured stage", required)
			}
		}
		// Exercise the unchanged real persistence path with each identical
		// result, measuring encoding, writes, fsync and directory durability.
		path := filepath.Join(t.TempDir(), "state.json")
		commit := &commitTimings{}
		commitStarted := time.Now()
		if err := saveCommittedStateWithTimings(path, got, migration, commit); err != nil {
			t.Fatal(err)
		}
		commitElapsed := time.Since(commitStarted)
		reopened, err := loadCommittedState(path, migration)
		if err != nil || !reflect.DeepEqual(got, reopened) {
			t.Fatal("actual persisted readback changed", err)
		}
		rows = append(rows, map[string]any{"order": index, "guarded": guarded, "seal_elapsed_ns": elapsed.Nanoseconds(), "seal_allocated_bytes": afterAlloc.TotalAlloc - beforeAlloc.TotalAlloc, "seal_allocations": afterAlloc.Mallocs - beforeAlloc.Mallocs, "seal_stages_ns": phases.stages, "second_hash_executed": rechecked, "atomic_commit_elapsed_ns": commitElapsed.Nanoseconds(), "atomic_commit_stages_ns": commit.stages, "payload_bytes": commit.bytes})
	}
	report, err := json.Marshal(map[string]any{"measurement": "retained_real_1024_state_seal_ABBA_and_atomic_persistence", "fee_events": len(fixture.FeeEvents), "app_hash": want.AppHash, "runtime_candidate_enabled": false, "business_tps": nil, "inclusion_latency": nil, "finality_latency": nil, "rows": rows})
	if err != nil {
		t.Fatal(err)
	}
	t.Log("SEAL_MATCHED_PHASES=" + string(report))
}

func TestSealGuardPreservesFirstErrorAndCommitTamperRejection(t *testing.T) {
	migration, fixture := retainedSealFixture(t)
	for _, bad := range []string{"late_encoding", "fee_audit", "migration_anchor", "supply"} {
		t.Run(bad, func(t *testing.T) {
			state := fixture
			state.Accounts = cloneAccounts(fixture.Accounts)
			state.FeeEvents = append([]BFTFeeEvent(nil), fixture.FeeEvents...)
			anchor := migration
			switch bad {
			case "late_encoding":
				state.FeeEvents[1023].RecordedAt = time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)
				anchor.StateHash = "also-invalid"
			case "fee_audit":
				state.FeeEvents[1023].AuditHash = "tampered"
			case "migration_anchor":
				anchor.StateHash = "invalid"
			case "supply":
				state.Accounts[0].Balance++
			}
			app := &Application{committed: state}
			execution := app.committedExecutionStateView()
			_, before := sealCommittedStateMeasured(anchor, state.Height, execution, false, nil)
			_, after := sealCommittedStateMeasured(anchor, state.Height, execution, true, nil)
			if before == nil || after == nil || before.Error() != after.Error() {
				t.Fatalf("first error changed: before=%v after=%v", before, after)
			}
		})
	}
	// A successful seal creates no authority for a later pending generation.
	m, path := journalFixture(t)
	app, err := NewBlockJournaledApplication(m, path)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	r, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: int64(m.Height) + 1, Time: time.Unix(1802736001, 0), Txs: [][]byte{journalTransfer(t, 1)}})
	if err != nil || r.TxResults[0].Code != 0 {
		t.Fatal(err)
	}
	// Replace the pending state with a genuinely guarded seal, then change a
	// nonce which remains semantically legal but invalidates the complete hash.
	view := (&Application{committed: *app.pending}).committedExecutionStateView()
	sealed, err := sealCommittedStateMeasured(m, app.pending.Height, view, true, nil)
	if err != nil {
		t.Fatal(err)
	}
	app.pending = &sealed
	app.pending.Accounts[0].Nonce++
	if err := app.pending.Validate(m); err == nil {
		t.Fatal("public Validate reused stale seal authority")
	}
	if _, err := app.Commit(ctx, &abci.RequestCommit{}); err == nil {
		t.Fatal("Commit reused stale seal authority")
	}
}
