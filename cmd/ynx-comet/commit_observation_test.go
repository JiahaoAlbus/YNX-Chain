package main

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

func TestOperatorCommitObservationDefaultAndClosedFlags(t *testing.T) {
	dir := wireObservationTestDir(t)
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	good := []string{"--commit-observation-output", filepath.Join(dir, "result.json"), "--commit-observation-scope", operatorWireObservationScope}
	for _, name := range []string{"default", "complete", "only-output", "only-scope", "public-scope", "relative", "duplicate-output", "duplicate-scope", "existing", "state-alias", "wire-alias", "lock-alias", "public-parent"} {
		t.Run(name, func(t *testing.T) {
			p := pqOptions{recoveryFD: -1}
			flags := pflag.NewFlagSet("normal", pflag.ContinueOnError)
			flags.SetOutput(io.Discard)
			registerCommitObservationFlags(flags, &p)
			args := append([]string(nil), good...)
			switch name {
			case "default":
				args = nil
			case "only-output":
				args = args[:2]
			case "only-scope":
				args = args[2:]
			case "public-scope":
				args[3] = "public-network"
			case "relative":
				args[1] = "result.json"
			case "duplicate-output":
				args = append(args, args[:2]...)
			case "duplicate-scope":
				args = append(args, args[2:]...)
			case "existing":
				args[1] = filepath.Join(dir, "original")
				if err := os.WriteFile(args[1], []byte("UNKNOWN-original"), 0600); err != nil {
					t.Fatal(err)
				}
			case "state-alias":
				p.state = args[1]
			case "wire-alias":
				p.wireObservationOutput = args[1]
			case "lock-alias":
				p.state = filepath.Join(dir, "state")
				args[1] = p.state + ".writer.lock"
			case "public-parent":
				public := filepath.Join(dir, "public")
				if err := os.Mkdir(public, 0755); err != nil {
					t.Fatal(err)
				}
				args[1] = filepath.Join(public, "result")
			}
			err := flags.Parse(args)
			if err == nil {
				err = p.validateCommitObservation()
			}
			if name == "default" {
				if err != nil || p.enabled() || p.commitObservationConfigured() {
					t.Fatal("default observation changed normal/legacy selection", err)
				}
				if o, err := prepareOperatorCommitObservation(nil, p); err != nil || o != nil {
					t.Fatal("disabled observation touched config/files", err)
				}
				base := log.NewNopLogger()
				if wrapOperatorCommitLogger(base, nil) != base {
					t.Fatal("disabled observation installed a logger")
				}
			} else if name == "complete" {
				if err != nil || !p.enabled() || p.validate() == nil {
					t.Fatal("observer flags replaced original independent node configuration", err)
				}
			} else if err == nil {
				t.Fatal("ambiguous/overwriting/public observation accepted")
			}
		})
	}
	p := pqOptions{state: filepath.Join(dir, "unopened-state"), recoveryFD: -1, commitObservationOutput: filepath.Join(dir, "unused")}
	if err := runPQNode(&cobra.Command{}, p); err == nil {
		t.Fatal("partial observer entered normal node")
	}
	for _, path := range []string{p.state, p.state + ".writer.lock", p.commitObservationOutput} {
		if _, err := os.Lstat(path); !os.IsNotExist(err) {
			t.Fatal("invalid flags wrote state/lease/output", err)
		}
	}
}

