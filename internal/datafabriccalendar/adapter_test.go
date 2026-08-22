package datafabriccalendar

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
)

var integrationKey = []byte("0123456789abcdef0123456789abcdef")

func TestCalendarEventMapsToStrictPrivateV2Envelope(t *testing.T) {
	event, context := validFixture()
	registry := datafabric.DefaultSchemaRegistry()
	envelope, err := MapAndSign(event, context, registry)
	if err != nil {
		t.Fatal(err)
	}
	if envelope.SchemaVersion != datafabric.EnvelopeSchemaVersionV2 || envelope.Product != "calendar" || envelope.Producer != "ynx-calendar" {
		t.Fatalf("unexpected envelope identity: %+v", envelope)
	}
	if envelope.Sequence != event.Sequence || envelope.AggregateID == event.AggregateID || envelope.AuditID == event.AuditID || envelope.IdempotencyKey == event.IdempotencyKey {
		t.Fatal("producer ordering was lost or private source identifiers were not pseudonymized")
	}
	if envelope.ProductSessionID != context.ProductSessionID || envelope.Actor.SessionID != context.ProductSessionID {
		t.Fatal("authenticated transport session was not bound exactly")
	}
	if err := envelope.Verify(integrationKey); err != nil {
		t.Fatalf("mapped envelope signature rejected: %v", err)
	}
	if err := registry.ValidateEnvelope(envelope); err != nil {
		t.Fatalf("mapped envelope registry validation failed: %v", err)
	}
	encoded, _ := json.Marshal(envelope)
	for _, private := range []string{"user-account-raw", "event-source-private", "audit-source-private", "title", "description", "notes", "walletAccount"} {
		if strings.Contains(string(encoded), private) {
			t.Fatalf("private Calendar value leaked into central envelope: %q", private)
		}
	}
	sequence, err := AckSequence(event, envelope)
	if err != nil || sequence != event.Sequence {
		t.Fatalf("durable acceptance did not return exact producer sequence: sequence=%d err=%v", sequence, err)
	}
}

func TestCalendarMappingFailsClosedWithoutSessionOrWithContractDrift(t *testing.T) {
	event, context := validFixture()
	registry := datafabric.DefaultSchemaRegistry()

	missingSession := context
	missingSession.ProductSessionID = ""
	if _, err := MapAndSign(event, missingSession, registry); err == nil || !strings.Contains(err.Error(), "product session") {
		t.Fatalf("missing authenticated product session was accepted: %v", err)
	}

	for name, mutate := range map[string]func(*Event){
		"wrong product":    func(candidate *Event) { candidate.Product = "com.example.calendar" },
		"wrong owner":      func(candidate *Event) { candidate.Owner = "29-integration" },
		"unknown type":     func(candidate *Event) { candidate.Type = "calendar.private.dump.v1" },
		"private field":    func(candidate *Event) { candidate.Payload["title"] = "private" },
		"wrong operation":  func(candidate *Event) { candidate.Payload["operation"] = "delete" },
		"missing sequence": func(candidate *Event) { candidate.Sequence = 0 },
		"raw subject":      func(candidate *Event) { candidate.SubjectHash = "user-account-raw" },
	} {
		t.Run(name, func(t *testing.T) {
			candidate := event
			candidate.Payload = clonePayload(event.Payload)
			mutate(&candidate)
			if _, err := MapAndSign(candidate, context, registry); err == nil {
				t.Fatal("drifted Calendar canonical record was accepted")
			}
		})
	}

	unknownSession := context
	unknownSession.ProductSessionID = "not a canonical session with spaces"
	if _, err := MapAndSign(event, unknownSession, registry); err == nil {
		t.Fatal("invalid central product-session identity was accepted")
	}
}

