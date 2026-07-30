package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"runtime"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
)

type latencySummary struct {
	P50Milliseconds float64 `json:"p50Milliseconds"`
	P95Milliseconds float64 `json:"p95Milliseconds"`
	P99Milliseconds float64 `json:"p99Milliseconds"`
	MaxMilliseconds float64 `json:"maxMilliseconds"`
}

type report struct {
	MeasuredAt       time.Time      `json:"measuredAt"`
	SourceCommit     string         `json:"sourceCommit"`
	SourceRelease    string         `json:"sourceRelease"`
	DirtyWorkingTree bool           `json:"dirtyWorkingTree"`
	GOOS             string         `json:"goos"`
	GOARCH           string         `json:"goarch"`
	GoVersion        string         `json:"goVersion"`
	CPUCount         int            `json:"cpuCount"`
	Events           int            `json:"events"`
	Concurrency      int            `json:"concurrency"`
	AppendLatency    latencySummary `json:"appendLatency"`
	AppendThroughput float64        `json:"appendThroughputPerSecond"`
	DispatchDuration float64        `json:"dispatchDurationMilliseconds"`
	ReplayDuration   float64        `json:"replayDurationMilliseconds"`
	ColdOpenDuration float64        `json:"coldOpenDurationMilliseconds"`
	AuditDuration    float64        `json:"integrityAuditDurationMilliseconds"`
	StateBytes       int64          `json:"stateBytes"`
	EventLogBytes    int64          `json:"eventLogBytes"`
	Errors           uint64         `json:"errors"`
	Limitations      []string       `json:"limitations"`
}

func main() {
	eventCount := flag.Int("events", 200, "event count")
	concurrency := flag.Int("concurrency", 4, "concurrent append workers")
	sourceCommit := flag.String("source-commit", "", "source commit")
	sourceRelease := flag.String("source-release", "data-fabric-local-capacity", "source release")
	dirty := flag.Bool("dirty-working-tree", true, "whether the measured tree has uncommitted changes")
	flag.Parse()
	if *eventCount < 1 || *eventCount > 10000 || *concurrency < 1 || *concurrency > 128 || *sourceCommit == "" {
		fatal("events, concurrency, and source commit are required and bounded")
	}
	root, err := os.MkdirTemp("", "ynx-data-fabric-capacity-")
	if err != nil {
		fatal(err.Error())
	}
	defer os.RemoveAll(root)
	store, err := datafabric.OpenStore(root + "/state.json")
	if err != nil {
		fatal(err.Error())
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		fatal(err.Error())
	}
	keyID := "key.capacity.local.0001"

	jobs := make(chan int)
	latencies := make([]time.Duration, 0, *eventCount)
	var latencyMu sync.Mutex
	var failures atomic.Uint64
	started := time.Now()
	var workers sync.WaitGroup
	for worker := 0; worker < *concurrency; worker++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for index := range jobs {
				event := capacityEvent(index, *sourceCommit, *sourceRelease, keyID, key)
				operationStart := time.Now()
				err := store.Append(event, key)
				latency := time.Since(operationStart)
				latencyMu.Lock()
				latencies = append(latencies, latency)
				latencyMu.Unlock()
				if err != nil {
					failures.Add(1)
				}
			}
		}()
	}
	for index := 0; index < *eventCount; index++ {
		jobs <- index
	}
	close(jobs)
	workers.Wait()
	appendDuration := time.Since(started)

	dispatchStart := time.Now()
	dispatcher := datafabric.Dispatcher{Store: store, Publisher: &datafabric.EventLogPublisher{Path: root + "/events.jsonl"}, BatchSize: *eventCount, MaxAttempts: 3}
	dispatchReport, err := dispatcher.DispatchOnce(context.Background())
	if err != nil {
		fatal(err.Error())
	}
	if int(dispatchReport.Published) != *eventCount {
		failures.Add(uint64(*eventCount) - dispatchReport.Published)
	}
	dispatchDuration := time.Since(dispatchStart)

	replayStart := time.Now()
	replayReport, err := store.ReplayProjection("capacity.consumer.v1", 0, 0, func(event datafabric.EventEnvelope, state map[string]string) (string, error) {
		state[event.AggregateID] = event.EventID
		return event.Integrity.Digest, nil
	})
	if err != nil {
		fatal(err.Error())
	}
	if int(replayReport.Applied) != *eventCount {
		failures.Add(uint64(*eventCount) - replayReport.Applied)
	}
	replayDuration := time.Since(replayStart)

	openStart := time.Now()
	reopened, err := datafabric.OpenStore(root + "/state.json")
	if err != nil {
		fatal(err.Error())
	}
	coldOpenDuration := time.Since(openStart)
	auditStart := time.Now()
	if err := reopened.AuditIntegrity(map[string][]byte{keyID: key}); err != nil {
		fatal(err.Error())
	}
	auditDuration := time.Since(auditStart)
	stateInfo, _ := os.Stat(root + "/state.json")
	logInfo, _ := os.Stat(root + "/events.jsonl")

	result := report{MeasuredAt: time.Now().UTC(), SourceCommit: *sourceCommit, SourceRelease: *sourceRelease, DirtyWorkingTree: *dirty, GOOS: runtime.GOOS, GOARCH: runtime.GOARCH, GoVersion: runtime.Version(), CPUCount: runtime.NumCPU(), Events: *eventCount, Concurrency: *concurrency, AppendLatency: summarize(latencies), AppendThroughput: float64(*eventCount) / appendDuration.Seconds(), DispatchDuration: milliseconds(dispatchDuration), ReplayDuration: milliseconds(replayDuration), ColdOpenDuration: milliseconds(coldOpenDuration), AuditDuration: milliseconds(auditDuration), StateBytes: stateInfo.Size(), EventLogBytes: logInfo.Size(), Errors: failures.Load(), Limitations: []string{"single local process", "atomic JSON state-file rewrite", "append/fsync local event log", "no network broker or database", "sample is not a public-scale claim"}}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(result); err != nil {
		fatal(err.Error())
	}
}

