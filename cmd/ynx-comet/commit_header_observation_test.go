package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/cometbft/cometbft/libs/log"
	cmtnet "github.com/cometbft/cometbft/libs/net"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

func newHeaderObserverFixture(t *testing.T) (commitObservationFixture, *operatorCommitObservation) {
	t.Helper()
	f := newCommitObservationFixture(t)
	dir := t.TempDir()
	path := filepath.Join(dir, "state")
	config, options := commitObservationOptions(t, path)
	options.stateLayout = "atomic-json"
	options.commitMonotonicOutput = filepath.Join(filepath.Dir(options.commitObservationOutput), "clock.json")
	options.commitHeaderStreamOutput = filepath.Join(filepath.Dir(options.commitObservationOutput), "headers.jsonl")
	observer, err := prepareOperatorCommitObservation(config, options)
	if err != nil {
		t.Fatal(err)
	}
	options.commitObservationBind = observer.bind
	app, err := newOperatorApplication(f.migration, path, f.bootstrap, nil, options)
	if err != nil {
		t.Fatal(err)
	}
	f.initialize(t, app)
	t.Cleanup(func() { _ = observer.close() })
	return f, observer
}

func TestSyntheticHeaderStreamRawTimingProjection(t *testing.T) {
	raw := consensus.CommitTimingSample{Height: 4, Storage: "atomic-json", Durable: true, ElapsedNs: 3, PayloadBytes: 2, StagesNs: map[string]int64{"zero": 0}}
	projection := raw
	projection.StagesNs = map[string]int64{"zero": 0, "validation-child": 1}
	if !rawTimingInProjection(raw, projection) {
		t.Fatal("legitimate validation projection rejected")
	}
	delete(projection.StagesNs, "zero")
	if rawTimingInProjection(raw, projection) {
		t.Fatal("missing zero-valued stage accepted")
	}
	projection.StagesNs["zero"] = 0
	projection.Durable = false
	if rawTimingInProjection(raw, projection) {
		t.Fatal("different durable attempt accepted")
	}
}

