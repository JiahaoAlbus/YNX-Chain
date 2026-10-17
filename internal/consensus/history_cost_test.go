package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"golang.org/x/sys/unix"
)

// This opt-in structural cost probe deliberately expands audit records without
// executing transactions. Its results must never be counted as business TPS.
// Real transaction equivalence is covered by TestABCITransferPerformance.
func TestFeeHistoryCost(t *testing.T) {
	if os.Getenv("YNX_CHAIN_HISTORY_COST") != "1" {
		t.Skip("set YNX_CHAIN_HISTORY_COST=1 and provide the isolated fixture paths")
	}
	root := os.Getenv("YNX_CHAIN_HISTORY_DIR")
	if root == "" {
		t.Fatal("YNX_CHAIN_HISTORY_DIR is required")
	}
	var disk unix.Statfs_t
	if err := unix.Statfs(root, &disk); err != nil {
		t.Fatal(err)
	}
	if uint64(disk.Bavail)*uint64(disk.Bsize) < 1<<30 {
		t.Fatal("history probe requires at least 1 GiB free; no files written")
	}
	var migration chain.ConsensusMigrationState
	migrationBytes, err := os.ReadFile(filepath.Join(root, "local-performance-migration.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(migrationBytes, &migration); err != nil {
		t.Fatal(err)
	}
	fixturePath := os.Getenv("YNX_CHAIN_HISTORY_STATE")
	fixture, err := loadCommittedState(fixturePath, migration)
	if err != nil {
		t.Fatal(err)
	}
	if fixturePath == "" || len(fixture.FeeEvents) != 1024 {
		t.Fatal("requires the existing 1024-transfer isolated snapshot")
	}
	runDir, err := os.MkdirTemp(root, "history-cost-")
	if err != nil {
		t.Fatal(err)
	}
	statePath := filepath.Join(runDir, "synthetic-state.json")
	// Retain only the report. Each larger snapshot replaces this one, bounding
	// live disk usage; removal here is limited to this newly created file.
	defer os.Remove(statePath)
	const attempts, repetitions = 32, 3
	rows := make([]map[string]any, 0, 9)
	for _, count := range []int{1024, 8192, 32768} {
		state := fixture
		state.FeeEvents = make([]BFTFeeEvent, count)
		copy(state.FeeEvents, fixture.FeeEvents)
		for i := len(fixture.FeeEvents); i < count; i++ {
			event := fixture.FeeEvents[i%len(fixture.FeeEvents)]
			event.ID = fmt.Sprintf("synthetic-history-cost-%08d", i)
			event.TxHash = fmt.Sprintf("synthetic-unexecuted-%08d", i)
			event.AuditHash = feeEventAuditHash(event)
			state.FeeEvents[i] = event
		}
		state.AppHash, err = state.calculateHash()
		if err != nil {
			t.Fatal(err)
		}
		for repetition := 0; repetition < repetitions; repetition++ {
			// Model the removed full-history branch copy, versus immutable
			// journal branching. Both append exactly the same 32 records.
			var legacy []BFTFeeEvent
			journal := feeEventJournal{base: state.FeeEvents}
			measure := func(f func()) map[string]any {
				runtime.GC()
				var before, after runtime.MemStats
				runtime.ReadMemStats(&before)
				started := time.Now()
				f()
				elapsed := time.Since(started)
				runtime.ReadMemStats(&after)
				return map[string]any{"ms": float64(elapsed) / float64(time.Millisecond), "allocated_bytes": after.TotalAlloc - before.TotalAlloc}
			}
			old := func() {
				legacy = state.FeeEvents
				for i := 0; i < attempts; i++ {
					legacy = append(append([]BFTFeeEvent(nil), legacy...), fixture.FeeEvents[i])
				}
			}
			newJournal := func() {
				for i := 0; i < attempts; i++ {
					journal = journal.append(fixture.FeeEvents[i])
				}
			}
			var oldCost, journalCost map[string]any
			if repetition%2 == 0 {
				oldCost = measure(old)
				journalCost = measure(newJournal)
			} else {
				journalCost = measure(newJournal)
				oldCost = measure(old)
			}
			var materialized []BFTFeeEvent
			materializeCost := measure(func() { materialized = journal.events() })
			if !reflect.DeepEqual(legacy, materialized) {
				t.Fatal("legacy/journal ordered output mismatch")
			}
			recorder := &commitTimings{}
			started := time.Now()
			if err := saveCommittedStateWithTimings(statePath, state, migration, recorder); err != nil {
				t.Fatal(err)
			}
			if len(recorder.stages) != 8 || recorder.bytes > 32<<20 {
				t.Fatal("incomplete phase recording or snapshot exceeded 32 MiB bound")
			}
			commitMS := float64(time.Since(started)) / float64(time.Millisecond)
			stored, err := loadCommittedState(statePath, migration)
			if err != nil || !reflect.DeepEqual(state, stored) {
				t.Fatalf("structural snapshot readback: %v", err)
			}
			payload, err := os.ReadFile(statePath)
			if err != nil {
				t.Fatal(err)
			}
			expected, err := json.MarshalIndent(state, "", "  ")
			if err != nil || !bytes.Equal(payload, append(expected, '\n')) {
				t.Fatal("persisted bytes differ from canonical format")
			}
			digest := sha256.Sum256(payload)
			phases := make(map[string]float64, len(recorder.stages))
			for name, duration := range recorder.stages {
				phases[name] = float64(duration) / float64(time.Millisecond)
			}
			rows = append(rows, map[string]any{"history_events": count, "repetition": repetition, "attempts": attempts, "legacy_copy_and_append": oldCost, "journal_append": journalCost, "journal_materialize_once": materializeCost, "ordered_outputs_equal": true, "commit_ms": commitMS, "commit_phases_ms": phases, "snapshot_bytes": recorder.bytes, "snapshot_sha256": hex.EncodeToString(digest[:]), "readback_equal": true})
		}
	}
	report := map[string]any{"schema": 1, "measurement": "synthetic_fee_history_structural_cost_not_executed_transactions_or_tps", "go_version": runtime.Version(), "gomaxprocs": runtime.GOMAXPROCS(0), "fixture": fixturePath, "fixture_fee_events": 1024, "migration_hash": migration.StateHash, "business_tps": nil, "inclusion_latency": nil, "finality_latency": nil, "rows": rows}
	payload, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(runDir, "result.json"), append(payload, '\n'), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Logf("report=%s", filepath.Join(runDir, "result.json"))
}
