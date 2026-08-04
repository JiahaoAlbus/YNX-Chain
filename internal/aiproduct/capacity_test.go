package aiproduct

import (
	"io"
	"net/http"
	"sort"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestLocalHealthCapacityEvidence(t *testing.T) {
	gateway := newGatewayFixture(t, true)
	defer gateway.Close()
	_, product := testProduct(t, gateway.URL)
	defer product.Close()

	const requests = 1000
	const concurrency = 25
	jobs := make(chan struct{}, requests)
	latencies := make([]time.Duration, requests)
	var failures atomic.Int64
	var next atomic.Int64
	started := time.Now()
	var workers sync.WaitGroup
	for range concurrency {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for range jobs {
				index := int(next.Add(1) - 1)
				start := time.Now()
				response, err := http.Get(product.URL + "/healthz")
				latencies[index] = time.Since(start)
				if err != nil {
					failures.Add(1)
					continue
				}
				_, readErr := io.Copy(io.Discard, response.Body)
				_ = response.Body.Close()
				if readErr != nil || response.StatusCode != http.StatusOK {
					failures.Add(1)
				}
			}
		}()
	}
	for range requests {
		jobs <- struct{}{}
	}
	close(jobs)
	workers.Wait()
	elapsed := time.Since(started)
	sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
	p50, p95, p99 := latencies[requests/2], latencies[requests*95/100], latencies[requests*99/100]
	throughput := float64(requests) / elapsed.Seconds()
	t.Logf("local AI product health capacity: requests=%d concurrency=%d failures=%d throughput=%.1f/s p50=%s p95=%s p99=%s", requests, concurrency, failures.Load(), throughput, p50, p95, p99)
	if failures.Load() != 0 || p99 > 250*time.Millisecond || throughput < 100 {
		t.Fatalf("local capacity gate failed: failures=%d throughput=%.1f/s p99=%s", failures.Load(), throughput, p99)
	}
}
