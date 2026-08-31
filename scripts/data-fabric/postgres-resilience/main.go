package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabricpostgres"
	_ "github.com/lib/pq"
)

const isolatedDatabase = "ynx_data_fabric_test"

type latencySummary struct {
	P50Milliseconds float64 `json:"p50Milliseconds"`
	P95Milliseconds float64 `json:"p95Milliseconds"`
	P99Milliseconds float64 `json:"p99Milliseconds"`
	MaxMilliseconds float64 `json:"maxMilliseconds"`
}

type commonReport struct {
	Phase            string    `json:"phase"`
	MeasuredAt       time.Time `json:"measuredAt"`
	SourceCommit     string    `json:"sourceCommit"`
	SourceRelease    string    `json:"sourceRelease"`
	DirtyWorkingTree bool      `json:"dirtyWorkingTree"`
	DatabaseVersion  string    `json:"databaseVersion"`
	DatabaseTopology string    `json:"databaseTopology"`
	GOOS             string    `json:"goos"`
	GOARCH           string    `json:"goarch"`
	GoVersion        string    `json:"goVersion"`
	CPUCount         int       `json:"cpuCount"`
	Events           int       `json:"events"`
	HotEvents        int       `json:"hotEvents"`
	ColdEvents       int       `json:"coldEvents"`
	HotEventShare    float64   `json:"hotEventShare"`
}

type seedReport struct {
	commonReport
	ConcurrentStart               bool           `json:"concurrentStart"`
	ColdWorkers                   int            `json:"coldWorkers"`
	AppendLatency                 latencySummary `json:"appendLatency"`
	AppendThroughput              float64        `json:"appendThroughputPerSecond"`
	DuplicateStormAttempts        int            `json:"duplicateStormAttempts"`
	DuplicateStormConcurrentStart bool           `json:"duplicateStormConcurrentStart"`
	DuplicateStormLatency         latencySummary `json:"duplicateStormLatency"`
	DuplicateStormThroughput      float64        `json:"duplicateStormThroughputPerSecond"`
	DuplicateRejects              uint64         `json:"duplicateRejects"`
	UnexpectedErrors              uint64         `json:"unexpectedErrors"`
	OutboxQueueDepth              uint64         `json:"transactionalOutboxQueueDepth"`
	DatabaseBytes                 int64          `json:"databaseBytes"`
	StorageBytesPerEvent          float64        `json:"storageBytesPerEvent"`
	Limitations                   []string       `json:"limitations"`
}

type verifyReport struct {
	commonReport
	DatabaseRestarted       bool           `json:"databaseRestarted"`
	RecoveryKind            string         `json:"recoveryKind"`
	WritablePrimary         bool           `json:"writablePrimary"`
	ConnectionAttempts      int            `json:"connectionAttempts"`
	AcceptingConnectionsRTO milliseconds   `json:"acceptingConnectionsRTOMilliseconds"`
	IntegrityValidatedRTO   milliseconds   `json:"integrityValidatedRTOMilliseconds"`
	RecoveryPointObjective  uint64         `json:"recoveryPointObjectiveLostEvents"`
	IntegrityAuditDuration  milliseconds   `json:"integrityAuditDurationMilliseconds"`
	ReplayScanned           uint64         `json:"longReplayScanned"`
	ReplayApplied           uint64         `json:"longReplayApplied"`
	ReplaySkipped           uint64         `json:"longReplaySkipped"`
	ReplayLatency           latencySummary `json:"longReplayEventLatency"`
	ReplayThroughput        float64        `json:"longReplayThroughputPerSecond"`
	IdempotentReplay        uint64         `json:"idempotentReplaySkipped"`
	IdempotentLatency       latencySummary `json:"idempotentReplayEventLatency"`
	IdempotentThroughput    float64        `json:"idempotentReplayThroughputPerSecond"`
	InboxEffects            uint64         `json:"inboxEffects"`
	AnalyticsFacts          uint64         `json:"analyticsFacts"`
	OutboxQueueDepth        uint64         `json:"transactionalOutboxQueueDepth"`
	DatabaseBytes           int64          `json:"databaseBytes"`
	StorageBytesPerEvent    float64        `json:"storageBytesPerEvent"`
	Limitations             []string       `json:"limitations"`
}

