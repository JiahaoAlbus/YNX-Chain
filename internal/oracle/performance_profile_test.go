package oracle

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"sort"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type performanceSummary struct {
	Route       string  `json:"route"`
	Requests    int     `json:"requests"`
	Concurrency int     `json:"concurrency"`
	P50Millis   float64 `json:"p50Millis"`
	P95Millis   float64 `json:"p95Millis"`
	P99Millis   float64 `json:"p99Millis"`
	Throughput  float64 `json:"requestsPerSecond"`
	ErrorRate   float64 `json:"errorRate"`
}

func TestLocalPerformanceProfile(t *testing.T) {
	if os.Getenv("YNX_ORACLE_PROFILE") != "1" {
		t.Skip("set YNX_ORACLE_PROFILE=1 for bounded local profiling")
	}
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	reporters := []testReporter{reporter(t, "source-a", 1_000_000, now), reporter(t, "source-b", 1_000_000, now), reporter(t, "source-c", 1_000_000, now)}
	service := testService(t, &now, reporters...)
	for index, item := range reporters {
		if _, err := service.Ingest(item.observation(t, 1, 1_000_000+int64(index*100), now.Add(-time.Second))); err != nil {
			t.Fatal(err)
		}
	}
	server, err := NewServer(service, slog.New(slog.NewJSONHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	profiles := []performanceSummary{
		profileRoute(t, server, "/health", 2000, 1),
		profileRoute(t, server, "/version", 2000, 1),
		profileRoute(t, server, "/prices?market=YNXT/YUSD_TEST&type=spot_price", 500, 1),
		profileRoute(t, server, "/prices?market=YNXT/YUSD_TEST&type=spot_price", 1000, 8),
	}
	encoded, err := json.Marshal(profiles)
	if err != nil {
		t.Fatal(err)
	}
	t.Log(string(encoded))
}

func profileRoute(t *testing.T, handler http.Handler, route string, requests, concurrency int) performanceSummary {
	t.Helper()
	latencies := make([]time.Duration, requests)
	jobs := make(chan int)
	var failures atomic.Int64
	var wait sync.WaitGroup
	started := time.Now()
	for worker := 0; worker < concurrency; worker++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			for index := range jobs {
				request := httptest.NewRequest(http.MethodGet, route, nil)
				response := httptest.NewRecorder()
				before := time.Now()
				handler.ServeHTTP(response, request)
				latencies[index] = time.Since(before)
				if response.Code < 200 || response.Code >= 300 {
					failures.Add(1)
				}
			}
		}()
	}
	for index := 0; index < requests; index++ {
		jobs <- index
	}
	close(jobs)
	wait.Wait()
	elapsed := time.Since(started)
	sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
	percentile := func(value float64) float64 {
		index := int(float64(len(latencies)-1) * value)
		return float64(latencies[index].Microseconds()) / 1000
	}
	if elapsed <= 0 {
		t.Fatal(fmt.Errorf("invalid profile duration: %s", elapsed))
	}
	return performanceSummary{Route: route, Requests: requests, Concurrency: concurrency, P50Millis: percentile(.50), P95Millis: percentile(.95), P99Millis: percentile(.99), Throughput: float64(requests) / elapsed.Seconds(), ErrorRate: float64(failures.Load()) / float64(requests)}
}
