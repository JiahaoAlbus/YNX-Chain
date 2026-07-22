package datafabric

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var testKey = []byte("0123456789abcdef0123456789abcdef")

func TestEnvelopeStrictValidationIntegrityAndUnknownFields(t *testing.T) {
	event := signedEvent(t, "event.pay.invoice.created.0001", 1)
	encoded, err := json.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := DecodeEnvelopeStrict(bytes.NewReader(encoded))
	if err != nil {
		t.Fatal(err)
	}
	if err := decoded.Verify(testKey); err != nil {
		t.Fatalf("valid signature rejected: %v", err)
	}

	var object map[string]any
	if err := json.Unmarshal(encoded, &object); err != nil {
		t.Fatal(err)
	}
	object["futureField"] = true
	withUnknown, _ := json.Marshal(object)
	if _, err := DecodeEnvelopeStrict(bytes.NewReader(withUnknown)); err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("unknown field was not rejected: %v", err)
	}

	tampered := decoded
	tampered.AggregateID = "invoice.tampered.0001"
	if err := tampered.Verify(testKey); !errors.Is(err, ErrTampered) {
		t.Fatalf("tamper was not detected: %v", err)
	}

	invalidVersion := decoded
	invalidVersion.SchemaVersion = "2.0"
	if err := invalidVersion.Validate(); err == nil || !strings.Contains(err.Error(), "unsupported") {
		t.Fatalf("invalid version was not rejected: %v", err)
	}
}

func TestEnvelopeRejectsSecretsAndPrivateContentButAllowsDigests(t *testing.T) {
	for name, payload := range map[string]string{
		"private key":  `{"privateKey":"not-allowed"}`,
		"nested token": `{"provider":{"access_token":"not-allowed"}}`,
		"mail body":    `{"mailBody":"private message"}`,
		"AI prompt":    `{"prompt":"private question"}`,
		"PEM material": `{"value":"-----BEGIN ` + `PRIVATE KEY-----"}`,
	} {
		event := signedEvent(t, "event.pay.privacy."+strings.ReplaceAll(name, " ", "-")+".0001", 1)
		event.Payload = json.RawMessage(payload)
		if err := event.Sign("key.datafabric.0001", testKey); err == nil {
			t.Fatalf("%s payload was accepted", name)
		}
	}
	event := signedEvent(t, "event.pay.privacy.digest.0001", 1)
	event.Payload = json.RawMessage(`{"contentHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","promptHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","providerReference":"provider.record.0001"}`)
	if err := event.Sign("key.datafabric.0001", testKey); err != nil {
		t.Fatalf("bounded references and digests were rejected: %v", err)
	}
}

func TestTransactionalOutboxInboxOrderingRetryAndRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "fabric.json")
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	first := signedEvent(t, "event.pay.invoice.created.0001", 1)
	if err := store.Append(first, testKey); err != nil {
		t.Fatal(err)
	}
	if err := store.Append(first, testKey); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("duplicate not rejected: %v", err)
	}
	third := signedEvent(t, "event.pay.invoice.paid.0003", 3)
	if err := store.Append(third, testKey); !errors.Is(err, ErrOutOfOrder) {
		t.Fatalf("out of order event not rejected: %v", err)
	}
	second := signedEvent(t, "event.pay.invoice.authorized.0002", 2)
	if err := store.Append(second, testKey); err != nil {
		t.Fatal(err)
	}

	pending := store.PendingOutbox(time.Now().UTC().Add(time.Second), 10)
	if len(pending) != 2 || pending[0].PartitionKey != "pay:invoice:invoice.authority.0001" {
		t.Fatalf("unexpected outbox: %+v", pending)
	}
	if err := store.MarkPublishFailure(first.EventID, "broker unavailable", time.Now().UTC(), 3); err != nil {
		t.Fatal(err)
	}
	if err := store.MarkPublished(second.EventID, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}

	apply := func(event EventEnvelope, projection map[string]string) (string, error) {
		projection[event.AggregateID] = event.EventType
		return event.Integrity.Digest, nil
	}
	applied, err := store.ApplyProjection("billing-ledger.v1", first.EventID, apply)
	if err != nil || !applied {
		t.Fatalf("first projection failed: applied=%t err=%v", applied, err)
	}
	applied, err = store.ApplyProjection("billing-ledger.v1", first.EventID, apply)
	if err != nil || applied {
		t.Fatalf("duplicate projection was not idempotent: applied=%t err=%v", applied, err)
	}

	restarted, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(restarted.Events()) != 2 || restarted.Projection(first.AggregateID) != first.EventType {
		t.Fatalf("restart lost committed state")
	}
}

