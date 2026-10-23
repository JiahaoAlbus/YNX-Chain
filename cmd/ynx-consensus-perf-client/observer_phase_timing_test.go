package main

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestObserverPhaseTimingDisabledCallsOnceAndPreservesFailure(t *testing.T) {
	var stats groupedObservationStats
	calls := 0
	cause := errors.New("original RPC failure")
	got, err := observedCall(&stats, "block_query", 0, 7, 0, "", func() (int, error) { calls++; return 3, cause })
	if calls != 1 || got != 3 || !errors.Is(err, cause) || stats.Phases != nil {
		t.Fatal("default telemetry changed original call or failure")
	}
}

func TestObserverPhaseTimingBindsSameCallErrorMonotonicTraceAndCaps(t *testing.T) {
	var stats groupedObservationStats
	stats.enablePhaseTiming(2, time.Now())
	cause := context.DeadlineExceeded
	for i := 0; i < observerTracePerWorker+3; i++ {
		err := observedCheck(&stats, "transaction_inclusion_proof", 1, 7, 1, "test-hash", func() error { return cause })
		if !errors.Is(err, cause) {
			t.Fatal("failed call was masked")
		}
	}
	total := stats.Phases.Totals["transaction_inclusion_proof"]
	if total.Attempts != observerTracePerWorker+3 || total.Errors != total.Attempts || total.DurationNs <= 0 || !stats.Phases.TraceCapped || len(stats.Phases.Trace) != observerTracePerWorker {
		t.Fatal("failed attempts/totals or capped trace lost", stats.Phases)
	}
	var previous int64
	for i, row := range stats.Phases.Trace {
		if row.Sequence != uint64(i+1) || row.Worker != 2 || row.Node != 1 || row.Height != 7 || row.Members != 1 || row.TransactionHash != "test-hash" || !row.Failed || row.StartOffsetNs < previous || row.DurationNs < 0 {
			t.Fatal("call correlation/monotonic trace invalid", row)
		}
		previous = row.StartOffsetNs + row.DurationNs
	}
	var aggregate groupedObservationStats
	aggregate.add(stats)
	stats.Phases.Trace[0].Members = 999
	stats.Phases.Totals["transaction_inclusion_proof"] = observerPhaseTotal{}
	if aggregate.Phases.Trace[0].Members != 1 || aggregate.Phases.Totals["transaction_inclusion_proof"].Attempts != observerTracePerWorker+3 {
		t.Fatal("aggregated timing aliases worker")
	}
}

func TestObserverPhaseTimingActualSignedBlockAndReadbackCounters(t *testing.T) {
	for _, scan := range []bool{false, true} {
		t.Run(map[bool]string{false: "tx_query", true: "block_scan"}[scan], func(t *testing.T) {
			g, c, jobs := groupedObservationFixture(t)
			var blockCalls, resultCalls *int
			if scan {
				var scanner *scannerTestClient
				g, scanner, jobs = scannerFixture(t)
				c = scanner.groupedTestClient
				blockCalls, resultCalls = &scanner.blockCalls, &scanner.resultCalls
			}
			g.stats.enablePhaseTiming(0, time.Now())
			c.requireMeasuredTick = true
			g.reader.measurePhases = true
			if remaining := g.step(context.Background(), jobs); len(remaining) != 0 {
				t.Fatal("actual signed block did not finish")
			}
			phases := g.stats.Phases.Totals
			for phase, count := range map[string]uint64{"commit_query": uint64(c.commitCalls), "validators_query": uint64(c.validatorCalls), "quorum_verification": g.stats.QuorumVerifications, "durable_business_batch": g.stats.DurableBatches, "published_info_query": uint64(c.infoCalls), "transaction_inclusion_proof": 3} {
				if phases[phase].Attempts != count || phases[phase].Errors != 0 || phases[phase].DurationNs <= 0 {
					t.Fatal("actual phase/call counts differ", phase, phases[phase], count)
				}
			}
			if scan {
				if phases["block_query"].Attempts != uint64(*blockCalls) || phases["block_results_query"].Attempts != uint64(*resultCalls) || phases["block_capture_and_merkle"].Attempts != 1 {
					t.Fatal("original block scan requests not measured exactly")
				}
			} else if phases["tx_query"].Attempts != 3 {
				t.Fatal("original transaction requests not measured")
			}
			reader := g.reader.stats()
			if reader.PhaseTotalsNs == nil || reader.PhaseTotalsNs.LoadNs <= 0 || reader.PhaseTotalsNs.TransactionVerifyNs <= 0 || reader.TransactionVerifications != 3 || g.reader.profileMu != nil {
				t.Fatal("observer-only readback timing changed cache/serialization or lost phases", reader)
			}
			for _, job := range jobs {
				if !verifiedBusinessInclusion(g.results[job.index]) || g.results[job.index].Status != "confirmed" {
					t.Fatal("timing changed actual business evidence")
				}
			}
		})
	}
}

func TestObserverPhaseTimingBadQuorumStillFailsAndIsTimed(t *testing.T) {
	g, c, jobs := groupedObservationFixture(t)
	g.stats.enablePhaseTiming(0, time.Now())
	c.commit.Commit.Signatures[0].Signature[0] ^= 1
	g.step(context.Background(), jobs)
	q := g.stats.Phases.Totals["quorum_verification"]
	if q.Attempts != 1 || q.Errors != 1 || q.DurationNs <= 0 || g.stats.Phases.Totals["durable_business_batch"].Attempts != 0 {
		t.Fatal("bad quorum timed as success or reached durability", g.stats.Phases)
	}
	for _, job := range jobs {
		if verifiedBusinessInclusion(g.results[job.index]) || g.results[job.index].Status == "confirmed" {
			t.Fatal("timing bypassed bad quorum")
		}
	}
}
