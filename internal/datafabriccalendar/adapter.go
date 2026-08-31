// Package datafabriccalendar translates the Calendar-owned transactional
// outbox record into the centrally accepted Data Fabric v2 envelope. It does
// not read Calendar private state and does not invent a Wallet product session.
package datafabriccalendar

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
)

const (
	CalendarSchemaVersion = "calendar-canonical-event/1.0"
	CalendarProductID     = "com.ynx.calendar"
	CalendarOwner         = "36-calendar"
)

var (
	hexDigestPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)
	commitPattern    = regexp.MustCompile(`^[0-9a-f]{7,64}$`)
	calendarTypes    = map[string]map[string]bool{
		"calendar.event.created.v1":        {"operation": true, "scope": true},
		"calendar.event.updated.v1":        {"operation": true, "scope": true},
		"calendar.event.cancelled.v1":      {"operation": true, "scope": true},
		"calendar.invitation.created.v1":   {"operation": true, "recipient_ref": true, "invitation_state": true},
		"calendar.invitation.updated.v1":   {"operation": true, "recipient_ref": true, "invitation_state": true},
		"calendar.invitation.cancelled.v1": {"operation": true, "recipient_ref": true, "invitation_state": true},
		"calendar.rsvp.updated.v1":         {"responder_ref": true, "response": true},
		"calendar.share.changed.v1":        {"recipient_ref": true, "role": false, "state": true},
		"calendar.reminder.due.v1":         {"reminder_id": true, "occurrence_start": true, "delivery_state": true},
		"calendar.ai.previewed.v1":         {"workflow": true, "event_count": true, "provider": true, "model": true, "cost_state": true},
	}
)

// Event is the public, privacy-bounded Calendar outbox contract. It mirrors the
// producer record without importing Calendar implementation state.
type Event struct {
	ID               string            `json:"id"`
	SchemaVersion    string            `json:"schema_version"`
	Type             string            `json:"type"`
	Product          string            `json:"product"`
	Owner            string            `json:"owner"`
	SourceCommit     string            `json:"source_commit"`
	Sequence         uint64            `json:"sequence"`
	AggregateID      string            `json:"aggregate_id"`
	AggregateVersion int               `json:"aggregate_version"`
	SubjectHash      string            `json:"subject_hash"`
	Authority        string            `json:"authority"`
	SourceStatus     string            `json:"source_status"`
	Coverage         float64           `json:"coverage"`
	PrivacyClass     string            `json:"privacy_class"`
	RetentionClass   string            `json:"retention_class"`
	OccurredAt       time.Time         `json:"occurred_at"`
	AsOf             time.Time         `json:"as_of"`
	RecordedAt       time.Time         `json:"recorded_at"`
	AuditID          string            `json:"audit_id"`
	IdempotencyKey   string            `json:"idempotency_key"`
	Payload          map[string]string `json:"payload"`
}

// TransportContext contains central facts that are unavailable to the durable
// Calendar record. ProductSessionID must come from authenticated Wallet/App
// Gateway introspection; the adapter never fabricates it.
type TransportContext struct {
	ProductSessionID string
	RequestID        string
	TraceID          string
	SourceRelease    string
	ResidencyClass   string
	ReceivedAt       time.Time
	KeyID            string
	SigningKey       []byte
}