func TestLedgerBalanceCorrectionsAndRestore(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ledger.json")
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Append(signedEvent(t, "event.pay.invoice.created.0001", 1), testKey); err != nil {
		t.Fatal(err)
	}
	entry := journalEntry("journal.invoice.0001", "")
	if err := store.PostJournal(entry); err != nil {
		t.Fatal(err)
	}
	unbalanced := journalEntry("journal.invoice.0002", "")
	unbalanced.Postings[1].Amount--
	if err := store.PostJournal(unbalanced); err == nil || !strings.Contains(err.Error(), "unbalanced") {
		t.Fatalf("unbalanced entry accepted: %v", err)
	}
	withoutConsent := journalEntry("journal.invoice.no-consent.0001", "")
	withoutConsent.FeeConsent = nil
	if err := store.PostJournal(withoutConsent); err == nil || !strings.Contains(err.Error(), "consent") {
		t.Fatalf("unconsented user charge accepted: %v", err)
	}
	overConsent := journalEntry("journal.invoice.over-consent.0001", "")
	overConsent.FeeConsent.MaximumAmountMinor = 1249
	if err := store.PostJournal(overConsent); err == nil || !strings.Contains(err.Error(), "consent") {
		t.Fatalf("charge above consent accepted: %v", err)
	}
	missing := journalEntry("journal.correction.0001", "journal.missing.0001")
	if err := store.PostJournal(missing); err == nil || !strings.Contains(err.Error(), "unknown") {
		t.Fatalf("unknown correction accepted: %v", err)
	}
	correction := journalEntry("journal.correction.0002", entry.EntryID)
	correction.Description = "Reverse incorrect provider allocation"
	if err := store.PostJournal(correction); err != nil {
		t.Fatal(err)
	}
	if len(store.Journal()) != 2 {
		t.Fatalf("history was overwritten instead of corrected")
	}
	restarted, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := restarted.VerifyLedger(); err != nil {
		t.Fatalf("restored ledger failed integrity: %v", err)
	}
}

func TestStoreFailsClosedOnUnknownPersistentField(t *testing.T) {
	path := filepath.Join(t.TempDir(), "fabric.json")
	if err := os.WriteFile(path, []byte(`{"schemaVersion":1,"events":[],"outbox":[],"inbox":{},"projections":{},"deadLetters":[],"ledger":[],"unknown":true}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenStore(path); err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("unknown persistent field was not rejected: %v", err)
	}
}

func TestRestoreAuditDetectsTamperedPersistentEvent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "fabric.json")
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	event := signedEvent(t, "event.pay.invoice.tamper.0001", 1)
	if err := store.Append(event, testKey); err != nil {
		t.Fatal(err)
	}
	if err := store.AuditIntegrity(map[string][]byte{"key.datafabric.0001": testKey}); err != nil {
		t.Fatalf("valid store failed audit: %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	data = bytes.Replace(data, []byte(`"created"`), []byte(`"settled"`), 1)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	tampered, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := tampered.AuditIntegrity(map[string][]byte{"key.datafabric.0001": testKey}); !errors.Is(err, ErrTampered) {
		t.Fatalf("restore audit did not detect tamper: %v", err)
	}
}

func signedEvent(t *testing.T, id string, sequence uint64) EventEnvelope {
	t.Helper()
	now := time.Date(2026, 7, 22, 12, int(sequence), 0, 0, time.UTC)
	event := EventEnvelope{
		EventID: id, EventType: "pay.invoice.state_changed", SchemaVersion: EnvelopeSchemaVersion,
		Product: "pay", Service: "invoice", AggregateID: "invoice.authority.0001",
		Actor:         Actor{ActorID: "actor.wallet.0001", AccountID: "account.wallet.0001", SessionID: "session.wallet.0001"},
		CorrelationID: "correlation.checkout.0001", CausationID: "command.invoice.0001", Sequence: sequence,
		Timestamp: now, EffectiveAt: now, SourceCommit: "719e1018267ed5a53e6fae5211c5fd8a1503c35c", SourceRelease: "data-fabric-testnet-v0",
		PrivacyClassification: "confidential", RetentionClass: "financial-7y", AuditID: "audit.invoice.0001",
		Source:  SourceMetadata{Source: "ynx-pay", AsOf: now, Version: "v1", Status: "authoritative"},
		Payload: json.RawMessage(`{"status":"created"}`),
	}
	if err := event.Sign("key.datafabric.0001", testKey); err != nil {
		t.Fatal(err)
	}
	return event
}

func journalEntry(id, correctionOf string) JournalEntry {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	return JournalEntry{
		EntryID: id, CorrelationID: "correlation.checkout.0001", EventID: "event.pay.invoice.created.0001",
		EffectiveAt: now, RecordedAt: now, Description: "Provider charge allocation", CorrectionOf: correctionOf,
		RevenueBoundary: "provider service accepted", SourceCommit: "719e1018267ed5a53e6fae5211c5fd8a1503c35c",
		SourceRelease: "data-fabric-testnet-v0", AuditID: "audit.journal.0001",
		FeeConsent: &FeeConsent{ConsentID: "consent.invoice.0001", FeeScheduleVersion: "pay-fees-v1", AcceptedAt: now.Add(-time.Minute), MaximumAmountMinor: 1250, Basis: "invoice total shown before approval"},
		Postings: []Posting{
			{AccountID: "account.wallet.0001", Asset: "USD", Currency: "USD", Side: Debit, Amount: 1250, Category: "user-charge"},
			{AccountID: "account.provider.0001", Asset: "USD", Currency: "USD", Side: Credit, Amount: 1250, Category: "provider-net"},
		},
	}
}
