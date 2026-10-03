package payproduct

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sort"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

func TestLocalReadCapacityEvidence(t *testing.T) {
	const (
		requests    = 1000
		concurrency = 25
	)

	now := time.Date(2026, 7, 29, 0, 0, 0, 0, time.UTC)
	pay := &fakePay{now: func() time.Time { return now }}
	service, _ := testService(t, pay, func() time.Time { return now })
	server := httptest.NewServer(NewServerWithLogger(
		service,
		buildinfo.Info{Commit: "local-capacity", Release: "local-evidence"},
		slog.New(slog.NewJSONHandler(io.Discard, nil)),
	).ObservedHandler())
	defer server.Close()

	client := &http.Client{Timeout: 5 * time.Second}
	jobs := make(chan int)
	latencies := make([]time.Duration, requests)
	var failures atomic.Int64
	var workers sync.WaitGroup
	started := time.Now()

	for worker := 0; worker < concurrency; worker++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for index := range jobs {
				path := "/health"
				if index%2 == 1 {
					path = "/version"
				}
				start := time.Now()
				response, err := client.Get(server.URL + path)
				latencies[index] = time.Since(start)
				if err != nil {
					failures.Add(1)
					continue
				}
				_, readErr := io.Copy(io.Discard, response.Body)
				closeErr := response.Body.Close()
				if response.StatusCode != http.StatusOK || readErr != nil || closeErr != nil {
					failures.Add(1)
				}
			}
		}()
	}
	for index := 0; index < requests; index++ {
		jobs <- index
	}
	close(jobs)
	workers.Wait()
	elapsed := time.Since(started)

	sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
	percentile := func(percent int) time.Duration {
		index := (percent*len(latencies) + 99) / 100
		if index < 1 {
			index = 1
		}
		return latencies[index-1]
	}
	throughput := float64(requests) / elapsed.Seconds()
	t.Logf(
		"local loopback read capacity: requests=%d concurrency=%d failures=%d throughput=%.1f req/s p50=%s p95=%s p99=%s elapsed=%s",
		requests,
		concurrency,
		failures.Load(),
		throughput,
		percentile(50),
		percentile(95),
		percentile(99),
		elapsed,
	)
	if failures.Load() != 0 {
		t.Fatalf("local capacity run had %d failures", failures.Load())
	}
}
