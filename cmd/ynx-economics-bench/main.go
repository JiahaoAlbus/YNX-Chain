package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"runtime"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/explorer"
)

var commitPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)

type latencySummary struct {
	MinimumMicros int64 `json:"minimumMicros"`
	P50Micros     int64 `json:"p50Micros"`
	P95Micros     int64 `json:"p95Micros"`
	P99Micros     int64 `json:"p99Micros"`
	MaximumMicros int64 `json:"maximumMicros"`
}

type benchmarkResult struct {
	SchemaVersion             int            `json:"schemaVersion"`
	Source                    string         `json:"source"`
	AsOf                      time.Time      `json:"asOf"`
	Version                   int            `json:"version"`
	Coverage                  string         `json:"coverage"`
	SourceCommit              string         `json:"sourceCommit"`
	Environment               map[string]any `json:"environment"`
	Endpoint                  string         `json:"endpoint"`
	FirstRequestLatencyMicros int64          `json:"firstRequestLatencyMicros"`
	WarmupRequests            int            `json:"warmupRequests"`
	MeasuredRequests          int            `json:"measuredRequests"`
	ConcurrentWorkers         int            `json:"concurrentWorkers"`
	WallTimeMillis            int64          `json:"wallTimeMillis"`
	ThroughputRequestsPerSec  float64        `json:"throughputRequestsPerSecond"`
	Latency                   latencySummary `json:"latency"`
	Errors                    uint64         `json:"errors"`
	ErrorRateBPS              int64          `json:"errorRateBps"`
	ResponseBytes             int            `json:"responseBytes"`
	TotalAllocatedBytes       uint64         `json:"totalAllocatedBytes"`
	AllocatedBytesPerRequest  uint64         `json:"allocatedBytesPerRequest"`
	QueueMeasurement          map[string]any `json:"queueMeasurement"`
	StorageGrowth             map[string]any `json:"storageGrowth"`
	ProviderLatency           map[string]any `json:"providerLatency"`
	RateLimit                 map[string]any `json:"rateLimit"`
	Failure                   bool           `json:"failure"`
}

func main() {
	sourceCommit := flag.String("source-commit", "", "exact 40-character source commit")
	requests := flag.Int("requests", 2_000, "measured disclosure requests")
	workers := flag.Int("concurrency", 16, "concurrent request workers")
	flag.Parse()
	if !commitPattern.MatchString(*sourceCommit) || *requests < 100 || *requests > 1_000_000 || *workers < 1 || *workers > 1_024 || *workers > *requests {
		fmt.Fprintln(os.Stderr, "valid -source-commit, -requests, and -concurrency are required")
		os.Exit(2)
	}
	result, err := run(*sourceCommit, *requests, *workers)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(result); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(sourceCommit string, requests, workers int) (benchmarkResult, error) {
	server := httptest.NewServer(explorer.NewServerWithBuild(nil, buildinfo.Info{Commit: sourceCommit, Release: "economics-local-benchmark", BuildTime: time.Now().UTC().Format(time.RFC3339)}).Handler())
	defer server.Close()
	client := &http.Client{Timeout: 2 * time.Second}
	endpoint := server.URL + "/api/economics/disclosure"
	firstStarted := time.Now()
	responseBytes, err := request(client, endpoint, "bench-first-request")
	firstLatency := time.Since(firstStarted)
	if err != nil {
		return benchmarkResult{}, err
	}
	const warmup = 50
	for i := 0; i < warmup; i++ {
		if _, err := request(client, endpoint, fmt.Sprintf("bench-warmup-%04d", i)); err != nil {
			return benchmarkResult{}, err
		}
	}
	runtime.GC()
	var before runtime.MemStats
	runtime.ReadMemStats(&before)
	jobs := make(chan int)
	latencies := make(chan int64, requests)
	var failures atomic.Uint64
	var wg sync.WaitGroup
	started := time.Now()
	for worker := 0; worker < workers; worker++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			for index := range jobs {
				requestStarted := time.Now()
				bytes, requestErr := request(client, endpoint, fmt.Sprintf("bench-%04d-%08d", workerID, index))
				latencies <- time.Since(requestStarted).Microseconds()
				if requestErr != nil || bytes != responseBytes {
					failures.Add(1)
				}
			}
		}(worker)
	}
	for i := 0; i < requests; i++ {
		jobs <- i
	}
	close(jobs)
	wg.Wait()
	close(latencies)
	elapsed := time.Since(started)
	var after runtime.MemStats
	runtime.ReadMemStats(&after)
	samples := make([]int64, 0, requests)
	for latency := range latencies {
		samples = append(samples, latency)
	}
	if len(samples) != requests {
		return benchmarkResult{}, errors.New("benchmark sample count mismatch")
	}
	sort.Slice(samples, func(i, j int) bool { return samples[i] < samples[j] })
	allocated := after.TotalAlloc - before.TotalAlloc
	failureCount := failures.Load()
	return benchmarkResult{SchemaVersion: 1, Source: "local-loopback-economics-disclosure-benchmark", AsOf: time.Now().UTC(), Version: 1, Coverage: "single-process-loopback-not-public-capacity", SourceCommit: sourceCommit, Environment: map[string]any{"goVersion": runtime.Version(), "goos": runtime.GOOS, "goarch": runtime.GOARCH, "logicalCPU": runtime.NumCPU()}, Endpoint: "/api/economics/disclosure", FirstRequestLatencyMicros: firstLatency.Microseconds(), WarmupRequests: warmup, MeasuredRequests: requests, ConcurrentWorkers: workers, WallTimeMillis: elapsed.Milliseconds(), ThroughputRequestsPerSec: float64(requests) / elapsed.Seconds(), Latency: latencySummary{MinimumMicros: samples[0], P50Micros: percentile(samples, 50), P95Micros: percentile(samples, 95), P99Micros: percentile(samples, 99), MaximumMicros: samples[len(samples)-1]}, Errors: failureCount, ErrorRateBPS: int64(failureCount) * 10_000 / int64(requests), ResponseBytes: responseBytes, TotalAllocatedBytes: allocated, AllocatedBytesPerRequest: allocated / uint64(requests), QueueMeasurement: map[string]any{"available": false, "reason": "read-only handler has no application queue"}, StorageGrowth: map[string]any{"bytes": 0, "reason": "read-only endpoint does not persist request state"}, ProviderLatency: map[string]any{"available": false, "reason": "reference model has no third-party provider call"}, RateLimit: map[string]any{"configured": false, "boundary": "public ingress rate limiting not deployed"}, Failure: failureCount > 0}, nil
}

func request(client *http.Client, endpoint, requestID string) (int, error) {
	req, _ := http.NewRequest(http.MethodGet, endpoint, nil)
	req.Header.Set("X-Request-ID", requestID)
	response, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		return 0, err
	}
	if response.StatusCode != http.StatusOK || response.Header.Get("X-Request-ID") != requestID {
		return len(body), fmt.Errorf("unexpected status or request ID")
	}
	return len(body), nil
}

func percentile(sorted []int64, percent int) int64 {
	return sorted[(len(sorted)-1)*percent/100]
}
