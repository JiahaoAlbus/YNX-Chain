package main

import (
	"bytes"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/cometbft/cometbft/libs/log"
	cmttypes "github.com/cometbft/cometbft/types"
)

// This logger is test-only. It snapshots the original application immediately
// after the original synchronous state logger callback; it does not wire a node.
type syntheticHeaderCallback struct {
	app       *consensus.Application
	count     int
	header    consensus.SyntheticCommitHeader
	timing    consensus.CommitTimingSample
	available bool
}
type syntheticHeaderCallbackLogger struct {
	base     log.Logger
	module   string
	callback *syntheticHeaderCallback
}

func (l *syntheticHeaderCallbackLogger) Debug(s string, kv ...interface{}) { l.base.Debug(s, kv...) }
func (l *syntheticHeaderCallbackLogger) Error(s string, kv ...interface{}) { l.base.Error(s, kv...) }
func (l *syntheticHeaderCallbackLogger) With(kv ...interface{}) log.Logger {
	return &syntheticHeaderCallbackLogger{base: l.base.With(kv...), module: commitLogModule(l.module, kv), callback: l.callback}
}
func (l *syntheticHeaderCallbackLogger) Info(s string, kv ...interface{}) {
	l.base.Info(s, kv...)
	if s == "committed state" && commitLogModule(l.module, kv) == "state" {
		l.callback.count++
		l.callback.header, l.callback.timing, l.callback.available = l.callback.app.LastSyntheticCommitHeaderAndTiming()
	}
}

func TestSyntheticCommitHeaderOriginalClockCallback(t *testing.T) {
	f := newCommitObservationFixture(t)
	app, observer, options := makeObservedOperatorApplication(t, f, "atomic-json", filepath.Join(t.TempDir(), "state"), true)
	if err := app.SetSyntheticCommitHeaderCapture(true); err != nil {
		t.Fatal(err)
	}
	options.commitMonotonicOutput = filepath.Join(filepath.Dir(options.commitObservationOutput), "header-clock.json")
	var err error
	observer.monotonic, err = prepareOperatorCommitMonotonic(options)
	if err != nil {
		t.Fatal(err)
	}
	observer.monotonic.clock = newCommitMonotonicClock(strings.Repeat("a", 40))
	before := observer.monotonic.capture()
	cb := &syntheticHeaderCallback{app: app}
	base := &syntheticHeaderCallbackLogger{base: log.NewNopLogger(), callback: cb}
	next, block, err := executeObservedEngineCommit(t, f, app, wrapOperatorCommitLogger(base, observer), cmttypes.Txs{f.transfer})
	if err != nil {
		t.Fatal(err)
	}
	after := observer.monotonic.capture()
	if cb.count != 1 || !cb.available || cb.header.Height != block.Height || !bytes.Equal(cb.header.HeaderHash[:], block.Hash()) || !bytes.Equal(cb.header.AppHash[:], next.AppHash) || !cb.timing.Durable || cb.timing.Height != block.Height || cb.header.CaptureEpoch == 0 || cb.header.Attempt == 0 {
		t.Fatal("original state callback did not observe its application header and raw timing")
	}
	if len(observer.result.Samples) != 1 || len(observer.monotonic.samples) != 1 {
		t.Fatal("original observer callback was not observed once")
	}
	sample, clock := observer.result.Samples[0], observer.monotonic.samples[0]
	if sample.Height != cb.header.Height || sample.Persistence.Height != cb.timing.Height || clock.Height != cb.header.Height || clock.AppHash != sample.AppHash {
		t.Fatal("callback projections differ")
	}
	for key, value := range cb.timing.StagesNs {
		if sample.Persistence.StagesNs[key] != value {
			t.Fatal("raw timing changed in projection")
		}
	}
	if runtime.GOOS == "linux" {
		assertCommitMonotonicBetween(t, before, clock.NS, after)
	} else if clock.NS != "" || clock.Reason == "" {
		t.Fatal("unsupported clock supplied a timestamp")
	}
}