type milliseconds float64

func main() {
	phase := flag.String("phase", "", "seed or verify")
	eventCount := flag.Int("events", 10000, "total canonical events")
	hotShare := flag.Int("hot-share-percent", 90, "percentage assigned to one ordered aggregate")
	coldWorkers := flag.Int("cold-workers", 16, "parallel workers for distinct cold aggregates")
	duplicateAttempts := flag.Int("duplicate-attempts", 1000, "simultaneously released duplicate writes")
	sourceCommit := flag.String("source-commit", "", "exact engineering source commit")
	sourceRelease := flag.String("source-release", "", "exact engineering source release")
	dirty := flag.Bool("dirty-working-tree", true, "whether tracked engineering files were dirty during measurement")
	restartStartedUnixNano := flag.Int64("restart-started-unix-nano", 0, "wall-clock instant immediately before database restart")
	topology := flag.String("topology", "single-primary", "single-primary or streaming-primary-standby")
	recoveryKind := flag.String("recovery-kind", "restart", "restart or standby-promotion")
	flag.Parse()
	if (*phase != "seed" && *phase != "verify") || (*topology != "single-primary" && *topology != "streaming-primary-standby") || (*recoveryKind != "restart" && *recoveryKind != "standby-promotion") || *eventCount < 1000 || *eventCount > 100000 || *hotShare < 50 || *hotShare > 99 || *coldWorkers < 1 || *coldWorkers > 128 || *duplicateAttempts < 100 || *duplicateAttempts > 10000 || !isCommit(*sourceCommit) || strings.TrimSpace(*sourceRelease) == "" {
		fatal("phase, events (1000..100000), hot-share-percent (50..99), cold-workers (1..128), duplicate-attempts (100..10000), exact source commit, and source release are required")
	}
	if *recoveryKind == "standby-promotion" && *topology != "streaming-primary-standby" {
		fatal("standby-promotion recovery requires streaming-primary-standby topology")
	}
	if *phase == "seed" && *restartStartedUnixNano != 0 {
		fatal("seed does not accept restart-started-unix-nano")
	}
	if *phase == "verify" && *restartStartedUnixNano <= 0 {
		fatal("verify requires restart-started-unix-nano")
	}

	dsn := os.Getenv("YNX_TEST_POSTGRES_DSN")
	if dsn == "" || os.Getenv("YNX_TEST_POSTGRES_ALLOW_DESTRUCTIVE") != "1" {
		fatal("isolated PostgreSQL DSN and YNX_TEST_POSTGRES_ALLOW_DESTRUCTIVE=1 are required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		fatal(err.Error())
	}
	defer db.Close()
	db.SetMaxOpenConns(*coldWorkers + 8)
	db.SetMaxIdleConns(*coldWorkers + 8)
	database, databaseVersion, connectionAttempts, err := databaseIdentity(ctx, db, *phase == "verify")
	if err != nil {
		fatal(err.Error())
	}
	connectionReady := time.Now().UTC()
	if database != isolatedDatabase {
		fatal(fmt.Sprintf("refusing resilience probe against database %q", database))
	}

	hotEvents := *eventCount * *hotShare / 100
	coldEvents := *eventCount - hotEvents
	common := commonReport{
		Phase: *phase, MeasuredAt: time.Now().UTC(), SourceCommit: *sourceCommit, SourceRelease: *sourceRelease,
		DirtyWorkingTree: *dirty, DatabaseVersion: databaseVersion, GOOS: runtime.GOOS, GOARCH: runtime.GOARCH,
		GoVersion: runtime.Version(), CPUCount: runtime.NumCPU(), DatabaseTopology: *topology, Events: *eventCount, HotEvents: hotEvents,
		ColdEvents: coldEvents, HotEventShare: float64(hotEvents) / float64(*eventCount),
	}
	key := deterministicKey("event", *sourceCommit)
	privacyKey := deterministicKey("privacy", *sourceCommit)
	store, err := datafabricpostgres.NewStore(db)
	if err != nil {
		fatal(err.Error())
	}
	if *phase == "seed" {
		runSeed(ctx, db, store, common, key, hotEvents, coldEvents, *coldWorkers, *duplicateAttempts)
		return
	}
	runVerify(ctx, db, store, common, key, privacyKey, *recoveryKind, time.Unix(0, *restartStartedUnixNano).UTC(), connectionReady, connectionAttempts)
}

func runSeed(ctx context.Context, db *sql.DB, store *datafabricpostgres.Store, common commonReport, key []byte, hotEvents, coldEvents, coldWorkers, duplicateAttempts int) {
	var fabricSchema, analyticsSchema sql.NullString
	if err := db.QueryRowContext(ctx, `SELECT to_regnamespace('ynx_fabric')::text,to_regnamespace('ynx_analytics')::text`).Scan(&fabricSchema, &analyticsSchema); err != nil {
		fatal(err.Error())
	}
	if fabricSchema.Valid || analyticsSchema.Valid {
		fatal("seed requires an empty isolated database")
	}
	if _, err := datafabricpostgres.Migrate(ctx, db); err != nil {
		fatal(err.Error())
	}

	base := time.Now().UTC()
	keyID := "key.postgres.resilience.0001"
	latencies := make([]time.Duration, 0, common.Events)
	var latencyMu sync.Mutex
	var unexpected atomic.Uint64
	startBarrier := make(chan struct{})
	started := time.Now()
	var workers sync.WaitGroup
	workers.Add(1)
	go func() {
		defer workers.Done()
		<-startBarrier
		for sequence := 1; sequence <= hotEvents; sequence++ {
			event := resilienceEvent("hot", sequence, base.Add(time.Duration(sequence)*time.Microsecond), common.SourceCommit, common.SourceRelease, keyID, key)
			operationStarted := time.Now()
			err := store.Append(ctx, event, key)
			recordDuration(&latencyMu, &latencies, time.Since(operationStarted))
			if err != nil {
				unexpected.Add(1)
				return
			}
		}
	}()
	coldJobs := make(chan int)
	for worker := 0; worker < coldWorkers; worker++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			<-startBarrier
			for index := range coldJobs {
				event := resilienceEvent(fmt.Sprintf("cold-%08d", index+1), 1, base.Add(time.Duration(hotEvents+index+1)*time.Microsecond), common.SourceCommit, common.SourceRelease, keyID, key)
				operationStarted := time.Now()
				err := store.Append(ctx, event, key)
				recordDuration(&latencyMu, &latencies, time.Since(operationStarted))
				if err != nil {
					unexpected.Add(1)
				}
			}
		}()
	}
	close(startBarrier)
	for index := 0; index < coldEvents; index++ {
		coldJobs <- index
	}
	close(coldJobs)
	workers.Wait()
	appendDuration := time.Since(started)
	if unexpected.Load() != 0 || len(latencies) != common.Events {
		fatal(fmt.Sprintf("hotspot append failed: unexpected=%d recorded=%d", unexpected.Load(), len(latencies)))
	}

	duplicateEvent := resilienceEvent("hot", 1, base.Add(time.Microsecond), common.SourceCommit, common.SourceRelease, keyID, key)
	duplicateLatencies := make([]time.Duration, duplicateAttempts)
	var duplicateRejects atomic.Uint64
	duplicateBarrier := make(chan struct{})
	workers = sync.WaitGroup{}
	workers.Add(duplicateAttempts)
	stormStarted := time.Now()
	for index := 0; index < duplicateAttempts; index++ {
		go func(index int) {
			defer workers.Done()
			<-duplicateBarrier
			operationStarted := time.Now()
			err := store.Append(ctx, duplicateEvent, key)
			duplicateLatencies[index] = time.Since(operationStarted)
			if errors.Is(err, datafabric.ErrDuplicate) {
				duplicateRejects.Add(1)
				return
			}
			unexpected.Add(1)
		}(index)
	}
	close(duplicateBarrier)
	workers.Wait()
	stormDuration := time.Since(stormStarted)
	if duplicateRejects.Load() != uint64(duplicateAttempts) || unexpected.Load() != 0 {
		fatal(fmt.Sprintf("duplicate storm failed closed: duplicates=%d unexpected=%d", duplicateRejects.Load(), unexpected.Load()))
	}
	stats, err := store.Stats(ctx)
	if err != nil || stats.Events != uint64(common.Events) || stats.OutboxPending != uint64(common.Events) {
		fatal(fmt.Sprintf("unexpected seeded PostgreSQL state: %+v err=%v", stats, err))
	}
	databaseBytes := databaseSize(ctx, db)
	limitations := []string{"90 percent ordered single-aggregate skew is a bounded hotspot workload, not a production traffic model", "duplicate writers share one local runner network", "Outbox is intentionally undrained before recovery", "deterministic test-only HMAC keys; no public-scale claim"}
	if common.DatabaseTopology == "single-primary" {
		limitations = append([]string{"one isolated PostgreSQL primary without replicas"}, limitations...)
	} else {
		limitations = append([]string{"one primary and one asynchronous streaming standby on one CI Docker host; not automatic failover or regional disaster recovery"}, limitations...)
	}
	emit(seedReport{
		commonReport: common, ConcurrentStart: true, ColdWorkers: coldWorkers, AppendLatency: summarize(latencies),
		AppendThroughput: float64(common.Events) / appendDuration.Seconds(), DuplicateStormAttempts: duplicateAttempts,
		DuplicateStormConcurrentStart: true, DuplicateStormLatency: summarize(duplicateLatencies),
		DuplicateStormThroughput: float64(duplicateAttempts) / stormDuration.Seconds(), DuplicateRejects: duplicateRejects.Load(),
		UnexpectedErrors: unexpected.Load(), OutboxQueueDepth: stats.OutboxPending, DatabaseBytes: databaseBytes,
		StorageBytesPerEvent: float64(databaseBytes) / float64(common.Events),
		Limitations:          limitations,
	})
}

