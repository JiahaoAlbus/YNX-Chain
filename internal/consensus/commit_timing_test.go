package consensus

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
)

func TestCommitTimingSplitsActualCheckpointWithoutChangingDurableBytes(t *testing.T) {
	migration, _ := journalFixture(t)
	paths := []string{filepath.Join(t.TempDir(), "observed"), filepath.Join(t.TempDir(), "control")}
	apps := make([]*Application, 2)
	for i := range apps {
		var err error
		apps[i], err = NewBlockJournaledApplication(migration, paths[i])
		if err != nil {
			t.Fatal(err)
		}
	}
	apps[0].SetCommitTimingEnabled(true)
	for block := 1; block <= blockJournalCheckpointBlocks+2; block++ {
		for _, app := range apps {
			height := int64(migration.Height) + int64(block)
			result, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: height, Time: time.Unix(1802736000+height, 0), Txs: [][]byte{journalTransfer(t, uint64(block))}})
			if err != nil || len(result.TxResults) != 1 || result.TxResults[0].Code != 0 {
				t.Fatal("signed execution", err)
			}
			if _, err = app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
				t.Fatal(err)
			}
		}
		sample, ok := apps[0].LastCommitTiming()
		if !ok || !sample.Durable {
			t.Fatal("missing durable sample")
		}
		if block != blockJournalCheckpointBlocks+1 {
			if sample.CheckpointStagesNs != nil {
				t.Fatal("fabricated checkpoint on append")
			}
			continue
		}
		var sum int64
		for _, key := range []string{"encode", "prepare_file", "write", "file_sync", "close_file", "rename", "directory_sync", "identity"} {
			value, exists := sample.CheckpointStagesNs[key]
			if !exists || value <= 0 {
				t.Fatalf("missing actual checkpoint %s: %+v", key, sample)
			}
			sum += value
		}
		if len(sample.CheckpointStagesNs) != 8 || sum > sample.StagesNs["journal_maintenance"] {
			t.Fatal("checkpoint children exceed parent", sample)
		}
		sample.CheckpointStagesNs["encode"] = -1
		owned, _ := apps[0].LastCommitTiming()
		if owned.CheckpointStagesNs["encode"] <= 0 {
			t.Fatal("caller mutated retained checkpoint")
		}
		encoded, err := json.Marshal(owned)
		if err != nil || !bytes.Contains(encoded, []byte(`"checkpointStagesNs"`)) {
			t.Fatal("checkpoint missing from diagnostic JSON", err)
		}
		t.Logf("actual checkpoint sample: %s", encoded)
	}
	a, err := os.ReadFile(paths[0])
	if err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(paths[1])
	if err != nil || !bytes.Equal(a, b) {
		t.Fatal("diagnostics changed checkpoint durable bytes", err)
	}
	restored, err := NewBlockJournaledApplication(migration, paths[0])
	if err != nil || !journalStateEqual(t, apps[0].committed, restored.committed) {
		t.Fatal("checkpoint replay differs", err)
	}
}

func TestCommitTimingCheckpointFailureKeepsFirstCauseAndRecovery(t *testing.T) {
	for _, stage := range []string{"compaction_synced", "compaction_renamed"} {
		t.Run(stage, func(t *testing.T) {
			migration, path := journalFixture(t)
			app, err := NewBlockJournaledApplication(migration, path)
			if err != nil {
				t.Fatal(err)
			}
			for nonce := uint64(1); nonce <= blockJournalCheckpointBlocks; nonce++ {
				commitJournalBlock(t, app, nonce)
			}
			previous := app.committed
			app.SetCommitTimingEnabled(true)
			first := errors.New("actual checkpoint boundary refusal")
			app.blockJournal.io.fault = func(at string) error {
				if at == stage {
					return first
				}
				return nil
			}
			result, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: previous.Height + 1, Time: time.Unix(1802736000+previous.Height+1, 0), Txs: [][]byte{journalTransfer(t, 17)}})
			if err != nil || len(result.TxResults) != 1 || result.TxResults[0].Code != 0 {
				t.Fatal("signed execution", err)
			}
			if _, err = app.Commit(context.Background(), &abci.RequestCommit{}); !errors.Is(err, first) {
				t.Fatal("first cause changed", err)
			}
			failed, ok := app.LastCommitTiming()
			if !ok || failed.Durable || failed.CheckpointStagesNs["file_sync"] <= 0 || failed.CheckpointStagesNs["close_file"] <= 0 || !app.blockJournal.io.poisoned {
				t.Fatal("failure marked durable or partial proof lost", failed)
			}
			if _, exists := failed.CheckpointStagesNs["directory_sync"]; exists {
				t.Fatal("fabricated unexecuted directory sync")
			}
			if stage == "compaction_synced" {
				if _, exists := failed.CheckpointStagesNs["rename"]; exists {
					t.Fatal("fabricated unexecuted rename")
				}
			}
			if !journalStateEqual(t, previous, app.committed) {
				t.Fatal("failed checkpoint published pending state")
			}
			if _, err = app.Commit(context.Background(), &abci.RequestCommit{}); err == nil {
				t.Fatal("uncertain writer reused")
			}
			reopened, err := NewBlockJournaledApplication(migration, path)
			if err != nil || !journalStateEqual(t, previous, reopened.committed) {
				t.Fatal("checkpoint boundary recovery differs", err)
			}
		})
	}
}