func TestCalendarMappingIsReplayStableAndDataFabricOrderingSurvivesRestart(t *testing.T) {
	first, context := validFixture()
	registry := datafabric.DefaultSchemaRegistry()
	firstEnvelope, err := MapAndSign(first, context, registry)
	if err != nil {
		t.Fatal(err)
	}
	repeated, err := MapAndSign(first, context, registry)
	if err != nil {
		t.Fatal(err)
	}
	firstJSON, _ := json.Marshal(firstEnvelope)
	repeatedJSON, _ := json.Marshal(repeated)
	if string(firstJSON) != string(repeatedJSON) {
		t.Fatal("identical Calendar event and transport context did not map deterministically")
	}

	storePath := filepath.Join(t.TempDir(), "calendar-data-fabric.json")
	store, err := datafabric.OpenStore(storePath)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Append(firstEnvelope, integrationKey); err != nil {
		t.Fatal(err)
	}
	if err := store.Append(firstEnvelope, integrationKey); !errors.Is(err, datafabric.ErrDuplicate) {
		t.Fatalf("duplicate Calendar event was not rejected: %v", err)
	}

	second := first
	second.ID = "calendar-event-source-0002"
	second.Type = "calendar.event.updated.v1"
	second.Sequence = 2
	second.AggregateVersion = 2
	second.IdempotencyKey = "calendar-idempotency-source-0002"
	second.Payload = map[string]string{"operation": "update", "scope": "entire_series"}
	secondEnvelope, err := MapAndSign(second, context, registry)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Append(secondEnvelope, integrationKey); err != nil {
		t.Fatal(err)
	}
	restarted, err := datafabric.OpenStore(storePath)
	if err != nil {
		t.Fatal(err)
	}
	if len(restarted.Events()) != 2 || restarted.Events()[1].Sequence != 2 {
		t.Fatalf("Calendar ordering did not survive Data Fabric restart: %+v", restarted.Events())
	}
	if _, err := AckSequence(first, secondEnvelope); err == nil {
		t.Fatal("mismatched central acceptance acknowledged the wrong Calendar event")
	}
}

func TestCalendarSchemasAreV2OnlyAndStrict(t *testing.T) {
	registry := datafabric.DefaultSchemaRegistry()
	definitions := registry.Definitions("calendar")
	if len(definitions) != 10 {
		t.Fatalf("unexpected Calendar registry definition count: %d", len(definitions))
	}
	for _, definition := range definitions {
		if definition.Version != datafabric.EnvelopeSchemaVersionV2 || definition.Owner != CalendarOwner || definition.SourceCommit != "f1305e6b52c7484c099fe6b2f6cbc2b6d36508e2" {
			t.Fatalf("Calendar registry provenance drifted: %+v", definition)
		}
		if definition.AllowUnknownPayloadFields || definition.PrivacyClassification != "restricted" || definition.RetentionClass != "operational" || definition.ResidencyClass != "account-home" {
			t.Fatalf("Calendar registry privacy boundary is not strict: %+v", definition)
		}
		if _, err := registry.Resolve(definition.EventType, datafabric.EnvelopeSchemaVersion, time.Now().UTC()); err == nil {
			t.Fatalf("unregistered Calendar v1 envelope was accepted for %s", definition.EventType)
		}
	}
}

func validFixture() (Event, TransportContext) {
	now := time.Date(2026, 8, 14, 1, 0, 0, 0, time.UTC)
	return Event{
			ID: "calendar-event-source-0001", SchemaVersion: CalendarSchemaVersion,
			Type: "calendar.event.created.v1", Product: CalendarProductID, Owner: CalendarOwner,
			SourceCommit: "f1305e6b52c7484c099fe6b2f6cbc2b6d36508e2", Sequence: 1,
			AggregateID: "event-source-private", AggregateVersion: 1,
			SubjectHash: strings.Repeat("a", 64), Authority: "YNX Calendar", SourceStatus: "authoritative", Coverage: 1,
			PrivacyClass: "restricted", RetentionClass: "operational", OccurredAt: now, AsOf: now, RecordedAt: now.Add(time.Second),
			AuditID: "audit-source-private", IdempotencyKey: "calendar-idempotency-source-0001",
			Payload: map[string]string{"operation": "create", "scope": "entire_series"},
		}, TransportContext{
			ProductSessionID: "session.calendar.0001", RequestID: "request.calendar.0001", TraceID: "trace.calendar.0001",
			SourceRelease: "ynx-calendar-f1305e6b", ResidencyClass: "account-home", ReceivedAt: now.Add(2 * time.Second),
			KeyID: "key.calendar.datafabric.0001", SigningKey: integrationKey,
		}
}

func clonePayload(source map[string]string) map[string]string {
	clone := make(map[string]string, len(source))
	for key, value := range source {
		clone[key] = value
	}
	return clone
}
