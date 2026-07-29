package datafabric

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
)

type committedEventSchema struct {
	ID                   string                     `json:"$id"`
	AdditionalProperties bool                       `json:"additionalProperties"`
	Required             []string                   `json:"required"`
	Properties           map[string]json.RawMessage `json:"properties"`
}

func TestCommittedEventEnvelopeSchemasMatchRuntimeFields(t *testing.T) {
	v1 := readCommittedEventSchema(t, "event-envelope-v1.schema.json")
	v2 := readCommittedEventSchema(t, "event-envelope-v2.schema.json")

	assertSchemaVersion(t, v1, EnvelopeSchemaVersion)
	assertSchemaVersion(t, v2, EnvelopeSchemaVersionV2)
	if v1.ID == v2.ID || !strings.HasSuffix(v2.ID, "/event-envelope-v2.schema.json") {
		t.Fatalf("v2 schema identity is not independently versioned: v1=%q v2=%q", v1.ID, v2.ID)
	}
	if v1.AdditionalProperties || v2.AdditionalProperties {
		t.Fatal("canonical event envelope schemas must reject unknown fields")
	}

	runtimeFields := eventEnvelopeJSONFields(t)
	for _, field := range runtimeFields {
		if _, ok := v2.Properties[field]; !ok {
			t.Fatalf("v2 schema is missing runtime EventEnvelope field %q", field)
		}
	}
	if len(v2.Properties) != len(runtimeFields) {
		t.Fatalf("v2 schema field count drifted from runtime: schema=%d runtime=%d", len(v2.Properties), len(runtimeFields))
	}

	expectedRequired := []string{
		"eventId", "eventType", "schemaVersion", "producer", "product", "service", "aggregateType", "aggregateId",
		"actor", "actorId", "accountId", "productSessionId", "correlationId", "traceId", "requestId", "sequence",
		"timestamp", "occurredAt", "effectiveAt", "receivedAt", "sourceCommit", "sourceRelease", "integrity",
		"integrityHash", "signature", "privacyClassification", "retentionClass", "residencyClass", "auditId",
		"idempotencyKey", "partitionKey", "orderingKey", "source", "payload", "metadata",
	}
	assertSameStrings(t, "v2 required fields", v2.Required, expectedRequired)

	for _, compatibilityField := range v1.Required {
		if _, ok := v2.Properties[compatibilityField]; !ok {
			t.Fatalf("v2 schema removed v1 compatibility field %q", compatibilityField)
		}
	}
}

func readCommittedEventSchema(t *testing.T, name string) committedEventSchema {
	t.Helper()
	path := filepath.Join("..", "..", "schemas", "data-fabric", name)
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var schema committedEventSchema
	if err := json.Unmarshal(contents, &schema); err != nil {
		t.Fatalf("decode %s: %v", name, err)
	}
	if schema.ID == "" || schema.Properties == nil || schema.Required == nil {
		t.Fatalf("%s is missing canonical schema metadata", name)
	}
	return schema
}

func assertSchemaVersion(t *testing.T, schema committedEventSchema, expected string) {
	t.Helper()
	property, ok := schema.Properties["schemaVersion"]
	if !ok {
		t.Fatal("schemaVersion property is missing")
	}
	var definition struct {
		Const string `json:"const"`
	}
	if err := json.Unmarshal(property, &definition); err != nil {
		t.Fatal(err)
	}
	if definition.Const != expected {
		t.Fatalf("schema version mismatch: got %q want %q", definition.Const, expected)
	}
}

func eventEnvelopeJSONFields(t *testing.T) []string {
	t.Helper()
	typeOfEnvelope := reflect.TypeOf(EventEnvelope{})
	fields := make([]string, 0, typeOfEnvelope.NumField())
	for index := 0; index < typeOfEnvelope.NumField(); index++ {
		tag := typeOfEnvelope.Field(index).Tag.Get("json")
		name := strings.Split(tag, ",")[0]
		if name == "" || name == "-" {
			t.Fatalf("EventEnvelope field %s does not declare a canonical JSON name", typeOfEnvelope.Field(index).Name)
		}
		fields = append(fields, name)
	}
	sort.Strings(fields)
	return fields
}

func assertSameStrings(t *testing.T, label string, actual, expected []string) {
	t.Helper()
	actualCopy := append([]string(nil), actual...)
	expectedCopy := append([]string(nil), expected...)
	sort.Strings(actualCopy)
	sort.Strings(expectedCopy)
	if !reflect.DeepEqual(actualCopy, expectedCopy) {
		t.Fatalf("%s mismatch:\nactual:   %v\nexpected: %v", label, actualCopy, expectedCopy)
	}
}
