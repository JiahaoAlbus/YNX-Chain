package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabricapi"
	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabricnats"
	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabricpostgres"
	_ "github.com/lib/pq"
	"github.com/nats-io/nats-server/v2/server"
)

type latencySummary struct {
	P50Milliseconds float64 `json:"p50Milliseconds"`
	P95Milliseconds float64 `json:"p95Milliseconds"`
	P99Milliseconds float64 `json:"p99Milliseconds"`
	MaxMilliseconds float64 `json:"maxMilliseconds"`
}

type report struct {
	MeasuredAt                 time.Time      `json:"measuredAt"`
	SourceCommit               string         `json:"sourceCommit"`
	SourceRelease              string         `json:"sourceRelease"`
	DirtyWorkingTree           bool           `json:"dirtyWorkingTree"`
	GOOS                       string         `json:"goos"`
	GOARCH                     string         `json:"goarch"`
	GoVersion                  string         `json:"goVersion"`
	CPUCount                   int            `json:"cpuCount"`
	Transport                  string         `json:"transport"`
	Database                   string         `json:"database"`
	Broker                     string         `json:"broker"`
	Producers                  int            `json:"producers"`
	SimultaneousStart          bool           `json:"simultaneousStart"`
	ProducerConcurrencyLimit   uint32         `json:"producerConcurrencyLimit"`
	ObservedPeakServerInFlight uint64         `json:"observedPeakServerInFlight"`
	Succeeded                  uint64         `json:"succeeded"`
	BusinessErrors             uint64         `json:"businessErrors"`
	RequestAttempts            uint64         `json:"requestAttempts"`
	BackpressureResponses      uint64         `json:"backpressureResponses"`
	BackpressureRate           float64        `json:"backpressureResponseRate"`
	EndToEndLatency            latencySummary `json:"producerEndToEndLatency"`
	Throughput                 float64        `json:"committedEventsPerSecond"`
	QueueDepth                 uint64         `json:"transactionalOutboxQueueDepth"`
	BrokerPublished            uint64         `json:"brokerPublished"`
	FinalQueueDepth            uint64         `json:"finalTransactionalOutboxQueueDepth"`
	StreamMessages             uint64         `json:"streamMessages"`
	StateBytes                 int64          `json:"stateBytes"`
	StorageBytesPerEvent       float64        `json:"storageBytesPerEvent"`
	DurationMilliseconds       float64        `json:"durationMilliseconds"`
	Limitations                []string       `json:"limitations"`
}

type denyAuthorizer struct{}

