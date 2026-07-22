package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"runtime"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabricpostgres"
	_ "github.com/lib/pq"
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
	DatabaseVersion  string         `json:"databaseVersion"`
	GOOS             string         `json:"goos"`
	GOARCH           string         `json:"goarch"`
	GoVersion        string         `json:"goVersion"`
	CPUCount         int            `json:"cpuCount"`
	Events           int            `json:"events"`
	Concurrency      int            `json:"concurrency"`
	AppendLatency    latencySummary `json:"appendLatency"`
	AppendThroughput float64        `json:"appendThroughputPerSecond"`
	OutboxDrain      latencySummary `json:"outboxLeaseAckLatency"`
	OutboxThroughput float64        `json:"outboxLeaseAckThroughputPerSecond"`
	AuditDuration    float64        `json:"integrityAuditDurationMilliseconds"`
	DatabaseBytes    int64          `json:"databaseBytes"`
	Errors           uint64         `json:"errors"`
	Limitations      []string       `json:"limitations"`
}

func main() {
	eventCount := flag.Int("events", 1000, "event count")
	concurrency := flag.Int("concurrency", 8, "concurrent append workers")
	sourceCommit := flag.String("source-commit", "", "source commit")
	sourceRelease := flag.String("source-release", "data-fabric-postgres-capacity", "source release")
	dirty := flag.Bool("dirty-working-tree", true, "whether the measured tree has uncommitted changes")
	flag.Parse()
	if *eventCount < 100 || *eventCount > 100000 || *concurrency < 1 || *concurrency > 128 || *sourceCommit == "" {
		fatal("events (100..100000), concurrency (1..128), and source commit are required")
	}
	dsn := os.Getenv("YNX_TEST_POSTGRES_DSN")
	if dsn == "" || os.Getenv("YNX_TEST_POSTGRES_ALLOW_DESTRUCTIVE") != "1" {
		fatal("isolated PostgreSQL DSN and YNX_TEST_POSTGRES_ALLOW_DESTRUCTIVE=1 are required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		fatal(err.Error())
	}
	defer db.Close()
	db.SetMaxOpenConns(*concurrency + 4)
	var database, databaseVersion string
	if err := db.QueryRowContext(ctx, `SELECT current_database(),version()`).Scan(&database, &databaseVersion); err != nil {
		fatal(err.Error())
	}
	if database != "ynx_data_fabric_test" {
		fatal("refusing capacity test outside ynx_data_fabric_test")
	}
	var fabricSchema, analyticsSchema sql.NullString
	if err := db.QueryRowContext(ctx, `SELECT to_regnamespace('ynx_fabric')::text,to_regnamespace('ynx_analytics')::text`).Scan(&fabricSchema, &analyticsSchema); err != nil {
		fatal(err.Error())
	}
	if fabricSchema.Valid || analyticsSchema.Valid {
		fatal("capacity test requires an empty isolated database")
	}
	if _, err := datafabricpostgres.Migrate(ctx, db); err != nil {
		fatal(err.Error())
	}
	store, err := datafabricpostgres.NewStore(db)
	if err != nil {
		fatal(err.Error())
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		fatal(err.Error())
	}
	keyID := "key.capacity.postgres.0001"
	baseTime := time.Now().UTC()
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
				event := capacityEvent(index, baseTime, *sourceCommit, *sourceRelease, keyID, key)
				operationStart := time.Now()
				err := store.Append(ctx, event, key)
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
	if failures.Load() != 0 {
		fatal(fmt.Sprintf("append failures: %d", failures.Load()))
	}

	drainStarted := time.Now()
	var drainLatencies []time.Duration
	for {
		operationStart := time.Now()
		claimed, err := store.ClaimOutbox(ctx, "capacity-worker", baseTime.Add(time.Minute), time.Minute, 1000)
		if err != nil {
			fatal(err.Error())
		}
		if len(claimed) == 0 {
			break
		}
		for _, record := range claimed {
			if err := store.MarkPublished(ctx, record.EventID, "capacity-worker", baseTime.Add(2*time.Minute)); err != nil {
				fatal(err.Error())
			}
		}
		drainLatencies = append(drainLatencies, time.Since(operationStart))
	}
	drainDuration := time.Since(drainStarted)
	auditStarted := time.Now()
	if err := store.AuditIntegrity(ctx, map[string][]byte{keyID: key}); err != nil {
		fatal(err.Error())
	}
	auditDuration := time.Since(auditStarted)
	stats, err := store.Stats(ctx)
	if err != nil || stats.Events != uint64(*eventCount) || stats.OutboxPending != 0 {
		fatal(fmt.Sprintf("unexpected post-capacity stats: %+v %v", stats, err))
	}
	var databaseBytes int64
	if err := db.QueryRowContext(ctx, `SELECT pg_database_size(current_database())`).Scan(&databaseBytes); err != nil {
		fatal(err.Error())
	}
	result := report{MeasuredAt: time.Now().UTC(), SourceCommit: *sourceCommit, SourceRelease: *sourceRelease, DirtyWorkingTree: *dirty, DatabaseVersion: databaseVersion, GOOS: runtime.GOOS, GOARCH: runtime.GOARCH, GoVersion: runtime.Version(), CPUCount: runtime.NumCPU(), Events: *eventCount, Concurrency: *concurrency, AppendLatency: summarize(latencies), AppendThroughput: float64(*eventCount) / appendDuration.Seconds(), OutboxDrain: summarize(drainLatencies), OutboxThroughput: float64(*eventCount) / drainDuration.Seconds(), AuditDuration: milliseconds(auditDuration), DatabaseBytes: databaseBytes, Errors: failures.Load(), Limitations: []string{"single local PostgreSQL process", "one event per aggregate without hot-partition skew", "lease and acknowledgement only; no network broker publication", "no journal, Saga, reconciliation, replica, failover, disk-full, or long-duration load", "dirty working tree and small sample; not a public-scale claim"}}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(result); err != nil {
		fatal(err.Error())
	}
}

func capacityEvent(index int, base time.Time, sourceCommit, sourceRelease, keyID string, key []byte) datafabric.EventEnvelope {
	suffix := fmt.Sprintf("%012d", index+1)
	now := base.Add(time.Duration(index) * time.Microsecond)
	event := datafabric.EventEnvelope{EventID: "event.capacity.postgres." + suffix, EventType: "capacity.event.recorded", SchemaVersion: datafabric.EnvelopeSchemaVersion, Product: "capacity", Service: "load", AggregateID: "aggregate.capacity." + suffix, Actor: datafabric.Actor{ActorID: "actor.capacity.0001", AccountID: "account.capacity.0001", SessionID: "session.capacity.0001"}, CorrelationID: "correlation.capacity." + suffix, CausationID: "command.capacity." + suffix, Sequence: 1, Timestamp: now, EffectiveAt: now, SourceCommit: sourceCommit, SourceRelease: sourceRelease, PrivacyClassification: "internal", RetentionClass: "transient", AuditID: "audit.capacity." + suffix, Source: datafabric.SourceMetadata{Source: "ynx-postgres-capacity-tool", AsOf: now, Version: "v1", Status: "authoritative"}, Payload: json.RawMessage(`{"status":"accepted"}`)}
	if err := event.Sign(keyID, key); err != nil {
		fatal(err.Error())
	}
	return event
}

func summarize(values []time.Duration) latencySummary {
	if len(values) == 0 {
		return latencySummary{}
	}
	sort.Slice(values, func(i, j int) bool { return values[i] < values[j] })
	return latencySummary{P50Milliseconds: milliseconds(values[percentileIndex(len(values), 0.50)]), P95Milliseconds: milliseconds(values[percentileIndex(len(values), 0.95)]), P99Milliseconds: milliseconds(values[percentileIndex(len(values), 0.99)]), MaxMilliseconds: milliseconds(values[len(values)-1])}
}

func percentileIndex(length int, percentile float64) int {
	if length == 0 {
		return 0
	}
	index := int(float64(length-1) * percentile)
	if index >= length {
		return length - 1
	}
	return index
}

func milliseconds(duration time.Duration) float64 { return float64(duration.Microseconds()) / 1000 }

func fatal(message string) {
	if message == "" {
		message = errors.New("capacity measurement failed").Error()
	}
	_, _ = fmt.Fprintln(os.Stderr, message)
	os.Exit(1)
}