func TestSyntheticHeaderStreamOriginalCallback(t *testing.T) {
	f, o := newHeaderObserverFixture(t)
	if err := o.armHeaderBeforeStart(); err != nil {
		t.Fatal(err)
	}
	// This fixture drives the original BlockExecutor and logger but no Node.
	o.started()
	o.monotonic.clock = newCommitMonotonicClock("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	next, _, err := executeObservedEngineCommit(t, f, o.app, wrapOperatorCommitLogger(log.NewNopLogger(), o), cmttypes.Txs{f.transfer})
	if err != nil {
		t.Fatal(err)
	}
	if o.headerHeight != next.LastBlockHeight && runtime.GOOS == "linux" {
		t.Fatal("original callback did not enqueue its height")
	}
	err = o.finishHeaderAfterStop()
	if runtime.GOOS == "linux" {
		if err != nil {
			t.Fatal(err)
		}
		if r := o.headerEvents.report(); r.Status != "OBSERVED_DATA" || r.Enqueued != 1 || r.Written != 1 {
			t.Fatalf("original stream incomplete: %+v", r)
		}
	} else if err == nil || !o.headerCaptureLost {
		t.Fatal("unsupported clock did not remain UNKNOWN")
	}
	receipt, err := os.ReadFile(o.headerEvents.receiptPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := o.finishHeaderAfterStop(); err == nil {
		t.Fatal("second stop readback was accepted")
	}
	after, err := os.ReadFile(o.headerEvents.receiptPath)
	if err != nil || string(after) != string(receipt) {
		t.Fatal("second stop readback changed original receipt")
	}
}

func TestSyntheticHeaderStreamPreStartCallbackUnknown(t *testing.T) {
	f, o := newHeaderObserverFixture(t)
	if err := o.armHeaderBeforeStart(); err != nil {
		t.Fatal(err)
	}
	o.monotonic.clock = newCommitMonotonicClock("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	if _, _, err := executeObservedEngineCommit(t, f, o.app, wrapOperatorCommitLogger(log.NewNopLogger(), o), cmttypes.Txs{f.transfer}); err != nil {
		t.Fatal(err)
	}
	if !o.headerCaptureLost {
		t.Fatal("a callback during startup was silently admitted")
	}
	if r := o.headerEvents.report(); r.FirstError != "original callback occurred before Node.Start returned" {
		t.Fatalf("startup first cause not retained: %+v", r)
	}
	o.started()
	if err := o.finishHeaderAfterStop(); err == nil {
		t.Fatal("startup callback became a complete stream")
	}
}

func TestSyntheticHeaderStreamChangedAttemptUnknown(t *testing.T) {
	f, o := newHeaderObserverFixture(t)
	if err := o.armHeaderBeforeStart(); err != nil {
		t.Fatal(err)
	}
	o.started()
	state, _, err := executeObservedEngineCommit(t, f, o.app, log.NewNopLogger(), cmttypes.Txs{f.transfer})
	if err != nil {
		t.Fatal(err)
	}
	first, timing, ok := o.readArmedHeader()
	if !ok {
		t.Fatal("original Commit not observed")
	}
	sample, reason := observedCommitSample(o.app, state.LastBlockHeight)
	if reason != "" {
		t.Fatal(reason)
	}
	// An intervening real application Commit cannot be paired with the older
	// callback even if the old timing was already read successfully.
	directObservedCommit(t, o.app, state.LastBlockHeight+1)
	o.mu.Lock()
	o.emitArmedHeader(state.LastBlockHeight, commitMonotonicReading{NS: "1"}, sample, first, timing, ok)
	lost := o.headerCaptureLost
	o.mu.Unlock()
	if !lost || o.headerEvents.report().FirstError != "original callback header and Commit attempt could not be bound" {
		t.Fatal("changed original attempt was admitted")
	}
	if err := o.finishHeaderAfterStop(); err == nil {
		t.Fatal("changed attempt produced a complete stream")
	}
}

func TestSyntheticHeaderStreamOptionsFailClosed(t *testing.T) {
	dir := t.TempDir()
	config, p := commitObservationOptions(t, filepath.Join(dir, "state"))
	p.commitHeaderStreamOutput = filepath.Join(filepath.Dir(p.commitObservationOutput), "header.jsonl")
	if p.validateCommitObservation() == nil {
		t.Fatal("header stream accepted without monotonic clock")
	}
	p.commitMonotonicOutput = filepath.Join(filepath.Dir(p.commitObservationOutput), "clock.json")
	if err := p.validateCommitObservation(); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{p.commitHeaderStreamOutput, p.commitHeaderStreamOutput + ".receipt.json"} {
		config.NodeKey = path
		if o, err := prepareOperatorCommitObservation(config, p); err == nil {
			_ = o.close()
			t.Fatal("header stream aliased original node key path")
		}
	}
	config.NodeKey = "config/node_key.json"
	p.commitHeaderStreamOutput = p.commitMonotonicOutput
	if p.validateCommitObservation() == nil {
		t.Fatal("overlapping stream accepted")
	}
	p.commitHeaderStreamOutput = p.commitMonotonicOutput + ".receipt.json"
	p.commitMonotonicOutput = p.commitHeaderStreamOutput + ".receipt.json"
	if p.validateCommitObservation() == nil {
		t.Fatal("receipt/output overlap accepted")
	}
}

func TestSyntheticHeaderStreamCloseDoesNotRetryTimedOutFinish(t *testing.T) {
	stream := &syntheticHeaderStream{queue: make(chan syntheticHeaderEvent), done: make(chan struct{})}
	o := &operatorCommitObservation{headerEvents: stream, headerFinished: true}
	start := time.Now()
	if err := o.close(); err != nil {
		t.Fatal(err)
	}
	if time.Since(start) >= time.Second || stream.closed {
		t.Fatal("close retried the original stream retirement")
	}
}

// The real normal launcher is started only on loopback with isolated test
// material. No transaction or quorum is produced; absence must stay UNKNOWN.
func TestSyntheticHeaderStreamNormalNodeNoActivityUnknown(t *testing.T) {
	f := newWireObservationFixture(t)
	f.options.wireObservationOutput, f.options.wireObservationScope = "", ""
	dir := wireObservationTestDir(t)
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	f.options.commitObservationOutput = filepath.Join(dir, "commit.json")
	f.options.commitObservationScope = operatorWireObservationScope
	f.options.commitMonotonicOutput = filepath.Join(dir, "clock.json")
	f.options.commitHeaderStreamOutput = filepath.Join(dir, "headers.jsonl")
	port, err := cmtnet.GetFreePort()
	if err != nil {
		t.Fatal(err)
	}
	viper.Reset()
	t.Cleanup(viper.Reset)
	t.Setenv("CMTHOME", "")
	t.Setenv("TMHOME", "")
	viper.SetConfigFile(f.config.RootDir + "/config/config.toml")
	if err := viper.ReadInConfig(); err != nil {
		t.Fatal(err)
	}
	viper.Set("p2p.laddr", fmt.Sprintf("tcp://127.0.0.1:%d", port))
	viper.Set("rpc.laddr", "")
	viper.Set("p2p.persistent_peers", "")
	viper.Set("p2p.seeds", "")
	viper.Set("log_level", "error")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	command := &cobra.Command{Use: "start"}
	command.Flags().String("home", f.config.RootDir, "synthetic isolated home")
	command.SetContext(ctx)
	if err := runPQNode(command, f.options); err == nil {
		t.Fatal("empty lifetime was reported as complete observation")
	}
	raw, err := os.ReadFile(f.options.commitHeaderStreamOutput + ".receipt.json")
	if err != nil {
		t.Fatal(err)
	}
	var receipt map[string]interface{}
	if json.Unmarshal(raw, &receipt) != nil || receipt["status"] != "UNKNOWN" || receipt["streamStatus"] != "UNKNOWN" || receipt["runtimeAuthorized"] != false || receipt["independentFinality"] != false {
		t.Fatal("empty normal node observation overstated evidence")
	}
}
