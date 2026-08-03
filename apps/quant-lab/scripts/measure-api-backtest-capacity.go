package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/quantlab"
)

type latencySummary struct {
	Count     int       `json:"count"`
	P50MS     float64   `json:"p50Ms"`
	P95MS     float64   `json:"p95Ms"`
	P99MS     float64   `json:"p99Ms"`
	MaxMS     float64   `json:"maxMs"`
	SamplesMS []float64 `json:"samplesMs"`
}

type apiPathEvidence struct {
	Method             string         `json:"method"`
	Path               string         `json:"path"`
	Requests           int            `json:"requests"`
	Concurrency        int            `json:"concurrency"`
	Errors             int            `json:"errors"`
	WallMilliseconds   float64        `json:"wallMilliseconds"`
	ThroughputRequests float64        `json:"throughputRequestsPerSecond"`
	Latency            latencySummary `json:"latency"`
}

type backtestEvidence struct {
	Runs                 int            `json:"runs"`
	BarsPerRun           int            `json:"barsPerRun"`
	Errors               int            `json:"errors"`
	WallMilliseconds     float64        `json:"wallMilliseconds"`
	ThroughputRunsSecond float64        `json:"throughputRunsPerSecond"`
	Latency              latencySummary `json:"latency"`
	InitialStateBytes    int64          `json:"initialStateBytes"`
	FinalStateBytes      int64          `json:"finalStateBytes"`
	StateGrowthBytes     int64          `json:"stateGrowthBytes"`
	CompletedExperiments int            `json:"completedExperiments"`
}

type machineEvidence struct {
	GOOS     string `json:"goos"`
	GOARCH   string `json:"goarch"`
	Go       string `json:"goVersion"`
	CPUCount int    `json:"cpuCount"`
}

type localCapacityEvidence struct {
	SchemaVersion    int                        `json:"schemaVersion"`
	Source           string                     `json:"source"`
	SourceCommit     string                     `json:"sourceCommit"`
	GeneratedAt      time.Time                  `json:"generatedAt"`
	Machine          machineEvidence            `json:"machine"`
	API              map[string]apiPathEvidence `json:"api"`
	Backtest         backtestEvidence           `json:"backtest"`
	PercentileMethod string                     `json:"percentileMethod"`
	TruthBoundary    string                     `json:"truthBoundary"`
}

var commitPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)

func main() {
	apiRequests := flag.Int("api-requests", 500, "requests per local API path")
	apiConcurrency := flag.Int("api-concurrency", 20, "concurrent local API clients")
	backtests := flag.Int("backtests", 40, "deterministic local backtest runs")
	bars := flag.Int("bars", 512, "bars per deterministic backtest")
	sourceCommit := flag.String("source-commit", "", "full 40-character source commit")
	output := flag.String("output", "", "optional JSON evidence output path")
	flag.Parse()

	if !commitPattern.MatchString(*sourceCommit) {
		fatalf("source-commit must be a full lowercase 40-character git SHA")
	}
	if *apiRequests < 1 || *apiRequests > 100000 || *apiConcurrency < 1 || *apiConcurrency > 1000 {
		fatalf("invalid API workload requests=%d concurrency=%d", *apiRequests, *apiConcurrency)
	}
	if *backtests < 1 || *backtests > 1000 || *bars < 20 || *bars > 100000 {
		fatalf("invalid backtest workload runs=%d bars=%d", *backtests, *bars)
	}

	root, err := os.MkdirTemp("", "ynx-quant-api-backtest-capacity-")
	if err != nil {
		fatalf("create capacity directory: %v", err)
	}
	defer os.RemoveAll(root)

	apiState := filepath.Join(root, "api-state.json")
	apiService, err := quantlab.New(quantlab.Config{StatePath: apiState})
	if err != nil {
		fatalf("create API service: %v", err)
	}
	server := httptest.NewServer(quantlab.NewObservedRoleServer(apiService, "all", io.Discard))
	defer server.Close()

	api := map[string]apiPathEvidence{}
	api["health"] = measureAPI(server.Client(), server.URL, "/health", *apiRequests, *apiConcurrency)
	api["snapshot"] = measureAPI(server.Client(), server.URL, "/v1/snapshot", *apiRequests, *apiConcurrency)

	backtestState := filepath.Join(root, "backtest-state.json")
	backtestService, err := quantlab.New(quantlab.Config{StatePath: backtestState})
	if err != nil {
		fatalf("create backtest service: %v", err)
	}
	backtest := measureBacktests(backtestService, backtestState, deterministicRequest(*bars, *sourceCommit), *backtests)

	for name, pathEvidence := range api {
		if pathEvidence.Errors != 0 || pathEvidence.Latency.Count != *apiRequests {
			fatalf("API capacity workload %s incomplete: count=%d errors=%d", name, pathEvidence.Latency.Count, pathEvidence.Errors)
		}
	}
	if backtest.Errors != 0 || backtest.CompletedExperiments != *backtests {
		fatalf("backtest capacity workload incomplete: completed=%d errors=%d", backtest.CompletedExperiments, backtest.Errors)
	}

	evidence := localCapacityEvidence{
		SchemaVersion: 1,
		Source:        "ynx-quant-local-api-and-backtest-capacity",
		SourceCommit:  *sourceCommit,
		GeneratedAt:   time.Now().UTC(),
		Machine: machineEvidence{
			GOOS: runtime.GOOS, GOARCH: runtime.GOARCH, Go: runtime.Version(), CPUCount: runtime.NumCPU(),
		},
		API:              api,
		Backtest:         backtest,
		PercentileMethod: "nearest-rank over retained raw wall-clock samples",
		TruthBoundary:    "Single-host loopback HTTP and deterministic synthetic-bar backtests only; not public edge, provider, multi-region, sustained mixed-write, or live-funds capacity evidence.",
	}

	encoded, err := json.MarshalIndent(evidence, "", "  ")
	if err != nil {
		fatalf("marshal capacity evidence: %v", err)
	}
	encoded = append(encoded, '\n')
	if *output != "" {
		if err := writeAtomic(*output, encoded); err != nil {
			fatalf("write capacity evidence: %v", err)
		}
	}
	fmt.Print(string(encoded))
}

