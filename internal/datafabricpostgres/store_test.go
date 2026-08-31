package datafabricpostgres

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"database/sql/driver"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
)

var fakeDriverSequence atomic.Uint64

func TestPostgresAppendCommitsEventAndOutboxTogether(t *testing.T) {
	db, connection := openRecordingDB(t)
	store, _ := NewStore(db)
	event := postgresTestEvent(t)
	if err := store.Append(context.Background(), event, postgresTestKey); err != nil {
		t.Fatal(err)
	}
	connection.mu.Lock()
	defer connection.mu.Unlock()
	if !connection.committed || connection.rolledBack || len(connection.execs) != 3 {
		t.Fatalf("event and Outbox were not one committed transaction: %+v", connection)
	}
	if !strings.Contains(connection.execs[0], "pg_advisory_xact_lock") || !strings.Contains(connection.execs[1], "ynx_fabric.events") || !strings.Contains(connection.execs[2], "ynx_fabric.outbox") {
		t.Fatalf("unexpected transaction statements: %v", connection.execs)
	}
}

func TestPostgresAppendV2UsesAggregateTypeSequenceDomain(t *testing.T) {
	db, connection := openRecordingDB(t)
	store, _ := NewStore(db)
	event := postgresTestEvent(t)
	event.Actor.SessionID = "session.test.0001"
	if err := event.PromoteToV2(datafabric.V2EnvelopeContext{
		Producer: "ynx-pay", AggregateType: "invoice", TraceID: "trace.test.0001", RequestID: "request.test.0001",
		ResidencyClass: "account-home", IdempotencyKey: "idempotency.test.0001", ReceivedAt: event.Timestamp.Add(time.Second),
		Metadata: map[string]string{"contract": "data-fabric-v2"},
	}); err != nil {
		t.Fatal(err)
	}
	if err := event.Sign("key.datafabric.0001", postgresTestKey); err != nil {
		t.Fatal(err)
	}
	if err := store.Append(context.Background(), event, postgresTestKey); err != nil {
		t.Fatal(err)
	}
	connection.mu.Lock()
	defer connection.mu.Unlock()
	if !connection.committed || len(connection.execs) != 3 || !strings.Contains(connection.execs[1], "aggregate_type") || !strings.Contains(connection.execs[2], "ynx_fabric.outbox") {
		t.Fatalf("v2 event was not committed with aggregate type and Outbox: %+v", connection)
	}
}

func TestPostgresAppendRejectsSequenceGapWhileHoldingPartitionLock(t *testing.T) {
	db, connection := openRecordingDB(t)
	store, _ := NewStore(db)
	connection.lastSequence = 1
	event := postgresTestEvent(t)
	event.Sequence = 3
	event.EventID = "event.pay.invoice.gap.0003"
	event.Timestamp = event.Timestamp.Add(2 * time.Second)
	event.EffectiveAt = event.EffectiveAt.Add(2 * time.Second)
	event.Source.AsOf = event.Source.AsOf.Add(2 * time.Second)
	if err := event.Sign("key.datafabric.0001", postgresTestKey); err != nil {
		t.Fatal(err)
	}
	err := store.Append(context.Background(), event, postgresTestKey)
	if !errors.Is(err, datafabric.ErrOutOfOrder) {
		t.Fatalf("sequence gap was accepted: %v", err)
	}
	connection.mu.Lock()
	defer connection.mu.Unlock()
	if connection.committed || !connection.rolledBack || len(connection.execs) != 1 || !strings.Contains(connection.execs[0], "pg_advisory_xact_lock") {
		t.Fatalf("gap rejection did not hold and roll back the ordering lock: %+v", connection)
	}
}

func TestPostgresAppendDistinguishesDuplicateIdentityFromSequenceReuse(t *testing.T) {
	db, connection := openRecordingDB(t)
	store, _ := NewStore(db)
	event := postgresTestEvent(t)
	connection.existingEnvelope, _ = json.Marshal(event)
	connection.lastSequence = 1
	if err := store.Append(context.Background(), event, postgresTestKey); !errors.Is(err, datafabric.ErrDuplicate) {
		t.Fatalf("same signed event was not classified as duplicate: %v", err)
	}

	tampered := event
	tampered.Payload = json.RawMessage(`{"invoiceId":"different"}`)
	if err := tampered.Sign("key.datafabric.0001", postgresTestKey); err != nil {
		t.Fatal(err)
	}
	if err := store.Append(context.Background(), tampered, postgresTestKey); !errors.Is(err, datafabric.ErrTampered) {
		t.Fatalf("reused identity with different canonical digest was not rejected as tampering: %v", err)
	}
}

