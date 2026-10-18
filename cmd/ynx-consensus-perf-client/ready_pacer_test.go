package main

import (
	"testing"
	"time"
)

func TestReadyPacingDefaultRetainsExactRelativePolicy(t *testing.T) {
	start := time.Unix(1802736000, 0)
	for _, mode := range []string{"", "relative"} {
		p, err := newReadyOfferPacer(mode, start, 2*time.Millisecond)
		if err != nil {
			t.Fatal(err)
		}
		for _, delay := range []time.Duration{0, time.Millisecond, time.Second} {
			now := p.target.Add(delay)
			catchup, reset := p.advance(now)
			if catchup || reset || !p.target.Equal(now.Add(2*time.Millisecond)) {
				t.Fatal("default pacing changed", mode, delay, p)
			}
		}
	}
}

// Virtual-clock schedule counterexample, not a throughput benchmark. A repeated
// 2.5ms late wake must not become an extra2.5ms in every future scheduled slot.
func TestReadyPacingBoundedCadenceDoesNotAccumulateShortJitter(t *testing.T) {
	start := time.Unix(1802736000, 0)
	end := func(mode string) time.Duration {
		p, err := newReadyOfferPacer(mode, start, 2*time.Millisecond)
		if err != nil {
			t.Fatal(err)
		}
		now := start
		for i := 0; i < 100; i++ {
			if p.target.After(now) {
				now = p.target.Add(2500 * time.Microsecond)
			}
			p.advance(now)
		}
		return now.Sub(start)
	}
	if old, candidate := end("relative"), end("bounded-cadence"); old < 400*time.Millisecond || candidate > 205*time.Millisecond {
		t.Fatalf("jitter schedule counterexample lost: relative=%s cadence=%s", old, candidate)
	}
}

func TestReadyPacingLongStallDropsMissedSlotsAndBurstIsBounded(t *testing.T) {
	start := time.Unix(1802736000, 0)
	p, err := newReadyOfferPacer("bounded-cadence", start, 2*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	now := start.Add(time.Second)
	catchup, reset := p.advance(now)
	if catchup || !reset || !p.target.Equal(now.Add(2*time.Millisecond)) {
		t.Fatal("long stall accumulated catch-up offers")
	}
	p.target = start
	for i := 0; i < readyPacingBurstLimit; i++ {
		// Lag remains below the time cutoff; adversarial work keeps the next
		// target overdue, so the independent consecutive-target cap must stop it.
		now = start.Add(time.Duration(7+2*i) * time.Millisecond)
		catchup, reset = p.advance(now)
		if i < readyPacingBurstLimit-1 {
			if !catchup || reset {
				t.Fatal("short-jitter budget disappeared", i)
			}
		} else if catchup || !reset || !p.target.After(now) {
			t.Fatal("four-offer budget did not stop catch-up", i)
		}
	}
}

func TestReadyPacingRejectsUnknownOrOverflowingPlans(t *testing.T) {
	for _, row := range []struct {
		mode     string
		interval time.Duration
	}{
		{"unknown", time.Millisecond}, {"bounded-cadence", 0}, {"relative", -1},
		{"bounded-cadence", time.Duration(1<<63 - 1)},
		{"grouped-cadence4", time.Duration(1<<63 - 1)},
	} {
		if _, err := newReadyOfferPacer(row.mode, time.Time{}, row.interval); err == nil {
			t.Fatal("invalid cadence accepted", row)
		}
	}
	o := options{manifest: "manifest", transactions: "transactions", output: "new-result", rounds: 2,
		concurrency: 4, observers: 4, timeout: 10 * time.Second, poll: 100 * time.Millisecond,
		offeredRate: 512, pacingMode: "bounded-cadence"}
	if validateOptions(o) == nil {
		t.Fatal("cadence accepted outside ready-pool")
	}
	o.senderMode = "ready-pool"
	if err := validateOptions(o); err != nil {
		t.Fatal(err)
	}
	o.pacingMode = "grouped-cadence4"
	if err := validateOptions(o); err != nil {
		t.Fatal(err)
	}
	o.senderMode = "rounds"
	if validateOptions(o) == nil {
		t.Fatal("grouped cadence accepted outside ready-pool")
	}
	o.senderMode = "ready-pool"
	o.pacingMode = "unknown"
	if validateOptions(o) == nil {
		t.Fatal("unknown pacing accepted")
	}
}
