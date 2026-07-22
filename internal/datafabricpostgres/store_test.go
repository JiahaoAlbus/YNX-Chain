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

func TestVerifySchemaAcceptsExactEmbeddedChecksumAndRejectsDrift(t *testing.T) {
	body, err := migrations.ReadFile("migrations/0001_initial.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(body)
	db, connection := openRecordingDB(t)
	connection.schemaChecksum = hex.EncodeToString(digest[:])
	if err := VerifySchema(context.Background(), db); err != nil {
		t.Fatalf("exact schema checksum rejected: %v", err)
	}
	connection.schemaChecksum = strings.Repeat("0", 64)
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
	if err != nil || record.Financial != 1 || record.Operational != 0 {
		t.Fatalf("erasure record failed: record=%+v err=%v", record, err)
	}
	connection.mu.Lock()
	defer connection.mu.Unlock()
	if !connection.committed || len(connection.execs) != 2 || !strings.Contains(connection.execs[0], "erasure_requests") || !strings.Contains(connection.execs[1], "ynx_analytics.event_facts") {
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
	mu               sync.Mutex
	execs            []string
	envelope         []byte
	existingEnvelope []byte
	schemaChecksum   string
	claimed          [][]driver.Value
	journal          *datafabric.JournalEntry
	eventProduct     string
	lastSequence     int64
	begun            int
	committed        bool
	rolledBack       bool
	closed           bool
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
	case strings.Contains(query, "INSERT INTO ynx_fabric.aggregate_sequences"):
		candidate := int64(0)
		if len(arguments) >= 4 {
			switch value := arguments[3].Value.(type) {
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
		return &recordingRows{columns: []string{"exists"}, values: [][]driver.Value{{false}}}, nil
	case strings.Contains(query, "schema_migrations"):
		return &recordingRows{columns: []string{"checksum"}, values: [][]driver.Value{{c.schemaChecksum}}}, nil
	case strings.Contains(query, "WITH selected AS"):
		return &recordingRows{columns: []string{"event_id", "partition_key", "attempt", "available_at", "lease_owner", "lease_until"}, values: c.claimed}, nil
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
