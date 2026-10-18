package main

import (
	"errors"
	"time"
)

const readyPacingBurstLimit = 4

func normalizeReadyPacingMode(mode string) (string, error) {
	switch mode {
	case "", "relative":
		return "relative", nil
	case "bounded-cadence", "grouped-cadence4":
		return mode, nil
	default:
		return "", errors.New("unsupported ready pacing mode")
	}
}

// The default retains the original now+interval policy. The opt-in cadence
// compensates short wake jitter, with at most three immediately due successor
// targets (four offers including the waking offer). Long stalls drop missed
// slots rather than accumulating a replay/catch-up workload.
type readyOfferPacer struct {
	mode        string
	interval    time.Duration
	target      time.Time
	catchups    int
	groupStart  time.Time
	groupOffers int
}

func newReadyOfferPacer(mode string, start time.Time, interval time.Duration) (*readyOfferPacer, error) {
	mode, err := normalizeReadyPacingMode(mode)
	if err != nil {
		return nil, err
	}
	if interval <= 0 {
		return nil, errors.New("positive ready pacing interval required")
	}
	if mode != "relative" && interval > time.Duration(1<<63-1)/readyPacingBurstLimit {
		return nil, errors.New("bounded cadence interval overflow")
	}
	return &readyOfferPacer{mode: mode, target: start, groupStart: start, interval: interval}, nil
}

// Returns whether a catch-up target was scheduled and whether stale cadence was
// reset. These counters describe scheduling decisions, never sent transactions.
func (p *readyOfferPacer) advance(now time.Time) (catchup, reset bool) {
	if p.mode == "relative" {
		p.target = now.Add(p.interval)
		return false, false
	}
	if p.mode == "grouped-cadence4" {
		period := readyPacingBurstLimit * p.interval
		// At most four offers per group. Once its deadline is reached, any
		// unissued slots expire. No timer wake grants missed slots or a replay.
		if now.Sub(p.groupStart) >= period {
			p.groupStart, p.target = now.Add(period), now.Add(period)
			p.groupOffers, p.catchups = 0, 0
			return false, true
		}
		p.groupOffers++
		if p.groupOffers < readyPacingBurstLimit {
			p.target = p.groupStart
			p.catchups = p.groupOffers
			return true, false
		}
		p.groupStart = p.groupStart.Add(period)
		p.target = p.groupStart
		p.groupOffers, p.catchups = 0, 0
		return false, false
	}
	next := p.target.Add(p.interval)
	if !next.After(now) {
		if now.Sub(p.target) >= readyPacingBurstLimit*p.interval || p.catchups >= readyPacingBurstLimit-1 {
			p.target, p.catchups = now.Add(p.interval), 0
			return false, true
		}
		p.target = next
		p.catchups++
		return true, false
	}
	p.target, p.catchups = next, 0
	return false, false
}