func TestCommitTimingRetainedHistoryCheckpoint(t *testing.T) {
	migration, state := retainedSealFixture(t)
	path := filepath.Join(t.TempDir(), "retained-history.blocks")
	journal, _, err := openBlockJournal(path, migration)
	if err != nil {
		t.Fatal(err)
	}
	timings := &commitTimings{}
	lock, err := journal.io.lock()
	if err != nil {
		t.Fatal(err)
	}
	f, err := journal.checkCurrentFile()
	if err != nil {
		releaseJournalLock(lock)
		t.Fatal(err)
	}
	started := timings.start()
	err = journal.replaceCheckpointLockedWithTimings(state, timings)
	timings.mark("journal_maintenance", started)
	_ = f.Close()
	releaseJournalLock(lock)
	if err != nil {
		t.Fatal(err)
	}
	var sum time.Duration
	for _, ns := range timings.checkpointStages {
		sum += ns
	}
	if len(timings.checkpointStages) != 8 || sum > timings.stages["journal_maintenance"] {
		t.Fatal("invalid retained-history checkpoint timing")
	}
	_, reopened, err := openBlockJournal(path, migration)
	if err != nil || !journalStateEqual(t, state, reopened) {
		t.Fatal("retained signed history changed during actual disk checkpoint", err)
	}
	controlPath := filepath.Join(t.TempDir(), "control.blocks")
	control, _, err := openBlockJournal(controlPath, migration)
	if err != nil {
		t.Fatal(err)
	}
	if err = control.replaceCheckpoint(state, migration); err != nil {
		t.Fatal(err)
	}
	a, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(controlPath)
	if err != nil || !bytes.Equal(a, b) {
		t.Fatal("timing changed actual1024-history checkpoint bytes", err)
	}
	stages := make(map[string]int64, len(timings.checkpointStages))
	for key, value := range timings.checkpointStages {
		stages[key] = value.Nanoseconds()
	}
	raw, err := json.Marshal(struct {
		FeeEvents          int              `json:"feeEvents"`
		PayloadBytes       int64            `json:"payloadBytes"`
		MaintenanceNs      int64            `json:"maintenanceNs"`
		CheckpointStagesNs map[string]int64 `json:"checkpointStagesNs"`
	}{len(state.FeeEvents), journal.checkpointBytesWritten, timings.stages["journal_maintenance"].Nanoseconds(), stages})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("actual retained1024 checkpoint: %s", raw)
}

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
			children := sample.ValidationStagesNs
			if len(children) != 2 || children["semantics"] <= 0 || children["app_hash"] <= 0 || children["semantics"]+children["app_hash"] > sample.StagesNs["validate"] {
				t.Fatalf("missing or double-counted validation child stages: %+v", sample)
			}
			sample.ValidationStagesNs["semantics"] = -1
			owned, _ := app.LastCommitTiming()
			if owned.ValidationStagesNs["semantics"] <= 0 {
				t.Fatal("caller mutated retained validation child timing")
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
			controlPath := filepath.Join(t.TempDir(), "without-diagnostics")
			control, err := tc.open(migration, controlPath)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = control.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: height, Time: time.Unix(1802736000+height, 0), Txs: [][]byte{journalTransfer(t, 1)}}); err != nil {
				t.Fatal(err)
			}
			if _, err = control.Commit(ctx, &abci.RequestCommit{}); err != nil {
				t.Fatal(err)
			}
			controlBytes, err := os.ReadFile(controlPath)
			if err != nil || !bytes.Equal(before, controlBytes) {
				t.Fatal("diagnostics changed original durable bytes", err)
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
	if _, err = app.Commit(ctx, &abci.RequestCommit{}); err == nil {
		t.Fatal("commit without pending succeeded")
	}
	if _, ok = app.LastCommitTiming(); ok {
		t.Fatal("missing pending state retained old sample")
	}
}
