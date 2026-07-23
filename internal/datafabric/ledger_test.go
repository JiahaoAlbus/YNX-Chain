package datafabric

import (
	"testing"
	"time"
)

func TestLedgerRejectsUnbalancedEntry(t *testing.T) {
	store := setupLedgerFixture(t)
	now := time.Date(2026, 7, 22, 14, 0, 0, 0, time.UTC)
	entry := JournalEntry{
		EntryID: "journal.test.0001", CorrelationID: "correlation.test.0001", EventID: store.state.Events[0].EventID,
		EffectiveAt: now, RecordedAt: now, Description: "Test entry", RevenueBoundary: "test",
		Postings: []Posting{
			{AccountID: "account.test.0001", Asset: "YNX", Currency: "YNX", Side: Debit, Amount: 1000, Category: "protocol-revenue"},
			{AccountID: "account.test.0002", Asset: "YNX", Currency: "YNX", Side: Credit, Amount: 900, Category: "protocol-revenue"},
		},
		SourceCommit: "719e101", SourceRelease: "test-v0", AuditID: "audit.test.0001",
	}
	err := store.PostJournal(entry)
	if err == nil || err.Error() != "journal is unbalanced for \"YNX\\x00YNX\" by 100 minor units" {
		t.Fatalf("expected unbalanced rejection, got: %v", err)
	}
}

func TestLedgerRequiresFeeConsentForUserCharge(t *testing.T) {
	store := setupLedgerFixture(t)
	now := time.Date(2026, 7, 22, 14, 0, 0, 0, time.UTC)
	entry := JournalEntry{
		EntryID: "journal.test.0002", CorrelationID: "correlation.test.0001", EventID: store.state.Events[0].EventID,
		EffectiveAt: now, RecordedAt: now, Description: "User charge without consent", RevenueBoundary: "test",
		Postings: []Posting{
			{AccountID: "account.user.0001", Asset: "YNX", Currency: "YNX", Side: Debit, Amount: 100, Category: "user-charge"},
			{AccountID: "account.protocol.revenue", Asset: "YNX", Currency: "YNX", Side: Credit, Amount: 100, Category: "protocol-revenue"},
		},
		SourceCommit: "719e101", SourceRelease: "test-v0", AuditID: "audit.test.0001",
	}
	err := store.PostJournal(entry)
	if err == nil || err.Error() != "user charge or fee requires prior bounded consent and fee schedule" {
		t.Fatalf("expected consent requirement, got: %v", err)
	}
}

func TestLedgerAcceptsValidFeeConsent(t *testing.T) {
	store := setupLedgerFixture(t)
	now := time.Date(2026, 7, 22, 14, 0, 0, 0, time.UTC)
	consentTime := now.Add(-time.Hour)
	entry := JournalEntry{
		EntryID: "journal.test.0003", CorrelationID: "correlation.test.0001", EventID: store.state.Events[0].EventID,
		EffectiveAt: now, RecordedAt: now, Description: "User charge with consent", RevenueBoundary: "test",
		Postings: []Posting{
			{AccountID: "account.user.0001", Asset: "YNX", Currency: "YNX", Side: Debit, Amount: 100, Category: "user-charge"},
			{AccountID: "account.protocol.revenue", Asset: "YNX", Currency: "YNX", Side: Credit, Amount: 100, Category: "protocol-revenue"},
		},
		FeeConsent: &FeeConsent{
			ConsentID: "consent.user.0001", FeeScheduleVersion: "v1.0", AcceptedAt: consentTime,
			MaximumAmountMinor: 200, Basis: "per-transaction",
		},
		SourceCommit: "719e101", SourceRelease: "test-v0", AuditID: "audit.test.0001",
	}
	if err := store.PostJournal(entry); err != nil {
		t.Fatalf("valid consent rejected: %v", err)
	}
}