func runVerify(ctx context.Context, db *sql.DB, store *datafabricpostgres.Store, common commonReport, key, privacyKey []byte, recoveryKind string, restartStarted, connectionReady time.Time, connectionAttempts int) {
	if !connectionReady.After(restartStarted) {
		fatal("database connection was established before the recorded restart")
	}
	var inRecovery, transactionReadOnly bool
	if err := db.QueryRowContext(ctx, `SELECT pg_is_in_recovery(), current_setting('transaction_read_only')::boolean`).Scan(&inRecovery, &transactionReadOnly); err != nil {
		fatal(fmt.Sprintf("read post-recovery database role: %v", err))
	}
	if inRecovery || transactionReadOnly {
		fatal("post-recovery database is not a writable primary")
	}
	stats, err := store.Stats(ctx)
	if err != nil {
		fatal(err.Error())
	}
	lostEvents := uint64(0)
	if stats.Events < uint64(common.Events) {
		lostEvents = uint64(common.Events) - stats.Events
	}
	if stats.Events != uint64(common.Events) || stats.OutboxPending != uint64(common.Events) {
		fatal(fmt.Sprintf("restart recovery lost or changed authoritative state: %+v", stats))
	}
	auditStarted := time.Now()
	if err := store.AuditIntegrity(ctx, map[string][]byte{"key.postgres.resilience.0001": key}); err != nil {
		fatal(fmt.Sprintf("post-restart integrity audit failed: %v", err))
	}
	auditDuration := time.Since(auditStarted)
	integrityReady := time.Now().UTC()
	events, err := store.Events(ctx)
	if err != nil || len(events) != common.Events {
		fatal(fmt.Sprintf("post-restart canonical event scan failed: events=%d err=%v", len(events), err))
	}
	derivedAt := time.Now().UTC().Add(time.Minute)
	replayLatencies := make([]time.Duration, len(events))
	replayStarted := time.Now()
	var applied uint64
	for index, event := range events {
		operationStarted := time.Now()
		result, applyErr := store.ApplyAnalyticsEvent(ctx, event.EventID, privacyKey, derivedAt)
		replayLatencies[index] = time.Since(operationStarted)
		if applyErr != nil || !result.Applied || result.Suppressed {
			fatal(fmt.Sprintf("long replay failed at %d/%s: result=%+v err=%v", index, event.EventID, result, applyErr))
		}
		applied++
	}
	replayDuration := time.Since(replayStarted)
	idempotentLatencies := make([]time.Duration, len(events))
	idempotentStarted := time.Now()
	var skipped uint64
	for index, event := range events {
		operationStarted := time.Now()
		result, applyErr := store.ApplyAnalyticsEvent(ctx, event.EventID, privacyKey, derivedAt)
		idempotentLatencies[index] = time.Since(operationStarted)
		if applyErr != nil || result.Applied || result.Suppressed {
			fatal(fmt.Sprintf("idempotent replay failed at %d/%s: result=%+v err=%v", index, event.EventID, result, applyErr))
		}
		skipped++
	}
	idempotentDuration := time.Since(idempotentStarted)
	stats, err = store.Stats(ctx)
	if err != nil || stats.InboxEffects != uint64(common.Events) || stats.AnalyticsFacts != uint64(common.Events) || stats.OutboxPending != uint64(common.Events) {
		fatal(fmt.Sprintf("replay state is not exact: %+v err=%v", stats, err))
	}
	databaseBytes := databaseSize(ctx, db)
	limitations := []string{"RTO starts immediately before the recovery action and ends at connection/integrity readiness on one CI runner", "RPO counts canonical events only and is zero for this bounded run", "Analytics replay is sequential and local to PostgreSQL", "Outbox is not published to JetStream in this drill; no availability or public-scale claim"}
	if recoveryKind == "standby-promotion" {
		limitations = append([]string{"manual promotion of one asynchronous streaming standby on the same Docker host; no automatic endpoint failover, fencing, synchronous quorum, cross-zone loss or regional disaster recovery claim"}, limitations...)
	} else {
		limitations = append([]string{"single PostgreSQL service-container restart, not failover or regional disaster recovery"}, limitations...)
	}
	emit(verifyReport{
		commonReport: common, DatabaseRestarted: recoveryKind == "restart", RecoveryKind: recoveryKind, WritablePrimary: true, ConnectionAttempts: connectionAttempts,
		AcceptingConnectionsRTO: millisecondsSince(restartStarted, connectionReady), IntegrityValidatedRTO: millisecondsSince(restartStarted, integrityReady),
		RecoveryPointObjective: lostEvents, IntegrityAuditDuration: milliseconds(durationMilliseconds(auditDuration)),
		ReplayScanned: uint64(len(events)), ReplayApplied: applied, ReplaySkipped: 0, ReplayLatency: summarize(replayLatencies),
		ReplayThroughput: float64(len(events)) / replayDuration.Seconds(), IdempotentReplay: skipped,
		IdempotentLatency: summarize(idempotentLatencies), IdempotentThroughput: float64(len(events)) / idempotentDuration.Seconds(),
		InboxEffects: stats.InboxEffects, AnalyticsFacts: stats.AnalyticsFacts, OutboxQueueDepth: stats.OutboxPending,
		DatabaseBytes: databaseBytes, StorageBytesPerEvent: float64(databaseBytes) / float64(common.Events),
		Limitations: limitations,
	})
}

