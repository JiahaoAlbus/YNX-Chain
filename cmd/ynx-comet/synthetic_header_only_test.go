package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/cometbft/cometbft/libs/log"
	cmtnet "github.com/cometbft/cometbft/libs/net"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

func TestSyntheticHeaderStreamOnlyBindIdentity(t *testing.T) {
	f := newCommitObservationFixture(t)
	dir := wireObservationTestDir(t)
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	state := filepath.Join(t.TempDir(), "state")
	config, options := commitObservationOptions(t, state)
	options.commitObservationOutput = ""
	options.commitHeaderStreamOutput = filepath.Join(dir, "header.jsonl")
	options.syntheticCommitHeaderStreamOnly = true
	o, err := prepareOperatorCommitObservation(config, options)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = o.close() })
	if err := os.Rename(options.commitHeaderStreamOutput, options.commitHeaderStreamOutput+".original"); err != nil {
		t.Fatal(err)
	}
	options.commitObservationBind = o.bind
	if _, err := newOperatorApplication(f.migration, state, f.bootstrap, nil, options); err == nil || !strings.Contains(err.Error(), "identity unavailable before application bind") || o.app != nil {
		t.Fatal("changed original output was not rejected at application bind", err)
	}
	first := o.headerEvents.report().FirstError
	if !o.headerCaptureLost || first == "" {
		t.Fatal("original bind identity error was not retained")
	}
	if err := o.close(); err == nil {
		t.Fatal("changed original stream reported a complete close")
	}
	if o.headerEvents.report().FirstError != first {
		t.Fatal("later cleanup replaced the original first cause")
	}
}