func (denyAuthorizer) Authorize(context.Context, datafabricapi.Credential, string) (datafabricapi.Principal, error) {
	return datafabricapi.Principal{}, errors.New("canonical user APIs are outside the producer capacity probe")
}

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	producerCount := flag.Int("producers", 1000, "simultaneously started producer clients")
	serverLimit := flag.Uint("server-concurrency", 64, "bounded producer requests admitted concurrently")
	sourceCommit := flag.String("source-commit", "", "exact engineering source commit")
	sourceRelease := flag.String("source-release", "", "exact engineering source release")
	dirty := flag.Bool("dirty-working-tree", true, "whether tracked engineering files were dirty during measurement")
	postgresDSN := flag.String("postgres-dsn", "", "isolated ynx_data_fabric_test PostgreSQL DSN")
	embeddedJetStream := flag.Bool("embedded-jetstream", false, "dispatch the PostgreSQL Outbox to a file-backed embedded JetStream")
	allowDestructive := flag.Bool("allow-destructive-test-database", false, "allow schema reset only in ynx_data_fabric_test")
	flag.Parse()
	if *producerCount < 100 || *producerCount > 5000 || *serverLimit < 1 || *serverLimit > 4096 || !isCommit(*sourceCommit) || strings.TrimSpace(*sourceRelease) == "" {
		fatal("producers (100..5000), server-concurrency (1..4096), exact source commit, and source release are required")
	}
	if (*postgresDSN == "") != (!*embeddedJetStream) || (*postgresDSN != "" && !*allowDestructive) {
		fatal("postgres-dsn, embedded-jetstream, and allow-destructive-test-database must be enabled together")
	}

	root, err := os.MkdirTemp("", "ynx-data-fabric-api-capacity-")
	if err != nil {
		fatal(err.Error())
	}
	defer os.RemoveAll(root)
	var repository datafabricapi.Repository
	var localStore *datafabric.Store
	var postgresStore *datafabricpostgres.Store
	var database *sql.DB
	databaseKind := "file-local-development"
	if *postgresDSN == "" {
		localStore, err = datafabric.OpenStore(root + "/state.json")
		if err != nil {
			fatal(err.Error())
		}
		repository = datafabricapi.LocalRepository{Store: localStore}
	} else {
		database, postgresStore = openPostgres(*postgresDSN)
		defer database.Close()
		repository = postgresStore
		databaseKind = "PostgreSQL"
	}
	eventKeys := make(map[string][]byte, *producerCount)
	eventKeyProducts := make(map[string]string, *producerCount)
	producerKeys := make([][]byte, *producerCount)
	for index := 0; index < *producerCount; index++ {
		keyID := producerKeyID(index)
		digest := sha256.Sum256([]byte(fmt.Sprintf("ynx-capacity-producer-key-%08d", index)))
		producerKeys[index] = append([]byte(nil), digest[:]...)
		eventKeys[keyID] = producerKeys[index]
		eventKeyProducts[keyID] = "capacity"
	}
	apiServer, err := datafabricapi.New(datafabricapi.Config{
		Repository: repository, Authorizer: denyAuthorizer{}, EventKeys: eventKeys, EventKeyProducts: eventKeyProducts,
		PrivacyKey: []byte("capacity-only-privacy-key-32bytes!!"), SourceCommit: *sourceCommit, SourceRelease: *sourceRelease,
		RateLimitPerMinute: 10000, ProducerConcurrencyLimit: uint32(*serverLimit), DatabaseKind: databaseKind,
	})
	if err != nil {
		fatal(err.Error())
	}
	httpServer := httptest.NewServer(apiServer.Handler())
	defer httpServer.Close()
	transport := &http.Transport{
		Proxy: http.ProxyFromEnvironment, DialContext: (&net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		MaxIdleConns: *producerCount, MaxIdleConnsPerHost: *producerCount, MaxConnsPerHost: *producerCount,
		IdleConnTimeout: 30 * time.Second, ResponseHeaderTimeout: 2 * time.Minute,
	}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	latencies := make([]time.Duration, *producerCount)
	var succeeded, businessErrors, attempts, backpressure atomic.Uint64
	var errorMu sync.Mutex
	var firstErrors []string
	startBarrier := make(chan struct{})
	started := time.Now()
	var workers sync.WaitGroup
	workers.Add(*producerCount)
	for index := 0; index < *producerCount; index++ {
		go func(index int) {
			defer workers.Done()
			event := capacityEvent(index, started.UTC(), *sourceCommit, *sourceRelease, producerKeyID(index), producerKeys[index])
			body, err := json.Marshal(event)
			if err != nil {
				recordError(&businessErrors, &errorMu, &firstErrors, err.Error())
				return
			}
			<-startBarrier
			producerStarted := time.Now()
			for attempt := 0; attempt < 300; attempt++ {
				attempts.Add(1)
				status, retryAfter, err := sendProducer(ctx, client, httpServer.URL, body, producerKeyID(index), producerKeys[index], fmt.Sprintf("nonce.capacity.producer.%08d", index))
				if err != nil {
					recordError(&businessErrors, &errorMu, &firstErrors, err.Error())
					return
				}
				if status == http.StatusAccepted {
					latencies[index] = time.Since(producerStarted)
					succeeded.Add(1)
					return
				}
				if status != http.StatusTooManyRequests || retryAfter != "1" {
					recordError(&businessErrors, &errorMu, &firstErrors, fmt.Sprintf("producer %d received status %d retry-after %q", index, status, retryAfter))
					return
				}
				backpressure.Add(1)
				jitter := time.Duration((index+attempt)%101) * time.Millisecond
				select {
				case <-time.After(time.Second + jitter):
				case <-ctx.Done():
					recordError(&businessErrors, &errorMu, &firstErrors, ctx.Err().Error())
					return
				}
			}
			recordError(&businessErrors, &errorMu, &firstErrors, fmt.Sprintf("producer %d exhausted bounded retries", index))
		}(index)
	}
	close(startBarrier)
	workers.Wait()
	duration := time.Since(started)
	if len(firstErrors) != 0 || succeeded.Load() != uint64(*producerCount) || businessErrors.Load() != 0 {
		fatal(fmt.Sprintf("producer capacity run failed: succeeded=%d errors=%d first=%v", succeeded.Load(), businessErrors.Load(), firstErrors))
	}
	stats, err := repository.Stats(ctx)
	if err != nil {
		fatal(err.Error())
	}
	if stats.Events != uint64(*producerCount) || stats.OutboxPending != uint64(*producerCount) {
		fatal(fmt.Sprintf("unexpected authoritative queue state: %+v", stats))
	}
	initialQueueDepth := stats.OutboxPending
	metrics, err := fetchMetrics(ctx, client, httpServer.URL)
	if err != nil {
		fatal(err.Error())
	}
	peak := metrics["ynx_data_fabric_producer_peak_inflight"]
	reportedBackpressure := metrics["ynx_data_fabric_producer_backpressure_total"]
	if peak == 0 || peak > uint64(*serverLimit) || reportedBackpressure != backpressure.Load() || backpressure.Load() == 0 {
		fatal(fmt.Sprintf("invalid backpressure metrics: peak=%d limit=%d reported=%d client=%d", peak, *serverLimit, reportedBackpressure, backpressure.Load()))
	}
	var stateBytes int64
	if database == nil {
		stateInfo, statErr := os.Stat(root + "/state.json")
		if statErr != nil {
			fatal(statErr.Error())
		}
		stateBytes = stateInfo.Size()
	} else if err := database.QueryRowContext(ctx, `SELECT pg_database_size(current_database())`).Scan(&stateBytes); err != nil {
		fatal(err.Error())
	}
	brokerKind := "not-configured"
	var brokerPublished, finalQueueDepth, streamMessages uint64
	if *embeddedJetStream {
		brokerKind = "file-backed embedded JetStream"
		brokerPublished, finalQueueDepth, streamMessages = dispatchPostgresOutbox(ctx, root, postgresStore, *producerCount)
	}
	limitations := []string{
		"real loopback HTTP but no external network or TLS terminator", "independent registered producer keys are deterministic test-only keys",
		"no broker partition, database restart, consumer crash, long replay, availability, or public-scale claim",
	}
	if database == nil {
		limitations = append(limitations, "single local process and atomic JSON state-file rewrite", "transactional Outbox queue is measured before dispatch; no JetStream publication")
	} else {
		limitations = append(limitations, "single PostgreSQL primary", "embedded single-node JetStream without replication", "one bounded batch dispatch after Producer completion, not sustained-duration traffic")
	}
	result := report{
		MeasuredAt: time.Now().UTC(), SourceCommit: *sourceCommit, SourceRelease: *sourceRelease, DirtyWorkingTree: *dirty,
		GOOS: runtime.GOOS, GOARCH: runtime.GOARCH, GoVersion: runtime.Version(), CPUCount: runtime.NumCPU(), Transport: "real-loopback-http",
		Database: databaseKind, Broker: brokerKind,
		Producers: *producerCount, SimultaneousStart: true, ProducerConcurrencyLimit: uint32(*serverLimit), ObservedPeakServerInFlight: peak,
		Succeeded: succeeded.Load(), BusinessErrors: businessErrors.Load(), RequestAttempts: attempts.Load(), BackpressureResponses: backpressure.Load(),
		BackpressureRate: float64(backpressure.Load()) / float64(attempts.Load()), EndToEndLatency: summarize(latencies),
		Throughput: float64(*producerCount) / duration.Seconds(), QueueDepth: initialQueueDepth, BrokerPublished: brokerPublished,
		FinalQueueDepth: finalQueueDepth, StreamMessages: streamMessages, StateBytes: stateBytes,
		StorageBytesPerEvent: float64(stateBytes) / float64(*producerCount), DurationMilliseconds: milliseconds(duration), Limitations: limitations,
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(result); err != nil {
		fatal(err.Error())
	}
}

func openPostgres(dsn string) (*sql.DB, *datafabricpostgres.Store) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	database, err := sql.Open("postgres", dsn)
	if err != nil {
		fatal(err.Error())
	}
	var databaseName string
	if err := database.QueryRowContext(ctx, `SELECT current_database()`).Scan(&databaseName); err != nil {
		fatal(err.Error())
	}
	if databaseName != "ynx_data_fabric_test" {
		fatal(fmt.Sprintf("refusing destructive producer E2E against database %q", databaseName))
	}
	if _, err := database.ExecContext(ctx, `DROP SCHEMA IF EXISTS ynx_analytics CASCADE; DROP SCHEMA IF EXISTS ynx_fabric CASCADE`); err != nil {
		fatal(err.Error())
	}
	if _, err := datafabricpostgres.Migrate(ctx, database); err != nil {
		fatal(err.Error())
	}
	store, err := datafabricpostgres.NewStore(database)
	if err != nil {
		fatal(err.Error())
	}
	return database, store
}

