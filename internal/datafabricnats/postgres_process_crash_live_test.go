package datafabricnats

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabricpostgres"
	_ "github.com/lib/pq"
)

const (
	consumerCrashHelper       = "YNX_DATA_FABRIC_CONSUMER_CRASH_HELPER"
	consumerCrashNATSURL      = "YNX_DATA_FABRIC_CONSUMER_CRASH_NATS_URL"
	consumerCrashEventID      = "event.pay.invoice.created.0001"
	consumerCrashDurable      = "postgres-analytics-process-crash-v1"
	consumerCrashExitCode     = 86
	consumerCrashTestDatabase = "ynx_data_fabric_test"
)

func TestPostgresJetStreamConsumerProcessCrashRedelivery(t *testing.T) {
	dsn := os.Getenv("YNX_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("YNX_TEST_POSTGRES_DSN is not configured")
	}
	if os.Getenv("YNX_TEST_POSTGRES_ALLOW_DESTRUCTIVE") != "1" {
		t.Fatal("live consumer crash test requires YNX_TEST_POSTGRES_ALLOW_DESTRUCTIVE=1")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openCrashTestDatabase(t, ctx, dsn)
	defer db.Close()
	resetCrashTestDatabase(t, ctx, db)
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = db.ExecContext(cleanupCtx, `DROP SCHEMA IF EXISTS ynx_analytics CASCADE; DROP SCHEMA IF EXISTS ynx_fabric CASCADE`)
	})
	if _, err := datafabricpostgres.Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	store, err := datafabricpostgres.NewStore(db)
	if err != nil {
		t.Fatal(err)
	}
	event := testEvent(t, 1)
	if err := store.Append(ctx, event, integrationKey); err != nil {
		t.Fatal(err)
	}

	natsServer := startServer(t, testServerOptions(t.TempDir(), -1))
	defer natsServer.Shutdown()
	broker, err := Connect(ctx, Config{URL: natsServer.ClientURL(), MaxBytes: 32 << 20, PublishTimeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer broker.Close()
	dispatcher := datafabricpostgres.Dispatcher{
		Store: store, Publisher: broker, Owner: "dispatcher.consumer-crash.0001", BatchSize: 1,
		Lease: time.Second, MaxAttempts: 4, Now: func() time.Time { return time.Now().UTC().Add(time.Minute) },
	}
	report, err := dispatcher.DispatchOnce(ctx)
	if err != nil || report.Published != 1 || report.Failed != 0 {
		t.Fatalf("failed to publish crash-test Outbox event: report=%+v err=%v", report, err)
	}

	helperCtx, helperCancel := context.WithTimeout(ctx, 15*time.Second)
	defer helperCancel()
	crashStarted := time.Now()
	command := exec.CommandContext(helperCtx, os.Args[0], "-test.run=^TestPostgresJetStreamConsumerProcessCrashHelper$", "-test.count=1")
	command.Env = append(os.Environ(), consumerCrashHelper+"=1", consumerCrashNATSURL+"="+natsServer.ClientURL())
	output, helperErr := command.CombinedOutput()
	var exitError *exec.ExitError
	if !errors.As(helperErr, &exitError) || exitError.ExitCode() != consumerCrashExitCode {
		t.Fatalf("consumer helper did not crash at the post-commit/pre-ack boundary: err=%v output=%s", helperErr, boundedCrashOutput(output))
	}
	if helperCtx.Err() != nil {
		t.Fatalf("consumer helper timed out: %v", helperCtx.Err())
	}
	helperExitedAt := time.Now()
	applied, err := store.ProjectionApplied(ctx, datafabricpostgres.AnalyticsEventConsumer, consumerCrashEventID)
	if err != nil || !applied {
		t.Fatalf("consumer crash lost the committed Inbox effect: applied=%t err=%v", applied, err)
	}

	privacyKey := crashPrivacyKey()
	deadline := time.Now().Add(8 * time.Second)
	var redelivered bool
	var receivedRedelivery bool
	for time.Now().Before(deadline) {
		handlerInvoked := false
		redelivered, err = broker.ConsumeEventOnce(ctx, consumerCrashDurable, "ynx.events.pay.>", func(ctx context.Context, receivedEvent datafabric.EventEnvelope) (bool, error) {
			handlerInvoked = true
			if receivedEvent.EventID != consumerCrashEventID {
				return false, fmt.Errorf("unexpected redelivered event %s", receivedEvent.EventID)
			}
			result, applyErr := store.ApplyAnalyticsEvent(ctx, receivedEvent.EventID, privacyKey, time.Now().UTC().Add(time.Minute))
			return result.Applied, applyErr
		})
		if err == nil && handlerInvoked {
			receivedRedelivery = true
			break
		}
		if err != nil && !strings.Contains(err.Error(), "fetch JetStream event") {
			t.Fatalf("redelivered consumer failed: %v", err)
		}
		time.Sleep(100 * time.Millisecond)
	}
	if !receivedRedelivery {
		t.Fatalf("unacknowledged event was not redelivered: %v", err)
	}
	if redelivered {
		t.Fatal("redelivered event reapplied its PostgreSQL business effect")
	}
	stats, err := store.Stats(ctx)
	if err != nil || stats.InboxEffects != 1 || stats.AnalyticsFacts != 1 || stats.Events != 1 || stats.OutboxPending != 0 {
		t.Fatalf("post-crash exactly-once local effect is invalid: stats=%+v err=%v", stats, err)
	}
	facts, err := store.AnalyticsEventFacts(ctx)
	if err != nil || len(facts) != 1 || facts[0].EventID != consumerCrashEventID {
		t.Fatalf("consumer crash duplicated or lost the Analytics effect: facts=%+v err=%v", facts, err)
	}
	consumer, err := broker.stream.Consumer(ctx, consumerCrashDurable)
	if err != nil {
		t.Fatal(err)
	}
	consumerInfo, err := consumer.Info(ctx)
	if err != nil || consumerInfo.NumAckPending != 0 || consumerInfo.Delivered.Consumer < 2 || consumerInfo.Delivered.Stream != 1 || consumerInfo.AckFloor.Consumer < 2 || consumerInfo.AckFloor.Stream != 1 {
		t.Fatalf("redelivered JetStream message was not durably acknowledged: info=%+v err=%v", consumerInfo, err)
	}
	evidence, err := json.Marshal(map[string]any{
		"sourceCommit": os.Getenv("YNX_DATA_FABRIC_TEST_SOURCE_COMMIT"), "database": "PostgreSQL",
		"broker": "file-backed embedded JetStream", "eventId": consumerCrashEventID, "durable": consumerCrashDurable,
		"childExitCode": consumerCrashExitCode, "crashAfterPostgresCommitBeforeBrokerAck": true,
		"childLifetimeMilliseconds":               durationMilliseconds(helperExitedAt.Sub(crashStarted)),
		"redeliveryRecoveryAfterExitMilliseconds": durationMilliseconds(time.Since(helperExitedAt)),
		"deliveredConsumerSequence":               consumerInfo.Delivered.Consumer, "deliveredStreamSequence": consumerInfo.Delivered.Stream,
		"ackFloorConsumerSequence": consumerInfo.AckFloor.Consumer, "ackFloorStreamSequence": consumerInfo.AckFloor.Stream,
		"ackPending": consumerInfo.NumAckPending, "canonicalEvents": stats.Events, "inboxEffects": stats.InboxEffects,
		"analyticsFacts": stats.AnalyticsFacts, "duplicateBusinessEffects": 0,
		"limitations": []string{"one event and one consumer crash", "embedded single-node JetStream", "single PostgreSQL primary", "no broker partition, leader loss, sustained load, shared Testnet or public-scale claim"},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("consumerCrashEvidence=%s", evidence)
}

func TestPostgresJetStreamCapacityBackpressureRetainsOutbox(t *testing.T) {
	dsn := os.Getenv("YNX_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("YNX_TEST_POSTGRES_DSN is not configured")
	}
	if os.Getenv("YNX_TEST_POSTGRES_ALLOW_DESTRUCTIVE") != "1" {
		t.Fatal("live transport backpressure test requires YNX_TEST_POSTGRES_ALLOW_DESTRUCTIVE=1")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	db := openCrashTestDatabase(t, ctx, dsn)
	defer db.Close()
	resetCrashTestDatabase(t, ctx, db)
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = db.ExecContext(cleanupCtx, `DROP SCHEMA IF EXISTS ynx_analytics CASCADE; DROP SCHEMA IF EXISTS ynx_fabric CASCADE`)
	})
	if _, err := datafabricpostgres.Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	store, err := datafabricpostgres.NewStore(db)
	if err != nil {
		t.Fatal(err)
	}
	const eventCount = 256
	baseTime := time.Now().UTC().Truncate(time.Millisecond)
	for index := 0; index < eventCount; index++ {
		if err := store.Append(ctx, backpressureEvent(t, index, baseTime), integrationKey); err != nil {
			t.Fatalf("append backpressure event %d: %v", index, err)
		}
	}

	natsServer := startServer(t, testServerOptions(t.TempDir(), -1))
	defer natsServer.Shutdown()
	const constrainedBytes = int64(64 << 10)
	broker, err := Connect(ctx, Config{URL: natsServer.ClientURL(), MaxBytes: constrainedBytes, PublishTimeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	dispatcher := datafabricpostgres.Dispatcher{
		Store: store, Publisher: broker, Owner: "dispatcher.transport-backpressure.0001", BatchSize: eventCount,
		Lease: time.Second, MaxAttempts: 4, Now: func() time.Time { return baseTime.Add(time.Minute) },
	}
	pressureStarted := time.Now()
	constrainedReport, err := dispatcher.DispatchOnce(ctx)
	pressureDuration := time.Since(pressureStarted)
	if err != nil {
		broker.Close()
		t.Fatal(err)
	}
	if constrainedReport.Published == 0 || constrainedReport.Failed == 0 || constrainedReport.Published+constrainedReport.Failed != eventCount || constrainedReport.DeadLetter != 0 {
		broker.Close()
		t.Fatalf("constrained JetStream did not exert bounded capacity pressure: report=%+v", constrainedReport)
	}
	constrainedStats, err := store.Stats(ctx)
	if err != nil || constrainedStats.Events != eventCount || constrainedStats.OutboxPending != constrainedReport.Failed || constrainedStats.DeadLetters != 0 {
		broker.Close()
		t.Fatalf("PostgreSQL Outbox was not retained under capacity pressure: stats=%+v report=%+v err=%v", constrainedStats, constrainedReport, err)
	}
	constrainedInfo, err := broker.StreamInfo(ctx)
	if err != nil || constrainedInfo.State.Msgs != uint64(constrainedReport.Published) {
		broker.Close()
		t.Fatalf("constrained stream and acknowledged Outbox count diverged: info=%+v report=%+v err=%v", constrainedInfo, constrainedReport, err)
	}
	broker.Close()

	const expandedBytes = int64(8 << 20)
	expandedBroker, err := Connect(ctx, Config{URL: natsServer.ClientURL(), MaxBytes: expandedBytes, PublishTimeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer expandedBroker.Close()
	dispatcher.Publisher = expandedBroker
	dispatcher.Owner = "dispatcher.transport-backpressure.0002"
	dispatcher.Now = func() time.Time { return baseTime.Add(10 * time.Minute) }
	recoveryStarted := time.Now()
	recoveryReport, err := dispatcher.DispatchOnce(ctx)
	recoveryDuration := time.Since(recoveryStarted)
	if err != nil || recoveryReport.Published != constrainedReport.Failed || recoveryReport.Failed != 0 || recoveryReport.DeadLetter != 0 {
		t.Fatalf("retained Outbox did not drain after capacity expansion: report=%+v err=%v", recoveryReport, err)
	}
	finalStats, err := store.Stats(ctx)
	if err != nil || finalStats.Events != eventCount || finalStats.OutboxPending != 0 || finalStats.DeadLetters != 0 {
		t.Fatalf("post-backpressure PostgreSQL state is invalid: stats=%+v err=%v", finalStats, err)
	}
	finalInfo, err := expandedBroker.StreamInfo(ctx)
	if err != nil || finalInfo.State.Msgs != eventCount || finalInfo.State.Bytes > uint64(expandedBytes) {
		t.Fatalf("expanded stream did not retain each canonical event exactly once: info=%+v err=%v", finalInfo, err)
	}
	evidence, err := json.Marshal(map[string]any{
		"sourceCommit": os.Getenv("YNX_DATA_FABRIC_TEST_SOURCE_COMMIT"), "database": "PostgreSQL",
		"broker": "file-backed embedded JetStream", "canonicalEvents": eventCount,
		"constrainedMaxBytes": constrainedBytes, "constrainedPublished": constrainedReport.Published,
		"constrainedRejected": constrainedReport.Failed, "outboxRetainedUnderPressure": constrainedStats.OutboxPending,
		"deadLettersUnderPressure": constrainedStats.DeadLetters, "pressureDurationMilliseconds": durationMilliseconds(pressureDuration),
		"expandedMaxBytes": expandedBytes, "recoveredPublished": recoveryReport.Published,
		"recoveryDurationMilliseconds": durationMilliseconds(recoveryDuration), "finalOutboxPending": finalStats.OutboxPending,
		"finalDeadLetters": finalStats.DeadLetters, "finalStreamMessages": finalInfo.State.Msgs,
		"finalStreamBytes": finalInfo.State.Bytes, "duplicateStreamMessages": uint64(eventCount) - finalInfo.State.Msgs,
		"limitations": []string{"256-event bounded batch, not a sustained-duration soak", "embedded single-node JetStream", "single PostgreSQL primary", "capacity recovery by explicit stream expansion, not automatic scaling", "no broker partition, leader loss, shared Testnet or public-scale claim"},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("transportBackpressureEvidence=%s", evidence)
}

func TestPostgresJetStreamConsumerProcessCrashHelper(t *testing.T) {
	if os.Getenv(consumerCrashHelper) != "1" {
		t.Skip("consumer crash helper is subprocess-only")
	}
	dsn := os.Getenv("YNX_TEST_POSTGRES_DSN")
	natsURL := os.Getenv(consumerCrashNATSURL)
	if dsn == "" || natsURL == "" {
		t.Fatal("consumer crash helper requires PostgreSQL and NATS endpoints")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store, err := datafabricpostgres.NewStore(db)
	if err != nil {
		t.Fatal(err)
	}
	broker, err := Connect(ctx, Config{URL: natsURL, MaxBytes: 32 << 20, PublishTimeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer broker.Close()
	_, err = broker.ConsumeEventOnce(ctx, consumerCrashDurable, "ynx.events.pay.>", func(ctx context.Context, event datafabric.EventEnvelope) (bool, error) {
		result, applyErr := store.ApplyAnalyticsEvent(ctx, event.EventID, crashPrivacyKey(), time.Now().UTC().Add(time.Minute))
		if applyErr != nil || !result.Applied || result.Suppressed {
			return false, fmt.Errorf("commit crash helper effect: result=%+v err=%v", result, applyErr)
		}
		os.Exit(consumerCrashExitCode)
		return false, errors.New("unreachable after consumer crash")
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Fatal("consumer crash helper returned without terminating")
}

func openCrashTestDatabase(t *testing.T, ctx context.Context, dsn string) *sql.DB {
	t.Helper()
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	var database string
	if err := db.QueryRowContext(ctx, `SELECT current_database()`).Scan(&database); err != nil {
		db.Close()
		t.Fatal(err)
	}
	if database != consumerCrashTestDatabase {
		db.Close()
		t.Fatalf("refusing destructive consumer crash test against database %q", database)
	}
	return db
}

func resetCrashTestDatabase(t *testing.T, ctx context.Context, db *sql.DB) {
	t.Helper()
	if _, err := db.ExecContext(ctx, `DROP SCHEMA IF EXISTS ynx_analytics CASCADE; DROP SCHEMA IF EXISTS ynx_fabric CASCADE`); err != nil {
		t.Fatal(err)
	}
}

func crashPrivacyKey() []byte {
	digest := sha256.Sum256([]byte("ynx-data-fabric-postgres-consumer-crash-privacy-key"))
	return append([]byte(nil), digest[:]...)
}

func backpressureEvent(t *testing.T, index int, baseTime time.Time) datafabric.EventEnvelope {
	t.Helper()
	suffix := fmt.Sprintf("%06d", index)
	event := testEvent(t, 1)
	event.EventID = "event.pay.invoice.created.backpressure." + suffix
	event.AggregateID = "invoice.backpressure." + suffix
	event.CorrelationID = "correlation.backpressure." + suffix
	event.CausationID = "command.backpressure." + suffix
	event.AuditID = "audit.backpressure." + suffix
	event.Timestamp = baseTime.Add(time.Duration(index) * time.Millisecond)
	event.EffectiveAt = event.Timestamp
	event.Source.AsOf = event.Timestamp
	payload, err := json.Marshal(map[string]string{"invoiceId": event.AggregateID, "padding": strings.Repeat("x", 2048)})
	if err != nil {
		t.Fatal(err)
	}
	event.Payload = payload
	if err := event.Sign("key.datafabric.0001", integrationKey); err != nil {
		t.Fatal(err)
	}
	return event
}

func boundedCrashOutput(output []byte) string {
	const limit = 2048
	if len(output) > limit {
		output = output[len(output)-limit:]
	}
	return string(output)
}

func durationMilliseconds(duration time.Duration) float64 {
	return float64(duration.Microseconds()) / 1000
}