func TestSyntheticHeaderStreamOnlyCounterOverflow(t *testing.T) {
	dir := wireObservationTestDir(t)
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	stream, err := newSyntheticHeaderStream(filepath.Join(dir, "header.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	o := &operatorCommitObservation{headerOnly: true, headerEvents: stream, result: operatorCommitObservationResult{SuccessNotifications: math.MaxUint64, RejectedNotifications: map[string]uint64{}}}
	t.Cleanup(func() { _ = o.close() })
	wrapOperatorCommitLogger(log.NewNopLogger(), o).With("module", "state").Info("committed state", "height", int64(1))
	if !o.headerCaptureLost || !o.result.SampleOverflow || stream.report().FirstError != "synthetic header original notification counter overflow" {
		t.Fatal("overflow did not retain UNKNOWN and its first cause")
	}
	if err := o.writeAfterStop(); err == nil {
		t.Fatal("overflow stream reported complete data")
	}
}

func TestSyntheticHeaderStreamOnlyOptions(t *testing.T) {
	dir := t.TempDir()
	config, base := commitObservationOptions(t, filepath.Join(dir, "state"))
	base.commitObservationOutput = ""
	outDir := wireObservationTestDir(t)
	if err := os.Chmod(outDir, 0700); err != nil {
		t.Fatal(err)
	}
	base.commitHeaderStreamOutput = filepath.Join(outDir, "header.jsonl")
	base.syntheticCommitHeaderStreamOnly = true
	if err := base.validateCommitObservation(); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*pqOptions){
		func(p *pqOptions) { p.commitHeaderStreamOutput = "" },
		func(p *pqOptions) { p.commitObservationOutput = filepath.Join(dir, "legacy") },
		func(p *pqOptions) { p.commitMonotonicOutput = filepath.Join(dir, "clock") },
		func(p *pqOptions) { p.finalizeObservationOutput = filepath.Join(dir, "finalize") },
		func(p *pqOptions) { p.commitValidationObservation = true },
	} {
		p := base
		mutate(&p)
		if _, err := prepareOperatorCommitObservation(config, p); err == nil {
			t.Fatal("mixed stream-only mode was admitted")
		}
		if _, err := os.Lstat(base.commitHeaderStreamOutput); !os.IsNotExist(err) {
			t.Fatal("invalid mode created stream", err)
		}
	}
	for _, path := range []string{base.commitHeaderStreamOutput, base.commitHeaderStreamOutput + ".receipt.json"} {
		config.NodeKey = path
		if _, err := prepareOperatorCommitObservation(config, base); err == nil {
			t.Fatal("node identity alias admitted")
		}
	}
	p := base
	p.commitHeaderStreamOutput = filepath.Join(outDir, "node.writer.lock")
	config.NodeKey = filepath.Join(outDir, "node")
	if _, err := prepareOperatorCommitObservation(config, p); err == nil {
		t.Fatal("node identity lock alias admitted")
	}
}

// Exercises 130 real application Finalize/Commit operations and the actual
// state logger callback on the same owning App. This is not BlockExecutor,
// Node.Start, a network test, or an assertion about startup/WAL coverage.
func TestSyntheticHeaderStreamOnly130ApplicationCallbacks(t *testing.T) {
	f := newCommitObservationFixture(t)
	dir := wireObservationTestDir(t)
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	state := filepath.Join(t.TempDir(), "state")
	config, options := commitObservationOptions(t, state)
	options.commitObservationOutput = ""
	options.commitHeaderStreamOutput = filepath.Join(dir, "header.jsonl")
	options.syntheticCommitHeaderStreamOnly = true
	o, err := prepareOperatorCommitObservation(config, options)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = o.close() })
	options.commitObservationBind = o.bind
	app, err := newOperatorApplication(f.migration, state, f.bootstrap, nil, options)
	if err != nil {
		t.Fatal(err)
	}
	f.initialize(t, app)
	if err = o.armHeaderBeforeStart(); err != nil {
		t.Fatal(err)
	}
	o.started() // controlled callback fixture, not a running Node
	o.monotonic.clock = newCommitMonotonicClock(strings.Repeat("a", 40))
	logger := wrapOperatorCommitLogger(log.NewNopLogger(), o).With("module", "state")
	headers, appHashes := make([]string, 0, 130), make([]string, 0, 130)
	for i := int64(0); i < 130; i++ {
		h := f.doc.InitialHeight + i
		snapshot, err := app.CommittedPQEngineSnapshot()
		if err != nil {
			t.Fatal(err)
		}
		next, err := snapshot.ExpectedValidatorHash(h + 1)
		if err != nil {
			t.Fatal(err)
		}
		hash := bytes.Repeat([]byte{byte(i%250 + 1)}, 32)
		if _, err = app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: h, Hash: hash, Time: time.Unix(1800000000+h, 0), NextValidatorsHash: next}); err != nil {
			t.Fatal(err)
		}
		if _, err = app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
		info, err := app.Info(context.Background(), &abci.RequestInfo{})
		if err != nil {
			t.Fatal(err)
		}
		headers, appHashes = append(headers, hex.EncodeToString(hash)), append(appHashes, hex.EncodeToString(info.LastBlockAppHash))
		logger.Info("committed state", "height", h)
	}
	if len(o.result.Samples) != 0 || len(o.monotonic.samples) != 0 || o.result.SampleOverflow {
		t.Fatal("stream-only mode retained or overflowed legacy samples")
	}
	probe := &wireObservationStopProbe{running: true, quit: make(chan struct{})}
	err = stopPQNodeWithObservations(probe, nil, o)
	if probe.calls != 1 {
		t.Fatal("original node stop was not attempted exactly once")
	}
	for _, name := range []string{"commit.json", "clock.json", "finalize.json"} {
		if _, err := os.Lstat(filepath.Join(dir, name)); !os.IsNotExist(err) {
			t.Fatal("legacy output appeared", name, err)
		}
	}
	if runtime.GOOS != "linux" {
		if err == nil || !o.headerCaptureLost {
			t.Fatal("unsupported clock did not remain UNKNOWN")
		}
		return
	}
	if err != nil {
		t.Fatal(err)
	}
	r := o.headerEvents.report()
	if r.Status != "OBSERVED_DATA" || r.Enqueued != 130 || r.Written != 130 {
		t.Fatalf("original stream incomplete: %+v", r)
	}
	file, err := os.Open(options.commitHeaderStreamOutput)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	if !scanner.Scan() || scanner.Text() != `{"version":"YNX-SYNTHETIC-HEADER-STREAM/v1","classification":"DATA_ONLY"}` {
		t.Fatal("original stream DATA_ONLY header missing or changed")
	}
	count := 0
	var previousNs uint64
	for scanner.Scan() {
		var row struct {
			Height      int64  `json:"height"`
			Attempt     uint64 `json:"attempt"`
			MonotonicNs string `json:"monotonicNs"`
			HeaderHash  string `json:"headerHash"`
			AppHash     string `json:"appHash"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &row); err != nil {
			t.Fatal(err)
		}
		if count >= len(headers) {
			t.Fatal("extra stream record")
		}
		ns, err := strconv.ParseUint(row.MonotonicNs, 10, 64)
		if row.Height != f.doc.InitialHeight+int64(count) || row.Attempt != uint64(count+1) || row.HeaderHash != headers[count] || row.AppHash != appHashes[count] || err != nil || ns == 0 || ns < previousNs {
			t.Fatal("stream event sequence differs", row)
		}
		previousNs = ns
		count++
	}
	if err := scanner.Err(); err != nil || count != 130 {
		t.Fatal("stream count", count, err)
	}
	raw, err := os.ReadFile(options.commitHeaderStreamOutput + ".receipt.json")
	if err != nil {
		t.Fatal(err)
	}
	var receipt map[string]interface{}
	if json.Unmarshal(raw, &receipt) != nil || receipt["classification"] != "DATA_ONLY" || receipt["startupCoverageComplete"] != false || receipt["walReplayExcluded"] != false || receipt["runtimeAuthorized"] != false || receipt["independentFinality"] != false {
		t.Fatal("stream receipt overstated evidence")
	}
}

// Exercises the actual normal launcher with a cancelled context and no
// transactions. An empty stream is retained as UNKNOWN, never coverage.
func TestSyntheticHeaderStreamOnlyNormalNodeNoActivity(t *testing.T) {
	f := newWireObservationFixture(t)
	f.options.wireObservationOutput, f.options.wireObservationScope = "", ""
	dir := wireObservationTestDir(t)
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	f.options.commitObservationScope = operatorWireObservationScope
	f.options.commitHeaderStreamOutput = filepath.Join(dir, "headers.jsonl")
	f.options.syntheticCommitHeaderStreamOnly = true
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
		t.Fatal("empty normal node observation became complete")
	}
	raw, err := os.ReadFile(f.options.commitHeaderStreamOutput + ".receipt.json")
	if err != nil {
		t.Fatal(err)
	}
	var receipt map[string]interface{}
	if json.Unmarshal(raw, &receipt) != nil || receipt["status"] != "UNKNOWN" || receipt["streamStatus"] != "UNKNOWN" || receipt["runtimeAuthorized"] != false || receipt["independentFinality"] != false {
		t.Fatal("normal node receipt overstated evidence")
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Fatalf("unexpected output from stream-only mode: %v", entries)
	}
}
