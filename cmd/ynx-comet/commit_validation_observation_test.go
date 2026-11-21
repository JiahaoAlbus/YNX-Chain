package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"

	cfg "github.com/cometbft/cometbft/config"
	cmtflags "github.com/cometbft/cometbft/libs/cli/flags"
	"github.com/cometbft/cometbft/libs/log"
	cmttypes "github.com/cometbft/cometbft/types"
)

func TestCommitValidationObservationOriginalBlockAndOptIn(t *testing.T) {
	f := newCommitObservationFixture(t)
	for _, enabled := range []bool{false, true} {
		t.Run(map[bool]string{false: "default", true: "opt_in"}[enabled], func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "state")
			c, p := commitObservationOptions(t, path)
			p.stateLayout = "atomic-json"
			p.commitValidationObservation = enabled
			if enabled {
				p.commitMonotonicOutput = filepath.Join(filepath.Dir(p.commitObservationOutput), "monotonic.json")
			}
			o, err := prepareOperatorCommitObservation(c, p)
			if err != nil {
				t.Fatal(err)
			}
			defer o.close()
			p.commitObservationBind = o.bind
			app, err := newOperatorApplication(f.migration, path, f.bootstrap, nil, p)
			if err != nil {
				t.Fatal(err)
			}
			f.initialize(t, app)
			base, err := cmtflags.ParseLogLevel("none", log.NewNopLogger(), cfg.DefaultLogLevel)
			if err != nil {
				t.Fatal(err)
			}
			logger := wrapOperatorCommitLogger(base, o).With("module", "main")
			next, _, err := executeObservedEngineCommit(t, f, app, logger, cmttypes.Txs{f.transfer})
			if err != nil {
				t.Fatal(err)
			}
			if len(o.result.Samples) != 1 {
				t.Fatal("original commit not observed", o.result.RejectedNotifications)
			}
			sample := o.result.Samples[0]
			if sample.Height != next.LastBlockHeight {
				t.Fatal("checkpoint mismatch")
			}
			if enabled {
				if sample.Validation == nil || sample.Validation.Height != sample.Height || sample.Validation.Version != "YNX-COMET-COMMIT-VALIDATION/v1" || len(sample.Validation.PhaseNs) == 0 {
					t.Fatalf("validation missing or unbound: %+v", sample.Validation)
				}
				bad := sample
				bad.Height++
				if _, reason := observedCommitValidation(app, &bad); reason == "" {
					t.Fatal("cross-height validation accepted")
				}
				if len(o.monotonic.samples) != 1 || o.monotonic.samples[0].Height != sample.Height || o.monotonic.samples[0].AppHash != sample.AppHash {
					t.Fatal("validation and monotonic observations lost same original commit identity")
				}
			} else if sample.Validation != nil {
				t.Fatal("default-off emitted validation")
			}
			o.started()
			if err = o.writeAfterStop(); err != nil {
				t.Fatal(err)
			}
			raw, err := os.ReadFile(p.commitObservationOutput)
			if err != nil {
				t.Fatal(err)
			}
			var wire struct {
				Samples []map[string]json.RawMessage `json:"samples"`
			}
			if err = json.Unmarshal(raw, &wire); err != nil {
				t.Fatal(err)
			}
			_, present := wire.Samples[0]["validation"]
			if present != enabled {
				t.Fatal("wire opt-in mismatch")
			}
		})
	}
}

// A small, interleaved, same-process fixture measures the actual local
// BlockExecutor. It is not a four-node benchmark or a throughput claim.
func TestCommitValidationObservationSyntheticOptInCost(t *testing.T) {
	f := newCommitObservationFixture(t)
	values := map[bool][]int64{false: {}, true: {}}
	for round := 0; round < 12; round++ {
		for _, enabled := range []bool{round%2 == 0, round%2 != 0} {
			path := filepath.Join(t.TempDir(), "state")
			c, p := commitObservationOptions(t, path)
			p.stateLayout = "atomic-json"
			p.commitValidationObservation = enabled
			o, err := prepareOperatorCommitObservation(c, p)
			if err != nil {
				t.Fatal(err)
			}
			p.commitObservationBind = o.bind
			app, err := newOperatorApplication(f.migration, path, f.bootstrap, nil, p)
			if err != nil {
				t.Fatal(err)
			}
			f.initialize(t, app)
			started := time.Now()
			_, _, err = executeObservedEngineCommit(t, f, app, wrapOperatorCommitLogger(log.NewNopLogger(), o), cmttypes.Txs{f.transfer})
			elapsed := time.Since(started).Nanoseconds()
			if err != nil || len(o.result.Samples) != 1 {
				t.Fatalf("original synthetic BlockExecutor sample: %v", err)
			}
			values[enabled] = append(values[enabled], elapsed)
			if err = o.close(); err != nil {
				t.Fatal(err)
			}
		}
	}
	for _, value := range values {
		sort.Slice(value, func(i, j int) bool { return value[i] < value[j] })
	}
	t.Logf("synthetic_same_process_interleaved n=12 each; original BlockExecutor elapsed ns median_off=%d median_on=%d; includes fixture-local IO, not real throughput", (values[false][5]+values[false][6])/2, (values[true][5]+values[true][6])/2)
}

func TestCommitValidationRequiresSyntheticCommitObservation(t *testing.T) {
	p := pqOptions{commitValidationObservation: true}
	if err := p.validateCommitObservation(); err == nil {
		t.Fatal("validation accepted without original synthetic Commit scope")
	}
}
