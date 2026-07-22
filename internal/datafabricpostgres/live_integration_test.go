package datafabricpostgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
	_ "github.com/lib/pq"
)

func TestPostgresLiveTransactionsConstraintsAndRecovery(t *testing.T) {
	dsn := os.Getenv("YNX_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("YNX_TEST_POSTGRES_DSN is not configured")
	}
	if os.Getenv("YNX_TEST_POSTGRES_ALLOW_DESTRUCTIVE") != "1" {
		t.Fatal("live test requires YNX_TEST_POSTGRES_ALLOW_DESTRUCTIVE=1")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	var database string
	if err := db.QueryRowContext(ctx, `SELECT current_database()`).Scan(&database); err != nil {
		t.Fatal(err)
	}
	if database != "ynx_data_fabric_test" {
		t.Fatalf("refusing destructive integration test against database %q", database)
	}
	if _, err := db.ExecContext(ctx, `DROP SCHEMA IF EXISTS ynx_analytics CASCADE; DROP SCHEMA IF EXISTS ynx_fabric CASCADE`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		defer db.Close()
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = db.ExecContext(cleanupCtx, `DROP SCHEMA IF EXISTS ynx_analytics CASCADE; DROP SCHEMA IF EXISTS ynx_fabric CASCADE`)
	})
	applied, err := Migrate(ctx, db)
	if err != nil || len(applied) != 1 || applied[0].Version != 1 {
		t.Fatalf("live migration failed: applied=%+v err=%v", applied, err)
	}
	if err := VerifySchema(ctx, db); err != nil {
		t.Fatalf("live schema checksum verification failed: %v", err)
	}
	store, err := NewStore(db)
	if err != nil {
		t.Fatal(err)
	}

	first := liveEvent(t, "event.pay.live.created.0001", "aggregate.live.0001", "correlation.live.0001", 1, time.Now().UTC())
	if err := store.Append(ctx, first, postgresTestKey); err != nil {
		t.Fatal(err)
	}
	if err := store.Append(ctx, first, postgresTestKey); !errors.Is(err, datafabric.ErrDuplicate) {
		t.Fatalf("duplicate event not rejected: %v", err)
	}
	gap := liveEvent(t, "event.pay.live.gap.0003", first.AggregateID, first.CorrelationID, 3, first.Timestamp.Add(2*time.Second))
	if err := store.Append(ctx, gap, postgresTestKey); !errors.Is(err, datafabric.ErrOutOfOrder) {
		t.Fatalf("sequence gap not rejected: %v", err)
	}
	second := liveEvent(t, "event.pay.live.updated.0002", first.AggregateID, first.CorrelationID, 2, first.Timestamp.Add(time.Second))
	if err := store.Append(ctx, second, postgresTestKey); err != nil {
		t.Fatal(err)
	}
	wrongAuthority := liveEvent(t, "event.pay.other.created.0001", "aggregate.other.0001", "correlation.other.0001", 1, first.Timestamp.Add(time.Second))
	if err := store.Append(ctx, wrongAuthority, postgresTestKey); err != nil {
		t.Fatal(err)
	}

	claimedA, err := store.ClaimOutbox(ctx, "worker-a", time.Now().UTC().Add(time.Minute), time.Minute, 1)
	if err != nil || len(claimedA) != 1 {
		t.Fatalf("first concurrent claim failed: %+v %v", claimedA, err)
	}
	claimedB, err := store.ClaimOutbox(ctx, "worker-b", time.Now().UTC().Add(time.Minute), time.Minute, 10)
	if err != nil || len(claimedB) != 2 {
		t.Fatalf("SKIP LOCKED claim did not isolate leases: %+v %v", claimedB, err)
	}
	for _, record := range claimedB {
		if record.EventID == claimedA[0].EventID {
			t.Fatal("two dispatchers claimed the same live Outbox record")
		}
	}
	if err := store.MarkPublished(ctx, claimedA[0].EventID, "worker-a", time.Now().UTC()); err != nil {
		t.Fatal(err)
	}

	entry := liveJournal(first, time.Now().UTC())
	if err := store.PostJournal(ctx, entry); err != nil {
		t.Fatal(err)
	}
	if err := insertUnbalancedJournal(ctx, db, first, time.Now().UTC()); err == nil {
		t.Fatal("deferred PostgreSQL balance trigger accepted an unbalanced journal")
	}
	if _, err := db.ExecContext(ctx, `UPDATE ynx_fabric.events SET event_type='pay.invoice.tampered' WHERE event_id=$1`, first.EventID); err == nil {
		t.Fatal("append-only event trigger accepted mutation")
	}

	now := time.Now().UTC()
	saga, err := datafabric.NewSaga("saga.pay.live.0001", datafabric.SagaPay, first.AggregateID, first.CorrelationID, "audit.saga.live.0001", now, now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.StartSaga(ctx, saga); err != nil {
		t.Fatal(err)
	}
	if err := store.CompleteSagaStep(ctx, saga.SagaID, wrongAuthority.EventID, now.Add(time.Second)); err == nil {
		t.Fatal("Saga accepted an event with the wrong correlation authority")
	}
	if err := store.CompleteSagaStep(ctx, saga.SagaID, first.EventID, now.Add(time.Second)); err != nil {
		t.Fatalf("canonical Saga event was rejected: %v", err)
	}

	observation := datafabric.SettlementObservation{Source: "chain", ReferenceID: "receipt.chain.live.0001", Asset: "USD", Currency: "USD", AmountMinor: 100, ObservedAt: now, EvidenceHash: strings.Repeat("a", 64), Metadata: datafabric.SourceMetadata{Source: "chain-testnet", AsOf: now, Version: "1", Status: "authoritative"}}
	run, err := store.ReconcileJournal(ctx, "reconcile.live.0001", entry.EntryID, "audit.reconcile.live.0001", "719e101", "data-fabric-live-test", []string{"chain"}, []datafabric.SettlementObservation{observation}, now)
	if err != nil || run.Status != "matched" || run.Coverage != 1 {
		t.Fatalf("live reconciliation failed: %+v %v", run, err)
	}
	projection, err := store.ApplyAnalyticsEvent(ctx, first.EventID, postgresTestKey, time.Now().UTC())
	if err != nil || !projection.Applied || projection.Suppressed {
		t.Fatalf("privacy-safe analytics projection failed: %+v %v", projection, err)
	}
	facts, err := store.AnalyticsEventFacts(ctx)
	if err != nil || len(facts) != 1 || facts[0].AccountPseudonym == "" || facts[0].AccountPseudonym == first.Actor.AccountID {
		t.Fatalf("analytics projection is missing or not pseudonymous: %+v %v", facts, err)
	}
	record, err := store.RecordErasure(ctx, first.Actor.AccountID, "audit.erase.live.0001", postgresTestKey, now)
	if err != nil || record.Financial != 3 {
		t.Fatalf("live erasure retention record failed: %+v %v", record, err)
	}
	facts, err = store.AnalyticsEventFacts(ctx)
	if err != nil || len(facts) != 0 {
		t.Fatalf("erasure retained derived analytics facts: %+v %v", facts, err)
	}
	projection, err = store.ApplyAnalyticsEvent(ctx, second.EventID, postgresTestKey, second.Timestamp.Add(time.Second))
	if err != nil || !projection.Applied || !projection.Suppressed {
		t.Fatalf("erased subject was rematerialized: %+v %v", projection, err)
	}
	facts, err = store.AnalyticsEventFacts(ctx)
	if err != nil || len(facts) != 0 {
		t.Fatalf("suppressed subject produced analytics facts: %+v %v", facts, err)
	}
	if err := store.AuditIntegrity(ctx, map[string][]byte{"key.datafabric.0001": postgresTestKey}); err != nil {
		t.Fatalf("live repository integrity audit failed: %v", err)
	}
	stats, err := store.Stats(ctx)
	if err != nil || stats.Events != 3 || stats.JournalEntries != 1 || stats.Reconciliations != 1 || stats.ErasureRequests != 1 {
		t.Fatalf("live repository statistics are wrong: %+v %v", stats, err)
	}
	var concurrent sync.WaitGroup
	concurrentErrors := make(chan error, 64)
	concurrentEvents := make([]datafabric.EventEnvelope, 64)
	for index := 0; index < 64; index++ {
		suffix := fmt.Sprintf("%04d", index+1)
		concurrentEvents[index] = liveEvent(t, "event.pay.concurrent."+suffix, "aggregate.concurrent."+suffix, "correlation.concurrent."+suffix, 1, time.Now().UTC())
	}
	for index := range concurrentEvents {
		concurrent.Add(1)
		go func(index int) {
			defer concurrent.Done()
			concurrentErrors <- store.Append(ctx, concurrentEvents[index], postgresTestKey)
		}(index)
	}
	concurrent.Wait()
	close(concurrentErrors)
	for err := range concurrentErrors {
		if err != nil {
			t.Fatalf("distinct canonical partitions contended: %v", err)
		}
	}
	if err := store.AuditIntegrity(ctx, map[string][]byte{"key.datafabric.0001": postgresTestKey}); err != nil {
		t.Fatalf("post-concurrency integrity audit failed: %v", err)
	}
}

func liveEvent(t *testing.T, id, aggregateID, correlationID string, sequence uint64, now time.Time) datafabric.EventEnvelope {
	t.Helper()
	event := datafabric.EventEnvelope{EventID: id, EventType: "pay.invoice.state_changed", SchemaVersion: datafabric.EnvelopeSchemaVersion, Product: "pay", Service: "invoice", AggregateID: aggregateID, Actor: datafabric.Actor{ActorID: "actor.live.0001", AccountID: "account.live.0001", SessionID: "session.live.0001"}, CorrelationID: correlationID, Sequence: sequence, Timestamp: now.UTC(), EffectiveAt: now.UTC(), SourceCommit: "719e101", SourceRelease: "data-fabric-live-test", PrivacyClassification: "confidential", RetentionClass: "financial-7y", AuditID: "audit." + id, Source: datafabric.SourceMetadata{Source: "live-postgres-test", AsOf: now.UTC(), Version: "1", Status: "authoritative"}, Payload: json.RawMessage(`{"status":"recorded"}`)}
	if err := event.Sign("key.datafabric.0001", postgresTestKey); err != nil {
		t.Fatal(err)
	}
	return event
}

func liveJournal(event datafabric.EventEnvelope, now time.Time) datafabric.JournalEntry {
	return datafabric.JournalEntry{EntryID: "journal.live.0001", CorrelationID: event.CorrelationID, EventID: event.EventID, EffectiveAt: now, RecordedAt: now, Description: "live balanced journal", RevenueBoundary: "payment-settled", SourceCommit: "719e101", SourceRelease: "data-fabric-live-test", AuditID: "audit.journal.live.0001", Postings: []datafabric.Posting{{AccountID: event.Actor.AccountID, Asset: "USD", Currency: "USD", Side: datafabric.Debit, Amount: 100, Category: "refund"}, {AccountID: "account.provider.live.0001", Asset: "USD", Currency: "USD", Side: datafabric.Credit, Amount: 100, Category: "provider-net"}}}
}

func insertUnbalancedJournal(ctx context.Context, db *sql.DB, event datafabric.EventEnvelope, now time.Time) error {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck
	_, err = tx.ExecContext(ctx, `INSERT INTO ynx_fabric.journal_entries(entry_id,correlation_id,event_id,effective_at,recorded_at,description,revenue_recognition_boundary,source_commit,source_release,audit_id) VALUES ('journal.unbalanced.live.0001',$1,$2,$3,$3,'unbalanced live test','payment-settled','719e101','data-fabric-live-test','audit.unbalanced.live.0001')`, event.CorrelationID, event.EventID, now)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO ynx_fabric.postings(entry_id,account_id,asset,currency,side,amount_minor,category) VALUES ('journal.unbalanced.live.0001',$1,'USD','USD','debit',100,'refund'),('journal.unbalanced.live.0001','account.provider.live.0001','USD','USD','credit',99,'provider-net')`, event.Actor.AccountID); err != nil {
		return err
	}
	return tx.Commit()
}
