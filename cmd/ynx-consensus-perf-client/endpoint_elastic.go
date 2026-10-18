package main

import "sync"

// Reuses the original four submit goroutines. Channels collectively retain the
// original queue budget; index%4 remains the only authority selector. Taking a
// second request at a busy endpoint cannot occupy all four workers there.
type elasticEndpointQueue struct {
	mu        sync.Mutex
	ready     *sync.Cond
	queues    [4]chan int
	active    [4]uint64
	peaks     [4]uint64
	attempts  [4]uint64
	returns   [4]uint64
	total     uint64
	peakTotal uint64
	next      int
	closed    bool
}

func newElasticEndpointQueue(capacity int) *elasticEndpointQueue {
	q := &elasticEndpointQueue{}
	q.ready = sync.NewCond(&q.mu)
	for endpoint := range q.queues {
		q.queues[endpoint] = make(chan int, (capacity+3-endpoint)/4)
	}
	return q
}

func (q *elasticEndpointQueue) enqueue(index int) {
	q.mu.Lock()
	defer q.mu.Unlock()
	// The controller has at most one outstanding generation per result slot.
	// Each original endpoint therefore fits its original bounded channel.
	q.queues[index%4] <- index
	q.ready.Broadcast()
}

func (q *elasticEndpointQueue) take() (int, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	for {
		pending := false
		for offset := 0; offset < 4; offset++ {
			endpoint := (q.next + offset) % 4
			if len(q.queues[endpoint]) == 0 {
				continue
			}
			pending = true
			if q.active[endpoint] == 2 || q.total == 4 {
				continue
			}
			index := <-q.queues[endpoint]
			q.active[endpoint]++
			q.total++
			if q.total > q.peakTotal {
				q.peakTotal = q.total
			}
			if q.active[endpoint] > q.peaks[endpoint] {
				q.peaks[endpoint] = q.active[endpoint]
			}
			q.attempts[endpoint]++
			q.next = (endpoint + 1) % 4
			return index, true
		}
		if q.closed && !pending {
			return 0, false
		}
		q.ready.Wait()
	}
}

func (q *elasticEndpointQueue) complete(index int) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.active[index%4]--
	q.total--
	q.returns[index%4]++
	q.ready.Broadcast()
}

func (q *elasticEndpointQueue) close() {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.closed = true
	q.ready.Broadcast()
}

// Called only after the original submitter WaitGroup has joined.
func (q *elasticEndpointQueue) report(stats *endpointDispatchStats) {
	q.mu.Lock()
	defer q.mu.Unlock()
	stats.PerEndpointInFlightLimit = 2
	stats.CallbackAttempts, stats.CallbackReturns = q.attempts, q.returns
	peaks := q.peaks
	stats.PeakInFlight = &peaks
	stats.PeakTotalInFlight = q.peakTotal
}
