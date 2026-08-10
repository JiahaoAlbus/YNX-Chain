package datafabric

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

var privacyTestKey = []byte("abcdef0123456789abcdef0123456789")

func TestSubjectExportAndPseudonymousErasureRetention(t *testing.T) {
	path := t.TempDir() + "/store.json"
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	first := signedEvent(t, "event.pay.privacy.export.0001", 1)
	if err := store.Append(first, testKey); err != nil {
		t.Fatal(err)
	}
	second := signedEvent(t, "event.pay.privacy.export.0002", 2)
	second.RetentionClass = "legal-hold"
	if err := second.Sign("key.datafabric.0001", testKey); err != nil {
		t.Fatal(err)
	}
	if err := store.Append(second, testKey); err != nil {
		t.Fatal(err)
	}

	entry := journalEntry("journal.privacy.0001", "")
	entry.EventID = first.EventID
	entry.Postings[0].AccountID = first.Actor.AccountID
	if err := store.PostJournal(entry); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 7, 22, 20, 0, 0, 0, time.UTC)
	saga, err := NewSaga("saga.privacy.0001", SagaPay, first.AggregateID, first.CorrelationID, "audit.privacy.saga.0001", now, now.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.StartSaga(saga); err != nil {
		t.Fatal(err)
	}

	export, err := store.ExportSubject(first.Actor.AccountID, "data-fabric-testnet-v0", now)
	if err != nil {
		t.Fatal(err)
	}
	if len(export.Events) != 2 || len(export.Journal) != 1 || len(export.Sagas) != 1 || export.AccountID != first.Actor.AccountID || export.Source.Status != "authoritative" {
		t.Fatalf("subject export is incomplete: %+v", export)
	}
	record, err := store.RecordErasure(first.Actor.AccountID, "audit.privacy.erase.0001", privacyTestKey, now)
	if err != nil {
		t.Fatal(err)
	}
	if record.Financial != 1 || record.LegalHold != 1 || record.AccountPseudonym == first.Actor.AccountID || !store.SubjectSuppressed(first.Actor.AccountID, privacyTestKey) {
		t.Fatalf("erasure retention truth is wrong: %+v", record)
	}
	encoded, _ := json.Marshal(record)
	if strings.Contains(string(encoded), first.Actor.AccountID) {
		t.Fatal("erasure record retained the raw account ID")
	}
	if _, err := store.RecordErasure(first.Actor.AccountID, "audit.privacy.erase.0002", privacyTestKey, now.Add(time.Second)); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("duplicate erasure was not idempotent: %v", err)
	}
	restarted, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if !restarted.SubjectSuppressed(first.Actor.AccountID, privacyTestKey) || len(restarted.ErasureRecords()) != 1 {
		t.Fatal("erasure suppression did not survive restart")
	}
	report, err := restarted.ReplayAnalyticsProjection("analytics.product-kpi.v1", 0, 0, privacyTestKey, func(event EventEnvelope, state map[string]string) (string, error) {
		state[event.EventID] = event.EventType
		return event.Integrity.Digest, nil
	})
	if err != nil || report.Scanned != 2 || report.Suppressed != 2 || report.Applied != 0 {
		t.Fatalf("suppressed subject entered analytics replay: %+v %v", report, err)
	}
	if err := restarted.AuditIntegrity(map[string][]byte{"key.datafabric.0001": testKey}); err != nil {
		t.Fatalf("privacy state failed restore audit: %v", err)
	}
}
