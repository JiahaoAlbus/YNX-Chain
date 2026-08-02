package finance

import (
	"net/http"
	"net/http/httptest"
	"sort"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestFinanceHTTPReadCapacity(t *testing.T) {
	const (
		requests    = 1000
		concurrency = 25
	)

	store, err := OpenStore("")
	if err != nil {
		t.Fatal(err)
	}
	upstreams, err := NewUpstreams("http://127.0.0.1:1", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	auth, _ := testAuthenticator(t, "finance-capacity-token")
	server, err := NewServer(
		&Service{
			Store:     store,
			Upstreams: upstreams,
			AI:        fakeAI{},
			Support: SupportLinks{
				HelpURL:    "https://support.example/help",
				PrivacyURL: "https://support.example/privacy",
				DisputeURL: "https://support.example/disputes",
			},
		},
		auth,
		ServerConfig{
			CursorSigningKey: testCursorKey,
			OperationsKey:    testOperationsKey,
		},
	)
	if err != nil {
		t.Fatal(err)
	}

	handler := server.Handler()
	jobs := make(chan struct{}, requests)
	latencies := make([]time.Duration, requests)
	var failures atomic.Int64
	var next atomic.Int64
	var workers sync.WaitGroup
	started := time.Now()

	for range concurrency {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for range jobs {
				index := int(next.Add(1) - 1)
				start := time.Now()
				response := httptest.NewRecorder()
				handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/health", nil))
				latencies[index] = time.Since(start)
				if response.Code != http.StatusOK {
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

	if failures.Load() != 0 {
		t.Fatalf("%d/%d capacity requests failed", failures.Load(), requests)
	}
	sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
	percentile := func(p float64) time.Duration {
		index := int(float64(len(latencies)-1) * p)
		return latencies[index]
	}
	throughput := float64(requests) / elapsed.Seconds()
	t.Logf(
		"requests=%d concurrency=%d failures=0 throughput=%.1f/s p50=%s p95=%s p99=%s",
		requests,
		concurrency,
		throughput,
		percentile(0.50),
		percentile(0.95),
		percentile(0.99),
	)
}
