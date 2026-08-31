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
	migrationFiles, migrationErr := MigrationFiles()
	if err != nil || migrationErr != nil || len(applied) != len(migrationFiles) || applied[len(applied)-1].Version != 8 {
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
	if err := insertMismatchedCorrection(ctx, db, entry, time.Now().UTC()); err == nil {
		t.Fatal("deferred PostgreSQL correction trigger accepted a balanced non-reversal")
	}
	reversal := liveReversal(entry, time.Now().UTC())
	if err := store.PostCorrection(ctx, reversal); err != nil {
		t.Fatalf("exact PostgreSQL correction was rejected: %v", err)
	}
	duplicate := reversal
	duplicate.EntryID = "journal.live.reversal.duplicate.0001"
	duplicate.AuditID = "audit.journal.live.reversal.duplicate.0001"
	if err := store.PostCorrection(ctx, duplicate); datafabric.ErrorCodeOf(err) != datafabric.CodeLedgerDuplicateReversal {
		t.Fatalf("duplicate PostgreSQL reversal was accepted: %v", err)
	}
	if err := insertUnbalancedJournal(ctx, db, first, time.Now().UTC()); err == nil {
		t.Fatal("deferred PostgreSQL balance trigger accepted an unbalanced journal")
	}
	usage := liveUsageEvent(t, time.Now().UTC())
	if err := store.Append(ctx, usage, postgresTestKey); err != nil {
		t.Fatalf("canonical usage event was not committed: %v", err)
	}
	plan := datafabric.BillingRatePlan{
		PlanID: "rate-plan.live.0001", Version: "rate-v1.live.0001", Product: "cloud",
		Meter: "compute", Unit: "request", UnitsPerBlock: 100, UserPriceMinor: 10, ProviderCostMinor: 4,
		Asset: "USD", Currency: "USD", ChargeCategory: "compute-data-fee",
		RevenueBoundary: "rated authoritative usage period ended", EffectiveFrom: usage.EffectiveAt.Add(-24 * time.Hour),
		SourceCommit: "719e101", SourceRelease: "data-fabric-live-test", AuditID: "audit.billing.plan.live.0001",
	}
	if err := store.RegisterBillingRatePlan(ctx, plan); err != nil {
		t.Fatalf("immutable PostgreSQL Billing rate was not registered: %v", err)
	}
	if err := store.RegisterBillingRatePlan(ctx, plan); datafabric.ErrorCodeOf(err) != datafabric.CodeBillingRatePlanDuplicate {
		t.Fatalf("duplicate PostgreSQL Billing rate was accepted: %v", err)
	}
	billingRequest := datafabric.BillingSettlementRequest{
		SettlementID: "billing.settlement.live.0001", UsageEventID: usage.EventID,
		RatePlanID: plan.PlanID, RatePlanVersion: plan.Version, JournalEntryID: "journal.billing.live.0001",
		ProviderAccountID: "account.billing.provider.live.0001", ProviderCostAccountID: "account.billing.cost.live.0001",
		ProtocolRevenueAccountID: "account.billing.revenue.live.0001", RecordedAt: usage.Timestamp.Add(time.Second),
		SourceCommit: "719e101", SourceRelease: "data-fabric-live-test", AuditID: "audit.billing.settlement.live.0001",
		FeeConsent: &datafabric.FeeConsent{ConsentID: "consent.billing.live.0001", FeeScheduleVersion: plan.Version, AcceptedAt: usage.Timestamp.Add(-2 * time.Hour), MaximumAmountMinor: 30, Basis: "metered price accepted before usage"},
	}
	billingSettlement, err := store.SettleUsage(ctx, billingRequest)
	if err != nil || billingSettlement.UserChargeMinor != 30 || billingSettlement.ProviderCostMinor != 12 {
		t.Fatalf("PostgreSQL usage Billing settlement failed: %+v %v", billingSettlement, err)
	}
	if _, err := store.SettleUsage(ctx, billingRequest); datafabric.ErrorCodeOf(err) != datafabric.CodeBillingAlreadySettled {
		t.Fatalf("PostgreSQL usage event was billed twice: %v", err)
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
	timeoutSaga, err := datafabric.NewSaga("saga.pay.timeout.live.0001", datafabric.SagaPay, first.AggregateID, first.CorrelationID, "audit.saga.timeout.live.0001", now, now.Add(2*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.StartSaga(ctx, timeoutSaga); err != nil {
		t.Fatal(err)
	}
	if err := store.CompleteSagaStep(ctx, timeoutSaga.SagaID, first.EventID, now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	expired, err := store.ExpireSagas(ctx, now.Add(3*time.Second), 10)
	if err != nil || len(expired) != 1 || expired[0] != timeoutSaga.SagaID {
		t.Fatalf("PostgreSQL Saga timeout scheduler failed: %+v %v", expired, err)
	}
	recoveryTasks, err := store.ClaimSagaRecoveries(ctx, "pay", "worker.pay.live.0001", now.Add(4*time.Second), time.Minute, 10)
	if err != nil || len(recoveryTasks) != 1 || recoveryTasks[0].SagaID != timeoutSaga.SagaID || recoveryTasks[0].Compensation != "void-authorization" {
		t.Fatalf("PostgreSQL Saga recovery claim failed: %+v %v", recoveryTasks, err)
	}
	if err := store.CompleteSagaRecovery(ctx, timeoutSaga.SagaID, recoveryTasks[0].TaskID, recoveryTasks[0].LeaseOwner, second.EventID, now.Add(5*time.Second)); err != nil {
		t.Fatalf("PostgreSQL Saga claimed recovery failed: %v", err)
	}
	recoveredSaga, exists, err := store.Saga(ctx, timeoutSaga.SagaID)
	if err != nil || !exists || recoveredSaga.Status != datafabric.SagaCompensated || recoveredSaga.RecoveryLease != nil {
		t.Fatalf("PostgreSQL Saga recovery truth is invalid: %+v %v", recoveredSaga, err)
	}
	emptyNow := now.Add(10 * time.Second)
	emptyTimeoutSaga, err := datafabric.NewSaga("saga.pay.empty-timeout.live.0001", datafabric.SagaPay, first.AggregateID, first.CorrelationID, "audit.saga.empty-timeout.live.0001", emptyNow, emptyNow.Add(time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.StartSaga(ctx, emptyTimeoutSaga); err != nil {
		t.Fatal(err)
	}
	expired, err = store.ExpireSagas(ctx, emptyNow.Add(2*time.Second), 10)
	if err != nil || len(expired) != 1 || expired[0] != emptyTimeoutSaga.SagaID {
		t.Fatalf("empty PostgreSQL Saga timeout failed: %+v %v", expired, err)
	}
	emptyRecovered, exists, err := store.Saga(ctx, emptyTimeoutSaga.SagaID)
	if err != nil || !exists || emptyRecovered.Status != datafabric.SagaCompensated {
		t.Fatalf("empty PostgreSQL Saga did not auto-recover: %+v %v", emptyRecovered, err)
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
	if err != nil || record.Financial != 3 || record.DerivedAnalyticsDeleted != 1 || len(record.DeletionReceipt) != 64 {
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
	if err != nil || stats.Events != 4 || stats.JournalEntries != 3 || stats.BillingRatePlans != 1 || stats.BillingSettlements != 1 || stats.Reconciliations != 1 || stats.ErasureRequests != 1 {
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

func liveUsageEvent(t *testing.T, now time.Time) datafabric.EventEnvelope {
	t.Helper()
	usageEnd := now.UTC()
	payload, err := json.Marshal(datafabric.MeteredUsage{Meter: "compute", Unit: "request", Quantity: 250, UsageStart: usageEnd.Add(-time.Hour), UsageEnd: usageEnd})
	if err != nil {
		t.Fatal(err)
	}
	event := datafabric.EventEnvelope{
		EventID: "event.cloud.usage.live.0001", EventType: "cloud.usage.recorded",
		SchemaVersion: datafabric.EnvelopeSchemaVersion, Product: "cloud", Service: "usage",
		AggregateID: "usage.cloud.live.0001", Actor: datafabric.Actor{ActorID: "actor.billing.live.0001", AccountID: "account.billing.user.live.0001"},
		CorrelationID: "correlation.billing.live.0001", Sequence: 1, Timestamp: usageEnd, EffectiveAt: usageEnd,
		SourceCommit: "719e101", SourceRelease: "cloud-live-test", PrivacyClassification: "confidential",
		RetentionClass: "financial-7y", AuditID: "audit.event.cloud.usage.live.0001",
		Source:  datafabric.SourceMetadata{Source: "cloud-meter", AsOf: usageEnd, Version: "1", Status: "authoritative"},
		Payload: payload,
	}
	if err := event.Sign("key.datafabric.0001", postgresTestKey); err != nil {
		t.Fatal(err)
	}
	return event
}

func liveJournal(event datafabric.EventEnvelope, now time.Time) datafabric.JournalEntry {
	return datafabric.JournalEntry{EntryID: "journal.live.0001", CorrelationID: event.CorrelationID, EventID: event.EventID, EffectiveAt: now, RecordedAt: now, Description: "live balanced journal", RevenueBoundary: "payment-settled", SourceCommit: "719e101", SourceRelease: "data-fabric-live-test", AuditID: "audit.journal.live.0001", Postings: []datafabric.Posting{{AccountID: event.Actor.AccountID, Asset: "USD", Currency: "USD", Side: datafabric.Debit, Amount: 100, Category: "refund"}, {AccountID: "account.provider.live.0001", Asset: "USD", Currency: "USD", Side: datafabric.Credit, Amount: 100, Category: "provider-net"}}}
}

func liveReversal(original datafabric.JournalEntry, now time.Time) datafabric.JournalEntry {
	reversal := original
	reversal.EntryID = "journal.live.reversal.0001"
	reversal.CorrectionOf = original.EntryID
	reversal.RecordedAt = now.UTC()
	reversal.Description = "exact live reversal"
	reversal.AuditID = "audit.journal.live.reversal.0001"
	reversal.FeeConsent = nil
	reversal.Postings = append([]datafabric.Posting(nil), original.Postings...)
	for index := range reversal.Postings {
		if reversal.Postings[index].Side == datafabric.Debit {
			reversal.Postings[index].Side = datafabric.Credit
		} else {
			reversal.Postings[index].Side = datafabric.Debit
		}
	}
	return reversal
}

func insertMismatchedCorrection(ctx context.Context, db *sql.DB, original datafabric.JournalEntry, now time.Time) error {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck
	_, err = tx.ExecContext(ctx, `INSERT INTO ynx_fabric.journal_entries(entry_id,correlation_id,event_id,effective_at,recorded_at,description,correction_of,revenue_recognition_boundary,source_commit,source_release,audit_id) VALUES ('journal.live.bad-reversal.0001',$1,$2,$3,$3,'balanced but mismatched correction',$4,'payment-settled','719e101','data-fabric-live-test','audit.journal.live.bad-reversal.0001')`, original.CorrelationID, original.EventID, now.UTC(), original.EntryID)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO ynx_fabric.postings(entry_id,account_id,asset,currency,side,amount_minor,category) VALUES ('journal.live.bad-reversal.0001',$1,'USD','USD','credit',99,'refund'),('journal.live.bad-reversal.0001','account.provider.live.0001','USD','USD','debit',99,'provider-net')`, original.Postings[0].AccountID); err != nil {
		return err
	}
	return tx.Commit()
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