func TestLedgerRejectsConsentExceedingMaximum(t *testing.T) {
	store := setupLedgerFixture(t)
	now := time.Date(2026, 7, 22, 14, 0, 0, 0, time.UTC)
	consentTime := now.Add(-time.Hour)
	entry := JournalEntry{
		EntryID: "journal.test.0004", CorrelationID: "correlation.test.0001", EventID: store.state.Events[0].EventID,
		EffectiveAt: now, RecordedAt: now, Description: "Charge exceeds consent", RevenueBoundary: "test",
		Postings: []Posting{
			{AccountID: "account.user.0001", Asset: "YNX", Currency: "YNX", Side: Debit, Amount: 300, Category: "user-charge"},
			{AccountID: "account.protocol.revenue", Asset: "YNX", Currency: "YNX", Side: Credit, Amount: 300, Category: "protocol-revenue"},
		},
		FeeConsent: &FeeConsent{
			ConsentID: "consent.user.0001", FeeScheduleVersion: "v1.0", AcceptedAt: consentTime,
			MaximumAmountMinor: 200, Basis: "per-transaction",
		},
		SourceCommit: "719e101", SourceRelease: "test-v0", AuditID: "audit.test.0001",
	}
	err := store.PostJournal(entry)
	if err == nil {
		t.Fatal("expected consent maximum exceeded rejection")
	}
}

func TestLedgerRejectsConsentAfterRecorded(t *testing.T) {
	store := setupLedgerFixture(t)
	now := time.Date(2026, 7, 22, 14, 0, 0, 0, time.UTC)
	futureConsent := now.Add(time.Hour)
	entry := JournalEntry{
		EntryID: "journal.test.0005", CorrelationID: "correlation.test.0001", EventID: store.state.Events[0].EventID,
		EffectiveAt: now, RecordedAt: now, Description: "Future consent", RevenueBoundary: "test",
		Postings: []Posting{
			{AccountID: "account.user.0001", Asset: "YNX", Currency: "YNX", Side: Debit, Amount: 100, Category: "user-charge"},
			{AccountID: "account.protocol.revenue", Asset: "YNX", Currency: "YNX", Side: Credit, Amount: 100, Category: "protocol-revenue"},
		},
		FeeConsent: &FeeConsent{
			ConsentID: "consent.user.0001", FeeScheduleVersion: "v1.0", AcceptedAt: futureConsent,
			MaximumAmountMinor: 200, Basis: "per-transaction",
		},
		SourceCommit: "719e101", SourceRelease: "test-v0", AuditID: "audit.test.0001",
	}
	err := store.PostJournal(entry)
	if err == nil {
		t.Fatal("expected future consent rejection")
	}
}

func TestLedgerRejectsConsentForNonUserAccount(t *testing.T) {
	store := setupLedgerFixture(t)
	now := time.Date(2026, 7, 22, 14, 0, 0, 0, time.UTC)
	consentTime := now.Add(-time.Hour)
	entry := JournalEntry{
		EntryID: "journal.test.0006", CorrelationID: "correlation.test.0001", EventID: store.state.Events[0].EventID,
		EffectiveAt: now, RecordedAt: now, Description: "Wrong account consent", RevenueBoundary: "test",
		Postings: []Posting{
			{AccountID: "account.other.0001", Asset: "YNX", Currency: "YNX", Side: Debit, Amount: 100, Category: "user-charge"},
			{AccountID: "account.protocol.revenue", Asset: "YNX", Currency: "YNX", Side: Credit, Amount: 100, Category: "protocol-revenue"},
		},
		FeeConsent: &FeeConsent{
			ConsentID: "consent.user.0001", FeeScheduleVersion: "v1.0", AcceptedAt: consentTime,
			MaximumAmountMinor: 200, Basis: "per-transaction",
		},
		SourceCommit: "719e101", SourceRelease: "test-v0", AuditID: "audit.test.0001",
	}
	err := store.PostJournal(entry)
	if err == nil {
		t.Fatal("expected account mismatch rejection")
	}
}

func TestLedgerCorrectionReferencesOriginal(t *testing.T) {
	store := setupLedgerFixture(t)
	now := time.Date(2026, 7, 22, 14, 0, 0, 0, time.UTC)
	original := JournalEntry{
		EntryID: "journal.test.0007", CorrelationID: "correlation.test.0001", EventID: store.state.Events[0].EventID,
		EffectiveAt: now, RecordedAt: now, Description: "Original entry", RevenueBoundary: "test",
		Postings: []Posting{
			{AccountID: "account.test.0001", Asset: "YNX", Currency: "YNX", Side: Debit, Amount: 1000, Category: "protocol-revenue"},
			{AccountID: "account.test.0002", Asset: "YNX", Currency: "YNX", Side: Credit, Amount: 1000, Category: "protocol-revenue"},
		},
		SourceCommit: "719e101", SourceRelease: "test-v0", AuditID: "audit.test.0001",
	}
	if err := store.PostJournal(original); err != nil {
		t.Fatal(err)
	}
	correction := JournalEntry{
		EntryID: "journal.test.0008", CorrelationID: "correlation.test.0001", EventID: store.state.Events[0].EventID,
		EffectiveAt: now, RecordedAt: now, Description: "Correction", RevenueBoundary: "test", CorrectionOf: "journal.test.0007",
		Postings: []Posting{
			{AccountID: "account.test.0001", Asset: "YNX", Currency: "YNX", Side: Credit, Amount: 1000, Category: "protocol-revenue"},
			{AccountID: "account.test.0002", Asset: "YNX", Currency: "YNX", Side: Debit, Amount: 1000, Category: "protocol-revenue"},
		},
		SourceCommit: "719e101", SourceRelease: "test-v0", AuditID: "audit.test.0002",
	}
	if err := store.PostJournal(correction); err != nil {
		t.Fatalf("valid correction rejected: %v", err)
	}
	journal := store.Journal()
	if len(journal) != 2 {
		t.Fatalf("expected both original and correction, got %d entries", len(journal))
	}
}

