package main

import (
	"math"
	"testing"
	"time"
)

// Gate flags are explicit unit inputs; these tests do not establish network finality.
func timelineFixture(base time.Time, offset time.Duration) transactionResult {
	r := gateResult(nil, 1)
	r.offerMonotonic = base.Add(offset + 100*time.Millisecond)
	r.submitMonotonic = base.Add(offset + 200*time.Millisecond)
	offered, submitted := r.offerMonotonic.UTC(), r.submitMonotonic.UTC()
	r.OfferedAt = &offered
	r.SubmittedAt = &submitted
	check, inclusion, final := 100.0, 900.0, 2000.0
	r.CheckTxMs = &check
	r.InclusionMs = &inclusion
	r.ConfirmationMs = &final
	// Only presence is relevant: stage offsets must not depend on UTC clock jumps.
	utc := base.Add(-48 * time.Hour).UTC()
	r.IncludedObservedAt = &utc
	return r
}

func TestReadyTimelineCountsStagesBacklogAndIdleGapsAfterOutOfOrderHandoffs(t *testing.T) {
	base := time.Now()
	s := &readyTimeSeries{start: base}
	s.add(timelineFixture(base, 50*time.Millisecond), true, base.Add(2400*time.Millisecond))
	s.add(timelineFixture(base, 0), true, base.Add(2500*time.Millisecond))
	report := s.snapshot(3.25)
	if !report.Valid || len(report.Buckets) != 4 {
		t.Fatalf("missing actual seconds: %+v", report)
	}
	a, b, c, d := report.Buckets[0], report.Buckets[1], report.Buckets[2], report.Buckets[3]
	if a.Offered != 2 || a.Submitted != 2 || a.CheckTxAccepted != 2 || a.FinalSubmitted != 0 || a.AwaitingTerminal != 2 || a.OfferedNotYetFinal != 2 {
		t.Fatal("submission bin mixed terminal stages", a)
	}
	if b.EffectiveBusinessIncluded != 2 || b.FinalSubmitted != 0 || b.AwaitingTerminal != 2 {
		t.Fatal("inclusion bin lost backlog", b)
	}
	if c.FinalSubmitted != 2 || c.TerminalHandedBack != 2 || c.AwaitingTerminal != 0 || c.OfferedNotYetFinal != 0 {
		t.Fatal("final/terminal bin differs", c)
	}
	if !a.CompleteSecond || !b.CompleteSecond || !c.CompleteSecond || d.CompleteSecond || d.SpanNs != int64(250*time.Millisecond) || d.FinalSubmitted != 0 {
		t.Fatal("idle gap or partial trailing second omitted", d)
	}
	report.Buckets[0].Offered = 999
	if s.snapshot(3.25).Buckets[0].Offered != 2 {
		t.Fatal("snapshot aliases retained counts")
	}
}

func TestReadyTimelineWithholdsInvalidOrUnavailableClockEvidence(t *testing.T) {
	base := time.Now()
	for _, tc := range []struct {
		name   string
		mutate func(*transactionResult)
		end    time.Duration
	}{
		{"missing submission clock", func(r *transactionResult) { r.submitMonotonic = time.Time{} }, 3 * time.Second},
		{"missing final latency", func(r *transactionResult) { r.ConfirmationMs = nil }, 3 * time.Second},
		{"nonfinite final latency", func(r *transactionResult) { n := math.NaN(); r.ConfirmationMs = &n }, 3 * time.Second},
		{"final precedes inclusion", func(r *transactionResult) { n := 1.0; r.ConfirmationMs = &n }, 3 * time.Second},
		{"future final event", func(r *transactionResult) {}, time.Second},
		{"bucket capacity", func(r *transactionResult) {}, 1024 * time.Second},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := &readyTimeSeries{start: base}
			r := timelineFixture(base, 0)
			tc.mutate(&r)
			s.add(r, true, base.Add(tc.end))
			out := s.snapshot(4)
			if out.Valid || out.InvalidRows != 1 || len(out.Buckets) != 0 {
				t.Fatal("invalid row left a qualified series", out)
			}
		})
	}
}

func TestReadyTimelineSeparatesUnknownQuarantineFromPendingAndFinal(t *testing.T) {
	base := time.Now()
	s := &readyTimeSeries{start: base}
	r := timelineFixture(base, 0)
	r.Status = "submission_unknown"
	r.CheckTxCode = nil
	r.ExecutionCode = nil
	r.QuorumVerified = false
	r.TransactionProofVerified = false
	r.DurableStateVerified = false
	s.add(r, true, base.Add(1500*time.Millisecond))
	out := s.snapshot(2)
	if !out.Valid || out.Buckets[1].SubmissionUnknown != 1 || out.Buckets[1].TerminalHandedBack != 1 || out.Buckets[1].AwaitingTerminal != 0 || out.Buckets[1].OfferedNotYetFinal != 1 || out.Buckets[1].FinalSubmitted != 0 {
		t.Fatal("unknown turned into final or pending", out)
	}
}