func TestOperatorCommitObservationRejectsPublicMigrationAndNetworkBeforeEnable(t *testing.T) {
	f := newCommitObservationFixture(t)
	state := filepath.Join(t.TempDir(), "state")
	for _, kind := range []string{"public-listener", "state-sync", "public-migration", "wrong-id", "foreign-slug"} {
		t.Run(kind, func(t *testing.T) {
			config, p := commitObservationOptions(t, state)
			m := f.migration
			switch kind {
			case "public-listener":
				config.P2P.ListenAddress = "tcp://0.0.0.0:37111"
			case "state-sync":
				config.StateSync.Enable = true
			case "public-migration":
				m.Network.IsPublicNet = true
			case "wrong-id":
				m.Network.ChainID++
			case "foreign-slug":
				m.Network.Slug = "original-public-testnet"
			}
			o, err := prepareOperatorCommitObservation(config, p)
			if kind == "public-listener" || kind == "state-sync" {
				if err == nil || o != nil {
					t.Fatal("private scope widened network")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			defer o.close()
			p.commitObservationBind = o.bind
			if app, err := newOperatorApplication(m, state, f.bootstrap, nil, p); err == nil || app != nil || o.app != nil {
				t.Fatal("public/non-lab source reached normal observer binding", err)
			}
			if _, err := os.Lstat(state); !os.IsNotExist(err) {
				t.Fatal("source rejection created application", err)
			}
		})
	}
}

func directObservedCommit(t *testing.T, app *consensus.Application, height int64) string {
	t.Helper()
	snapshot, err := app.CommittedPQEngineSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	next, err := snapshot.ExpectedValidatorHash(height + 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: height, Time: time.Unix(1800000000+height, 0), NextValidatorsHash: next}); err != nil {
		t.Fatal(err)
	}
	if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	info, err := app.Info(context.Background(), &abci.RequestInfo{})
	if err != nil {
		t.Fatal(err)
	}
	return hex.EncodeToString(info.LastBlockAppHash)
}

func readCommitObservationResult(t *testing.T, path string) operatorCommitObservationResult {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var result operatorCommitObservationResult
	if err = json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestOperatorCommitObservationLoggerModuleOwnershipAndUntrustedPayloads(t *testing.T) {
	f := newCommitObservationFixture(t)
	app, o, _ := makeObservedOperatorApplication(t, f, "atomic-json", filepath.Join(t.TempDir(), "own"), true)
	foreign, other, _ := makeObservedOperatorApplication(t, f, "atomic-json", filepath.Join(t.TempDir(), "other"), true)
	own := wrapOperatorCommitLogger(log.NewNopLogger(), o)
	otherLogger := wrapOperatorCommitLogger(log.NewNopLogger(), other)
	height := f.doc.InitialHeight
	// A foreign application's event has no access to the original consumer.
	foreignHash := directObservedCommit(t, foreign, height)
	otherLogger.With("module", "state").Info("committed state", "height", height)
	if len(other.result.Samples) != 1 || len(o.result.Samples) != 0 {
		t.Fatal("foreign application log was consumed by the original owner")
	}
	// Even a crafted original logger call cannot create timing before a real
	// Commit, or supply its own hash, stage durations, storage or authority.
	own.With("module", "state").Info("committed state", "height", height, "block_app_hash", foreignHash, "elapsedNs", int64(0))
	if len(o.result.Samples) != 0 || o.result.RejectedNotifications["timing-unavailable"] != 1 {
		t.Fatal("log payload forged an Application sample")
	}
	actual := directObservedCommit(t, app, height)
	for _, logger := range []log.Logger{own.With("module", "rpc"), own.With("module", "state").With("module", "consensus"), own.With("module", "state", "module", "rpc")} {
		logger.Info("committed state", "height", height)
	}
	if len(o.result.Samples) != 0 {
		t.Fatal("another module's same-name event was consumed")
	}
	own.With("module", "main").With("service", "node").With("module", "state").Info("committed state", "height", height, "block_app_hash", strings.Repeat("f", 64), "stagesNs", map[string]int64{"file_sync": 0})
	if len(o.result.Samples) != 1 || o.result.Samples[0].AppHash != actual || o.result.Samples[0].Persistence.ElapsedNs <= 0 || o.result.Samples[0].Persistence.StagesNs["file_sync"] <= 0 {
		t.Fatal("With chain lost consumer or accepted log-supplied metrics")
	}
	if _, ok := o.result.Samples[0].Persistence.StagesNs["delta_encode"]; ok {
		t.Fatal("missing atomic JSON stage was synthesized as zero")
	}
	own.With("module", "state").Info("committed state", "height", height)
	own.With("module", "state").Info("committed state", "height", height+1)
	if len(o.result.Samples) != 1 || o.result.RejectedNotifications["duplicate-or-stale-notification"] != 1 || o.result.RejectedNotifications["notification-does-not-match-durable-attempt"] != 1 {
		t.Fatal("stale/mismatched notifications became new samples")
	}
	if err := o.bind(foreign, f.migration); err == nil {
		t.Fatal("original application consumer was rebound")
	}
}

func TestOperatorCommitObservationMissingFailureAndReplayRemainUnknown(t *testing.T) {
	f := newCommitObservationFixture(t)
	for _, kind := range []string{"no-commit", "pre-persistence-failure", "unobserved-replay-latest", "persistence-failure"} {
		t.Run(kind, func(t *testing.T) {
			parent := t.TempDir()
			path := filepath.Join(parent, "state-owner", "state")
			app, o, p := makeObservedOperatorApplication(t, f, "atomic-json", path, true)
			logger := wrapOperatorCommitLogger(log.NewNopLogger(), o).With("module", "state")
			switch kind {
			case "pre-persistence-failure":
				if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err == nil {
					t.Fatal("fixture expected real pre-finalize failure")
				}
				logger.Error("client error during proxyAppConn.CommitSync", "err", errors.New("not collected"))
			case "unobserved-replay-latest":
				directObservedCommit(t, app, f.doc.InitialHeight)
			case "persistence-failure":
				// Create a real durable predecessor before obstructing only this
				// isolated test's next write. InitChain alone need not create an
				// atomic-json state file; never assume that setup is persisted.
				directObservedCommit(t, app, f.doc.InitialHeight)
				snapshot, err := app.CommittedPQEngineSnapshot()
				if err != nil {
					t.Fatal(err)
				}
				next, err := snapshot.ExpectedValidatorHash(f.doc.InitialHeight + 2)
				if err != nil {
					t.Fatal(err)
				}
				if _, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: f.doc.InitialHeight + 1, Time: time.Unix(1800000001+f.doc.InitialHeight, 0), NextValidatorsHash: next}); err != nil {
					t.Fatal(err)
				}
				if err := os.Rename(filepath.Dir(path), filepath.Dir(path)+"-retained"); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Dir(path), []byte("owned test fixture obstruction"), 0600); err != nil {
					t.Fatal(err)
				}
				if _, err := app.Commit(context.Background(), &abci.RequestCommit{}); err == nil {
					t.Fatal("fixture expected real persistence failure")
				}
				logger.Error("client error during proxyAppConn.CommitSync", "err", errors.New("private raw error not collected"))
			}
			o.started()
			if err := o.writeAfterStop(); err == nil {
				t.Fatal("missing/failed/replay capture claimed complete timing")
			}
			r := readCommitObservationResult(t, p.commitObservationOutput)
			if r.Coverage.NotificationCaptureComplete || r.Coverage.AllCommitAttemptsCovered || r.Coverage.ReplayCoverageComplete || len(r.Samples) != 0 {
				t.Fatal("missing attempt became a fabricated successful sample")
			}
			if kind == "pre-persistence-failure" && (r.LastFailure == nil || r.LastFailure.Timing != nil || r.LatestTimingAvailable || r.LastFailure.AttemptAppHash != nil) {
				t.Fatal("absent timing was manufactured as zero")
			}
			if kind == "persistence-failure" && (r.LastFailure == nil || r.LastFailure.Timing == nil || r.LastFailure.CommittedCheckpoint == nil || r.LastFailure.Timing.Durable || r.LastFailure.AttemptAppHash != nil || r.LastFailure.CommittedCheckpoint.Height == r.LastFailure.Timing.Height) {
				t.Fatal("failed persistence reused the old hash as its new checkpoint")
			}
			if kind == "persistence-failure" {
				detail, available := app.LastCommitValidationTiming()
				if !available || !detail.Valid || detail.Height != r.LastFailure.Timing.Height || !r.LastFailure.NotificationObserved {
					t.Fatal("failed write lost its original successful validation or notification")
				}
				if ns, ok := r.LastFailure.Timing.StagesNs["validate_child_pq_state"]; !ok || ns != detail.PhaseNs["pq_state"] {
					t.Fatal("real failed persistence lost its measured validation child")
				}
				if detail.HashDocumentNs == 0 {
					if _, ok := r.LastFailure.Timing.StagesNs["validate_child_hash_document"]; ok {
						t.Fatal("unchanged-genesis path fabricated a zero hash document probe")
					}
				}
			}
			if kind == "unobserved-replay-latest" && (r.UnobservedLatest == nil || !r.UnobservedLatest.Persistence.Durable || r.UnobservedLatest.Height != f.doc.InitialHeight) {
				t.Fatal("actual unobserved final timing was discarded or relabelled as notification")
			}
		})
	}
}

