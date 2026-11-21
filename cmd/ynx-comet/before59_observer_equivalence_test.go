package main

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/cometbft/cometbft/libs/log"
	cmttypes "github.com/cometbft/cometbft/types"
)

func before59OriginalObserverArm(t *testing.T, f commitObservationFixture, state string, enabled bool) (*consensus.Application, *operatorCommitObservation) {
	t.Helper()
	cfg, options := commitObservationOptions(t, state)
	options.stateLayout = "atomic-json"
	if enabled {
		parent := filepath.Dir(options.commitObservationOutput)
		options.finalizeObservationOutput = filepath.Join(parent, "finalize.json")
		options.commitMonotonicOutput = filepath.Join(parent, "monotonic.json")
		options.commitValidationObservation = true
	} else {
		options.commitObservationOutput = ""
		options.commitObservationScope = ""
	}
	observer, err := prepareOperatorCommitObservation(cfg, options)
	if err != nil {
		t.Fatal(err)
	}
	if enabled {
		if observer == nil {
			t.Fatal("observer-on arm did not bind original observation")
		}
		t.Cleanup(func() { _ = observer.close() })
		options.commitObservationBind = observer.bind
	} else if observer != nil || options.commitObservationBind != nil || options.commitObservationConfigured() {
		t.Fatal("observer-off arm is not the original default-off configuration")
	}
	app, err := newOperatorApplication(f.migration, state, f.bootstrap, nil, options)
	if err != nil {
		t.Fatal(err)
	}
	f.initialize(t, app)
	return app, observer
}

// This synthetic direct ABCI control compares each committed height, not
// votes, remote finality, four-node timing, or a released business run.
func TestBefore59ObserverAllStagesPreserveOriginalStateEveryHeight(t *testing.T) {
	f := newCommitObservationFixture(t)
	type point struct {
		Response, State, Fees, Hash []byte
		Files                       map[string][]byte
	}
	arms := make([][]point, 0, 2)
	for _, enabled := range []bool{false, true} {
		dir := t.TempDir()
		state := filepath.Join(dir, "state")
		app, observer := before59OriginalObserverArm(t, f, state, enabled)
		logger := log.NewNopLogger()
		if enabled {
			logger = wrapOperatorCommitLogger(logger, observer)
		}
		logger = logger.With("module", "state")
		var points []point
		for offset := int64(0); offset < 3; offset++ {
			height := f.doc.InitialHeight + offset
			snapshot, err := app.CommittedPQEngineSnapshot()
			if err != nil {
				t.Fatal(err)
			}
			validators, err := snapshot.ExpectedValidatorHash(height + 1)
			if err != nil {
				t.Fatal(err)
			}
			var txs [][]byte
			if offset == 0 {
				txs = [][]byte{bytes.Clone(f.transfer)}
			}
			response, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{
				Height: height, Time: time.Unix(1800000000+height, 0), NextValidatorsHash: validators, Txs: txs,
			})
			if err != nil {
				t.Fatal(err)
			}
			if offset == 0 && (len(response.TxResults) != 1 || response.TxResults[0].Code != 0) {
				t.Fatalf("original transfer did not execute successfully: %+v", response.TxResults)
			}
			if _, err = app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
				t.Fatal(err)
			}
			logger.Info("committed state", "height", height)
			info, err := app.Info(context.Background(), &abci.RequestInfo{})
			if err != nil {
				t.Fatal(err)
			}
			body, err := json.Marshal(response)
			if err != nil {
				t.Fatal(err)
			}
			var committed consensus.CommittedState
			stateRaw := cometJournalQuery(t, app, "/state", nil)
			if err = json.Unmarshal(stateRaw, &committed); err != nil {
				t.Fatal(err)
			}
			if offset == 0 && len(committed.FeeEvents) == 0 {
				t.Fatal("original transfer has no fee event")
			}
			points = append(points, point{Response: body, State: stateRaw, Fees: cometJournalQuery(t, app, "/economics/fees", nil),
				Hash: bytes.Clone(info.LastBlockAppHash), Files: commitObservationStateFiles(t, dir)})
		}
		if enabled {
			if len(observer.result.Samples) != len(points) {
				t.Fatalf("original commit notifications: %d", len(observer.result.Samples))
			}
			if observer.monotonic == nil || len(observer.monotonic.samples) != len(points) {
				t.Fatal("missing same-height synthetic clock samples")
			}
			for i, sample := range observer.monotonic.samples {
				decoded, err := hex.DecodeString(sample.AppHash)
				if err != nil || sample.Height != f.doc.InitialHeight+int64(i) || !bytes.Equal(points[i].Hash, decoded) {
					t.Fatal("clock identity differs from original commit")
				}
			}
		} else {
			if _, ok := app.LastCommitTiming(); ok {
				t.Fatal("observer-off arm enabled original Commit timing")
			}
			if _, ok := app.LastCommitValidationTiming(); ok {
				t.Fatal("observer-off arm enabled validation timing")
			}
		}
		arms = append(arms, points)
	}
	if !reflect.DeepEqual(arms[0], arms[1]) {
		t.Fatal("observer changed ABCI results, state/fee bytes, app hash, or persisted files at a height")
	}
}

// This companion control uses the actual local Comet BlockExecutor and a
// signed transfer in both arms. It is not a multi-node or finality test.
func TestBefore59AllObserverStagesPreserveOriginalBlockExecutor(t *testing.T) {
	f := newCommitObservationFixture(t)
	type point struct {
		State, Fees, Hash, Block []byte
		Height                   int64
		Files                    map[string][]byte
	}
	var points []point
	for _, enabled := range []bool{false, true} {
		dir := t.TempDir()
		state := filepath.Join(dir, "state")
		app, observer := before59OriginalObserverArm(t, f, state, enabled)
		logger := log.NewNopLogger()
		if enabled {
			logger = wrapOperatorCommitLogger(logger, observer)
		}
		next, block, err := executeObservedEngineCommit(t, f, app, logger, cmttypes.Txs{f.transfer})
		if err != nil {
			t.Fatal(err)
		}
		if enabled && (len(observer.result.Samples) != 1 || observer.result.Samples[0].Height != next.LastBlockHeight) {
			t.Fatal("original BlockExecutor commit observation missing")
		}
		if enabled && (observer.monotonic == nil || len(observer.monotonic.samples) != 1 || observer.monotonic.samples[0].AppHash != hex.EncodeToString(next.AppHash)) {
			t.Fatal("original BlockExecutor clock identity differs")
		}
		points = append(points, point{State: cometJournalQuery(t, app, "/state", nil), Fees: cometJournalQuery(t, app, "/economics/fees", nil),
			Hash: bytes.Clone(next.AppHash), Block: bytes.Clone(block.Hash()), Height: next.LastBlockHeight, Files: commitObservationStateFiles(t, dir)})
		if enabled {
			observer.started()
			if err := observer.writeAfterStop(); err != nil {
				t.Fatal(err)
			}
		} else {
			if _, ok := app.LastCommitTiming(); ok {
				t.Fatal("observer-off BlockExecutor enabled Commit timing")
			}
			if _, ok := app.LastCommitValidationTiming(); ok {
				t.Fatal("observer-off BlockExecutor enabled validation timing")
			}
		}
	}
	if len(points) != 2 || !reflect.DeepEqual(points[0], points[1]) {
		t.Fatal("observer changed real BlockExecutor block, checkpoint, fee, hash, or persisted bytes")
	}
}