// MapAndSign validates Calendar ownership and privacy, binds the authenticated
// transport session, signs the v2 envelope, and checks it against the central
// schema registry. A caller may acknowledge the Calendar sequence only after
// the returned envelope is durably accepted by Data Fabric.
func MapAndSign(event Event, context TransportContext, registry *datafabric.SchemaRegistry) (datafabric.EventEnvelope, error) {
	if registry == nil {
		return datafabric.EventEnvelope{}, errors.New("Calendar Data Fabric registry is unavailable")
	}
	if err := validateEvent(event); err != nil {
		return datafabric.EventEnvelope{}, err
	}
	if strings.TrimSpace(context.ProductSessionID) == "" || strings.TrimSpace(context.RequestID) == "" || strings.TrimSpace(context.TraceID) == "" {
		return datafabric.EventEnvelope{}, errors.New("authenticated product session, request ID, and trace ID are required")
	}
	if strings.TrimSpace(context.SourceRelease) == "" || context.ReceivedAt.IsZero() || context.ReceivedAt.Location() != time.UTC {
		return datafabric.EventEnvelope{}, errors.New("source release and UTC receipt time are required")
	}
	if context.ReceivedAt.Before(event.OccurredAt.Add(-time.Minute)) {
		return datafabric.EventEnvelope{}, errors.New("receipt time materially precedes the Calendar event")
	}

	payload := make(map[string]any, len(event.Payload)+1)
	payload["aggregateVersion"] = event.AggregateVersion
	for key, value := range event.Payload {
		payload[key] = value
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return datafabric.EventEnvelope{}, fmt.Errorf("encode Calendar canonical payload: %w", err)
	}
	aggregateType := strings.Split(event.Type, ".")[1]
	subjectID := "calendar-subject." + event.SubjectHash
	auditID := opaqueID("calendar-audit", event.AuditID)
	envelope := datafabric.EventEnvelope{
		EventID:       opaqueID("calendar-event", event.ID),
		EventType:     event.Type,
		SchemaVersion: datafabric.EnvelopeSchemaVersionV2,
		Producer:      "ynx-calendar",
		Product:       "calendar",
		Service:       "calendar",
		AggregateType: aggregateType,
		AggregateID:   opaqueID("calendar-aggregate", event.AggregateID),
		Actor: datafabric.Actor{
			ActorID:   subjectID,
			AccountID: subjectID,
			SessionID: context.ProductSessionID,
		},
		ActorID:               subjectID,
		AccountID:             subjectID,
		ProductSessionID:      context.ProductSessionID,
		CorrelationID:         auditID,
		TraceID:               context.TraceID,
		RequestID:             context.RequestID,
		Sequence:              event.Sequence,
		Timestamp:             event.OccurredAt,
		OccurredAt:            event.OccurredAt,
		EffectiveAt:           event.AsOf,
		ReceivedAt:            context.ReceivedAt,
		SourceCommit:          event.SourceCommit,
		SourceRelease:         context.SourceRelease,
		PrivacyClassification: "restricted",
		RetentionClass:        "operational",
		ResidencyClass:        context.ResidencyClass,
		AuditID:               auditID,
		IdempotencyKey:        opaqueID("calendar-idempotency", event.IdempotencyKey),
		Source: datafabric.SourceMetadata{
			Source:   event.Authority,
			AsOf:     event.AsOf,
			Version:  event.SchemaVersion,
			Coverage: floatPointer(event.Coverage),
			Status:   event.SourceStatus,
		},
		Payload: encoded,
		Metadata: map[string]string{
			"calendarOwner":        event.Owner,
			"calendarSchema":       event.SchemaVersion,
			"calendarRecordedAt":   event.RecordedAt.Format(time.RFC3339Nano),
			"calendarSourceIdHash": digest(event.ID),
		},
	}
	envelope.Partition = envelope.PartitionKey()
	envelope.OrderingKey = envelope.Partition
	if err := envelope.Sign(context.KeyID, context.SigningKey); err != nil {
		return datafabric.EventEnvelope{}, fmt.Errorf("sign Calendar Data Fabric envelope: %w", err)
	}
	if err := registry.ValidateEnvelope(envelope); err != nil {
		return datafabric.EventEnvelope{}, fmt.Errorf("validate Calendar Data Fabric schema: %w", err)
	}
	return envelope, nil
}

