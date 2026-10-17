package main

import (
	"context"
	"sync"
	"sync/atomic"
	"time"
)

type pacedStatistics struct {
	PeakAwaitingSubmission  int64 `json:"peakOfferedAwaitingSubmission"`
	PeakAwaitingObservation int64 `json:"peakAcceptedAwaitingObservationCompletion"`
}

func atomicMaximum(target *atomic.Int64, value int64) {
	for previous := target.Load(); value > previous; previous = target.Load() {
		if target.CompareAndSwap(previous, value) {
			return
		}
	}
}

func waitUntil(ctx context.Context, target time.Time) bool {
	if ctx.Err() != nil {
		return false
	}
	remaining := time.Until(target)
	if remaining <= 0 {
		return ctx.Err() == nil
	}
	timer := time.NewTimer(remaining)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return ctx.Err() == nil
	}
}

// Submission and observation have separate bounded worker pools. All queues
// are bounded by maxTransactions input transactions. An unknown submission outcome
// never enters observation as an accepted transaction and is never retried.
func runPacedTransactions(ctx context.Context, o options, started time.Time, results []transactionResult, submit func(int) (time.Time, bool), observe func(int, time.Time)) pacedStatistics {
	type job struct {
		index   int
		offered time.Time
	}
	type acceptedJob struct {
		index   int
		started time.Time
	}
	jobs := make(chan job, len(results))
	accepted := make(chan acceptedJob, len(results))
	var pendingSubmit, peakSubmit, pendingObserve, peakObserve atomic.Int64
	var submitters, observers sync.WaitGroup
	for worker := 0; worker < o.observers; worker++ {
		observers.Add(1)
		go func() {
			defer observers.Done()
			for job := range accepted {
				observe(job.index, job.started)
				pendingObserve.Add(-1)
			}
		}()
	}
	for worker := 0; worker < o.concurrency; worker++ {
		submitters.Add(1)
		go func() {
			defer submitters.Done()
			for job := range jobs {
				pendingSubmit.Add(-1)
				start, ok := submit(job.index)
				if !start.IsZero() {
					delay := start.Sub(job.offered).Seconds() * 1000
					results[job.index].QueueDelayMs = &delay
				}
				if ok {
					atomicMaximum(&peakObserve, pendingObserve.Add(1))
					accepted <- acceptedJob{job.index, start}
				}
			}
		}()
	}
	for index := range results {
		scheduled := started.Add(time.Duration(float64(index) * float64(time.Second) / o.offeredRate))
		if !waitUntil(ctx, scheduled) {
			break
		}
		offered := time.Now()
		results[index].offerMonotonic = offered
		at, due := offered.UTC(), scheduled.UTC()
		results[index].OfferedAt, results[index].ScheduledAt = &at, &due
		atomicMaximum(&peakSubmit, pendingSubmit.Add(1))
		jobs <- job{index, offered}
	}
	close(jobs)
	submitters.Wait()
	close(accepted)
	observers.Wait()
	return pacedStatistics{peakSubmit.Load(), peakObserve.Load()}
}

func eventSpanRate(events []time.Time) (float64, *float64) {
	if len(events) < 2 {
		return 0, nil
	}
	first, last := events[0], events[0]
	for _, event := range events[1:] {
		if event.Before(first) {
			first = event
		}
		if event.After(last) {
			last = event
		}
	}
	seconds := last.Sub(first).Seconds()
	if seconds <= 0 {
		return 0, nil
	}
	rate := float64(len(events)-1) / seconds
	return seconds, &rate
}
