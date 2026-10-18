package consensus

import (
	"bytes"
	"context"
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
