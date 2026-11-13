package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/cometbft/cometbft/libs/log"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/spf13/pflag"
)

func TestOperatorFinalizeObservationDefaultAndClosedFlags(t *testing.T) {
	for _, name := range []string{"default", "complete", "missing-commit", "missing-scope", "duplicate", "relative", "commit-alias", "wire-alias", "state-alias", "existing", "public-parent", "public-listener"} {
		t.Run(name, func(t *testing.T) {
			cfg, p := commitObservationOptions(t, filepath.Join(t.TempDir(), "state"))
			p.commitObservationOutput = ""
			p.commitObservationScope = ""
			dir := wireObservationTestDir(t)
			os.Chmod(dir, 0700)
			args := []string{"--commit-observation-output", filepath.Join(dir, "commit.json"), "--commit-observation-scope", operatorWireObservationScope, "--finalize-observation-output", filepath.Join(dir, "finalize.json")}
			switch name {
			case "default":
				args = nil
			case "missing-commit":
				args = args[2:]
			case "missing-scope":
				args = append(args[:2], args[4:]...)
			case "duplicate":
				args = append(args, args[4:]...)
			case "relative":
				args[5] = "finalize.json"
			case "commit-alias":
				args[5] = args[1]
			case "wire-alias":
				p.wireObservationOutput = args[5]
			case "state-alias":
				p.state = args[5]
			case "existing":
				if err := os.WriteFile(args[5], []byte("retained UNKNOWN"), 0600); err != nil {
					t.Fatal(err)
				}
			case "public-parent":
				sub := filepath.Join(dir, "public")
				os.Mkdir(sub, 0755)
				args[5] = filepath.Join(sub, "finalize.json")
			case "public-listener":
				cfg.P2P.ListenAddress = "tcp://0.0.0.0:37111"
			}
			flags := pflag.NewFlagSet("normal", pflag.ContinueOnError)
			flags.SetOutput(io.Discard)
			registerCommitObservationFlags(flags, &p)
			err := flags.Parse(args)
			if err == nil {
				err = p.validateCommitObservation()
			}
			var o *operatorCommitObservation
			if err == nil {
				o, err = prepareOperatorCommitObservation(cfg, p)
			}
			if o != nil {
				defer o.close()
			}
			if name == "default" {
				if err != nil || o != nil || p.commitObservationConfigured() {
					t.Fatal("default observer changed")
				}
			} else if name == "complete" {
				if err != nil || o == nil || o.finalize == nil {
					t.Fatal("normal opt-in unavailable", err)
				}
			} else if err == nil {
				t.Fatal("invalid/misbound observation accepted")
			}
		})
	}
}
func finalizeObservedApp(t *testing.T) (commitObservationFixture, *consensus.Application, *operatorCommitObservation, pqOptions) {
	t.Helper()
	f := newCommitObservationFixture(t)
	path := filepath.Join(t.TempDir(), "state")
	cfg, p := commitObservationOptions(t, path)
	p.finalizeObservationOutput = filepath.Join(filepath.Dir(p.commitObservationOutput), "finalize.json")
	o, err := prepareOperatorCommitObservation(cfg, p)
	if err != nil {
		t.Fatal(err)
	}
	p.commitObservationBind = o.bind
	app, err := newOperatorApplication(f.migration, path, f.bootstrap, nil, p)
	if err != nil {
		t.Fatal(err)
	}
	f.initialize(t, app)
	t.Cleanup(func() { o.close() })
	return f, app, o, p
}
func TestOperatorFinalizeObservationActualCallerAndFailureProjection(t *testing.T) {
	f, app, o, p := finalizeObservedApp(t)
	logger := wrapOperatorCommitLogger(log.NewNopLogger(), o)
	_, _, err := executeObservedEngineCommit(t, f, app, logger, cmttypes.Txs{f.transfer})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: -1}); err == nil {
		t.Fatal("original failed Finalize accepted")
	}
	o.started()
	probe := &wireObservationStopProbe{running: true, quit: make(chan struct{})}
	probe.onStop = func() {
		if _, err := os.Stat(p.finalizeObservationOutput); !os.IsNotExist(err) {
			t.Fatal("projection published before completed Stop")
		}
	}
	if err = stopPQNodeWithObservations(probe, nil, o); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(p.finalizeObservationOutput)
	if err != nil {
		t.Fatal(err)
	}
	var r operatorFinalizeResult
	if err = json.Unmarshal(raw, &r); err != nil {
		t.Fatal(err)
	}
	if !r.CaptureComplete || r.LockWaitIncluded || r.IndependentFinality || !r.ChildrenOverlapParentPhases || !r.UnreportedStagesAreUnknown || r.ProcessID != os.Getpid() || r.Observation.Attempts != 2 || len(r.Observation.Samples) != 2 {
		t.Fatal("bounded actual caller projection differs")
	}
	if !r.Observation.Samples[0].Success || r.Observation.Samples[0].AppHash == "" || r.Observation.Latest.Success || r.Observation.Latest.FailedPhase != "preflight" || r.Observation.Latest.AppHash != "" {
		t.Fatal("failed Finalize reused prior committed success")
	}
	original, err := os.ReadFile(p.commitObservationOutput)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	json.Unmarshal(original, &fields)
	if _, found := fields["finalize"]; found {
		t.Fatal("existing Commit schema changed")
	}
	if err = stopPQNodeWithObservations(probe, nil, o); err == nil {
		t.Fatal("output retry accepted")
	}
	again, _ := os.ReadFile(p.finalizeObservationOutput)
	if !bytes.Equal(raw, again) {
		t.Fatal("original output overwritten")
	}
	if err = o.close(); err != nil {
		t.Fatal(err)
	}
	if _, ok := app.FinalizeTimingSnapshot(); ok {
		t.Fatal("closed owner retained capture")
	}
}
func TestOperatorFinalizeObservationRetainsFailureAndDropDebt(t *testing.T) {
	for _, name := range []string{"early-failure-only", "overflow", "stop-failure", "overwrite", "public-migration"} {
		t.Run(name, func(t *testing.T) {
			f, app, o, p := finalizeObservedApp(t)
			if name == "public-migration" {
				cfg, p2 := commitObservationOptions(t, filepath.Join(t.TempDir(), "state"))
				p2.finalizeObservationOutput = filepath.Join(filepath.Dir(p2.commitObservationOutput), "finalize.json")
				other, e := prepareOperatorCommitObservation(cfg, p2)
				if e != nil {
					t.Fatal(e)
				}
				defer other.close()
				m := f.migration
				m.Network.IsPublicNet = true
				if e = other.bind(app, m); e == nil || other.app != nil || other.finalize.app != nil {
					t.Fatal("public source admitted")
				}
				return
			}
			count := 1
			if name == "overflow" {
				count = consensus.FinalizeTimingMaxSamples + 1
			}
			for i := 0; i < count; i++ {
				if _, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: -1}); err == nil {
					t.Fatal("failure guard lost")
				}
			}
			o.started()
			probe := &wireObservationStopProbe{running: true, quit: make(chan struct{})}
			if name == "stop-failure" {
				probe.err = errors.New("PUBLIC actual stop error")
			}
			if name == "overwrite" {
				if err := os.WriteFile(p.finalizeObservationOutput, []byte("retained UNKNOWN"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if err := stopPQNodeWithObservations(probe, nil, o); err == nil {
				t.Fatal("Commit-missing/truncated/stop/overwrite debt was suppressed")
			}
			raw, err := os.ReadFile(p.finalizeObservationOutput)
			if name == "stop-failure" {
				if !os.IsNotExist(err) {
					t.Fatal("failed physical stop wrote projection")
				}
				return
			}
			if name == "overwrite" {
				if err != nil || string(raw) != "retained UNKNOWN" {
					t.Fatal("UNKNOWN output overwritten")
				}
				return
			}
			if err != nil {
				t.Fatal("failed Finalize projection lost due no Commit", err)
			}
			var r operatorFinalizeResult
			if json.Unmarshal(raw, &r) != nil {
				t.Fatal("public result malformed")
			}
			if r.Observation.Latest.Success || r.Observation.Latest.FailedPhase != "preflight" || r.Observation.Attempts != uint64(count) {
				t.Fatal("failure coverage omitted")
			}
			if name == "overflow" {
				if r.CaptureComplete || r.Observation.Dropped != 1 || len(r.Observation.Samples) != consensus.FinalizeTimingMaxSamples {
					t.Fatal("overflow concealed")
				}
			} else if !r.CaptureComplete {
				t.Fatal("known failed attempt was not captured")
			}
		})
	}
}
