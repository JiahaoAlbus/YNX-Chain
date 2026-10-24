package consensus

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
)

func TestStateHashEncodingSelectedApplicationAndRecovery(t *testing.T) {
	if mode := os.Getenv("YNX_TEST_HASH_ENCODING_CHILD"); mode != "" {
		if ConfigureStateHashEncoding("unsupported") == nil {
			t.Fatal("unknown selector accepted")
		}
		if mode == "late" {
			if _, err := hashCommittedStateDocument(CommittedState{}.hashDocument("test", 13)); err != nil {
				t.Fatal(err)
			}
			if ConfigureStateHashEncoding(StateHashCachedFeeJSON) == nil {
				t.Fatal("late backend change accepted")
			}
			selected, calls, failures := StateHashEncodingMeasurements()
			if selected != StateHashOriginalJSON || calls != 0 || failures != 0 {
				t.Fatal("default changed")
			}
			return
		}
		if err := ConfigureStateHashEncoding(mode); err != nil {
			t.Fatal(err)
		}
		raw, err := os.ReadFile(os.Getenv("YNX_TEST_HASH_ENCODING_MIGRATION"))
		if err != nil {
			t.Fatal(err)
		}
		var migration chain.ConsensusMigrationState
		if err = json.Unmarshal(raw, &migration); err != nil {
			t.Fatal(err)
		}
		path := os.Getenv("YNX_TEST_HASH_JOURNAL")
		if path == "" {
			path = filepath.Join(t.TempDir(), "state.journal")
		}
		app, err := NewBlockJournaledApplication(migration, path)
		if err != nil {
			t.Fatal(err)
		}
		for nonce := uint64(1); nonce <= 18; nonce++ {
			commitJournalBlock(t, app, nonce)
		}
		before := app.committed
		app.blockJournal.io.fault = func(stage string) error {
			if stage == "append_synced" && os.Getenv("YNX_TEST_HASH_CRASH_AT_SYNC") == "1" {
				os.Exit(73)
			}
			if stage == "append_payload_written" && os.Getenv("YNX_TEST_HASH_CRASH_AT_SYNC") != "1" {
				return errors.New("selected hash write boundary failure")
			}
			return nil
		}
		_, err = app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: before.Height + 1, Time: time.Unix(1802736019, 0), Txs: [][]byte{journalTransfer(t, 19)}})
		if err != nil {
			t.Fatal(err)
		}
		if _, err = app.Commit(context.Background(), &abci.RequestCommit{}); err == nil {
			t.Fatal("uncertain write reported success")
		}
		if !journalStateEqual(t, app.committed, before) || app.pending == nil || !app.blockJournal.io.poisoned {
			t.Fatal("uncertain write published pending state")
		}
		original, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = app.Commit(context.Background(), &abci.RequestCommit{}); err == nil {
			t.Fatal("uncertain commit retried")
		}
		again, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(original, again) {
			t.Fatal("uncertain original evidence changed", err)
		}
		recovered, err := NewBlockJournaledApplication(migration, path)
		if err != nil || recovered.committed.Height != before.Height+1 {
			t.Fatal("complete uncertain delta did not reconcile", err)
		}
		if err = recovered.committed.Validate(migration); err != nil {
			t.Fatal(err)
		}
		replay, err := recovered.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: journalTransfer(t, 19)})
		if err != nil || replay.Code != CodeInvalidNonce {
			t.Fatal("recovered nonce replay accepted", err)
		}

		_, beforeCalls, beforeErrors := StateHashEncodingMeasurements()
		doc := recovered.committed.hashDocument("YNX_ABCI_STATE_V13", CommittedStateVersion)
		var workers sync.WaitGroup
		for worker := 0; worker < 4; worker++ {
			workers.Add(1)
			go func() {
				defer workers.Done()
				for i := 0; i < 8; i++ {
					if err := ConfigureStateHashEncoding(mode); err != nil {
						t.Error(err)
						return
					}
					got, err := hashCommittedStateDocument(doc)
					if err != nil || got != recovered.committed.AppHash {
						t.Error("parallel selected state hash differs", err)
						return
					}
				}
			}()
		}
		workers.Wait()
		_, afterCalls, afterErrors := StateHashEncodingMeasurements()
		if mode == StateHashCachedFeeJSON && (afterCalls-beforeCalls != 32 || afterErrors != beforeErrors) {
			t.Fatal("actual concurrent selected coverage differs", beforeCalls, afterCalls, beforeErrors, afterErrors)
		}
		state, err := encodeCommittedStateJSON(recovered.committed)
		if err != nil {
			t.Fatal(err)
		}
		stateSum, journalSum := sha256.Sum256(state), sha256.Sum256(original)
		// Exercise the real selected hash error counter without creating authority for
		// an invalid state. The original encoder error still rejects the document.
		invalid := recovered.committed
		invalid.FeeEvents = append([]BFTFeeEvent(nil), invalid.FeeEvents...)
		invalid.FeeEvents[0].RecordedAt = time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)
		if _, err := hashCommittedStateDocument(invalid.hashDocument("test", 13)); err == nil {
			t.Fatal("invalid encoding accepted")
		}
		selected, calls, failures := StateHashEncodingMeasurements()
		if selected != mode {
			t.Fatal("constructor selection differs")
		}
		if mode == StateHashCachedFeeJSON {
			if calls == 0 || failures != 1 {
				t.Fatal("selected path was not actually called", calls, failures)
			}
		} else if calls != 0 || failures != 0 {
			t.Fatal("original invented candidate work")
		}
		other := StateHashCachedFeeJSON
		if mode == other {
			other = StateHashOriginalJSON
		}
		if ConfigureStateHashEncoding(other) == nil {
			t.Fatal("used process changed backend")
		}
		result := map[string]any{"stateSHA256": hex.EncodeToString(stateSum[:]), "journalSHA256": hex.EncodeToString(journalSum[:]), "appHash": recovered.committed.AppHash, "height": recovered.committed.Height, "feeEvents": len(recovered.committed.FeeEvents)}
		usage, _ := json.Marshal(map[string]any{"mode": selected, "candidateAttempts": calls, "encodingErrors": failures})
		fmt.Printf("YNX_STATE_HASH_SELECTION_USAGE %s\n", usage)
		out, _ := json.Marshal(result)
		fmt.Printf("YNX_STATE_HASH_SELECTION_RESULT %s\n", out)
		t.Logf("actual signed19 execution+persistence/recovery,18 duplicate-nonce rejects,unknown write preserved/no retry, candidate attempts=%d/errors=%d; no network TPS", calls, failures)
		return
	}
	migration, _ := journalFixture(t)
	raw, err := json.Marshal(migration)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "migration.json")
	if err = os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	var control map[string]any
	for _, mode := range []string{StateHashOriginalJSON, StateHashCachedFeeJSON, "late"} {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestStateHashEncodingSelectedApplicationAndRecovery$", "-test.v")
		cmd.Env = append(os.Environ(), "YNX_TEST_HASH_ENCODING_CHILD="+mode, "YNX_TEST_HASH_ENCODING_MIGRATION="+path)
		out, err := cmd.CombinedOutput()
		cancel()
		if err != nil {
			t.Fatalf("%s: %v\n%s", mode, err, out)
		}
		if mode == "late" {
			continue
		}
		var result map[string]any
		for _, line := range strings.Split(string(out), "\n") {
			if strings.HasPrefix(line, "YNX_STATE_HASH_SELECTION_RESULT ") {
				if result != nil {
					t.Fatal("duplicate child result")
				}
				if err = json.Unmarshal([]byte(strings.TrimPrefix(line, "YNX_STATE_HASH_SELECTION_RESULT ")), &result); err != nil {
					t.Fatal(err)
				}
			}
		}
		if result == nil {
			t.Fatal("actual selected application result absent", mode)
		}
		if control == nil {
			control = result
		} else if !reflect.DeepEqual(control, result) {
			t.Fatal("original and cached actual state/journal/results differ", control, result)
		}
		for _, line := range strings.Split(string(out), "\n") {
			if strings.HasPrefix(line, "YNX_STATE_HASH_SELECTION_USAGE ") {
				t.Log(line)
			}
		}
		t.Logf("%s actual child passed", mode)
	}
	// A real abrupt exit in the selected writer after fsync must remain readable
	// by the unchanged original backend, with identical state and journal bytes.
	journalPath := filepath.Join(t.TempDir(), "selected-abrupt.journal")
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestStateHashEncodingSelectedApplicationAndRecovery$")
	cmd.Env = append(os.Environ(), "YNX_TEST_HASH_ENCODING_CHILD="+StateHashCachedFeeJSON, "YNX_TEST_HASH_ENCODING_MIGRATION="+path, "YNX_TEST_HASH_JOURNAL="+journalPath, "YNX_TEST_HASH_CRASH_AT_SYNC=1")
	out, err := cmd.CombinedOutput()
	cancel()
	var exit *exec.ExitError
	if !errors.As(err, &exit) || exit.ExitCode() != 73 {
		t.Fatalf("actual selected abrupt fsync exit absent: %v\n%s", err, out)
	}
	recovered, err := NewBlockJournaledApplication(migration, journalPath)
	if err != nil || recovered.committed.Height != int64(migration.Height)+19 {
		t.Fatal("original backend could not recover selected writer", err)
	}
	replay, err := recovered.CheckTx(context.Background(), &abci.RequestCheckTx{Tx: journalTransfer(t, 19)})
	if err != nil || replay.Code != CodeInvalidNonce {
		t.Fatal("abrupt recovery lost nonce fence", err)
	}
	state, err := encodeCommittedStateJSON(recovered.committed)
	if err != nil {
		t.Fatal(err)
	}
	journal, err := os.ReadFile(journalPath)
	if err != nil {
		t.Fatal(err)
	}
	stateSum, journalSum := sha256.Sum256(state), sha256.Sum256(journal)
	if hex.EncodeToString(stateSum[:]) != control["stateSHA256"] || hex.EncodeToString(journalSum[:]) != control["journalSHA256"] || recovered.committed.AppHash != control["appHash"] {
		t.Fatal("abrupt selected output differs from original/cached regular recovery", control)
	}
	t.Log("actual selected writer abrupt exit73 after fsync -> original full decoder/replay/nonce and identical journal/state passed")

}
