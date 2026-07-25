package datafabric

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestDefaultSchemaRegistryResolvesRegisteredType(t *testing.T) {
	registry := DefaultSchemaRegistry()
	definition, err := registry.Resolve("pay.invoice.created", EnvelopeSchemaVersion, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if definition.Product != "pay" || definition.Owner != "ynx-pay" || registry.Version() != "1.0" {
		t.Fatalf("unexpected definition: %+v", definition)
	}
	if _, err := registry.Resolve("pay.invoice.unregistered", EnvelopeSchemaVersion, time.Now().UTC()); ErrorCodeOf(err) != CodeUnknownEventType {
		t.Fatalf("expected unknown event type code, got %v", err)
	}
}

func TestSchemaRegistryRejectsWrongProductAndUnknownPayloadField(t *testing.T) {
	definition := testSchemaDefinition("1.0", CompatibilityFull)
	registry, err := NewSchemaRegistry("test-v1", []EventSchemaDefinition{definition})
	if err != nil {
		t.Fatal(err)
	}
	event := signedEvent(t, "event.schema.registry.0001", 1)
	event.EventType = definition.EventType
	event.Product = "shop"
	event.Payload = json.RawMessage(`{"status":"paid"}`)
	if err := registry.ValidateEnvelope(event); ErrorCodeOf(err) != CodeSchemaProductMismatch {
		t.Fatalf("expected product mismatch, got %v", err)
	}
	event.Product = "pay"
	event.Payload = json.RawMessage(`{"status":"paid","unexpected":true}`)
	if err := registry.ValidateEnvelope(event); ErrorCodeOf(err) != CodeUnknownField {
		t.Fatalf("expected unknown field, got %v", err)
	}
}

func TestSchemaRegistryRequiredFieldAndEnumValidation(t *testing.T) {
	definition := testSchemaDefinition("1.0", CompatibilityFull)
	registry, err := NewSchemaRegistry("test-v1", []EventSchemaDefinition{definition})
	if err != nil {
		t.Fatal(err)
	}
	event := signedEvent(t, "event.schema.payload.0001", 1)
	event.EventType = definition.EventType
	event.Payload = json.RawMessage(`{}`)
	if err := registry.ValidateEnvelope(event); ErrorCodeOf(err) != CodeMissingRequiredField {
		t.Fatalf("expected missing required field, got %v", err)
	}
	event.Payload = json.RawMessage(`{"status":"unknown"}`)
	if err := registry.ValidateEnvelope(event); ErrorCodeOf(err) != CodeSchemaCompatibilityViolation {
		t.Fatalf("expected enum violation, got %v", err)
	}
}

func TestSchemaCompatibilityRequiredAdditionTypeAndEnumExpansion(t *testing.T) {
	from := testSchemaDefinition("1.0", CompatibilityFull)
	to := testSchemaDefinition("2.0", CompatibilityFull)
	to.PayloadFields = append(to.PayloadFields, PayloadField{Name: "currency", Type: "string", Required: true})
	report := CheckSchemaCompatibility(from, to)
	if report.Compatible || len(report.Violations) == 0 {
		t.Fatalf("required addition must be incompatible: %+v", report)
	}

	to = testSchemaDefinition("2.0", CompatibilityFull)
	to.PayloadFields[0].Type = "integer"
	report = CheckSchemaCompatibility(from, to)
	if report.Compatible || !reportHasRule(report, "type") {
		t.Fatalf("type change must be incompatible: %+v", report)
	}

	to = testSchemaDefinition("2.0", CompatibilityForward)
	to.PayloadFields[0].Enum = append(to.PayloadFields[0].Enum, "refunded")
	report = CheckSchemaCompatibility(from, to)
	if report.Compatible || !reportHasRule(report, "enum expansion") {
		t.Fatalf("forward enum expansion must be incompatible: %+v", report)
	}
}

func TestSchemaCompatibilityBackwardOptionalAddition(t *testing.T) {
	from := testSchemaDefinition("1.0", CompatibilityFull)
	to := testSchemaDefinition("2.0", CompatibilityBackward)
	to.PayloadFields = append(to.PayloadFields, PayloadField{Name: "memo", Type: "string"})
	report := CheckSchemaCompatibility(from, to)
	if !report.Compatible || len(report.Violations) != 0 {
		t.Fatalf("optional additive backward migration should be compatible: %+v", report)
	}
}

func TestLoadSchemaRegistryRejectsUnknownDocumentField(t *testing.T) {
	document := `{"registryVersion":"1.0","generatedAt":"2026-07-22T00:00:00Z","definitions":[],"unknown":true}`
	_, err := LoadSchemaRegistry(strings.NewReader(document))
	if err == nil {
		t.Fatal("expected strict registry decoder to reject unknown field")
	}
}

func TestErrorCodePreservesSentinel(t *testing.T) {
	err := WrapReject(CodeSequenceGap, "gap", ErrOutOfOrder, map[string]string{"expected": "2", "actual": "4"})
	if !errors.Is(err, ErrOutOfOrder) || ErrorCodeOf(err) != CodeSequenceGap || ErrorEvidenceOf(err)["actual"] != "4" {
		t.Fatalf("unexpected coded error: %v", err)
	}
}

func testSchemaDefinition(version string, mode CompatibilityMode) EventSchemaDefinition {
	return EventSchemaDefinition{
		EventType: "pay.invoice.created", Version: version, Owner: "ynx-pay", Product: "pay", Producer: "ynx-pay",
		Consumers: []string{"ynx-data-fabric"}, CompatibilityMode: mode,
		EffectiveAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		Migration:   "migrate", Rollback: "rollback", SourceCommit: "719e1018267ed5a53e6fae5211c5fd8a1503c35c", Release: "test",
		TestVectors: []string{"vector-1"}, ExamplePayload: json.RawMessage(`{"status":"pending"}`),
		PrivacyClassification: "confidential", RetentionClass: "financial-7y", ResidencyClass: "global", EnforceDataClassification: true,
		ErrorCodes: []ErrorCode{CodeUnknownField}, AllowUnknownPayloadFields: false,
		PayloadFields: []PayloadField{{Name: "status", Type: "string", Required: true, Enum: []string{"pending", "paid"}}},
	}
}

func reportHasRule(report CompatibilityReport, fragment string) bool {
	for _, violation := range report.Violations {
		if strings.Contains(violation.Rule, fragment) {
			return true
		}
	}
	return false
}