func capacityEvent(index int, sourceCommit, sourceRelease, keyID string, key []byte) datafabric.EventEnvelope {
	now := time.Date(2026, 7, 22, 21, 0, 0, index, time.UTC)
	suffix := fmt.Sprintf("%012d", index+1)
	event := datafabric.EventEnvelope{EventID: "event.capacity.recorded." + suffix, EventType: "capacity.event.recorded", SchemaVersion: datafabric.EnvelopeSchemaVersion, Product: "capacity", Service: "load", AggregateID: "aggregate.capacity." + suffix, Actor: datafabric.Actor{ActorID: "actor.capacity.0001", AccountID: "account.capacity.0001", SessionID: "session.capacity.0001"}, CorrelationID: "correlation.capacity." + suffix, CausationID: "command.capacity." + suffix, Sequence: 1, Timestamp: now, EffectiveAt: now, SourceCommit: sourceCommit, SourceRelease: sourceRelease, PrivacyClassification: "internal", RetentionClass: "transient", AuditID: "audit.capacity." + suffix, Source: datafabric.SourceMetadata{Source: "ynx-capacity-tool", AsOf: now, Version: "v1", Status: "authoritative"}, Payload: json.RawMessage(`{"status":"accepted"}`)}
	if err := event.Sign(keyID, key); err != nil {
		fatal(err.Error())
	}
	return event
}

func summarize(values []time.Duration) latencySummary {
	sort.Slice(values, func(i, j int) bool { return values[i] < values[j] })
	return latencySummary{P50Milliseconds: milliseconds(values[percentileIndex(len(values), 0.50)]), P95Milliseconds: milliseconds(values[percentileIndex(len(values), 0.95)]), P99Milliseconds: milliseconds(values[percentileIndex(len(values), 0.99)]), MaxMilliseconds: milliseconds(values[len(values)-1])}
}

func percentileIndex(length int, percentile float64) int {
	index := int(float64(length-1) * percentile)
	if index < 0 {
		return 0
	}
	if index >= length {
		return length - 1
	}
	return index
}

func milliseconds(duration time.Duration) float64 { return float64(duration.Microseconds()) / 1000 }

func fatal(message string) { _, _ = fmt.Fprintln(os.Stderr, message); os.Exit(1) }