func databaseIdentity(ctx context.Context, db *sql.DB, retry bool) (string, string, int, error) {
	deadline := time.Now().Add(2 * time.Minute)
	var database, version string
	for attempt := 1; ; attempt++ {
		err := db.QueryRowContext(ctx, `SELECT current_database(),version()`).Scan(&database, &version)
		if err == nil {
			return database, version, attempt, nil
		}
		if !retry || time.Now().After(deadline) || ctx.Err() != nil {
			return "", "", attempt, fmt.Errorf("connect to isolated PostgreSQL after %d attempt(s): %w", attempt, err)
		}
		select {
		case <-ctx.Done():
			return "", "", attempt, ctx.Err()
		case <-time.After(200 * time.Millisecond):
		}
	}
}

func resilienceEvent(aggregate string, sequence int, now time.Time, sourceCommit, sourceRelease, keyID string, key []byte) datafabric.EventEnvelope {
	suffix := fmt.Sprintf("%s.%012d", aggregate, sequence)
	event := datafabric.EventEnvelope{
		EventID: "event.capacity.resilience." + suffix, EventType: "capacity.event.recorded", SchemaVersion: datafabric.EnvelopeSchemaVersion,
		Product: "capacity", Service: "resilience", AggregateID: "aggregate.capacity." + aggregate,
		Actor:         datafabric.Actor{ActorID: "actor.capacity.0001", AccountID: "account.capacity.0001", SessionID: "session.capacity.0001"},
		CorrelationID: "correlation.capacity." + aggregate, CausationID: "command.capacity." + suffix, Sequence: uint64(sequence),
		Timestamp: now.UTC(), EffectiveAt: now.UTC(), SourceCommit: sourceCommit, SourceRelease: sourceRelease,
		PrivacyClassification: "internal", RetentionClass: "transient", AuditID: "audit.capacity." + suffix,
		Source:  datafabric.SourceMetadata{Source: "ynx-postgres-resilience-probe", AsOf: now.UTC(), Version: "v1", Status: "authoritative"},
		Payload: json.RawMessage(`{"status":"accepted"}`),
	}
	if err := event.Sign(keyID, key); err != nil {
		fatal(err.Error())
	}
	return event
}

