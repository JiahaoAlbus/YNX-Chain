//go:build unix

package consensus

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/cometbft/cometbft/node"
	sm "github.com/cometbft/cometbft/state"
)

func TestPQLabLiveMaterialsCaptureOnlyOriginalCommitCrossings(t *testing.T) {
	h := newEngineWiringHarness(t)
	for i := 0; i < 4; i++ {
		h.apply(t, nil)
	}
	for _, scenario := range []string{
		"stable", "engine-crossing", "two-engine-crossings", "app-crossing",
		"engine-error", "joined-crossing-error", "same-height-wrong-hash", "chain-mismatch", "initial-height-mismatch",
		"height-gap", "app-behind", "not-activated", "exhausted", "cancel-crossing", "deadline-crossing", "already-canceled", "already-expired",
	} {
		t.Run(scenario, func(t *testing.T) {
			baseline, err := h.raw.Load()
			if err != nil {
				t.Fatal(err)
			}
			dir := t.TempDir()
			in := &pqLabLiveMaterialsInputs{
				directory:  dir,
				plan:       PQLabNetworkPlan{ChainID: baseline.ChainID, InitialHeight: baseline.InitialHeight},
				activation: PQLabActivation{ActivationHeight: baseline.InitialHeight, RegistryHeight: baseline.InitialHeight},
				policy:     PQLabLiveMaterialsPolicy{CaptureTimeout: 30 * time.Second},
			}
			if scenario == "not-activated" {
				in.activation.ActivationHeight = baseline.LastBlockHeight
			}
			// This tests only the original snapshot read seam. The numeric lower
			// bound here is not an activation proof or a fabricated PQ certificate.
			control := &PQLabLiveMaterialsControl{app: h.app, in: in, next: 1, seen: map[string]bool{}}
			ctx, cancel := context.WithTimeout(context.Background(), in.policy.CaptureTimeout)
			defer cancel()
			if scenario == "already-canceled" {
				cancel()
			}
			if scenario == "already-expired" || scenario == "deadline-crossing" {
				cancel()
				duration := -time.Second
				if scenario == "deadline-crossing" {
					duration = time.Second
				}
				ctx, cancel = context.WithTimeout(context.Background(), duration)
				defer cancel()
			}
			deadline, _ := ctx.Deadline()
			calls := 0
			readFailure := errors.New("PRIVATE-original-read-failure")
			load := func() (sm.State, error) {
				calls++
				actual, err := h.raw.Load()
				if err != nil {
					return actual, err
				}
				switch scenario {
				case "engine-crossing", "two-engine-crossings":
					count := 1
					if scenario == "two-engine-crossings" {
						count = 2
					}
					if calls <= count {
						// The real Node sentinel supplies no height. Do not invent
						// one in order to authorize a later proof snapshot.
						return sm.State{}, node.ErrProofSourceCheckpointCrossing
					}
				case "app-crossing":
					if calls == 1 {
						h.apply(t, nil) // actual original App/engine Commit, not edited JSON
					}
				case "engine-error":
					return sm.State{}, readFailure
				case "joined-crossing-error":
					return sm.State{}, errors.Join(node.ErrProofSourceCheckpointCrossing, readFailure)
				case "same-height-wrong-hash":
					actual.AppHash = bytes.Clone(actual.AppHash)
					actual.AppHash[0] ^= 1
				case "chain-mismatch":
					actual.ChainID += "-other"
				case "initial-height-mismatch":
					actual.InitialHeight++
				case "height-gap":
					actual.LastBlockHeight -= 2
				case "app-behind":
					actual.LastBlockHeight++
				case "exhausted":
					return sm.State{}, node.ErrProofSourceCheckpointCrossing
				case "cancel-crossing":
					cancel()
					return sm.State{}, node.ErrProofSourceCheckpointCrossing
				case "deadline-crossing":
					<-ctx.Done()
					return sm.State{}, node.ErrProofSourceCheckpointCrossing
				}
				return actual, nil
			}
			actual, raw, err := control.captureCheckpoint(ctx, load, nil)
			passed := scenario == "stable" || scenario == "engine-crossing" || scenario == "two-engine-crossings" || scenario == "app-crossing"
			wantedCalls := 1
			if scenario == "engine-crossing" || scenario == "app-crossing" {
				wantedCalls = 2
			} else if scenario == "two-engine-crossings" || scenario == "exhausted" {
				wantedCalls = 3
			} else if scenario == "already-canceled" || scenario == "already-expired" {
				wantedCalls = 0
			}
			if calls != wantedCalls || (err == nil) != passed {
				t.Fatal("paired capture call count or original refusal changed", calls, err)
			}
			if passed {
				// Existing strict full-state validator, not a new proof or a
				// synthetic height/hash acceptance rule.
				if e := pqBusinessCheckpointState(h.app, actual, raw, baseline.LastBlockHeight, calls); e != nil {
					t.Fatal(e)
				}
				original := bytes.Clone(raw)
				h.apply(t, nil)
				if !bytes.Equal(original, raw) || pqBusinessCheckpointState(h.app, actual, raw, baseline.LastBlockHeight, calls) != nil {
					t.Fatal("later original Commit changed or relabeled captured historical bytes")
				}
			} else if actual.LastBlockHeight != 0 || len(raw) != 0 {
				t.Fatal("refusal exposed partial engine/App snapshot")
			}
			if (scenario == "engine-error" || scenario == "joined-crossing-error") && !errors.Is(err, readFailure) {
				t.Fatal("original read failure lost")
			}
			if (scenario == "cancel-crossing" || scenario == "already-canceled") && !errors.Is(err, context.Canceled) {
				t.Fatal("cancellation lost")
			}
			if (scenario == "deadline-crossing" || scenario == "already-expired") && !errors.Is(err, context.DeadlineExceeded) {
				t.Fatal("original deadline lost")
			}
			if (scenario == "exhausted" || scenario == "cancel-crossing" || scenario == "deadline-crossing") && !errors.Is(err, node.ErrProofSourceCheckpointCrossing) {
				t.Fatal("original crossing first cause lost")
			}
			afterDeadline, _ := ctx.Deadline()
			entries, readErr := os.ReadDir(dir)
			if readErr != nil || len(entries) != 0 || afterDeadline != deadline || control.next != 1 || len(control.seen) != 0 || control.retired || control.busy {
				t.Fatal("read-only recapture wrote output, moved request, or changed owner/deadline")
			}
		})
	}
}