func TestOperatorCommitObservationOutputPreservesOriginalAndStopFailure(t *testing.T) {
	f := newCommitObservationFixture(t)
	for _, kind := range []string{"existing-output", "replaced-parent", "closed-directory", "stop-failure", "incomplete-stop"} {
		t.Run(kind, func(t *testing.T) {
			app, o, p := makeObservedOperatorApplication(t, f, "atomic-json", filepath.Join(t.TempDir(), "state"), true)
			directObservedCommit(t, app, f.doc.InitialHeight)
			wrapOperatorCommitLogger(log.NewNopLogger(), o).With("module", "state").Info("committed state", "height", f.doc.InitialHeight)
			o.started()
			probe := &wireObservationStopProbe{running: true, quit: make(chan struct{})}
			original := []byte("original-UNKNOWN-do-not-overwrite")
			switch kind {
			case "existing-output":
				if err := os.WriteFile(p.commitObservationOutput, original, 0600); err != nil {
					t.Fatal(err)
				}
			case "replaced-parent":
				parent := filepath.Dir(p.commitObservationOutput)
				moved := parent + "-retained"
				if err := os.Rename(parent, moved); err != nil {
					t.Fatal(err)
				}
				if err := os.Mkdir(parent, 0700); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = os.RemoveAll(moved) }) // owned isolated fixture only
			case "closed-directory":
				if err := o.file.directory.Close(); err != nil {
					t.Fatal(err)
				}
			case "stop-failure":
				probe.err = errors.New("original normal stop first cause")
			case "incomplete-stop":
				probe.running = false
			}
			err := stopPQNodeWithObservations(probe, nil, o)
			if err == nil || probe.err != nil && !errors.Is(err, probe.err) {
				t.Fatal("original stop/output failure disappeared", err)
			}
			if kind == "existing-output" {
				got, err := os.ReadFile(p.commitObservationOutput)
				if err != nil || !bytes.Equal(got, original) {
					t.Fatal("original UNKNOWN was replaced", err)
				}
			} else if _, err := os.Lstat(p.commitObservationOutput); !os.IsNotExist(err) {
				t.Fatal("failed lifecycle/namespace created a result", err)
			}
			if o.attempted && o.writeAfterStop() == nil {
				t.Fatal("uncertain output attempt was retried")
			}
		})
	}
}