func TestPostgresProjectionEffectAndInboxShareTransaction(t *testing.T) {
	db, connection := openRecordingDB(t)
	store, _ := NewStore(db)
	event := postgresTestEvent(t)
	encoded, _ := json.Marshal(event)
	connection.envelope = encoded
	applied, err := store.ApplyProjection(context.Background(), "billing-ledger-test", event.EventID, func(ctx context.Context, tx *sql.Tx, received datafabric.EventEnvelope) (string, error) {
		if received.EventID != event.EventID {
			t.Fatalf("wrong event delivered to projection: %s", received.EventID)
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO projection_effect(event_id) VALUES ($1)`, received.EventID)
		return received.Integrity.Digest, err
	})
	if err != nil || !applied {
		t.Fatalf("transactional projection failed: applied=%t err=%v", applied, err)
	}
	connection.mu.Lock()
	defer connection.mu.Unlock()
	if !connection.committed || len(connection.execs) != 2 || !strings.Contains(connection.execs[0], "projection_effect") || !strings.Contains(connection.execs[1], "ynx_fabric.inbox") {
		t.Fatalf("projection effect and Inbox were not committed together: %+v", connection)
	}
}

func TestPostgresProjectionFailureRollsBackEffectAndInbox(t *testing.T) {
	db, connection := openRecordingDB(t)
	store, _ := NewStore(db)
	event := postgresTestEvent(t)
	connection.envelope, _ = json.Marshal(event)
	want := errors.New("projection rejected")
	applied, err := store.ApplyProjection(context.Background(), "billing-ledger-test", event.EventID, func(ctx context.Context, tx *sql.Tx, _ datafabric.EventEnvelope) (string, error) {
		_, execErr := tx.ExecContext(ctx, `INSERT INTO projection_effect(event_id) VALUES ($1)`, event.EventID)
		if execErr != nil {
			return "", execErr
		}
		return "", want
	})
	if applied || !errors.Is(err, want) {
		t.Fatalf("projection failure was not returned: applied=%t err=%v", applied, err)
	}
	connection.mu.Lock()
	defer connection.mu.Unlock()
	if connection.committed || !connection.rolledBack || len(connection.execs) != 1 || strings.Contains(strings.Join(connection.execs, " "), "ynx_fabric.inbox") {
		t.Fatalf("failed projection did not roll back before Inbox insert: %+v", connection)
	}
}

func TestPostgresProjectionAppliedReadsCommittedInbox(t *testing.T) {
	db, connection := openRecordingDB(t)
	store, _ := NewStore(db)
	connection.inboxExists = true
	applied, err := store.ProjectionApplied(context.Background(), "pay-ledger-reconciliation-v1", "event.pay.refund.completed.0001")
	if err != nil || !applied {
		t.Fatalf("committed Inbox was not detected: applied=%t err=%v", applied, err)
	}
	connection.mu.Lock()
	defer connection.mu.Unlock()
	if connection.begun != 0 || len(connection.execs) != 0 {
		t.Fatalf("Inbox fast path performed a write: %+v", connection)
	}
}

func TestPostgresProjectionComposesJournalReconciliationAndInboxAtomically(t *testing.T) {
	db, connection := openRecordingDB(t)
	store, _ := NewStore(db)
	event := postgresTestEvent(t)
	connection.envelope, _ = json.Marshal(event)
	connection.eventProduct = "pay"
	now := time.Now().UTC()
	entry := datafabric.JournalEntry{
		EntryID: "journal.pay.refund.atomic.0001", CorrelationID: event.CorrelationID, EventID: event.EventID,
		EffectiveAt: now, RecordedAt: now, Description: "Atomic Pay refund", RevenueBoundary: "committed-native-refund",
		Postings: []datafabric.Posting{
			{AccountID: "account.merchant.0001", Asset: "YNXT", Currency: "YNXT", Side: datafabric.Debit, Amount: 5, Category: "refund"},
			{AccountID: "account.payer.0001", Asset: "YNXT", Currency: "YNXT", Side: datafabric.Credit, Amount: 5, Category: "refund"},
		},
		SourceCommit: "719e101", SourceRelease: "data-fabric-test", AuditID: "audit.pay.refund.atomic.0001",
	}
	connection.journal = &entry
	metadata := datafabric.SourceMetadata{Source: "test-authority", AsOf: now, Version: "1", Status: "authoritative"}
	observations := []datafabric.SettlementObservation{
		{Source: "chain", ReferenceID: "transaction.refund.0001", Asset: "YNXT", Currency: "YNXT", AmountMinor: 5, ObservedAt: now, Metadata: metadata, EvidenceHash: strings.Repeat("a", 64)},
		{Source: "pay", ReferenceID: "refund.pay.0001", Asset: "YNXT", Currency: "YNXT", AmountMinor: 5, ObservedAt: now, Metadata: metadata, EvidenceHash: strings.Repeat("b", 64)},
	}
	applied, err := store.ApplyProjection(context.Background(), "pay-ledger-reconciliation-v1", event.EventID, func(ctx context.Context, tx *sql.Tx, _ datafabric.EventEnvelope) (string, error) {
		if err := PostJournalTx(ctx, tx, entry); err != nil {
			return "", err
		}
		run, err := ReconcileJournalTx(ctx, tx, "reconcile.pay.refund.0001", entry.EntryID, "audit.reconcile.pay.0001", "719e101", "data-fabric-test", []string{"chain", "pay"}, observations, now)
		if err != nil {
			return "", err
		}
		if run.Status != "matched" || run.Coverage != 1 {
			return "", errors.New("reconciliation did not match")
		}
		return "effect.pay.refund.atomic.0001", nil
	})
	if err != nil || !applied {
		t.Fatalf("atomic Pay Ledger projection failed: applied=%t err=%v", applied, err)
	}
	connection.mu.Lock()
	defer connection.mu.Unlock()
	joined := strings.Join(connection.execs, "\n")
	for _, required := range []string{"INSERT INTO ynx_fabric.journal_entries", "INSERT INTO ynx_fabric.postings", "INSERT INTO ynx_fabric.reconciliation_runs", "INSERT INTO ynx_fabric.reconciliation_findings", "INSERT INTO ynx_fabric.inbox"} {
		if !strings.Contains(joined, required) {
			t.Fatalf("atomic projection did not execute %q: %s", required, joined)
		}
	}
	if connection.begun != 1 || !connection.committed || connection.rolledBack {
		t.Fatalf("journal, reconciliation, and Inbox were not one transaction: %+v", connection)
	}
}

func TestVerifySchemaAcceptsExactEmbeddedChecksumAndRejectsDrift(t *testing.T) {
	files, err := MigrationFiles()
	if err != nil {
		t.Fatal(err)
	}
	checksums := make(map[int64]string, len(files))
	for _, name := range files {
		body, err := migrations.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(body)
		version, err := migrationVersion(name)
		if err != nil {
			t.Fatal(err)
		}
		checksums[version] = hex.EncodeToString(digest[:])
	}
	db, connection := openRecordingDB(t)
	connection.schemaChecksums = checksums
	if err := VerifySchema(context.Background(), db); err != nil {
		t.Fatalf("exact schema checksum rejected: %v", err)
	}
	connection.schemaChecksums[2] = strings.Repeat("0", 64)
	if err := VerifySchema(context.Background(), db); err == nil || !strings.Contains(err.Error(), "checksum drift") {
		t.Fatalf("schema checksum drift accepted: %v", err)
	}
}

func TestPostgresJournalCommitsHeaderAndAllPostingsTogether(t *testing.T) {
	db, connection := openRecordingDB(t)
	store, _ := NewStore(db)
	now := time.Now().UTC()
	entry := datafabric.JournalEntry{
		EntryID: "journal.test.0001", CorrelationID: "correlation.test.0001", EventID: "event.pay.invoice.created.0001",
		EffectiveAt: now, RecordedAt: now, Description: "test journal", RevenueBoundary: "payment-settled",
		SourceCommit: "719e101", SourceRelease: "data-fabric-test", AuditID: "audit.test.0001",
		Postings: []datafabric.Posting{
			{AccountID: "account.user.0001", Asset: "USD", Currency: "USD", Side: datafabric.Debit, Amount: 100, Category: "refund"},
			{AccountID: "account.cash.0001", Asset: "USD", Currency: "USD", Side: datafabric.Credit, Amount: 100, Category: "provider-net"},
		},
	}
	if err := store.PostJournal(context.Background(), entry); err != nil {
		t.Fatal(err)
	}
	connection.mu.Lock()
	defer connection.mu.Unlock()
	if !connection.committed || len(connection.execs) != 3 || !strings.Contains(connection.execs[0], "journal_entries") || !strings.Contains(connection.execs[1], "postings") || !strings.Contains(connection.execs[2], "postings") {
		t.Fatalf("journal was not committed as header plus all postings: %+v", connection)
	}
}

func TestPostgresUsageBillingCommitsJournalAndSettlementTogether(t *testing.T) {
	db, connection := openRecordingDB(t)
	store, _ := NewStore(db)
	usageEnd := time.Date(2026, 7, 22, 14, 0, 0, 0, time.UTC)
	payload, _ := json.Marshal(datafabric.MeteredUsage{Meter: "compute", Unit: "request", Quantity: 250, UsageStart: usageEnd.Add(-time.Hour), UsageEnd: usageEnd})
	event := datafabric.EventEnvelope{
		EventID: "event.cloud.usage.postgres.0001", EventType: "cloud.usage.recorded",
		SchemaVersion: datafabric.EnvelopeSchemaVersion, Product: "cloud", Service: "usage",
		AggregateID: "usage.cloud.postgres.0001", Actor: datafabric.Actor{ActorID: "actor.billing.postgres.0001", AccountID: "account.billing.user.postgres.0001"},
		CorrelationID: "correlation.billing.postgres.0001", Sequence: 1, Timestamp: usageEnd, EffectiveAt: usageEnd,
		SourceCommit: "719e101", SourceRelease: "cloud-test", PrivacyClassification: "confidential",
		RetentionClass: "financial-7y", AuditID: "audit.event.cloud.usage.postgres.0001",
		Source:  datafabric.SourceMetadata{Source: "cloud-meter", AsOf: usageEnd, Version: "1", Status: "authoritative"},
		Payload: payload,
	}
	if err := event.Sign("key.datafabric.0001", postgresTestKey); err != nil {
		t.Fatal(err)
	}
	connection.existingEnvelope, _ = json.Marshal(event)
	connection.billingPlan = &datafabric.BillingRatePlan{
		PlanID: "rate-plan.postgres.0001", Version: "rate-v1.postgres.0001", Product: "cloud",
		Meter: "compute", Unit: "request", UnitsPerBlock: 100, UserPriceMinor: 10, ProviderCostMinor: 4,
		Asset: "USD", Currency: "USD", ChargeCategory: "compute-data-fee",
		RevenueBoundary: "rated authoritative usage period ended", EffectiveFrom: usageEnd.Add(-24 * time.Hour),
		SourceCommit: "719e101", SourceRelease: "data-fabric-test", AuditID: "audit.billing.plan.postgres.0001",
	}
	request := datafabric.BillingSettlementRequest{
		SettlementID: "billing.settlement.postgres.0001", UsageEventID: event.EventID,
		RatePlanID: connection.billingPlan.PlanID, RatePlanVersion: connection.billingPlan.Version, JournalEntryID: "journal.billing.postgres.0001",
		ProviderAccountID: "account.billing.provider.postgres.0001", ProviderCostAccountID: "account.billing.cost.postgres.0001",
		ProtocolRevenueAccountID: "account.billing.revenue.postgres.0001", RecordedAt: usageEnd.Add(time.Second),
		SourceCommit: "719e101", SourceRelease: "data-fabric-test", AuditID: "audit.billing.settlement.postgres.0001",
		FeeConsent: &datafabric.FeeConsent{ConsentID: "consent.billing.postgres.0001", FeeScheduleVersion: connection.billingPlan.Version, AcceptedAt: usageEnd.Add(-2 * time.Hour), MaximumAmountMinor: 30, Basis: "metered price accepted before usage"},
	}
	settlement, err := store.SettleUsage(context.Background(), request)
	if err != nil || settlement.UserChargeMinor != 30 || settlement.ProviderCostMinor != 12 {
		t.Fatalf("PostgreSQL usage settlement failed: %+v %v", settlement, err)
	}
	connection.mu.Lock()
	defer connection.mu.Unlock()
	if !connection.committed || connection.rolledBack || len(connection.execs) != 6 ||
		!strings.Contains(connection.execs[0], "journal_entries") ||
		!strings.Contains(connection.execs[5], "billing_settlements") {
		t.Fatalf("Billing Journal and settlement were not one committed transaction: %+v", connection)
	}
}

func TestPostgresCorrectionLocksAndAtomicallyReversesJournal(t *testing.T) {
	db, connection := openRecordingDB(t)
	store, _ := NewStore(db)
	now := time.Now().UTC()
	original := datafabric.JournalEntry{
		EntryID: "journal.test.original.0001", CorrelationID: "correlation.test.0001", EventID: "event.pay.invoice.created.0001",
		EffectiveAt: now, RecordedAt: now, Description: "original journal", RevenueBoundary: "payment-settled",
		SourceCommit: "719e101", SourceRelease: "data-fabric-test", AuditID: "audit.test.original.0001",
		Postings: []datafabric.Posting{
			{AccountID: "account.user.0001", Asset: "USD", Currency: "USD", Side: datafabric.Debit, Amount: 100, Category: "refund"},
			{AccountID: "account.cash.0001", Asset: "USD", Currency: "USD", Side: datafabric.Credit, Amount: 100, Category: "provider-net"},
		},
	}
	connection.journal = &original
	reversal := original
	reversal.EntryID = "journal.test.reversal.0001"
	reversal.CorrectionOf = original.EntryID
	reversal.Description = "exact reversal"
	reversal.AuditID = "audit.test.reversal.0001"
	reversal.Postings = append([]datafabric.Posting(nil), original.Postings...)
	reversal.Postings[0].Side = datafabric.Credit
	reversal.Postings[1].Side = datafabric.Debit
	if err := store.PostCorrection(context.Background(), reversal); err != nil {
		t.Fatal(err)
	}
	connection.mu.Lock()
	defer connection.mu.Unlock()
	if !connection.committed || connection.begun != 1 || len(connection.execs) != 3 || !strings.Contains(connection.execs[0], "journal_entries") {
		t.Fatalf("correction header and postings were not one transaction: %+v", connection)
	}
}

func TestPostgresCorrectionRejectsExistingReversalBeforeWrite(t *testing.T) {
	db, connection := openRecordingDB(t)
	store, _ := NewStore(db)
	now := time.Now().UTC()
	original := datafabric.JournalEntry{
		EntryID: "journal.test.original.0002", CorrelationID: "correlation.test.0001", EventID: "event.pay.invoice.created.0001",
		EffectiveAt: now, RecordedAt: now, Description: "original journal", RevenueBoundary: "payment-settled",
		SourceCommit: "719e101", SourceRelease: "data-fabric-test", AuditID: "audit.test.original.0002",
		Postings: []datafabric.Posting{
			{AccountID: "account.user.0001", Asset: "USD", Currency: "USD", Side: datafabric.Debit, Amount: 100, Category: "refund"},
			{AccountID: "account.cash.0001", Asset: "USD", Currency: "USD", Side: datafabric.Credit, Amount: 100, Category: "provider-net"},
		},
	}
	connection.journal = &original
	connection.existingReversal = "journal.test.existing-reversal.0001"
	reversal := original
	reversal.EntryID = "journal.test.reversal.0002"
	reversal.CorrectionOf = original.EntryID
	reversal.AuditID = "audit.test.reversal.0002"
	reversal.Postings = append([]datafabric.Posting(nil), original.Postings...)
	reversal.Postings[0].Side = datafabric.Credit
	reversal.Postings[1].Side = datafabric.Debit
	if err := store.PostCorrection(context.Background(), reversal); datafabric.ErrorCodeOf(err) != datafabric.CodeLedgerDuplicateReversal {
		t.Fatalf("existing PostgreSQL reversal was not rejected: %v", err)
	}
	connection.mu.Lock()
	defer connection.mu.Unlock()
	if connection.committed || len(connection.execs) != 0 {
		t.Fatalf("duplicate reversal reached PostgreSQL writes: %+v", connection)
	}
}

func TestPostgresSagaHeaderAndCanonicalStepsCommitTogether(t *testing.T) {
	db, connection := openRecordingDB(t)
	store, _ := NewStore(db)
	now := time.Now().UTC()
	saga, err := datafabric.NewSaga("saga.pay.test.0001", datafabric.SagaPay, "invoice.authority.0001", "correlation.test.0001", "audit.test.0001", now, now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.StartSaga(context.Background(), saga); err != nil {
		t.Fatal(err)
	}
	connection.mu.Lock()
	defer connection.mu.Unlock()
	if !connection.committed || len(connection.execs) != 1+len(saga.Steps) || !strings.Contains(connection.execs[0], "ynx_fabric.sagas") {
		t.Fatalf("Saga and steps were not committed together: %+v", connection)
	}
	for _, statement := range connection.execs[1:] {
		if !strings.Contains(statement, "ynx_fabric.saga_steps") {
			t.Fatalf("non-step statement in Saga transaction: %s", statement)
		}
	}
}

func TestPostgresDispatcherClaimsPublishesAndAcknowledgesLease(t *testing.T) {
	db, connection := openRecordingDB(t)
	store, _ := NewStore(db)
	event := postgresTestEvent(t)
	connection.envelope, _ = json.Marshal(event)
	now := time.Now().UTC()
	connection.claimed = [][]driver.Value{{event.EventID, event.PartitionKey(), int64(0), now, "worker-a", now.Add(time.Minute)}}
	publisher := &recordingPublisher{}
	dispatcher := Dispatcher{Store: store, Publisher: publisher, Owner: "worker-a", BatchSize: 10, Lease: time.Minute, Now: func() time.Time { return now }}
	report, err := dispatcher.DispatchOnce(context.Background())
	if err != nil || report.Selected != 1 || report.Published != 1 || report.Failed != 0 {
		t.Fatalf("PostgreSQL dispatch failed: report=%+v err=%v", report, err)
	}
	if publisher.topic != "ynx.events."+event.EventType || publisher.partition != event.PartitionKey() {
		t.Fatalf("publisher received wrong routing: %+v", publisher)
	}
	connection.mu.Lock()
	defer connection.mu.Unlock()
	if len(connection.execs) != 1 || !strings.Contains(connection.execs[0], "published_at") {
		t.Fatalf("claimed lease was not acknowledged: %v", connection.execs)
	}
}

func TestPostgresReconciliationRunAndFindingsCommitTogether(t *testing.T) {
	db, connection := openRecordingDB(t)
	store, _ := NewStore(db)
	now := time.Now().UTC()
	entry := datafabric.JournalEntry{
		EntryID: "journal.test.0001", CorrelationID: "correlation.test.0001", EventID: "event.pay.invoice.created.0001",
		EffectiveAt: now, RecordedAt: now, Description: "settled invoice", RevenueBoundary: "payment-settled",
		SourceCommit: "719e101", SourceRelease: "data-fabric-test", AuditID: "audit.test.0001",
		Postings: []datafabric.Posting{
			{AccountID: "account.user.0001", Asset: "USD", Currency: "USD", Side: datafabric.Debit, Amount: 100, Category: "refund"},
			{AccountID: "account.cash.0001", Asset: "USD", Currency: "USD", Side: datafabric.Credit, Amount: 100, Category: "provider-net"},
		},
	}
	connection.journal, connection.eventProduct = &entry, "pay"
	observation := datafabric.SettlementObservation{Source: "chain", ReferenceID: "receipt.chain.0001", Asset: "USD", Currency: "USD", AmountMinor: 100, ObservedAt: now, EvidenceHash: strings.Repeat("a", 64), Metadata: datafabric.SourceMetadata{Source: "chain-testnet", AsOf: now, Version: "1", Status: "authoritative"}}
	run, err := store.ReconcileJournal(context.Background(), "reconcile.test.0001", entry.EntryID, "audit.reconcile.0001", "719e101", "data-fabric-test", []string{"chain"}, []datafabric.SettlementObservation{observation}, now)
	if err != nil || run.Status != "matched" || run.Coverage != 1 {
		t.Fatalf("reconciliation failed: run=%+v err=%v", run, err)
	}
	connection.mu.Lock()
	defer connection.mu.Unlock()
	if !connection.committed || len(connection.execs) != 2 || !strings.Contains(connection.execs[0], "reconciliation_runs") || !strings.Contains(connection.execs[1], "reconciliation_findings") {
		t.Fatalf("run and findings were not committed together: %+v", connection)
	}
}

func TestPostgresErasureCountsAndSuppressionRecordCommitTogether(t *testing.T) {
	db, connection := openRecordingDB(t)
	store, _ := NewStore(db)
	event := postgresTestEvent(t)
	connection.envelope, _ = json.Marshal(event)
	now := time.Now().UTC()
	record, err := store.RecordErasure(context.Background(), event.Actor.AccountID, "audit.erase.0001", postgresTestKey, now)
	if err != nil || record.Financial != 1 || record.Operational != 0 || record.DerivedAnalyticsDeleted != 1 || len(record.DeletionReceipt) != 64 {
		t.Fatalf("erasure record failed: record=%+v err=%v", record, err)
	}
	connection.mu.Lock()
	defer connection.mu.Unlock()
	if !connection.committed || len(connection.execs) != 3 || !strings.Contains(connection.execs[0], "erasure_requests") || !strings.Contains(connection.execs[1], "ynx_analytics.event_facts") || !strings.Contains(connection.execs[2], "erasure_deletion_receipts") {
		t.Fatalf("erasure suppression record was not committed: %+v", connection)
	}
}

func TestPostgresAnalyticsFactAndInboxShareTransaction(t *testing.T) {
	db, connection := openRecordingDB(t)
	store, _ := NewStore(db)
	event := postgresTestEvent(t)
	connection.envelope, _ = json.Marshal(event)
	result, err := store.ApplyAnalyticsEvent(context.Background(), event.EventID, postgresTestKey, event.Timestamp.Add(time.Second))
	if err != nil || !result.Applied || result.Suppressed {
		t.Fatalf("analytics projection failed: %+v %v", result, err)
	}
	connection.mu.Lock()
	defer connection.mu.Unlock()
	if !connection.committed || len(connection.execs) != 2 || !strings.Contains(connection.execs[0], "ynx_analytics.event_facts") || !strings.Contains(connection.execs[1], "ynx_fabric.inbox") {
		t.Fatalf("analytics fact and Inbox were not committed together: %+v", connection)
	}
}

func TestPostgresAnalyticsRetentionSweepIsBoundedAndAudited(t *testing.T) {
	db, connection := openRecordingDB(t)
	store, _ := NewStore(db)
	now := time.Now().UTC()
	connection.retentionTransientDeleted = 3
	connection.retentionOperationalDeleted = 7
	result, err := store.SweepExpiredAnalytics(context.Background(), "audit.retention.0001", now, now.Add(-24*time.Hour), now.Add(-90*24*time.Hour))
	if err != nil || result.TransientDeleted != 3 || result.OperationalDeleted != 7 {
		t.Fatalf("analytics retention sweep failed: result=%+v err=%v", result, err)
	}
	connection.mu.Lock()
	defer connection.mu.Unlock()
	if !connection.committed || connection.rolledBack || len(connection.execs) != 0 {
		t.Fatalf("retention sweep was not a committed query transaction: %+v", connection)
	}
}

func TestPostgresAnalyticsRetentionSweepReplayIsIdempotentAndParameterBound(t *testing.T) {
	db, connection := openRecordingDB(t)
	store, _ := NewStore(db)
	now := time.Now().UTC()
	connection.retentionSweep = &AnalyticsRetentionSweep{
		AuditID: "audit.retention.0003", ExecutedAt: now, TransientBefore: now.Add(-time.Hour), OperationalBefore: now.Add(-2 * time.Hour), TransientDeleted: 3, OperationalDeleted: 7,
	}
	result, err := store.SweepExpiredAnalytics(context.Background(), connection.retentionSweep.AuditID, now, connection.retentionSweep.TransientBefore, connection.retentionSweep.OperationalBefore)
	if err != nil || result.TransientDeleted != 3 || result.OperationalDeleted != 7 {
		t.Fatalf("retention sweep replay was not idempotent: result=%+v err=%v", result, err)
	}
	if _, err := store.SweepExpiredAnalytics(context.Background(), connection.retentionSweep.AuditID, now, now.Add(-3*time.Hour), connection.retentionSweep.OperationalBefore); err == nil {
		t.Fatal("retention sweep replay accepted changed cutoffs")
	}
	connection.mu.Lock()
	defer connection.mu.Unlock()
	if connection.begun != 2 || !connection.rolledBack || len(connection.execs) != 0 {
		t.Fatalf("retention sweep replay wrote another deletion effect: %+v", connection)
	}
}

func TestPostgresAnalyticsRetentionSweepRejectsUnsafeInputBeforeDatabaseAccess(t *testing.T) {
	db, connection := openRecordingDB(t)
	store, _ := NewStore(db)
	now := time.Now().UTC()
	for _, input := range []struct {
		auditID, transient, operational string
	}{
		{auditID: "bad", transient: "past", operational: "past"},
		{auditID: "audit.retention.0002", transient: "future", operational: "past"},
	} {
		transient, operational := now.Add(-time.Hour), now.Add(-time.Hour)
		if input.transient == "future" {
			transient = now.Add(time.Hour)
		}
		if input.operational == "future" {
			operational = now.Add(time.Hour)
		}
		if _, err := store.SweepExpiredAnalytics(context.Background(), input.auditID, now, transient, operational); err == nil {
			t.Fatalf("unsafe retention input accepted: %+v", input)
		}
	}
	connection.mu.Lock()
	defer connection.mu.Unlock()
	if connection.begun != 0 || len(connection.execs) != 0 {
		t.Fatalf("unsafe retention input reached database: %+v", connection)
	}
}

func TestPostgresStoreRejectsInvalidWritesBeforeDatabaseAccess(t *testing.T) {
	db, connection := openRecordingDB(t)
	store, _ := NewStore(db)
	invalid := postgresTestEvent(t)
	invalid.Sequence = 0
	if err := store.Append(context.Background(), invalid, postgresTestKey); err == nil {
		t.Fatal("invalid canonical event accepted")
	}
	if err := store.PostJournal(context.Background(), datafabric.JournalEntry{}); err == nil {
		t.Fatal("invalid journal accepted")
	}
	correction := datafabric.JournalEntry{CorrectionOf: "journal.test.0001"}
	if err := store.PostJournal(context.Background(), correction); datafabric.ErrorCodeOf(err) != datafabric.CodeLedgerCorrectionRouteRequired {
		t.Fatalf("correction bypassed dedicated PostgreSQL route: %v", err)
	}
	connection.mu.Lock()
	defer connection.mu.Unlock()
	if len(connection.execs) != 0 || connection.begun != 0 {
		t.Fatalf("invalid writes reached database: %+v", connection)
	}
}

var postgresTestKey = []byte("0123456789abcdef0123456789abcdef")

func postgresTestEvent(t *testing.T) datafabric.EventEnvelope {
	t.Helper()
	now := time.Now().UTC()
	event := datafabric.EventEnvelope{
		EventID: "event.pay.invoice.created.0001", EventType: "pay.invoice.created", SchemaVersion: datafabric.EnvelopeSchemaVersion,
		Product: "pay", Service: "invoice", AggregateID: "invoice.authority.0001", Actor: datafabric.Actor{ActorID: "actor.test.0001", AccountID: "account.user.0001"},
		CorrelationID: "correlation.test.0001", Sequence: 1, Timestamp: now, EffectiveAt: now,
		SourceCommit: "719e101", SourceRelease: "data-fabric-test", PrivacyClassification: "confidential", RetentionClass: "financial-7y", AuditID: "audit.test.0001",
		Source: datafabric.SourceMetadata{Source: "data-fabric-test", AsOf: now, Version: "1", Status: "authoritative"}, Payload: json.RawMessage(`{"invoiceId":"invoice.authority.0001"}`),
	}
	if err := event.Sign("key.datafabric.0001", postgresTestKey); err != nil {
		t.Fatal(err)
	}
	return event
}

type recordingDriver struct{ connection *recordingConn }

func (d recordingDriver) Open(string) (driver.Conn, error) { return d.connection, nil }

type recordingConn struct {
	mu                          sync.Mutex
	execs                       []string
	envelope                    []byte
	existingEnvelope            []byte
	schemaChecksum              string
	schemaChecksums             map[int64]string
	claimed                     [][]driver.Value
	journal                     *datafabric.JournalEntry
	billingPlan                 *datafabric.BillingRatePlan
	existingReversal            string
	eventProduct                string
	inboxExists                 bool
	lastSequence                int64
	retentionTransientDeleted   int64
	retentionOperationalDeleted int64
	retentionSweep              *AnalyticsRetentionSweep
	begun                       int
	committed                   bool
	rolledBack                  bool
	closed                      bool
}

func (c *recordingConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("Prepare is not supported")
}
func (c *recordingConn) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.closed = true
	return nil
}
func (c *recordingConn) Begin() (driver.Tx, error) {
	return c.BeginTx(context.Background(), driver.TxOptions{})
}
func (c *recordingConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.begun++
	c.committed, c.rolledBack = false, false
	return recordingTx{connection: c}, nil
}
func (c *recordingConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.execs = append(c.execs, compactSQL(query))
	return driver.RowsAffected(1), nil
}
func (c *recordingConn) QueryContext(_ context.Context, query string, arguments []driver.NamedValue) (driver.Rows, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	query = compactSQL(query)
	switch {
	case strings.Contains(query, "FROM ynx_analytics.retention_sweeps"):
		if c.retentionSweep == nil {
			return &recordingRows{columns: []string{"audit_id"}}, nil
		}
		run := c.retentionSweep
		return &recordingRows{columns: []string{"audit_id", "executed_at", "transient_before", "operational_before", "transient_deleted", "operational_deleted"}, values: [][]driver.Value{{run.AuditID, run.ExecutedAt, run.TransientBefore, run.OperationalBefore, int64(run.TransientDeleted), int64(run.OperationalDeleted)}}}, nil
	case strings.Contains(query, "INSERT INTO ynx_analytics.retention_sweeps"):
		return &recordingRows{columns: []string{"transient_deleted", "operational_deleted"}, values: [][]driver.Value{{c.retentionTransientDeleted, c.retentionOperationalDeleted}}}, nil
	case strings.Contains(query, "INSERT INTO ynx_fabric.aggregate_sequences"):
		candidate := int64(0)
		if len(arguments) >= 5 {
			switch value := arguments[4].Value.(type) {
			case int64:
				candidate = value
			case uint64:
				candidate = int64(value)
			}
		}
		if candidate != c.lastSequence+1 || (c.lastSequence == 0 && candidate != 1) {
			return &recordingRows{columns: []string{"last_sequence"}}, nil
		}
		return &recordingRows{columns: []string{"last_sequence"}, values: [][]driver.Value{{candidate}}}, nil
	case strings.Contains(query, "canonical_envelope") && strings.Contains(query, "FOR KEY SHARE"):
		if len(c.existingEnvelope) == 0 {
			return &recordingRows{columns: []string{"canonical_envelope"}}, nil
		}
		return &recordingRows{columns: []string{"canonical_envelope"}, values: [][]driver.Value{{append([]byte(nil), c.existingEnvelope...)}}}, nil
	case strings.Contains(query, "canonical_envelope"):
		return &recordingRows{columns: []string{"canonical_envelope"}, values: [][]driver.Value{{append([]byte(nil), c.envelope...)}}}, nil
	case strings.Contains(query, "SELECT EXISTS"):
		return &recordingRows{columns: []string{"exists"}, values: [][]driver.Value{{c.inboxExists}}}, nil
	case strings.Contains(query, "schema_migrations"):
		checksum := c.schemaChecksum
		if len(arguments) > 0 && c.schemaChecksums != nil {
			version, _ := arguments[0].Value.(int64)
			checksum = c.schemaChecksums[version]
		}
		return &recordingRows{columns: []string{"checksum"}, values: [][]driver.Value{{checksum}}}, nil
	case strings.Contains(query, "WITH selected AS"):
		return &recordingRows{columns: []string{"event_id", "partition_key", "attempt", "available_at", "lease_owner", "lease_until"}, values: c.claimed}, nil
	case strings.Contains(query, "SELECT settlement_id FROM ynx_fabric.billing_settlements"):
		return &recordingRows{columns: []string{"settlement_id"}}, nil
	case strings.Contains(query, "FROM ynx_fabric.billing_rate_plans") && strings.Contains(query, "FOR KEY SHARE"):
		if c.billingPlan == nil {
			return &recordingRows{columns: []string{"plan_id"}}, nil
		}
		plan := c.billingPlan
		return &recordingRows{
			columns: []string{"plan_id", "version", "product", "meter", "unit", "units_per_block", "user_price_minor", "provider_cost_minor", "asset", "currency", "charge_category", "revenue_recognition_boundary", "effective_from", "effective_until", "source_commit", "source_release", "audit_id"},
			values:  [][]driver.Value{{plan.PlanID, plan.Version, plan.Product, plan.Meter, plan.Unit, plan.UnitsPerBlock, plan.UserPriceMinor, plan.ProviderCostMinor, plan.Asset, plan.Currency, plan.ChargeCategory, plan.RevenueBoundary, plan.EffectiveFrom, nil, plan.SourceCommit, plan.SourceRelease, plan.AuditID}},
		}, nil
	case strings.Contains(query, "FROM ynx_fabric.journal_entries WHERE correction_of"):
		if c.existingReversal == "" {
			return &recordingRows{columns: []string{"entry_id"}}, nil
		}
		return &recordingRows{columns: []string{"entry_id"}, values: [][]driver.Value{{c.existingReversal}}}, nil
	case strings.Contains(query, "SELECT entry_id FROM ynx_fabric.journal_entries WHERE entry_id") && strings.Contains(query, "FOR UPDATE"):
		if c.journal == nil {
			return &recordingRows{columns: []string{"entry_id"}}, nil
		}
		return &recordingRows{columns: []string{"entry_id"}, values: [][]driver.Value{{c.journal.EntryID}}}, nil
	case strings.Contains(query, "FROM ynx_fabric.journal_entries WHERE entry_id"):
		if c.journal == nil {
			return &recordingRows{columns: []string{"entry_id"}}, nil
		}
		entry := c.journal
		return &recordingRows{columns: []string{"entry_id", "correlation_id", "event_id", "effective_at", "recorded_at", "description", "correction_of", "revenue_recognition_boundary", "source_commit", "source_release", "audit_id", "fee_consent_id", "fee_schedule_version", "fee_accepted_at", "fee_maximum_amount_minor", "fee_basis"}, values: [][]driver.Value{{entry.EntryID, entry.CorrelationID, entry.EventID, entry.EffectiveAt, entry.RecordedAt, entry.Description, nil, entry.RevenueBoundary, entry.SourceCommit, entry.SourceRelease, entry.AuditID, nil, nil, nil, nil, nil}}}, nil
	case strings.Contains(query, "FROM ynx_fabric.postings WHERE entry_id"):
		var values [][]driver.Value
		if c.journal != nil {
			for _, posting := range c.journal.Postings {
				values = append(values, []driver.Value{posting.AccountID, posting.Asset, posting.Currency, string(posting.Side), posting.Amount, posting.Category})
			}
		}
		return &recordingRows{columns: []string{"account_id", "asset", "currency", "side", "amount_minor", "category"}, values: values}, nil
	case strings.Contains(query, "SELECT product FROM ynx_fabric.events"):
		return &recordingRows{columns: []string{"product"}, values: [][]driver.Value{{c.eventProduct}}}, nil
	default:
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
}

type recordingTx struct{ connection *recordingConn }

func (tx recordingTx) Commit() error {
	tx.connection.mu.Lock()
	defer tx.connection.mu.Unlock()
	tx.connection.committed = true
	return nil
}
func (tx recordingTx) Rollback() error {
	tx.connection.mu.Lock()
	defer tx.connection.mu.Unlock()
	if !tx.connection.committed {
		tx.connection.rolledBack = true
	}
	return nil
}

type recordingRows struct {
	columns []string
	values  [][]driver.Value
	index   int
}

func (r *recordingRows) Columns() []string { return r.columns }
func (r *recordingRows) Close() error      { return nil }
func (r *recordingRows) Next(destination []driver.Value) error {
	if r.index >= len(r.values) {
		return io.EOF
	}
	copy(destination, r.values[r.index])
	r.index++
	return nil
}

func openRecordingDB(t *testing.T) (*sql.DB, *recordingConn) {
	t.Helper()
	connection := &recordingConn{}
	name := fmt.Sprintf("ynx-postgres-recording-%d", fakeDriverSequence.Add(1))
	sql.Register(name, recordingDriver{connection: connection})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })
	return db, connection
}

func compactSQL(query string) string { return strings.Join(strings.Fields(query), " ") }

type recordingPublisher struct {
	topic, partition string
	payload          []byte
}

func (p *recordingPublisher) Publish(_ context.Context, topic, partition string, payload []byte) error {
	p.topic, p.partition, p.payload = topic, partition, append([]byte(nil), payload...)
	return nil
}
