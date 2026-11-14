//go:build unix

package consensus

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func checkpointRefusalCalls(t *testing.T, metrics *PQLabMetrics, want map[string]uint64, private ...string) {
	t.Helper()
	got := map[string]uint64{}
	for key, value := range metrics.Snapshot().Stages {
		if strings.HasPrefix(key, "checkpoint.refused.") {
			got[key] = value.Calls
			if value.ElapsedNS < 0 {
				t.Fatal("negative observation interval")
			}
		}
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatal("fixed refusal counts differ", got, want)
	}
	raw, err := json.Marshal(metrics.Snapshot())
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range private {
		if value != "" && bytes.Contains(raw, []byte(value)) {
			t.Fatal("refusal DATA exposed original input or cause")
		}
	}
}

func TestPQLabCheckpointRefusalStagesAndOriginalErrors(t *testing.T) {
	p, pin, _ := checkpointReadFixture(t, 1)
	cache := NewPQLabStaticCache()
	defer cache.Close()
	entry, err := cache.load(p.RootDir, pin, nil)
	if err != nil {
		t.Fatal(err)
	}
	path := p.Nodes[0].StatePath
	state, err := readPQEngineCommittedStateOwned(path, entry.witness, nil, nil, capturePQEngineState)
	if err != nil {
		t.Fatal(err)
	}
	cause := errors.New("PRIVATE-original-cause-owner-path-must-not-be-exported")
	closeCause := errors.New("PRIVATE-original-close-cause")
	for _, name := range []string{"success", "capture", "capture-disabled", "decode", "full-current", "reused-current", "close", "current-and-close", "same-height-other-hash", "expected-future-height", "unproven-past-height"} {
		t.Run(name, func(t *testing.T) {
			metrics := &PQLabMetrics{}
			r := &pqLabCheckpointRead{witness: entry.witness, height: state.Height, appHash: state.AppHash, metrics: metrics}
			want := map[string]uint64{}
			capture := capturePQEngineState
			closes := 0
			if name == "reused-current" || name == "current-and-close" {
				if _, err := r.read(0, path, capture); err != nil {
					t.Fatal(err)
				}
			}
			if name == "capture" || name == "capture-disabled" {
				capture = func(string) (*pqEngineStateRead, error) { return nil, cause }
				if name == "capture-disabled" {
					r.metrics = nil
				} else {
					want["checkpoint.refused.capture"] = 1
				}
			} else {
				capture = func(path string) (*pqEngineStateRead, error) {
					original, err := capturePQEngineState(path)
					if err != nil {
						return nil, err
					}
					original.closeOriginal = func() error {
						closes++
						if name == "close" || name == "current-and-close" {
							return closeCause
						}
						return nil
					}
					switch name {
					case "decode":
						original.data = []byte(`{"invalid-current":true}`)
					case "full-current", "reused-current", "current-and-close":
						original.checkOriginal = func() error { return cause }
					}
					return original, nil
				}
			}
			switch name {
			case "decode", "full-current":
				want["checkpoint.refused.fullValidationOrCurrent"] = 1
			case "reused-current", "current-and-close":
				want["checkpoint.refused.currentOriginal"] = 1
			case "same-height-other-hash":
				r.appHash = strings.Repeat("0", 64)
				want["checkpoint.refused.coordinates"] = 1
			case "expected-future-height":
				r.height++
				want["checkpoint.refused.coordinates"] = 1
			case "unproven-past-height":
				r.height--
				want["checkpoint.refused.coordinates"] = 1
			}
			if name == "close" || name == "current-and-close" {
				want["checkpoint.refused.close"] = 1
			}
			before := r.files
			_, err := r.read(0, path, capture)
			if (err == nil) != (name == "success") {
				t.Fatal("refusal outcome changed", err)
			}
			if name != "capture" && name != "capture-disabled" && closes != 1 {
				t.Fatal("original capability not closed exactly once", closes)
			}
			if name == "capture" || name == "capture-disabled" || name == "full-current" || name == "reused-current" || name == "current-and-close" {
				if !errors.Is(err, cause) {
					t.Fatal("original first cause replaced", err)
				}
			}
			if name == "close" || name == "current-and-close" {
				if !errors.Is(err, closeCause) {
					t.Fatal("close debt hidden", err)
				}
			}
			if err != nil && r.files != before {
				t.Fatal("refusal published reusable state")
			}
			checkpointRefusalCalls(t, metrics, want, path, cause.Error(), closeCause.Error(), state.AppHash)
		})
	}
}

func TestPQLabCheckpointRefusalOriginalAdvanceRemainsRefused(t *testing.T) {
	p, pin, corpus := checkpointReadFixture(t, 1)
	raw, err := os.ReadFile(p.Nodes[0].StatePath)
	if err != nil {
		t.Fatal(err)
	}
	var state CommittedState
	if err = json.Unmarshal(raw, &state); err != nil {
		t.Fatal(err)
	}
	metrics := &PQLabMetrics{}
	checkpoint, err := LoadPQLabSenderCheckpointMeasured(p.RootDir, pin, "", state.Height, state.AppHash, metrics)
	if err != nil {
		t.Fatal(err)
	}
	if err = checkpoint.current(); err != nil {
		t.Fatal(err)
	}
	checkpointRefusalCalls(t, metrics, map[string]uint64{})
	tx, err := os.ReadFile(filepath.Join(p.RootDir, "workload", corpus.Transactions[0].Envelope.Path))
	if err != nil {
		t.Fatal(err)
	}
	// The existing real BlockExecutor fixture advances all four independent
	// original stores; this is not an edited JSON height or a mocked validator.
	checkpointReadApplyOriginal(t, p, pin, tx)
	err = pqLabPostPersistenceCheckpointRead(checkpoint, metrics)
	if err == nil || err.Error() != "actual four-node checkpoint differs from independently supplied H/AppHash" {
		t.Fatal("later complete state authorized an old checkpoint", err)
	}
	if checkpoint.state.Height != state.Height || checkpoint.state.AppHash != state.AppHash {
		t.Fatal("diagnostic refreshed the immutable signing checkpoint")
	}
	checkpointRefusalCalls(t, metrics, map[string]uint64{"checkpoint.refused.heightAdvanced": 1}, p.RootDir, state.AppHash)
	stages := metrics.Snapshot().Stages
	if stages["checkpoint.nodeReadAndValidate"].Calls != 9 || stages["checkpoint.postPersistenceReadRejected"].Calls != 1 {
		t.Fatal("original first refused node or late boundary changed", stages)
	}
	// The unchanged Sign caller joins this error with the original UNKNOWN
	// sentinel after persistence. It must neither refresh nor retry here.
}
