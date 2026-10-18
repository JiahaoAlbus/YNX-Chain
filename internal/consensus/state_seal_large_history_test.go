package consensus

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"syscall"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// Explicit follow-on to the existing real-history case. It reads that case's
// completed exact store, performs no transaction generation, and never opens a
// writer, truncates, extends or replaces its input. Both paths see one state.
func TestSealGuardedActualLargeHistoryPhases(t *testing.T) {
	if os.Getenv("YNX_CHAIN_SEAL_REAL_HISTORY") != "1" {
		t.Skip("explicit same-run large actual-history seal measurement not selected")
	}
	directory := os.Getenv("YNX_CHAIN_REAL_HISTORY_DIR")
	if !filepath.IsAbs(directory) {
		t.Fatal("absolute completed real-history evidence directory required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	var original struct {
		TestFailed  bool   `json:"testFailed"`
		StoreSHA256 string `json:"storeSHA256"`
		Executed    int    `json:"executedPersistedTransactions"`
		Verified    int    `json:"verifiedFeeEvents"`
	}
	result, err := os.ReadFile(filepath.Join(directory, "result.json"))
	if err != nil || len(result) > 1<<20 {
		t.Fatal("completed bounded real-history result missing", err)
	}
	if err := json.Unmarshal(result, &original); err != nil {
		t.Fatal(err)
	}
	if original.TestFailed || original.Executed < 16384 || original.Executed > 65536 || original.Verified != original.Executed || len(original.StoreSHA256) != 64 {
		t.Fatal("requires a completed successful actual signed-history case")
	}
	var migration chain.ConsensusMigrationState
	migrationRaw, err := os.ReadFile(filepath.Join(directory, "migration.json"))
	if err != nil || len(migrationRaw) > 1<<20 {
		t.Fatal("bounded migration required", err)
	}
	if err := json.Unmarshal(migrationRaw, &migration); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(directory, "state.journal")
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() <= 16<<20 || info.Size() > 32<<20 {
		t.Fatal("requires the existing >16 MiB, <=32 MiB actual journal", err)
	}
	store, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(store)
	if hex.EncodeToString(sum[:]) != original.StoreSHA256 {
		t.Fatal("input differs from the completed actual-history proof")
	}
	decoded, err := DecodeBlockJournal(ctx, store, migration)
	if err != nil || decoded.IncompleteTail || decoded.CompleteBytes != len(store) || len(decoded.State.FeeEvents) != original.Verified {
		t.Fatal("full signed replay/state validation differs", err)
	}
	fixture := decoded.State
	store, decoded.SnapshotJSON = nil, nil
	execution := (&Application{committed: fixture}).committedExecutionStateView()
	want, err := sealCommittedStateMeasuredMode(migration, fixture.Height, execution, sealWitnessNone, nil)
	if err != nil || want.AppHash != fixture.AppHash {
		t.Fatal("baseline differs from complete actual state", err)
	}
	rows := make([]map[string]any, 0, 6)
	// ABC CBA: original runtime, previous full-copy witness, compact witness.
	modes := []sealWitnessMode{sealWitnessNone, sealWitnessFullCopy, sealWitnessCompact, sealWitnessCompact, sealWitnessFullCopy, sealWitnessNone}
	for index, mode := range modes {
		guarded := mode != sealWitnessNone
		name := map[sealWitnessMode]string{sealWitnessNone: "original", sealWitnessFullCopy: "full_copy", sealWitnessCompact: "compact"}[mode]
		if err := ctx.Err(); err != nil {
			t.Fatal(err)
		}
		runtime.GC()
		phases := &commitTimings{}
		var before, after runtime.MemStats
		runtime.ReadMemStats(&before)
		started := time.Now()
		got, err := sealCommittedStateMeasuredMode(migration, fixture.Height, execution, mode, phases)
		elapsed := time.Since(started)
		runtime.ReadMemStats(&after)
		if err != nil || !reflect.DeepEqual(want, got) {
			t.Fatal("complete actual large-history state changed", err)
		}
		if err := got.Validate(migration); err != nil {
			t.Fatal("independent public full validation failed", err)
		}
		_, rechecked := phases.stages["final_hash"]
		if rechecked == guarded {
			t.Fatal("guarded and original paths were not actually distinct")
		}
		rows = append(rows, map[string]any{"order": index, "witness_mode": name, "guarded": guarded, "seal_elapsed_ns": elapsed.Nanoseconds(), "seal_allocated_bytes": after.TotalAlloc - before.TotalAlloc, "seal_allocations": after.Mallocs - before.Mallocs, "seal_stages_ns": phases.stages, "second_hash_executed": rechecked, "full_state_equal": true, "public_full_validate_passed": true})
	}
	if err := ctx.Err(); err != nil {
		t.Fatal(err)
	}
	// A fresh whole-file hash, outside measured intervals, corroborates that
	// the original input was unchanged. No write-capable handle was opened.
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.New()
	n, readErr := io.Copy(digest, io.LimitReader(file, (32<<20)+1))
	closeErr := file.Close()
	if readErr != nil || closeErr != nil || n != info.Size() || hex.EncodeToString(digest.Sum(nil)) != original.StoreSHA256 {
		t.Fatal("original journal changed during measurement", readErr, closeErr)
	}
	var usage syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &usage); err != nil {
		t.Fatal(err)
	}
	report := map[string]any{"measurement": "same_completed_actual_large_history_seal_ABCCBA_not_business_or_network_TPS", "fee_events": len(fixture.FeeEvents), "app_hash": want.AppHash, "input_store_sha256": original.StoreSHA256, "input_bytes": info.Size(), "input_unchanged": true, "replayed_blocks": decoded.ReplayedBlocks, "replayed_signed_inputs": decoded.ReplayedTransactionInputs, "gomaxprocs": runtime.GOMAXPROCS(0), "go_version": runtime.Version(), "max_rss_raw": usage.Maxrss, "max_rss_platform": runtime.GOOS, "runtime_candidate_enabled": defaultSealWitnessMode != sealWitnessNone, "business_tps": nil, "inclusion_latency": nil, "finality_latency": nil, "rows": rows}
	raw, err := json.MarshalIndent(report, "", "  ")
	if err != nil || len(raw) > 1<<20 {
		t.Fatal("bounded phase report encoding failed", err)
	}
	output, err := os.OpenFile(filepath.Join(directory, "seal-phases.json"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	nwritten, writeErr := output.Write(append(raw, byte(10)))
	closeErr = output.Close()
	if writeErr != nil || closeErr != nil || nwritten != len(raw)+1 {
		t.Fatal("phase report write failed", writeErr, closeErr)
	}
	compact, err := json.Marshal(report)
	if err != nil {
		t.Fatal(err)
	}
	t.Log("LARGE_SEAL_MATCHED_PHASES=" + string(compact))
}
