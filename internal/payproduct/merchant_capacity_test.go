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

func TestMerchantLocalReadCapacityEvidence(t *testing.T) {
	const requests, concurrency = 1000, 25
	now := time.Date(2026, 7, 29, 0, 0, 0, 0, time.UTC)
	service, _ := testService(t, &fakePay{}, func() time.Time { return now })
	server := httptest.NewServer(NewServerWithMetadata(service, slog.New(slog.NewJSONHandler(io.Discard, nil)), buildinfo.Info{Commit: "merchant-local-capacity", Release: "local-evidence"}, now).Handler())
	defer server.Close()

	client := &http.Client{Timeout: 5 * time.Second}
	jobs := make(chan int)
	latencies := make([]time.Duration, requests)
	var failures atomic.Int64
	var workers sync.WaitGroup
	started := time.Now()
	for range concurrency {
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
	for index := range requests {
		jobs <- index
	}
	close(jobs)
	workers.Wait()
	elapsed := time.Since(started)
	sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
	percentile := func(percent int) time.Duration {
		index := (percent*len(latencies) + 99) / 100
		return latencies[index-1]
	}
	throughput := float64(requests) / elapsed.Seconds()
	t.Logf("merchant local read capacity: requests=%d concurrency=%d failures=%d throughput=%.1f/s p50=%s p95=%s p99=%s", requests, concurrency, failures.Load(), throughput, percentile(50), percentile(95), percentile(99))
	if failures.Load() != 0 || percentile(99) > 250*time.Millisecond || throughput < 100 {
		t.Fatalf("merchant local capacity gate failed: failures=%d throughput=%.1f/s p99=%s", failures.Load(), throughput, percentile(99))
	}
}
