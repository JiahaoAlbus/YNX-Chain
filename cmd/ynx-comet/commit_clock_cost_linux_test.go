//go:build linux && ynx_clock_diagnostic

package main

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"syscall"
	"testing"
	"time"

	"github.com/cometbft/cometbft/libs/log"
	cmttypes "github.com/cometbft/cometbft/types"
)

// This comparison uses real local BlockExecutor inputs and synthetic chain state.
// Both arms retain the original Commit observer and internal validation timing.
// It does not start a node or measure remote finality or sustained throughput.
func TestSyntheticClockFinalizeOverheadIndependent(t *testing.T) {
	source := os.Getenv("GITHUB_SHA")
	oldSource := operatorCommitBuildSource
	operatorCommitBuildSource = source
	defer func() { operatorCommitBuildSource = oldSource }()
	if binarySourceRevision() != source || len(source) != 40 {
		t.Fatal("exact synthetic source declaration required")
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	file, err := os.Open(executable)
	if err != nil {
		t.Fatal(err)
	}
	hashReader := sha256.New()
	_, copyErr := io.Copy(hashReader, file)
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil {
		t.Fatal("original test executable hash unavailable", copyErr, closeErr)
	}
	binaryDigest := hashReader.Sum(nil)
	f := newCommitObservationFixture(t)
	type samples struct {
		Rounds                      []int
		BlockNS, StopNS, AllocBytes []int64
	}
	results := map[bool]*samples{false: {}, true: {}}
	var executionOrder []string
	var expectedHash, boot, namespace string
	var expectedHeight int64
	for round := 0; round < 10; round++ {
		for _, on := range []bool{round%2 == 0, round%2 != 0} {
			dir := t.TempDir()
			state := filepath.Join(dir, "state")
			cfg, p := commitObservationOptions(t, state)
			p.stateLayout = "atomic-json"
			if on {
				outputDir := filepath.Dir(p.commitObservationOutput)
				p.finalizeObservationOutput = filepath.Join(outputDir, "finalize.json")
				p.commitMonotonicOutput = filepath.Join(outputDir, "monotonic.json")
				p.commitValidationObservation = true
			}
			obs, err := prepareOperatorCommitObservation(cfg, p)
			if err != nil {
				t.Fatal(err)
			}
			p.commitObservationBind = obs.bind
			app, err := newOperatorApplication(f.migration, state, f.bootstrap, nil, p)
			if err != nil {
				t.Fatal(err)
			}
			f.initialize(t, app)
			obs.started()
			var memBefore, memAfter runtime.MemStats
			runtime.ReadMemStats(&memBefore)
			started := time.Now()
			_, _, err = executeObservedEngineCommit(t, f, app, wrapOperatorCommitLogger(log.NewNopLogger(), obs), cmttypes.Txs{f.transfer})
			block := time.Since(started).Nanoseconds()
			if err != nil || len(obs.result.Samples) != 1 {
				t.Fatalf("synthetic original BlockExecutor: %v", err)
			}
			hash, height := obs.result.Samples[0].AppHash, obs.result.Samples[0].Height
			if expectedHash == "" {
				expectedHash, expectedHeight = hash, height
			} else if hash != expectedHash || height != expectedHeight {
				t.Fatal("on/off original height or AppHash changed")
			}
			probe := &wireObservationStopProbe{running: true, quit: make(chan struct{})}
			started = time.Now()
			err = stopPQNodeWithObservations(probe, nil, obs)
			stop := time.Since(started).Nanoseconds()
			if err != nil {
				t.Fatal(err)
			}
			runtime.ReadMemStats(&memAfter)
			if on {
				finalizeRaw, err := os.ReadFile(p.finalizeObservationOutput)
				if err != nil {
					t.Fatal(err)
				}
				var final operatorFinalizeResult
				if json.Unmarshal(finalizeRaw, &final) != nil || !final.CaptureComplete || final.IndependentFinality || final.ProcessID != os.Getpid() || len(final.Observation.Samples) != 1 || !final.Observation.Samples[0].Success || final.Observation.Samples[0].Height != obs.result.Samples[0].Height || final.Observation.Samples[0].AppHash != hash {
					t.Fatal("original Finalize output identity or completeness changed")
				}
				raw, err := os.ReadFile(p.commitMonotonicOutput)
				if err != nil {
					t.Fatal(err)
				}
				var identity struct {
					Status    string `json:"status"`
					BootID    string `json:"bootID"`
					Namespace string `json:"timeNamespace"`
					Source    string `json:"sourceRevision"`
					PID       int    `json:"processID"`
					Finality  bool   `json:"independentFinality"`
					Samples   []struct {
						Height  int64  `json:"height"`
						AppHash string `json:"appHash"`
						NS      string `json:"monotonicNs"`
					} `json:"samples"`
				}
				if json.Unmarshal(raw, &identity) != nil || identity.Status != "OBSERVED" || identity.Source != source || identity.PID != os.Getpid() || identity.Finality || len(identity.Samples) != 1 || identity.Samples[0].Height != obs.result.Samples[0].Height || identity.Samples[0].AppHash != hash || identity.Samples[0].NS == "" || identity.BootID == "" || identity.Namespace == "" {
					t.Fatal("original same-process clock domain or result unavailable")
				}
				if boot == "" {
					boot, namespace = identity.BootID, identity.Namespace
				} else if boot != identity.BootID || namespace != identity.Namespace {
					t.Fatal("kernel clock domain changed")
				}
			}
			if err = obs.close(); err != nil {
				t.Fatal(err)
			}
			if round >= 2 {
				results[on].Rounds = append(results[on].Rounds, round)
				executionOrder = append(executionOrder, fmt.Sprintf("%d:%t", round, on))
				results[on].BlockNS = append(results[on].BlockNS, block)
				results[on].StopNS = append(results[on].StopNS, stop)
				results[on].AllocBytes = append(results[on].AllocBytes, int64(memAfter.TotalAlloc-memBefore.TotalAlloc))
			}
		}
	}
	median := func(raw []int64) int64 {
		if len(raw) != 8 {
			t.Fatal("expected eight complete paired rounds")
		}
		values := append([]int64(nil), raw...)
		sort.Slice(values, func(i, j int) bool { return values[i] < values[j] })
		return values[3] + (values[4]-values[3])/2
	}
	var usage syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &usage); err != nil {
		t.Fatal(err)
	}
	t.Logf("SYNTHETIC_CLOCK_FINALIZE_AB/v1 source=%s testBinarySHA256=%x pid=%d boot=%s namespace=%s warmup=2 samples=8_each height=%d appHash=%s originalCommitAndValidation=enabled_both clock=CLOCK_MONOTONIC roundsOff=%v roundsOn=%v executionOrder=%v blockNsOff=%v blockNsOn=%v stopNsOff=%v stopNsOn=%v allocBytesOff=%v allocBytesOn=%v medianBlockNsOff=%d medianBlockNsOn=%d medianStopNsOff=%d medianStopNsOn=%d medianAllocBytesOff=%d medianAllocBytesOn=%d processMaxRSSKiBSharedLifetime=%d independentFinality=false", source, binaryDigest, os.Getpid(), boot, namespace, expectedHeight, expectedHash, results[false].Rounds, results[true].Rounds, executionOrder, results[false].BlockNS, results[true].BlockNS, results[false].StopNS, results[true].StopNS, results[false].AllocBytes, results[true].AllocBytes, median(results[false].BlockNS), median(results[true].BlockNS), median(results[false].StopNS), median(results[true].StopNS), median(results[false].AllocBytes), median(results[true].AllocBytes), usage.Maxrss)
}
