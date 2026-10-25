package main

import (
	"math"
	"reflect"
	"testing"
	"time"
)

// Flags are explicit unit inputs. These checks do not establish live consensus.
func cumulativeFixture() []transactionResult {
	base := time.Now()
	rows := make([]transactionResult, 6)
	for i := range rows {
		rows[i] = transactionResult{Index: i, Status: "not_submitted", Errors: []errorObservation{}}
	}
	zero := uint32(0)
	for i := 0; i < 4; i++ {
		at := base.Add(time.Duration(i) * time.Millisecond)
		utc := at.UTC()
		rows[i].OfferedAt = &utc
		rows[i].offerMonotonic = at
		if i < 3 {
			submit := at.Add(time.Millisecond)
			u := submit.UTC()
			rows[i].SubmittedAt = &u
			rows[i].submitMonotonic = submit
		}
	}
	at := base.UTC()
	for i := 0; i < 2; i++ {
		r := &rows[i]
		r.CheckTxCode = &zero
		r.CheckTxIdentityVerified = true
		r.ExecutionCode = &zero
		r.IncludedObservedAt = &at
		r.QuorumVerified = true
		r.TransactionProofVerified = true
	}
	rows[0].Status = "confirmed"
	rows[0].ConfirmedObservedAt = &at
	rows[0].DurableStateVerified = true
	rows[0].Height = 5
	rows[0].DurableStateHeight = 5
	rows[0].DurableSnapshotSHA256 = "unit-explicit-gate"
	queue, final, inclusion, check := 2.1, 5.3, 1.2, 0.5
	rows[0].QueueDelayMs = &queue
	rows[0].ConfirmationMs = &final
	rows[0].InclusionMs = &inclusion
	rows[0].CheckTxMs = &check
	rows[1].Status = "timeout"
	rows[1].InclusionMs = &inclusion
	rows[1].ConfirmationMs = &final
	rows[2].Status = "submission_unknown"
	return rows
}

func TestReadySenderCumulativeCountsMatchCompleteHistoryAfterOutOfOrderHandoffs(t *testing.T) {
	rows := cumulativeFixture()
	collector, err := newReadyCumulativeSummary(6)
	if err != nil {
		t.Fatal(err)
	}
	for _, i := range []int{3, 1, 0, 2} {
		if err = collector.add(rows[i], true); err != nil {
			t.Fatal(err)
		}
	}
	report := collector.snapshot(2)
	if report.TerminalRecords != 4 || report.Counts.Input != 6 || report.Counts.FinalSubmitted != 1 || report.Counts.NotSubmitted != 3 {
		t.Fatal("lifetime counts replaced by last slots", report.Counts)
	}
	got, want := report.Counts, summarize(rows, 2)
	clear := func(s *summary) {
		s.QueueDelay = percentiles{}
		s.CheckTxLatency = percentiles{}
		s.InclusionLatency = percentiles{}
		s.EffectiveInclusionLatency = percentiles{}
		s.ConfirmationLatency = percentiles{}
		s.InclusionBlocks = blockStatistics{}
	}
	clear(&got)
	clear(&want)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("cumulative stage counts/rates differ\ngot %+v\nwant %+v", got, want)
	}
	final := report.LatencyIntervalsNs["final"]
	if final.Samples != 1 || !final.P95.Valid || final.P95.LowerNs > int64(5300*time.Microsecond) || final.P95.UpperNs < int64(5300*time.Microsecond) {
		t.Fatal("nonfinal row polluted final latency", final)
	}
	whole := report.LatencyIntervalsNs["offerToFinal"]
	if whole.Samples != 1 || whole.P95.LowerNs > int64(7400*time.Microsecond) || whole.P95.UpperNs < int64(7400*time.Microsecond) {
		t.Fatal("offer-to-final spans not added per record", whole)
	}
	if report.Counts.ConfirmationLatency.P95 != nil || report.Counts.SteadyStateEffectiveTPS != nil {
		t.Fatal("bounded histogram claimed exact or steady result")
	}
}