func dispatchPostgresOutbox(ctx context.Context, root string, store *datafabricpostgres.Store, expected int) (uint64, uint64, uint64) {
	options := &server.Options{Host: "127.0.0.1", Port: -1, NoLog: true, NoSigs: true, JetStream: true, StoreDir: root + "/jetstream", SyncAlways: true}
	natsServer, err := server.NewServer(options)
	if err != nil {
		fatal(err.Error())
	}
	natsServer.Start()
	defer natsServer.Shutdown()
	if !natsServer.ReadyForConnections(5 * time.Second) {
		fatal("embedded JetStream did not become ready")
	}
	broker, err := datafabricnats.Connect(ctx, datafabricnats.Config{URL: natsServer.ClientURL(), MaxBytes: 32 << 20, PublishTimeout: 2 * time.Second})
	if err != nil {
		fatal(err.Error())
	}
	defer broker.Close()
	dispatcher := datafabricpostgres.Dispatcher{
		Store: store, Publisher: broker, Owner: "api-capacity-postgres-jetstream", BatchSize: 250,
		Lease: 30 * time.Second, MaxAttempts: 4, Now: func() time.Time { return time.Now().UTC() },
	}
	var published uint64
	for attempt := 0; attempt < 20; attempt++ {
		stats, err := store.Stats(ctx)
		if err != nil {
			fatal(err.Error())
		}
		if stats.OutboxPending == 0 {
			break
		}
		report, err := dispatcher.DispatchOnce(ctx)
		if err != nil || report.Failed != 0 || report.DeadLetter != 0 {
			fatal(fmt.Sprintf("PostgreSQL-to-JetStream dispatch failed: report=%+v err=%v", report, err))
		}
		published += report.Published
	}
	stats, err := store.Stats(ctx)
	if err != nil {
		fatal(err.Error())
	}
	info, err := broker.StreamInfo(ctx)
	if err != nil {
		fatal(err.Error())
	}
	if published != uint64(expected) || stats.OutboxPending != 0 || info.State.Msgs != uint64(expected) {
		fatal(fmt.Sprintf("PostgreSQL-to-JetStream E2E mismatch: published=%d stats=%+v stream=%+v", published, stats, info.State))
	}
	return published, stats.OutboxPending, info.State.Msgs
}