func deterministicKey(domain, sourceCommit string) []byte {
	digest := sha256.Sum256([]byte("ynx-postgres-resilience:" + domain + ":" + sourceCommit))
	return append([]byte(nil), digest[:]...)
}

func databaseSize(ctx context.Context, db *sql.DB) int64 {
	var size int64
	if err := db.QueryRowContext(ctx, `SELECT pg_database_size(current_database())`).Scan(&size); err != nil {
		fatal(err.Error())
	}
	return size
}

func recordDuration(mu *sync.Mutex, values *[]time.Duration, value time.Duration) {
	mu.Lock()
	*values = append(*values, value)
	mu.Unlock()
}

func summarize(values []time.Duration) latencySummary {
	if len(values) == 0 {
		return latencySummary{}
	}
	ordered := append([]time.Duration(nil), values...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })
	return latencySummary{
		P50Milliseconds: durationMilliseconds(ordered[percentileIndex(len(ordered), 0.50)]),
		P95Milliseconds: durationMilliseconds(ordered[percentileIndex(len(ordered), 0.95)]),
		P99Milliseconds: durationMilliseconds(ordered[percentileIndex(len(ordered), 0.99)]),
		MaxMilliseconds: durationMilliseconds(ordered[len(ordered)-1]),
	}
}

func percentileIndex(length int, percentile float64) int {
	if length <= 1 {
		return 0
	}
	index := int(float64(length-1) * percentile)
	if index >= length {
		return length - 1
	}
	return index
}

func durationMilliseconds(duration time.Duration) float64 {
	return float64(duration.Microseconds()) / 1000
}

func millisecondsSince(start, end time.Time) milliseconds {
	return milliseconds(durationMilliseconds(end.Sub(start)))
}

func isCommit(value string) bool {
	if len(value) != 40 {
		return false
	}
	for _, character := range value {
		if !strings.ContainsRune("0123456789abcdef", character) {
			return false
		}
	}
	return true
}

func emit(value any) {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		fatal(err.Error())
	}
}

func fatal(message string) {
	if strings.TrimSpace(message) == "" {
		message = "PostgreSQL resilience probe failed"
	}
	_, _ = fmt.Fprintln(os.Stderr, message)
	os.Exit(1)
}
