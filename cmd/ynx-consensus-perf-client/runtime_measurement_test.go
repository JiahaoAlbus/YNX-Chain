package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

func TestRuntimeMeasurementCPURealUsageAndUnavailableAreTruthful(t *testing.T) {
	if _, err := readProcessCPUUsage(); err != nil {
		t.Skip("native process CPU unavailable", err)
	}
	probe := startProcessCPUProbe(true, readProcessCPUUsage)
	started := time.Now()
	digest := [32]byte{1}
	for i := 0; i < 20000; i++ {
		digest = sha256.Sum256(digest[:])
	}
	wall := time.Since(started)
	out := probe.finish(wall)
	if !out.Available || out.Samples != 2 || out.TotalNs <= 0 || out.TotalNs != out.UserNs+out.SystemNs || out.SampleBracketWallNs < out.MeasurementWallNs || out.SampleBracketOverheadNs != out.SampleBracketWallNs-out.MeasurementWallNs || out.CPUPercentOfOneCore <= 0 || digest == ([32]byte{}) {
		t.Fatalf("real process CPU sample not bound to actual work: %+v", out)
	}
	actual, _ := json.Marshal(out)
	t.Logf("LOCAL_PROCESS_CPU_ACTUAL %s", actual)
	calls := 0
	disabled := startProcessCPUProbe(false, func() (processCPUUsage, error) { calls++; return processCPUUsage{}, nil })
	if disabled.finish(time.Nanosecond) != nil || calls != 0 {
		t.Fatal("disabled measurement sampled CPU")
	}
	failed := startProcessCPUProbe(true, func() (processCPUUsage, error) { return processCPUUsage{}, errors.New("actual read failure") })
	if result := failed.finish(time.Nanosecond); result.Available || result.Samples != 0 || result.Error == "" {
		t.Fatal("unavailable CPU fabricated successful zeros", result)
	}
	sequence := 0
	regressed := startProcessCPUProbe(true, func() (processCPUUsage, error) {
		sequence++
		return processCPUUsage{UserNs: int64(100 - sequence)}, nil
	})
	if result := regressed.finish(time.Nanosecond); result.Available || result.Error == "" {
		t.Fatal("regressing CPU accepted", result)
	}
	raw, err := json.Marshal(report{})
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err = json.Unmarshal(raw, &fields); err != nil {
		t.Fatal(err)
	}
	if fields["processCPU"] != nil || fields["submissionOccupancy"] != nil {
		t.Fatal("default report invented runtime measurement")
	}
}

func TestRuntimeMeasurementPacedOccupancyUsesOriginalCallbackAndQueueIntervals(t *testing.T) {
	opts := options{concurrency: 2, observers: 2, offeredRate: 1e9, submissionOccupancy: new(submissionOccupancyRecorder)}
	rows := make([]transactionResult, 12)
	entered := make(chan struct{}, 2)
	release := make(chan struct{})
	var callbacks, observed atomic.Int64
	done := make(chan pacedStatistics, 1)
	started := time.Now()
	go func() {
		done <- runPacedTransactions(context.Background(), opts, started, rows, func(i int) (time.Time, bool) {
			at := time.Now()
			if callbacks.Add(1) <= 2 {
				entered <- struct{}{}
				<-release
			}
			return at, true
		}, func(int, time.Time) { observed.Add(1) })
	}()
	<-entered
	<-entered
	active := opts.submissionOccupancy.snapshot(time.Since(started))
	if active.ActiveCallbacksAtEnd != 2 || active.PeakActiveCallbacks != 2 || active.CallbackReturned != 0 {
		t.Fatal("actual held callbacks not measured", active)
	}
	close(release)
	<-done
	wall := time.Since(started)
	out := opts.submissionOccupancy.snapshot(wall)
	if callbacks.Load() != 12 || observed.Load() != 12 || out.CallbackStarted != 12 || out.CallbackReturned != 12 || out.ActiveCallbacksAtEnd != 0 || out.PeakActiveCallbacks != 2 || out.CallbackBusyNs <= 0 || out.CallbackBusyNs > 2*wall.Nanoseconds() || out.QueueWaitSamples != 12 || out.QueueWaitNs <= 0 {
		t.Fatalf("actual original callback or occupancy differs: %+v", out)
	}
	var queue float64
	for _, r := range rows {
		if r.QueueDelayMs == nil {
			t.Fatal("original queue interval absent")
		}
		queue += *r.QueueDelayMs * 1e6
	}
	if gap := queue - float64(out.QueueWaitNs); gap < -12 || gap > 12 {
		t.Fatal("queue occupancy differs from original row intervals", gap)
	}
	actual, _ := json.Marshal(out)
	t.Logf("CONTROLLED_CALLBACK_OCCUPANCY %s", actual)
	out.CallbackStarted = 999
	if opts.submissionOccupancy.snapshot(wall).CallbackStarted != 12 {
		t.Fatal("occupancy report aliases internal counters")
	}
}