func sendProducer(ctx context.Context, client *http.Client, origin string, body []byte, keyID string, key []byte, nonce string) (int, string, error) {
	timestamp := time.Now().UTC().Format(time.RFC3339Nano)
	signature, err := datafabric.ProducerDeliverySignature(keyID, timestamp, nonce, body, key)
	if err != nil {
		return 0, "", err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, origin+datafabric.ProducerEventsPath, bytes.NewReader(body))
	if err != nil {
		return 0, "", err
	}
	request.Header.Set(datafabric.ProducerKeyIDHeader, keyID)
	request.Header.Set(datafabric.ProducerTimestampHeader, timestamp)
	request.Header.Set(datafabric.ProducerNonceHeader, nonce)
	request.Header.Set(datafabric.ProducerSignatureHeader, signature)
	response, err := client.Do(request)
	if err != nil {
		return 0, "", err
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 1<<20))
	return response.StatusCode, response.Header.Get("Retry-After"), nil
}

func fetchMetrics(ctx context.Context, client *http.Client, origin string) (map[string]uint64, error) {
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, origin+"/metrics", nil)
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil || response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("metrics request failed: status=%d err=%v", response.StatusCode, err)
	}
	metrics := map[string]uint64{}
	for _, line := range strings.Split(string(body), "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 || !strings.HasPrefix(fields[0], "ynx_data_fabric_producer_") {
			continue
		}
		value, parseErr := strconv.ParseUint(fields[1], 10, 64)
		if parseErr == nil {
			metrics[fields[0]] = value
		}
	}
	return metrics, nil
}

