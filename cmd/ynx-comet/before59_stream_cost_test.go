package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"syscall"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	dbm "github.com/cometbft/cometbft-db"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/mempool"
	"github.com/cometbft/cometbft/proxy"
	sm "github.com/cometbft/cometbft/state"
	blockstore "github.com/cometbft/cometbft/store"
	cmttypes "github.com/cometbft/cometbft/types"
)

type before59CostABCI struct {
	abci.Application
	response *abci.ResponseFinalizeBlock
}

func (a *before59CostABCI) FinalizeBlock(ctx context.Context, req *abci.RequestFinalizeBlock) (*abci.ResponseFinalizeBlock, error) {
	response, err := a.Application.FinalizeBlock(ctx, req)
	a.response = response
	return response, err
}

// Matches the original executeObservedEngineCommit fixture. The sole added
// wrapper records the actual Finalize response on both arms for Code checking.
func before59CostOriginalEngine(t *testing.T, f commitObservationFixture, app *consensus.Application, logger log.Logger, tx []byte) (sm.State, *cmttypes.Block, *abci.ResponseFinalizeBlock, error) {
	t.Helper()
	capture := &before59CostABCI{Application: app}
	p := proxy.NewAppConns(proxy.NewLocalClientCreator(capture), proxy.NopMetrics())
	if err := p.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = p.Stop() }()
	state, err := sm.MakeGenesisState(f.doc)
	if err != nil {
		t.Fatal(err)
	}
	info, err := app.Info(context.Background(), &abci.RequestInfo{})
	if err != nil {
		t.Fatal(err)
	}
	state.Version.Consensus.App = info.AppVersion
	db := dbm.NewMemDB()
	defer db.Close()
	store := sm.NewStore(db, sm.StoreOptions{})
	if err = store.Save(state); err != nil {
		t.Fatal(err)
	}
	blocksDB := dbm.NewMemDB()
	defer blocksDB.Close()
	blocks := blockstore.NewBlockStore(blocksDB)
	block, err := state.MakeBlock(state.InitialHeight, cmttypes.Txs{tx}, &cmttypes.Commit{}, nil, state.Validators.GetProposer().Address)
	if err != nil {
		t.Fatal(err)
	}
	parts, err := block.MakePartSet(cmttypes.BlockPartSizeBytes)
	if err != nil {
		t.Fatal(err)
	}
	id := cmttypes.BlockID{Hash: block.Hash(), PartSetHeader: parts.Header()}
	executor := sm.NewBlockExecutor(sm.WithConsensusAuthorityStore(store, app), logger.With("module", "state"), p.Consensus(), &mempool.NopMempool{}, sm.EmptyEvidencePool{}, blocks)
	next, err := executor.ApplyBlock(state, id, block)
	return next, block, capture.response, err
}

func TestBefore59CostOriginalEngineTransferResult(t *testing.T) {
	f := newCommitObservationFixture(t)
	for _, good := range []bool{true, false} {
		app, _, _ := makeObservedOperatorApplication(t, f, "atomic-json", filepath.Join(t.TempDir(), "state"), false)
		tx := f.transfer
		if !good {
			tx = []byte("invalid-synthetic-transfer")
		}
		_, _, response, err := before59CostOriginalEngine(t, f, app, log.NewNopLogger(), tx)
		if err != nil || response == nil || len(response.TxResults) != 1 || response.TxResults[0] == nil || (response.TxResults[0].Code == 0) != good {
			t.Fatalf("original transaction result differs for good=%t: %v", good, err)
		}
	}
}

