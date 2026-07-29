package datafabricpgbackup

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabricpostgres"
	_ "github.com/lib/pq"
)

func TestPostgresLiveLogicalBackupRestoreAndIntegrity(t *testing.T) {
	dsn := os.Getenv("YNX_TEST_POSTGRES_DSN")
	pgDump := os.Getenv("YNX_TEST_PG_DUMP")
	pgRestore := os.Getenv("YNX_TEST_PG_RESTORE")
	if dsn == "" || pgDump == "" || pgRestore == "" {
		t.Skip("live PostgreSQL backup test tools are not configured")
	}
	if os.Getenv("YNX_TEST_POSTGRES_ALLOW_DESTRUCTIVE") != "1" {
		t.Fatal("live backup test requires YNX_TEST_POSTGRES_ALLOW_DESTRUCTIVE=1")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
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
		t.Fatalf("refusing destructive backup test against %q", database)
	}
	drop := func() {
		_, _ = db.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS ynx_analytics CASCADE; DROP SCHEMA IF EXISTS ynx_fabric CASCADE`)
	}
	drop()
	t.Cleanup(func() { drop(); _ = db.Close() })
	if _, err := datafabricpostgres.Migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	store, _ := datafabricpostgres.NewStore(db)
	key := []byte("0123456789abcdef0123456789abcdef")
	event := backupLiveEvent(t, key)
	if err := store.Append(ctx, event, key); err != nil {
		t.Fatal(err)
	}
	entry := datafabric.JournalEntry{EntryID: "journal.backup.live.0001", CorrelationID: event.CorrelationID, EventID: event.EventID, EffectiveAt: event.EffectiveAt, RecordedAt: event.Timestamp, Description: "backup restore balance", RevenueBoundary: "payment-settled", SourceCommit: event.SourceCommit, SourceRelease: event.SourceRelease, AuditID: "audit.journal.backup.live.0001", Postings: []datafabric.Posting{{AccountID: event.Actor.AccountID, Asset: "USD", Currency: "USD", Side: datafabric.Debit, Amount: 100, Category: "refund"}, {AccountID: "account.provider.backup.0001", Asset: "USD", Currency: "USD", Side: datafabric.Credit, Amount: 100, Category: "provider-net"}}}
	if err := store.PostJournal(ctx, entry); err != nil {
		t.Fatal(err)
	}
	if result, err := store.ApplyAnalyticsEvent(ctx, event.EventID, key, event.Timestamp.Add(time.Second)); err != nil || !result.Applied {
		t.Fatalf("analytics fixture failed: %+v %v", result, err)
	}
	backupDir := t.TempDir() + "/postgres-backup"
	manifest, err := Create(ctx, db, dsn, pgDump, pgRestore, backupDir, event.SourceCommit, event.SourceRelease, map[string][]byte{event.Integrity.KeyID: key}, true, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if manifest.Counts.Events != 1 || manifest.Counts.JournalEntries != 1 || manifest.Counts.AnalyticsFacts != 1 || manifest.Dump.Bytes == 0 {
		t.Fatalf("backup manifest is incomplete: %+v", manifest)
	}
	t.Logf("verified archive bytes=%d sha256=%s events=%d journal=%d analytics=%d", manifest.Dump.Bytes, manifest.Dump.SHA256, manifest.Counts.Events, manifest.Counts.JournalEntries, manifest.Counts.AnalyticsFacts)
	if _, err := Verify(ctx, backupDir, pgRestore); err != nil {
		t.Fatal(err)
	}
	drop()
	if _, err := Restore(ctx, db, dsn, pgRestore, backupDir, map[string][]byte{event.Integrity.KeyID: key}); err != nil {
		t.Fatal(err)
	}
	restored, _ := datafabricpostgres.NewStore(db)
	loaded, exists, err := restored.Event(ctx, event.EventID)
	if err != nil || !exists || loaded.Integrity.Digest != event.Integrity.Digest {
		t.Fatalf("restored event differs: %+v %t %v", loaded, exists, err)
	}
	journal, exists, err := restored.JournalEntry(ctx, entry.EntryID)
	if err != nil || !exists || len(journal.Postings) != 2 {
		t.Fatalf("restored journal differs: %+v %t %v", journal, exists, err)
	}
	if _, err := Restore(ctx, db, dsn, pgRestore, backupDir, map[string][]byte{event.Integrity.KeyID: key}); err == nil {
		t.Fatal("restore overwrote a non-empty target")
	}
}

func backupLiveEvent(t *testing.T, key []byte) datafabric.EventEnvelope {
	t.Helper()
	now := time.Now().UTC()
	event := datafabric.EventEnvelope{EventID: "event.pay.backup.live.0001", EventType: "pay.invoice.settled", SchemaVersion: datafabric.EnvelopeSchemaVersion, Product: "pay", Service: "invoice", AggregateID: "invoice.backup.live.0001", Actor: datafabric.Actor{ActorID: "actor.backup.live.0001", AccountID: "account.backup.live.0001", SessionID: "session.backup.live.0001"}, CorrelationID: "correlation.backup.live.0001", Sequence: 1, Timestamp: now, EffectiveAt: now, SourceCommit: "719e1018267ed5a53e6fae5211c5fd8a1503c35c", SourceRelease: "data-fabric-backup-live", PrivacyClassification: "confidential", RetentionClass: "financial-7y", AuditID: "audit.backup.live.0001", Source: datafabric.SourceMetadata{Source: "postgres-backup-live-test", AsOf: now, Version: "1", Status: "authoritative"}, Payload: json.RawMessage(`{"status":"settled"}`)}
	if err := event.Sign("key.backup.live.0001", key); err != nil {
		t.Fatal(err)
	}
	return event
}
