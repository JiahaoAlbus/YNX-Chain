package main

import (
	"context"
	"math"
	"sync/atomic"
	"testing"
	"time"
)

func TestPacedSubmissionProceedsWhileConfirmationIsBlocked(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	results := make([]transactionResult, 3)
	submitted := make(chan int, 3)
	confirmGate := make(chan struct{})
	finished := make(chan pacedStatistics, 1)
	go func() {
		finished <- runPacedTransactions(ctx, options{concurrency: 1, observers: 1, offeredRate: 256}, time.Now(), results,
			func(i int) (time.Time, bool) { start := time.Now(); submitted <- i; return start, true },
			func(_ int, _ time.Time) {
				select {
				case <-confirmGate:
				case <-ctx.Done():
				}
			})
	}()
	// A closed submit-and-confirm loop would deadlock after the first callback.
	for i := 0; i < 3; i++ {
		select {
		case index := <-submitted:
			if index != i {
				t.Fatalf("submission order=%d want=%d", index, i)
			}
		case <-ctx.Done():
			t.Fatal("confirmation blocked remaining submissions")
		}
	}
	close(confirmGate)
	select {
	case stats := <-finished:
		if stats.PeakAwaitingObservation < 2 {
			t.Fatalf("accepted backlog was not recorded: %+v", stats)
		}
	case <-ctx.Done():
		t.Fatal("paced workers did not drain")
	}
	for i, result := range results {
		if result.OfferedAt == nil || result.ScheduledAt == nil || result.QueueDelayMs == nil {
			t.Fatalf("missing offer/queue metadata at %d", i)
		}
	}
}

func TestPacedDeadlineDoesNotSubmitUnOfferedWork(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var submissions atomic.Int64
	stats := runPacedTransactions(ctx, options{concurrency: 1, observers: 1, offeredRate: 32}, time.Now(), make([]transactionResult, 4),
		func(int) (time.Time, bool) { submissions.Add(1); return time.Now(), false },
		func(int, time.Time) { t.Error("unexpected observation") })
	if submissions.Load() != 0 || stats.PeakAwaitingSubmission != 0 {
		t.Fatal("cancelled scheduler submitted work")
	}
}

func TestPacedUnknownSubmissionIsNotObservedOrRetried(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	var submits, observes atomic.Int64
	results := make([]transactionResult, 3)
	runPacedTransactions(ctx, options{concurrency: 1, observers: 1, offeredRate: 256}, time.Now(), results,
		func(i int) (time.Time, bool) { submits.Add(1); return time.Now(), i != 1 },
		func(i int, _ time.Time) {
			if i == 1 {
				t.Error("unknown result was observed as accepted")
			}
			observes.Add(1)
		})
	if submits.Load() != 3 || observes.Load() != 2 {
		t.Fatalf("unexpected retries/observations: submitted=%d observed=%d", submits.Load(), observes.Load())
	}
}

func TestInterarrivalRateAndUnverifiedAcceptanceStaySeparate(t *testing.T) {
	at := time.Unix(100, 0)
	events := []time.Time{at.Add(2 * time.Second), at, at.Add(time.Second)}
	seconds, rate := eventSpanRate(events)
	if seconds != 2 || rate == nil || *rate != 1 {
		t.Fatalf("wrong interarrival estimate: %v %v", seconds, rate)
	}
	if _, rate := eventSpanRate(events[:1]); rate != nil {
		t.Fatal("one event invented a rate")
	}
	zero := uint32(0)
	s := summarize([]transactionResult{{SubmittedAt: &at, CheckTxCode: &zero, Status: "submission_unknown"}}, 2)
	if s.CheckTxResponses != 1 || s.CheckTxUnverified != 1 || s.CheckTxAccepted != 0 || s.FinalSubmitted != 0 || s.SubmissionUnknown != 1 || s.SteadyStateEffectiveTPS != nil {
		t.Fatalf("unverified response inflated success: %+v", s)
	}
	for _, bad := range []float64{-1, 257, math.NaN(), math.Inf(1)} {
		o := options{manifest: "m", transactions: "t", concurrency: 1, observers: 1, offeredRate: bad, timeout: time.Second, poll: 100 * time.Millisecond}
		if validateOptions(o) == nil {
			t.Fatalf("invalid offered rate accepted: %v", bad)
		}
	}
}
