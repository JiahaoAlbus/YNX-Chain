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
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/governance"
)

type denyAuth struct{}

func (denyAuth) Authenticate(*http.Request) (governance.Principal, error) {
	return governance.Principal{}, errors.New("public-read probe has no authenticated mutations")
}

type report struct {
	SchemaVersion        string           `json:"schemaVersion"`
	SourceCommit         string           `json:"sourceCommit"`
	MeasuredAt           time.Time        `json:"measuredAt"`
	Environment          map[string]any   `json:"environment"`
	State                string           `json:"state"`
	Requests             int              `json:"requests"`
	Concurrency          int              `json:"concurrency"`
	Errors               uint64           `json:"errors"`
	DurationMilliseconds int64            `json:"durationMilliseconds"`
	ThroughputPerSecond  float64          `json:"throughputPerSecond"`
	LatencyMicroseconds  map[string]int64 `json:"latencyMicroseconds"`
	Endpoints            []string         `json:"endpoints"`
	ClaimBoundary        string           `json:"claimBoundary"`
}

func main() {
	requests := flag.Int("requests", 10000, "total bounded public-read requests")
	concurrency := flag.Int("concurrency", 16, "parallel workers")
	flag.Parse()
	commit := strings.TrimSpace(os.Getenv("YNX_SOURCE_COMMIT"))
	if len(commit) != 40 || *requests < 100 || *requests > 100000 || *concurrency < 1 || *concurrency > 128 {
		fmt.Fprintln(os.Stderr, "YNX_SOURCE_COMMIT must be a 40-hex commit and request/concurrency bounds must be respected")
		os.Exit(2)
	}
	policy := governance.Policy{MinimumDeposit: 100, QuorumBPS: 5000, ThresholdBPS: 6667, VotingPeriod: time.Hour, Timelock: 2 * time.Hour, MaxLifetime: 30 * 24 * time.Hour, EmergencyThreshold: 3, EmergencyMaxDuration: 24 * time.Hour, ParameterRules: map[string]governance.ParameterRule{"/bridge/dailyLimit": {Scope: governance.ScopeBridge, Numeric: true, Minimum: 10, Maximum: 100}}, GenesisRoleManifestHash: strings.Repeat("f", 64), ElectorateApprovalThreshold: 2}
	service, err := governance.NewService(policy)
	if err != nil {
		panic(err)
	}
	server, err := governance.NewServer(service, denyAuth{}, os.TempDir()+"/ynx-governance-capacity-unused.json", time.Now)
	if err != nil {
		panic(err)
	}
	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()
	client := &http.Client{Timeout: 5 * time.Second}
	paths := []string{"/health", "/governance/proposals", "/governance/roles", "/governance/appeals", "/governance/emergencies"}
	jobs := make(chan int)
	latencies := make([]int64, *requests)
	var failures atomic.Uint64
	started := time.Now()
	var workers sync.WaitGroup
	for worker := 0; worker < *concurrency; worker++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for index := range jobs {
				at := time.Now()
				response, requestErr := client.Get(httpServer.URL + paths[index%len(paths)])
				if requestErr != nil {
					failures.Add(1)
				} else {
					_, readErr := io.Copy(io.Discard, io.LimitReader(response.Body, 1<<20))
					response.Body.Close()
					if readErr != nil || response.StatusCode != http.StatusOK {
						failures.Add(1)
					}
				}
				latencies[index] = time.Since(at).Microseconds()
			}
		}()
	}
	for index := 0; index < *requests; index++ {
		jobs <- index
	}
	close(jobs)
	workers.Wait()
	elapsed := time.Since(started)
	sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
	percentile := func(value float64) int64 { index := int(float64(len(latencies)-1) * value); return latencies[index] }
	result := report{SchemaVersion: "ynx-governance-local-capacity/v1", SourceCommit: commit, MeasuredAt: time.Now().UTC(), Environment: map[string]any{"goVersion": runtime.Version(), "goos": runtime.GOOS, "goarch": runtime.GOARCH, "gomaxprocs": runtime.GOMAXPROCS(0)}, State: "empty authoritative local state", Requests: *requests, Concurrency: *concurrency, Errors: failures.Load(), DurationMilliseconds: elapsed.Milliseconds(), ThroughputPerSecond: float64(*requests) / elapsed.Seconds(), LatencyMicroseconds: map[string]int64{"p50": percentile(.50), "p95": percentile(.95), "p99": percentile(.99), "max": latencies[len(latencies)-1]}, Endpoints: paths, ClaimBoundary: "local httptest public-read probe only; no staging, public network, mutation, BFT, or production-scale claim"}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err = encoder.Encode(result); err != nil {
		panic(err)
	}
	if failures.Load() != 0 {
		os.Exit(1)
	}
}
