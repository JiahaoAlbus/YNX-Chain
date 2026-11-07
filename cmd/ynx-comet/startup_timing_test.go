package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"testing"

	"github.com/cometbft/cometbft/libs/log"
	"github.com/spf13/pflag"
)

type startupBrokenSink struct{ calls int }

func (w *startupBrokenSink) Write([]byte) (int, error) { w.calls++; return 0, io.ErrClosedPipe }

func TestOperatorStartupTimingDefaultAndOriginalError(t *testing.T) {
	var output bytes.Buffer
	if newOperatorStartupTimings(false, &output) != nil {
		t.Fatal("default timing changed")
	}
	p := pqOptions{recoveryFD: -1}
	f := pflag.NewFlagSet("start", pflag.ContinueOnError)
	registerStartupTimingFlags(f, &p)
	if p.enabled() {
		t.Fatal("default selected operator")
	}
	if err := f.Parse([]string{"--startup-timings"}); err != nil {
		t.Fatal(err)
	}
	if !p.enabled() || p.validate() == nil {
		t.Fatal("timing alone selected stock/unbound source")
	}
	sink := &startupBrokenSink{}
	timing := newOperatorStartupTimings(true, sink)
	original := errors.New("original private error never serialized")
	calls := 0
	for i := 0; i < 2; i++ {
		err := timedOperatorStartupCall(timing, "startup.nodeStart", func() error { calls++; return original })
		if err != original {
			t.Fatal("broken diagnostic sink changed first cause")
		}
	}
	if calls != 2 || sink.calls != 1 {
		t.Fatal("diagnostic failure retried operation or sink", calls, sink.calls)
	}
	timing = newOperatorStartupTimings(true, &output)
	if err := timedOperatorStartupCall(timing, "startup.nodeStart", func() error { return original }); err != original {
		t.Fatal(err)
	}
	var events []operatorStartupTimingEvent
	dec := json.NewDecoder(&output)
	for dec.More() {
		var e operatorStartupTimingEvent
		if err := dec.Decode(&e); err != nil {
			t.Fatal(err)
		}
		events = append(events, e)
	}
	if len(events) != 2 || events[0].Event != "begin" || events[0].Outcome != "RUNNING" || events[1].Event != "end" || events[1].Outcome != "REFUSED_OR_UNKNOWN" || events[1].ElapsedNS < 0 {
		t.Fatal("timing manufactured success", events)
	}
}

func TestOperatorStartupTimingActualColdConstructorWithoutStart(t *testing.T) {
	f := newCometJournalFixture(t)
	c, p := bootstrapStartupFixture(t, f, "atomic-json")
	original := bootstrapOriginalBytes(t, c, p)
	var out bytes.Buffer
	timing := newOperatorStartupTimings(true, &out)
	err := timedOperatorStartupCall(timing, "startup.normalNodeConstructor", func() error {
		n, custody, err := constructBootstrapNode(c, log.NewNopLogger(), p)
		if err != nil {
			return err
		}
		defer custody.Close()
		defer func() { n.OnStop(); _ = n.ProxyApp().Stop() }()
		if n.IsRunning() || n.BlockStore().Height() != 0 {
			t.Fatal("timing test started a node or invented blocks")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	assertBootstrapOriginalBytes(t, original)
	var e operatorStartupTimingEvent
	d := json.NewDecoder(&out)
	if err = d.Decode(&e); err != nil || e.Event != "begin" {
		t.Fatal(err, e)
	}
	if err = d.Decode(&e); err != nil || e.Outcome != "SUCCEEDED" || e.ElapsedNS <= 0 {
		t.Fatal(err, e)
	}
	if d.Decode(&e) != io.EOF {
		t.Fatal("extra timing event")
	}
}
