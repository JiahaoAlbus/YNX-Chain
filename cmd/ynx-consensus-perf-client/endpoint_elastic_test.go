package main

import (
	"sync"
	"testing"
	"time"
)

func TestEndpointElasticCloseDrainsBoundedPendingRequestsExactlyOnce(t *testing.T) {
	q := newElasticEndpointQueue(16)
	capacity := 0
	for _, queue := range q.queues {
		capacity += cap(queue)
	}
	if capacity != 16 {
		t.Fatal("queue budget changed", capacity)
	}
	for i := 0; i < 16; i++ {
		q.enqueue(i)
	}
	started := make(chan int, 4)
	release := make(chan struct{})
	var releaseOnce sync.Once
	releaseAll := func() { releaseOnce.Do(func() { close(release) }) }
	defer releaseAll()
	var seenMu sync.Mutex
	var seen [16]int
	var workers sync.WaitGroup
	for worker := 0; worker < 4; worker++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			first := true
			for {
				index, ok := q.take()
				if !ok {
					return
				}
				if first {
					started <- index
					<-release
					first = false
				}
				seenMu.Lock()
				seen[index]++
				seenMu.Unlock()
				q.complete(index)
			}
		}()
	}
	for i := 0; i < 4; i++ {
		select {
		case <-started:
		case <-time.After(time.Second):
			t.Fatal("original four workers did not start")
		}
	}
	q.close() // Closing while callbacks and queued requests remain must drain.
	releaseAll()
	done := make(chan struct{})
	go func() { workers.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("closed queue failed to drain")
	}
	for i, count := range seen {
		if count != 1 {
			t.Fatal("lost/repeated queued callback", i, count)
		}
	}
	stats := &endpointDispatchStats{}
	q.report(stats)
	if stats.PeakTotalInFlight != 4 || q.total != 0 || q.active != [4]uint64{} {
		t.Fatal("active callbacks did not close", stats, q.active)
	}
	for endpoint := 0; endpoint < 4; endpoint++ {
		if stats.CallbackAttempts[endpoint] != 4 || stats.CallbackReturns[endpoint] != 4 || stats.PeakInFlight[endpoint] > 2 {
			t.Fatal("endpoint callback accounting/limit changed", stats)
		}
	}
}
