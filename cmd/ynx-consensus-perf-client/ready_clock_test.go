package main

import (
	"testing"
	"time"
)

func TestNativeStreamingClientClockCoversActualMonotonicEvents(t *testing.T) {
	start := time.Now()
	s := &readyTimeSeries{start: start, clockEnabled: true}
	row := timelineFixture(start, 0)
	s.add(row, true, start.Add(3*time.Second))
	clock := s.snapshot(3.25).Clock
	if clock == nil || !clock.Valid || !clock.DriftWithin1ms || clock.Samples != 3 || clock.InvalidSamples != 0 || clock.OriginUnixNs == "" {
		t.Fatal("real matching clocks missing", clock)
	}
	old := &readyTimeSeries{start: start}
	old.add(row, true, start.Add(3*time.Second))
	if old.snapshot(3.25).Clock != nil {
		t.Fatal("legacy clock report changed")
	}
	clock.Samples = 999
	if s.snapshot(3.25).Clock.Samples != 3 {
		t.Fatal("public clock snapshot modified counters")
	}
	row.OfferedAt = new(time.Time)
	*row.OfferedAt = start.Add(48 * time.Hour)
	s.add(row, true, start.Add(3*time.Second))
	if s.snapshot(3.25).Clock.Valid {
		t.Fatal("serialized UTC timestamp differing from original clock accepted")
	}
}
func TestNativeStreamingClientClockRejectsDifferentWallTimestamp(t *testing.T) {
	start := time.Now()
	s := &readyTimeSeries{start: start, clockEnabled: true}
	// Deliberately mismatched unit inputs must never supply clock evidence.
	later := start.Add(time.Millisecond)
	wall := later.Add(2 * time.Second)
	s.sampleClientClock(wall, later)
	if s.clientClockReport().Valid {
		t.Fatal("mismatched timestamp and monotonic sample accepted")
	}
}