func validateEvent(event Event) error {
	fields, known := calendarTypes[event.Type]
	if !known || event.SchemaVersion != CalendarSchemaVersion || event.Product != CalendarProductID || event.Owner != CalendarOwner {
		return errors.New("Calendar canonical identity, schema, or owner is not accepted")
	}
	if !commitPattern.MatchString(event.SourceCommit) || event.Sequence == 0 || event.AggregateVersion < 1 || strings.TrimSpace(event.ID) == "" || strings.TrimSpace(event.AggregateID) == "" {
		return errors.New("Calendar canonical provenance, sequence, or aggregate is invalid")
	}
	if !hexDigestPattern.MatchString(event.SubjectHash) || strings.TrimSpace(event.AuditID) == "" || strings.TrimSpace(event.IdempotencyKey) == "" {
		return errors.New("Calendar canonical subject, audit, or idempotency binding is invalid")
	}
	if event.Authority != "YNX Calendar" || event.SourceStatus != "authoritative" || event.Coverage != 1 || event.PrivacyClass != "restricted" || event.RetentionClass != "operational" {
		return errors.New("Calendar authority, source, coverage, privacy, or retention is invalid")
	}
	if event.OccurredAt.IsZero() || event.AsOf.IsZero() || event.RecordedAt.IsZero() || event.OccurredAt.Location() != time.UTC || event.AsOf.Location() != time.UTC || event.RecordedAt.Location() != time.UTC {
		return errors.New("Calendar canonical timestamps must be present and UTC")
	}
	if event.AsOf.Before(event.OccurredAt) || event.RecordedAt.Before(event.OccurredAt) {
		return errors.New("Calendar canonical timestamps are out of order")
	}
	for name, required := range fields {
		if required && strings.TrimSpace(event.Payload[name]) == "" {
			return fmt.Errorf("Calendar canonical payload field %s is required", name)
		}
	}
	for name, value := range event.Payload {
		if _, accepted := fields[name]; !accepted || strings.TrimSpace(name) == "" || len(name) > 64 || len(value) > 1024 {
			return fmt.Errorf("Calendar canonical payload field %s is not accepted", name)
		}
	}
	return validateEnums(event)
}

func validateEnums(event Event) error {
	accepted := func(value string, values ...string) bool {
		for _, candidate := range values {
			if value == candidate {
				return true
			}
		}
		return false
	}
	switch event.Type {
	case "calendar.event.created.v1":
		if !accepted(event.Payload["operation"], "create") {
			return errors.New("Calendar create operation is invalid")
		}
	case "calendar.event.updated.v1":
		if !accepted(event.Payload["operation"], "update", "recurrence") {
			return errors.New("Calendar update operation is invalid")
		}
	case "calendar.event.cancelled.v1":
		if !accepted(event.Payload["operation"], "cancel") {
			return errors.New("Calendar cancel operation is invalid")
		}
	case "calendar.invitation.created.v1":
		if !accepted(event.Payload["operation"], "create") {
			return errors.New("Calendar invitation create operation is invalid")
		}
	case "calendar.invitation.updated.v1":
		if !accepted(event.Payload["operation"], "update") {
			return errors.New("Calendar invitation update operation is invalid")
		}
	case "calendar.invitation.cancelled.v1":
		if !accepted(event.Payload["operation"], "cancel") {
			return errors.New("Calendar invitation cancel operation is invalid")
		}
	case "calendar.rsvp.updated.v1":
		if !accepted(event.Payload["response"], "yes", "no", "maybe", "pending") {
			return errors.New("Calendar RSVP response is invalid")
		}
	case "calendar.share.changed.v1":
		if !accepted(event.Payload["state"], "granted", "revoked") {
			return errors.New("Calendar share state is invalid")
		}
		if role := event.Payload["role"]; role != "" && !accepted(role, "viewer", "editor", "availability") {
			return errors.New("Calendar share role is invalid")
		}
	}
	return nil
}

func opaqueID(prefix, value string) string { return prefix + "." + digest(value) }
func digest(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
func floatPointer(value float64) *float64 { return &value }

// AckSequence returns the exact producer sequence eligible for acknowledgement
// after durable central acceptance. It intentionally has no failure fallback.
func AckSequence(event Event, accepted datafabric.EventEnvelope) (uint64, error) {
	if accepted.Sequence != event.Sequence || accepted.EventType != event.Type || accepted.IdempotencyKey != opaqueID("calendar-idempotency", event.IdempotencyKey) {
		return 0, errors.New("central acceptance does not match the Calendar producer record")
	}
	if accepted.Integrity.Digest == "" || accepted.Integrity.Signature == "" {
		return 0, errors.New("unsigned central acceptance cannot acknowledge Calendar")
	}
	return event.Sequence, nil
}