func TestPQLabLiveMaterialsCaptureKnownCoordinatesNeverRebase(t *testing.T) {
	h := newEngineWiringHarness(t)
	for i := 0; i < 4; i++ {
		h.apply(t, nil)
	}
	for _, scenario := range []string{"backward", "same-height-hash", "same-height-block", "forward-jump", "cumulative-forward"} {
		t.Run(scenario, func(t *testing.T) {
			baseline, err := h.raw.Load()
			if err != nil {
				t.Fatal(err)
			}
			in := &pqLabLiveMaterialsInputs{
				plan:       PQLabNetworkPlan{ChainID: baseline.ChainID, InitialHeight: baseline.InitialHeight},
				activation: PQLabActivation{ActivationHeight: baseline.InitialHeight, RegistryHeight: baseline.InitialHeight},
			}
			control := &PQLabLiveMaterialsControl{app: h.app, in: in}
			calls := 0
			load := func() (sm.State, error) {
				calls++
				if calls == 1 {
					h.apply(t, nil)
					return baseline, nil // real App == engine+1 typed crossing
				}
				switch scenario {
				case "forward-jump", "cumulative-forward":
					current, err := h.raw.Load()
					if err != nil {
						return current, err
					}
					h.apply(t, nil)
					if scenario == "forward-jump" {
						return h.raw.Load() // observed H+2, never a one-boundary retry
					}
					return current, nil // a second real App crossing at H+1
				case "backward":
					actual := baseline
					actual.LastBlockHeight--
					return actual, nil
				case "same-height-hash":
					actual := baseline
					actual.AppHash = bytes.Clone(actual.AppHash)
					actual.AppHash[0] ^= 1
					return actual, nil
				case "same-height-block":
					actual := baseline
					actual.LastBlockID.Hash = bytes.Clone(actual.LastBlockID.Hash)
					actual.LastBlockID.Hash[0] ^= 1
					return actual, nil
				}
				return sm.State{}, errors.New("unexpected extra capture")
			}
			trace := newPQLabProofCaptureObservation(0, 1, "", "")
			actual, raw, err := control.captureCheckpoint(context.Background(), load, trace)
			if err == nil || calls != 2 || len(raw) != 0 || actual.LastBlockHeight != 0 || !errors.Is(err, errProofHostCheckpointCrossing) {
				t.Fatal("known-coordinate refusal retried or lost first crossing", calls, err)
			}
			wantCrossings := uint32(1)
			if scenario == "cumulative-forward" {
				wantCrossings = 2
			}
			if trace.crossings != wantCrossings || trace.metrics.Snapshot().Stages["proof.engineRead"].Calls != 2 {
				t.Fatal("observation omitted a terminal typed crossing or counted a coordinate rejection", scenario, trace.crossings)
			}
			// Preserve the actual historical engine coordinate used by the first
			// pair; no old AppHash is relabeled at the subsequently observed H.
			if len(baseline.AppHash) != 32 || hex.EncodeToString(baseline.AppHash) == "" {
				t.Fatal("fixture did not provide a full original engine AppHash")
			}
		})
	}
}