func TestLedgerRejectsCorrectionOfNonexistent(t *testing.T) {
	store := setupLedgerFixture(t)
	now := time.Date(2026, 7, 22, 14, 0, 0, 0, time.UTC)
	correction := JournalEntry{
		EntryID: "journal.test.0009", CorrelationID: "correlation.test.0001", EventID: store.state.Events[0].EventID,
		EffectiveAt: now, RecordedAt: now, Description: "Invalid correction", RevenueBoundary: "test", CorrectionOf: "journal.nonexistent",
		Postings: []Posting{
			{AccountID: "account.test.0001", Asset: "YNX", Currency: "YNX", Side: Debit, Amount: 1000, Category: "protocol-revenue"},
			{AccountID: "account.test.0002", Asset: "YNX", Currency: "YNX", Side: Credit, Amount: 1000, Category: "protocol-revenue"},
		},
		SourceCommit: "719e101", SourceRelease: "test-v0", AuditID: "audit.test.0001",
	}
	err := store.PostJournal(correction)
	if err == nil || err.Error() != "correction references an unknown journal entry" {
		t.Fatalf("expected correction rejection, got: %v", err)
	}
}

func TestLedgerVerifyIntegrity(t *testing.T) {
	store := setupLedgerFixture(t)
	now := time.Date(2026, 7, 22, 14, 0, 0, 0, time.UTC)
	entry := JournalEntry{
		EntryID: "journal.test.0010", CorrelationID: "correlation.test.0001", EventID: store.state.Events[0].EventID,
		EffectiveAt: now, RecordedAt: now, Description: "Integrity test", RevenueBoundary: "test",
		Postings: []Posting{
			{AccountID: "account.test.0001", Asset: "YNX", Currency: "YNX", Side: Debit, Amount: 500, Category: "protocol-revenue"},
			{AccountID: "account.test.0002", Asset: "YNX", Currency: "YNX", Side: Credit, Amount: 500, Category: "protocol-revenue"},
		},
		SourceCommit: "719e101", SourceRelease: "test-v0", AuditID: "audit.test.0001",
	}
	if err := store.PostJournal(entry); err != nil {
		t.Fatal(err)
	}
	if err := store.VerifyLedger(); err != nil {
		t.Fatalf("ledger integrity check failed: %v", err)
	}
}

func setupLedgerFixture(t *testing.T) *Store {
	t.Helper()
	store, err := OpenStore(t.TempDir() + "/store.json")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 7, 22, 13, 0, 0, 0, time.UTC)
	event := EventEnvelope{
		EventID: "event.test.0001", EventType: "test.event.created", SchemaVersion: EnvelopeSchemaVersion,
		Product: "test", Service: "test", AggregateID: "aggregate.test.0001",
		Actor:         Actor{ActorID: "actor.test.0001", AccountID: "account.user.0001", SessionID: "session.test.0001"},
		CorrelationID: "correlation.test.0001", Sequence: 1,
		Timestamp: now, EffectiveAt: now, SourceCommit: "719e101", SourceRelease: "test-v0",
		PrivacyClassification: "confidential", RetentionClass: "operational", AuditID: "audit.test.0001",
		Source:  SourceMetadata{Source: "test", AsOf: now, Version: "v1", Status: "authoritative"},
		Payload: []byte(`{"test":true}`),
	}
	key := []byte("abcdef0123456789abcdef0123456789")
	if err := event.Sign("key.test.0001", key); err != nil {
		t.Fatal(err)
	}
	if err := store.Append(event, key); err != nil {
		t.Fatal(err)
	}
	return store
}