func TestOperatorCommitObservationBoundedSamplesAndNormalStopGuard(t *testing.T) {
	f := newCommitObservationFixture(t)
	app, o, p := makeObservedOperatorApplication(t, f, "atomic-json", filepath.Join(t.TempDir(), "state"), true)
	logger := wrapOperatorCommitLogger(log.NewNopLogger(), o).With("module", "state")
	for i := 0; i < operatorCommitObservationMaxSamples+1; i++ {
		height := f.doc.InitialHeight + int64(i)
		directObservedCommit(t, app, height)
		logger.Info("committed state", "height", height)
	}
	if len(o.result.Samples) != operatorCommitObservationMaxSamples || o.result.DroppedSuccessSamples != 1 || !o.result.SampleOverflow {
		t.Fatal("sample cap grew or silently lost real observations")
	}
	o.started()
	probe := &wireObservationStopProbe{running: true, quit: make(chan struct{})}
	probe.onStop = func() {
		if _, err := os.Lstat(p.commitObservationOutput); !os.IsNotExist(err) {
			t.Fatal("Commit output preceded actual Stop completion", err)
		}
	}
	if err := stopPQNodeWithObservations(probe, nil, o); err == nil || probe.calls != 1 {
		t.Fatal("truncated private result did not fail its qualification after normal stop", err)
	}
	r := readCommitObservationResult(t, p.commitObservationOutput)
	if !r.SampleOverflow || r.Coverage.NotificationCaptureComplete || r.SuccessNotifications != operatorCommitObservationMaxSamples+1 || r.DroppedSuccessSamples != 1 {
		t.Fatal("truncation was converted into a complete timing window")
	}
	before, err := os.ReadFile(p.commitObservationOutput)
	if err != nil {
		t.Fatal(err)
	}
	if err := stopPQNodeWithObservations(probe, nil, o); err == nil {
		t.Fatal("partial/truncated observation was retried")
	}
	after, err := os.ReadFile(p.commitObservationOutput)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("retained observation changed after retry", err)
	}
}