func measureAPI(client *http.Client, baseURL, path string, requests, concurrency int) apiPathEvidence {
	client.Timeout = 5 * time.Second
	samples := make([]float64, requests)
	jobs := make(chan int)
	var wg sync.WaitGroup
	var errorsMu sync.Mutex
	errorsCount := 0
	wallStart := time.Now()

	for worker := 0; worker < concurrency; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for index := range jobs {
				started := time.Now()
				response, err := client.Get(baseURL + path)
				completed := time.Now()
				samples[index] = milliseconds(completed.Sub(started))
				failed := err != nil
				if err == nil {
					_, copyErr := io.Copy(io.Discard, response.Body)
					closeErr := response.Body.Close()
					failed = response.StatusCode != http.StatusOK || copyErr != nil || closeErr != nil
				}
				if failed {
					errorsMu.Lock()
					errorsCount++
					errorsMu.Unlock()
				}
			}
		}()
	}
	for index := 0; index < requests; index++ {
		jobs <- index
	}
	close(jobs)
	wg.Wait()
	wall := time.Since(wallStart)
	throughput := 0.0
	if wall > 0 {
		throughput = float64(requests-errorsCount) / wall.Seconds()
	}
	return apiPathEvidence{
		Method: "GET", Path: path, Requests: requests, Concurrency: concurrency,
		Errors: errorsCount, WallMilliseconds: milliseconds(wall),
		ThroughputRequests: throughput, Latency: summarize(samples),
	}
}

func measureBacktests(service *quantlab.Service, statePath string, request quantlab.BacktestRequest, runs int) backtestEvidence {
	initial := fileSize(statePath)
	samples := make([]float64, 0, runs)
	errorsCount := 0
	completed := 0
	wallStart := time.Now()
	for index := 0; index < runs; index++ {
		started := time.Now()
		result, err := service.RunBacktest(request)
		completedAt := time.Now()
		samples = append(samples, milliseconds(completedAt.Sub(started)))
		if err != nil || result.Status != "completed_oos" {
			errorsCount++
			continue
		}
		completed++
	}
	wall := time.Since(wallStart)
	throughput := 0.0
	if wall > 0 {
		throughput = float64(completed) / wall.Seconds()
	}
	final := fileSize(statePath)
	return backtestEvidence{
		Runs: runs, BarsPerRun: len(request.Bars), Errors: errorsCount,
		WallMilliseconds: milliseconds(wall), ThroughputRunsSecond: throughput,
		Latency: summarize(samples), InitialStateBytes: initial, FinalStateBytes: final,
		StateGrowthBytes: final - initial, CompletedExperiments: completed,
	}
}

func deterministicRequest(barCount int, sourceCommit string) quantlab.BacktestRequest {
	bars := make([]quantlab.Bar, barCount)
	start := time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC)
	for index := range bars {
		closeValue := int64(100_000 + index*3 + (index%37)*11)
		bars[index] = quantlab.Bar{
			Time: start.Add(time.Duration(index) * time.Minute), Open: closeValue - 5,
			High: closeValue + 50, Low: closeValue - 50, Close: closeValue,
			Volume: 5_000_000 + int64(index%17)*10_000,
		}
	}
	return quantlab.BacktestRequest{
		Strategy: quantlab.StrategySpec{
			ID: "api-backtest-capacity-ma", Name: "API and backtest capacity moving average",
			Family: "transparent", Source: "quant://capacity/built-in-ma", SourceCommit: sourceCommit,
			License: "Apache-2.0", Params: map[string]int64{"fast": 3, "slow": 8},
			Limitations: "Synthetic deterministic bars for local capacity measurement only",
		},
		Bars: bars,
		Assumptions: quantlab.Assumptions{
			FeeBPS: 10, SlippageBPS: 5, LatencyBars: 1, ParticipationBPS: 1000,
			Seed: 7, TrainEnd: barCount / 2, WalkForwardWindows: 4,
		},
	}
}

func summarize(samples []float64) latencySummary {
	copySamples := append([]float64(nil), samples...)
	sorted := append([]float64(nil), samples...)
	sort.Float64s(sorted)
	return latencySummary{
		Count: len(copySamples), P50MS: percentile(sorted, 0.50), P95MS: percentile(sorted, 0.95),
		P99MS: percentile(sorted, 0.99), MaxMS: percentile(sorted, 1.00), SamplesMS: copySamples,
	}
}

func percentile(sorted []float64, fraction float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	index := int(float64(len(sorted))*fraction+0.999999999999) - 1
	if index < 0 {
		index = 0
	}
	if index >= len(sorted) {
		index = len(sorted) - 1
	}
	return sorted[index]
}

func milliseconds(duration time.Duration) float64 {
	return float64(duration.Nanoseconds()) / 1_000_000
}

func fileSize(path string) int64 {
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return 0
		}
		fatalf("stat %s: %v", filepath.Base(path), err)
	}
	return info.Size()
}

func writeAtomic(path string, content []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".capacity-*.json")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o644); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(content); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, path)
}

func fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
