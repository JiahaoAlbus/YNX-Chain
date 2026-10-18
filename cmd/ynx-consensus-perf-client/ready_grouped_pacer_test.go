package main

import (
	"testing"
	"time"
)

// Scheduling counterexample only. No synthetic TPS or business finality claim.
func TestReadyPacingGroupedFourReducesFutureTimerTargets(t *testing.T) {
	start := time.Unix(1802736000, 0)
	p, err := newReadyOfferPacer("grouped-cadence4", start, 2*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	now := start
	waits, immediate, peak := 0, 0, 0
	for i := 0; i < 1024; i++ {
		if p.target.After(now) {
			waits++
			now = p.target.Add(2500 * time.Microsecond)
			immediate = 0
		}
		immediate++
		if immediate > peak {
			peak = immediate
		}
		p.advance(now)
	}
	if waits != 255 || peak != 4 || now.Sub(start) > 2050*time.Millisecond {
		t.Fatalf("fixed four-offer grouping escaped scheduling budget: waits=%d burst=%d duration=%s", waits, peak, now.Sub(start))
	}
}

func TestReadyPacingGroupedFourNeverReplaysExpiredGroups(t *testing.T) {
	start := time.Unix(1802736000, 0)
	for _, stall := range []time.Duration{8 * time.Millisecond, time.Second} {
		p, err := newReadyOfferPacer("grouped-cadence4", start, 2*time.Millisecond)
		if err != nil {
			t.Fatal(err)
		}
		p.advance(start) // One offered input; three slots in its group remain.
		now := start.Add(stall)
		catchup, reset := p.advance(now)
		if catchup || !reset || !p.target.Equal(now.Add(8*time.Millisecond)) || p.catchups != 0 {
			t.Fatal("expired group kept stale debt", stall, p)
		}
		// Reset is a fresh future group, not a continuation of the old group.
		now = p.target
		for i := 0; i < 4; i++ {
			catchup, reset = p.advance(now)
			if reset || catchup != (i < 3) {
				t.Fatal("group boundary/catch-up changed", i, p)
			}
		}
		if !p.target.After(now) || p.catchups != 0 {
			t.Fatal("fifth immediate offer possible")
		}
	}
}

func TestReadyPacingGroupedFourDropsAWholeMissedNextGroup(t *testing.T) {
	start := time.Unix(1802736000, 0)
	p, err := newReadyOfferPacer("grouped-cadence4", start, 2*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		p.advance(start)
	}
	// The fourth real offer is delayed beyond its group deadline. The pacer
	// does not generate the missed slots, issue a fifth, or carry them forward.
	now := start.Add(20 * time.Millisecond)
	catchup, reset := p.advance(now)
	if catchup || !reset || !p.target.Equal(now.Add(8*time.Millisecond)) {
		t.Fatal("missed group replayed", p)
	}
}