// A local synthetic measurement, not a live node, throughput or finality test.
// Every arm uses the same original transfer and BlockExecutor. The enabled arm
// includes the real private stream, its worker, normal stop and durable receipt.
func TestBefore59SyntheticStreamOnlyCost(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("requires the original Linux monotonic clock and namespace")
	}
	source := os.Getenv("GITHUB_SHA")
	oldSource := operatorCommitBuildSource
	operatorCommitBuildSource = source
	defer func() { operatorCommitBuildSource = oldSource }()
	if binarySourceRevision() != source || len(source) != 40 {
		t.Fatal("exact declared synthetic source is required")
	}
	executable, err := os.Open(os.Args[0])
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.New()
	_, readErr := io.Copy(digest, executable)
	closeErr := executable.Close()
	if readErr != nil || closeErr != nil {
		t.Fatal("original test executable hash unavailable", readErr, closeErr)
	}
	f := newCommitObservationFixture(t)
	inputHash := sha256.Sum256(f.transfer)
	type roundRecord struct {
		Round          int    `json:"round"`
		Warmup         bool   `json:"warmup"`
		Enabled        bool   `json:"enabled"`
		BlockNs        int64  `json:"engineFixtureNs"`
		StopNs         int64  `json:"probeAndStreamStopNs"`
		CloseNs        int64  `json:"observerCloseNs"`
		AllocatedBytes uint64 `json:"allocatedBytes"`
		StreamBytes    int64  `json:"streamBytes"`
		StreamSHA256   string `json:"streamSHA256,omitempty"`
	}
	var records []roundRecord
	var expectedHeight int64
	var expectedBlock, expectedApp, boot, namespace string
	for round := 0; round < 10; round++ {
		for _, enabled := range []bool{round%2 == 0, round%2 != 0} {
			dir := t.TempDir()
			cfg, options := commitObservationOptions(t, filepath.Join(dir, "state"))
			options.stateLayout = "atomic-json"
			options.commitObservationOutput = ""
			if enabled {
				options.commitHeaderStreamOutput = filepath.Join(dir, "header.jsonl")
				options.syntheticCommitHeaderStreamOnly = true
			} else {
				options.commitObservationScope = ""
			}
			observer, err := prepareOperatorCommitObservation(cfg, options)
			if err != nil {
				t.Fatal(err)
			}
			if observer != nil {
				t.Cleanup(func() {
					if err := observer.close(); err != nil {
						t.Errorf("original observer cleanup UNKNOWN: %v", err)
					}
				})
			}
			if enabled {
				if observer == nil || !observer.headerOnly {
					t.Fatal("actual stream-only observer was not prepared")
				}
				options.commitObservationBind = observer.bind
			} else if observer != nil {
				t.Fatal("disabled arm unexpectedly enabled observation")
			}
			app, err := newOperatorApplication(f.migration, filepath.Join(dir, "state"), f.bootstrap, nil, options)
			if err != nil {
				t.Fatal(err)
			}
			f.initialize(t, app)
			logger := log.NewNopLogger()
			if enabled {
				if err := observer.armHeaderBeforeStart(); err != nil {
					t.Fatal(err)
				}
				observer.started() // controlled original callback; no Node was started
				clock := observer.monotonic.clock
				if clock.reason != "" || clock.boot == "" || clock.namespace == "" {
					t.Fatal("Linux clock identity unavailable", clock.reason)
				}
				if boot == "" {
					boot, namespace = clock.boot, clock.namespace
				} else if boot != clock.boot || namespace != clock.namespace {
					t.Fatal("kernel boot or time namespace changed")
				}
				logger = wrapOperatorCommitLogger(logger, observer)
			}
			var before, after runtime.MemStats
			runtime.ReadMemStats(&before)
			start := time.Now()
			state, block, response, err := before59CostOriginalEngine(t, f, app, logger, f.transfer)
			blockNs := time.Since(start).Nanoseconds()
			if err != nil || response == nil || len(response.TxResults) != 1 || response.TxResults[0] == nil || response.TxResults[0].Code != 0 {
				t.Fatal("original synthetic BlockExecutor or transfer failed", err)
			}
			blockHash, appHash := hex.EncodeToString(block.Hash()), hex.EncodeToString(state.AppHash)
			if expectedBlock == "" {
				expectedHeight, expectedBlock, expectedApp = state.LastBlockHeight, blockHash, appHash
			} else if state.LastBlockHeight != expectedHeight || blockHash != expectedBlock || appHash != expectedApp {
				t.Fatal("same-input block, height or application hash differs")
			}
			probe := &wireObservationStopProbe{running: true, quit: make(chan struct{})}
			start = time.Now()
			err = stopPQNodeWithObservations(probe, nil, observer)
			stopNs := time.Since(start).Nanoseconds()
			if err != nil || probe.calls != 1 {
				t.Fatal("original synthetic stop/stream UNKNOWN", err)
			}
			runtime.ReadMemStats(&after)
			record := roundRecord{Round: round, Warmup: round < 2, Enabled: enabled, BlockNs: blockNs, StopNs: stopNs, AllocatedBytes: after.TotalAlloc - before.TotalAlloc}
			if enabled {
				r := observer.headerEvents.report()
				if r.Status != "OBSERVED_DATA" || r.Enqueued != 1 || r.Written != 1 || !r.Durable || r.CleanupDebt || !r.ReceiptPublished || r.ReceiptCleanupDebt || r.FirstError != "" {
					t.Fatalf("original stream or worker not fully observed: %+v", r)
				}
				raw, err := os.ReadFile(options.commitHeaderStreamOutput)
				if err != nil || int64(len(raw)) != r.Bytes || len(raw) == 0 || int64(len(raw)) > syntheticHeaderStreamMaxBytes {
					t.Fatal("original stream bytes unavailable", err)
				}
				actualHash := sha256.Sum256(raw)
				if hex.EncodeToString(actualHash[:]) != r.SHA256 {
					t.Fatal("original stream digest changed after stop")
				}
				lines := bytes.Split(bytes.TrimSuffix(raw, []byte{'\n'}), []byte{'\n'})
				var event struct {
					Height      int64  `json:"height"`
					HeaderHash  string `json:"headerHash"`
					AppHash     string `json:"appHash"`
					MonotonicNs string `json:"monotonicNs"`
				}
				if len(lines) != 2 || string(lines[0]) != `{"version":"YNX-SYNTHETIC-HEADER-STREAM/v1","classification":"DATA_ONLY"}` ||
					json.Unmarshal(lines[1], &event) != nil || event.Height != expectedHeight || event.HeaderHash != expectedBlock || event.AppHash != expectedApp || event.MonotonicNs == "" {
					t.Fatal("original stream event differs from the real engine block")
				}
				record.StreamBytes, record.StreamSHA256 = r.Bytes, r.SHA256
				start = time.Now()
				err = observer.close()
				record.CloseNs = time.Since(start).Nanoseconds()
				if err != nil {
					t.Fatal("original stream close UNKNOWN", err)
				}
			}
			records = append(records, record)
		}
	}
	median := func(enabled bool, stop bool) int64 {
		var values []int64
		for _, record := range records {
			if record.Enabled == enabled && !record.Warmup {
				if stop {
					values = append(values, record.StopNs)
				} else {
					values = append(values, record.BlockNs)
				}
			}
		}
		if len(values) != 8 {
			t.Fatal("incomplete original paired samples")
		}
		sort.Slice(values, func(i, j int) bool { return values[i] < values[j] })
		return values[3] + (values[4]-values[3])/2
	}
	var usage syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &usage); err != nil {
		t.Fatal(err)
	}
	out := map[string]interface{}{"version": "YNX-SYNTHETIC-STREAM-ONLY-AB/v1", "source": source,
		"testBinarySHA256": hex.EncodeToString(digest.Sum(nil)), "inputSHA256": hex.EncodeToString(inputHash[:]),
		"pid": os.Getpid(), "bootID": boot, "timeNamespace": namespace, "clock": "CLOCK_MONOTONIC",
		"height": expectedHeight, "blockHash": expectedBlock, "appHash": expectedApp,
		"records": records, "medianEngineFixtureNsOff": median(false, false), "medianEngineFixtureNsOn": median(true, false),
		"medianProbeAndStreamStopNsOff": median(false, true), "medianProbeAndStreamStopNsOn": median(true, true),
		"engineFixtureMeaning":           "local proxy, state and in-memory database setup plus original BlockExecutor and proxy stop",
		"stopMeaning":                    "synthetic stop probe plus actual stream worker and durable receipt; not actual Node.Stop",
		"allocatedBytesMeaning":          "process-wide allocation delta from before engine fixture through probe and stream stop; excludes readback and observer close",
		"processMaxRSSKiBSharedLifetime": usage.Maxrss, "nodeStarted": false, "runtimeAuthorized": false, "independentFinality": false}
	raw, err := json.Marshal(out)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("YNX_SYNTHETIC_STREAM_ONLY_AB %s", raw)
}
