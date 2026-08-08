package mail

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sort"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

func TestMailCapacityIsBoundedAndObservable(t *testing.T) {
	capacity := newMailCapacity(HandlerOptions{MaxInFlight: 1, MaxQueued: 1})
	entered := make(chan struct{}, 2)
	release := make(chan struct{})
	handler := capacity.wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		entered <- struct{}{}
		<-release
		w.WriteHeader(http.StatusNoContent)
	}))

	firstDone := make(chan struct{})
	go func() {
		handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/v1/drafts", nil))
		close(firstDone)
	}()
	<-entered

	secondDone := make(chan struct{})
	go func() {
		handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/v1/drafts", nil))
		close(secondDone)
	}()
	for capacity.queued.Load() != 1 {
		time.Sleep(time.Millisecond)
	}

	overflow := httptest.NewRecorder()
	handler.ServeHTTP(overflow, httptest.NewRequest(http.MethodPost, "/v1/drafts", nil))
	if overflow.Code != http.StatusTooManyRequests || overflow.Header().Get("Retry-After") != "1" {
		t.Fatalf("unbounded or opaque overload response: status=%d headers=%v body=%s", overflow.Code, overflow.Header(), overflow.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(overflow.Body.Bytes(), &payload); err != nil || payload["error"] != "mail_capacity_exhausted" {
		t.Fatalf("invalid overload payload: err=%v payload=%v", err, payload)
	}
	close(release)
	<-firstDone
	<-secondDone
}

func TestMailHealthReportsConfiguredCapacity(t *testing.T) {
	service, _ := newTestService(t, "")
	handler := NewHandlerWithOptions(service, buildinfo.Info{}, HandlerOptions{MaxInFlight: 7, MaxQueued: 11})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/health", nil))
	var payload struct {
		Capacity map[string]any `json:"capacity"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Capacity["maxInFlight"] != float64(7) || payload.Capacity["maxQueued"] != float64(11) {
		t.Fatalf("capacity is not truthful: %v", payload.Capacity)
	}
}

func TestMailHTTPReadCapacity(t *testing.T) {
	const (
		requests    = 1000
		concurrency = 25
	)
	service, _ := newTestService(t, "")
	handler := NewHandler(service)
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
				handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/health", nil))
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
		return latencies[int(float64(len(latencies)-1)*p)]
	}
	t.Logf(
		"requests=%d concurrency=%d failures=0 throughput=%.1f/s p50=%s p95=%s p99=%s",
		requests,
		concurrency,
		float64(requests)/elapsed.Seconds(),
		percentile(0.50),
		percentile(0.95),
		percentile(0.99),
	)
}