func TestReadySenderCumulativeBusinessCountsRequireCompleteEvidence(t *testing.T) {
	for _, mutate := range []func(*transactionResult){func(r *transactionResult) { r.DurableSnapshotSHA256 = "" }, func(r *transactionResult) { r.Height = 0 }, func(r *transactionResult) { r.DurableStateHeight = 1 }, func(r *transactionResult) { r.ExecutionCode = nil }, func(r *transactionResult) { one := uint32(1); r.ExecutionCode = &one }, func(r *transactionResult) { r.DurableStoreFormat = "block-journal"; r.DurableInfoVerified = false }, func(r *transactionResult) {
		r.DurableStoreFormat = "block-journal"
		r.DurableInfoVerified = true
		r.DurableInfoHeight = 1
	}} {
		r := cumulativeFixture()[0]
		mutate(&r)
		collector, err := newReadyCumulativeSummary(1)
		if err != nil {
			t.Fatal(err)
		}
		if err = collector.add(r, true); err != nil {
			t.Fatal(err)
		}
		s := collector.snapshot(1)
		if s.Counts.FinalSubmitted != 0 || s.Counts.EffectiveBusinessIncluded != 0 || s.LatencyIntervalsNs["final"].Samples != 0 {
			t.Fatal("incomplete evidence promoted to business final", s.Counts)
		}
	}
}

func TestReadySenderCumulativeInvalidLatencyPreservesCountsAndMissingMonotonicWithholdsRate(t *testing.T) {
	collector, err := newReadyCumulativeSummary(2)
	if err != nil {
		t.Fatal(err)
	}
	r := cumulativeFixture()[0]
	invalid := math.NaN()
	r.CheckTxMs = &invalid
	if collector.add(r, true) == nil || collector.records != 1 || collector.snapshot(1).Counts.Submitted != 1 || collector.snapshot(1).InvalidLatencyRecords != 1 {
		t.Fatal("invalid latency hid actual submission or failed to stop")
	}
	for _, distribution := range collector.snapshot(1).LatencyIntervalsNs {
		if distribution.Samples != 0 {
			t.Fatal("partial histogram update")
		}
	}
	collector, err = newReadyCumulativeSummary(2)
	if err != nil {
		t.Fatal(err)
	}
	for _, i := range []int{0, 1} {
		r := cumulativeFixture()[i]
		r.offerMonotonic = time.Time{}
		r.submitMonotonic = time.Time{}
		if err = collector.add(r, true); err != nil {
			t.Fatal(err)
		}
	}
	s := collector.snapshot(1)
	if s.Counts.OfferedEventSpanRate != nil || s.Counts.SubmissionEventSpanRate != nil {
		t.Fatal("UTC used as monotonic fallback")
	}
	if collector.add(r, true) == nil {
		t.Fatal("terminal count bound ignored")
	}
}

func TestReadySenderSlotCLIRequiresDurableTerminalStream(t *testing.T) {
	o := options{manifest: "manifest", transactions: "transactions", output: "new-output", concurrency: 1, observers: 4, rounds: 2, senderMode: "ready-pool", inclusionMode: "block-scan", offeredRate: 128, timeout: time.Second, poll: 100 * time.Millisecond, reuseResultSlots: true, terminalStream: true}
	if err := validateOptions(o); err != nil {
		t.Fatal(err)
	}
	o.terminalStream = false
	if validateOptions(o) == nil {
		t.Fatal("CLI slot reuse without terminal evidence")
	}
}

func TestReadySenderCumulativeWrongIdentityCannotPromoteBusinessCounts(t *testing.T) {
	collector, err := newReadyCumulativeSummary(1)
	if err != nil {
		t.Fatal(err)
	}
	if err = collector.add(cumulativeFixture()[0], false); err != nil {
		t.Fatal(err)
	}
	s := collector.snapshot(1)
	if s.Counts.FinalSubmitted != 0 || s.Counts.EffectiveBusinessIncluded != 0 || s.Counts.QuorumConfirmed != 1 {
		t.Fatal("unbound identity promoted or raw quorum hidden", s.Counts)
	}
}