func capacityEvent(index int, base time.Time, sourceCommit, sourceRelease, keyID string, key []byte) datafabric.EventEnvelope {
	suffix := fmt.Sprintf("%012d", index+1)
	now := base.Add(time.Duration(index) * time.Microsecond)
	event := datafabric.EventEnvelope{
		EventID: "event.capacity.api." + suffix, EventType: "capacity.event.recorded", SchemaVersion: datafabric.EnvelopeSchemaVersion,
		Product: "capacity", Service: "producer", AggregateID: "aggregate.capacity.api." + suffix,
		Actor:         datafabric.Actor{ActorID: "actor.capacity." + suffix, AccountID: "account.capacity." + suffix, SessionID: "session.capacity." + suffix},
		CorrelationID: "correlation.capacity.api." + suffix, CausationID: "command.capacity.api." + suffix, Sequence: 1,
		Timestamp: now, EffectiveAt: now, SourceCommit: sourceCommit, SourceRelease: sourceRelease,
		PrivacyClassification: "internal", RetentionClass: "transient", AuditID: "audit.capacity.api." + suffix,
		Source:  datafabric.SourceMetadata{Source: "ynx-api-capacity-tool", AsOf: now, Version: "v1", Status: "authoritative"},
		Payload: json.RawMessage(`{"status":"accepted"}`),
	}
	if err := event.Sign(keyID, key); err != nil {
		fatal(err.Error())
	}
	return event
}

func producerKeyID(index int) string { return fmt.Sprintf("key.capacity.producer.%08d", index) }

func recordError(counter *atomic.Uint64, mu *sync.Mutex, messages *[]string, message string) {
	counter.Add(1)
	mu.Lock()
	defer mu.Unlock()
	if len(*messages) < 5 {
		*messages = append(*messages, message)
	}
}

func summarize(values []time.Duration) latencySummary {
	copyValues := append([]time.Duration(nil), values...)
	sort.Slice(copyValues, func(i, j int) bool { return copyValues[i] < copyValues[j] })
	return latencySummary{
		P50Milliseconds: milliseconds(copyValues[percentileIndex(len(copyValues), 0.50)]),
		P95Milliseconds: milliseconds(copyValues[percentileIndex(len(copyValues), 0.95)]),
		P99Milliseconds: milliseconds(copyValues[percentileIndex(len(copyValues), 0.99)]),
		MaxMilliseconds: milliseconds(copyValues[len(copyValues)-1]),
	}
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

func fatal(message string) {
	_, _ = fmt.Fprintln(os.Stderr, message)
	os.Exit(1)
}
