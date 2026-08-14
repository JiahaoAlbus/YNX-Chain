package datafabric

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

type CompatibilityMode string

const (
	CompatibilityNone     CompatibilityMode = "none"
	CompatibilityBackward CompatibilityMode = "backward"
	CompatibilityForward  CompatibilityMode = "forward"
	CompatibilityFull     CompatibilityMode = "full"
)

var schemaVersionPattern = regexp.MustCompile(`^[0-9]+\.[0-9]+(?:\.[0-9]+)?$`)

type PayloadField struct {
	Name     string   `json:"name"`
	Type     string   `json:"type"`
	Required bool     `json:"required"`
	Enum     []string `json:"enum,omitempty"`
	Scale    *int     `json:"scale,omitempty"`
}

type EventSchemaDefinition struct {
	EventType                 string            `json:"eventType"`
	Version                   string            `json:"version"`
	Owner                     string            `json:"owner"`
	Product                   string            `json:"product"`
	Producer                  string            `json:"producer"`
	Consumers                 []string          `json:"consumers"`
	CompatibilityMode         CompatibilityMode `json:"compatibilityMode"`
	EffectiveAt               time.Time         `json:"effectiveAt"`
	DeprecatedAt              *time.Time        `json:"deprecatedAt,omitempty"`
	RetiredAt                 *time.Time        `json:"retiredAt,omitempty"`
	Migration                 string            `json:"migration"`
	Rollback                  string            `json:"rollback"`
	SourceCommit              string            `json:"sourceCommit"`
	Release                   string            `json:"release"`
	TestVectors               []string          `json:"testVectors"`
	ExamplePayload            json.RawMessage   `json:"examplePayload"`
	PrivacyClassification     string            `json:"privacyClassification"`
	RetentionClass            string            `json:"retentionClass"`
	ResidencyClass            string            `json:"residencyClass"`
	EnforceDataClassification bool              `json:"enforceDataClassification"`
	ErrorCodes                []ErrorCode       `json:"errorCodes"`
	AllowUnknownPayloadFields bool              `json:"allowUnknownPayloadFields"`
	RequiredEnvelopeFields    []string          `json:"requiredEnvelopeFields"`
	PayloadFields             []PayloadField    `json:"payloadFields"`
}

type SchemaRegistryDocument struct {
	RegistryVersion string                  `json:"registryVersion"`
	GeneratedAt     time.Time               `json:"generatedAt"`
	Definitions     []EventSchemaDefinition `json:"definitions"`
}

type CompatibilityViolation struct {
	Code  ErrorCode `json:"code"`
	Field string    `json:"field,omitempty"`
	Rule  string    `json:"rule"`
}

type CompatibilityReport struct {
	EventType   string                   `json:"eventType"`
	FromVersion string                   `json:"fromVersion"`
	ToVersion   string                   `json:"toVersion"`
	Mode        CompatibilityMode        `json:"mode"`
	Compatible  bool                     `json:"compatible"`
	Violations  []CompatibilityViolation `json:"violations"`
}

type SchemaRegistry struct {
	mu          sync.RWMutex
	version     string
	definitions map[string]map[string]EventSchemaDefinition
}

func NewSchemaRegistry(version string, definitions []EventSchemaDefinition) (*SchemaRegistry, error) {
	if strings.TrimSpace(version) == "" {
		return nil, errors.New("schema registry version is required")
	}
	registry := &SchemaRegistry{version: version, definitions: make(map[string]map[string]EventSchemaDefinition)}
	for _, definition := range definitions {
		if err := registry.register(definition); err != nil {
			return nil, err
		}
	}
	if len(registry.definitions) == 0 {
		return nil, errors.New("schema registry must contain at least one definition")
	}
	return registry, nil
}

func LoadSchemaRegistry(r io.Reader) (*SchemaRegistry, error) {
	decoder := json.NewDecoder(r)
	decoder.DisallowUnknownFields()
	var document SchemaRegistryDocument
	if err := decoder.Decode(&document); err != nil {
		return nil, fmt.Errorf("decode schema registry: %w", err)
	}
	if err := ensureEOF(decoder); err != nil {
		return nil, fmt.Errorf("decode schema registry: %w", err)
	}
	if document.GeneratedAt.IsZero() || document.GeneratedAt.Location() != time.UTC {
		return nil, errors.New("schema registry generatedAt must be UTC")
	}
	return NewSchemaRegistry(document.RegistryVersion, document.Definitions)
}

func (r *SchemaRegistry) Version() string {
	if r == nil {
		return ""
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.version
}

// Document returns a deterministic, complete registry snapshot suitable for
// distribution to producers and consumers. The timestamp is supplied by the
// release process so repeated builds can be reproduced exactly.
func (r *SchemaRegistry) Document(generatedAt time.Time) (SchemaRegistryDocument, error) {
	if r == nil {
		return SchemaRegistryDocument{}, errors.New("schema registry is unavailable")
	}
	if generatedAt.IsZero() || generatedAt.Location() != time.UTC {
		return SchemaRegistryDocument{}, errors.New("schema registry generatedAt must be UTC")
	}
	return SchemaRegistryDocument{
		RegistryVersion: r.Version(),
		GeneratedAt:     generatedAt,
		Definitions:     r.Definitions(""),
	}, nil
}

func (r *SchemaRegistry) MarshalDocument(generatedAt time.Time) ([]byte, error) {
	document, err := r.Document(generatedAt)
	if err != nil {
		return nil, err
	}
	encoded, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("encode schema registry: %w", err)
	}
	return append(encoded, '\n'), nil
}

func (r *SchemaRegistry) Definitions(product string) []EventSchemaDefinition {
	if r == nil {
		return nil
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	var result []EventSchemaDefinition
	for _, versions := range r.definitions {
		for _, definition := range versions {
			if product == "" || definition.Product == product {
				result = append(result, cloneSchemaDefinition(definition))
			}
		}
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].EventType == result[j].EventType {
			return result[i].Version < result[j].Version
		}
		return result[i].EventType < result[j].EventType
	})
	return result
}

func (r *SchemaRegistry) Resolve(eventType, version string, at time.Time) (EventSchemaDefinition, error) {
	if r == nil {
		return EventSchemaDefinition{}, Reject(CodeSchemaVersionUnsupported, "schema registry is unavailable", map[string]string{"eventType": eventType, "schemaVersion": version})
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	versions, exists := r.definitions[eventType]
	if !exists {
		return EventSchemaDefinition{}, Reject(CodeUnknownEventType, "event type is not registered", map[string]string{"eventType": eventType})
	}
	definition, exists := versions[version]
	if !exists {
		return EventSchemaDefinition{}, Reject(CodeSchemaVersionUnsupported, "event schema version is not registered", map[string]string{"eventType": eventType, "schemaVersion": version})
	}
	if at.IsZero() {
		at = time.Now().UTC()
	}
	if at.Before(definition.EffectiveAt) {
		return EventSchemaDefinition{}, Reject(CodeSchemaNotEffective, "event schema version is not effective", map[string]string{"eventType": eventType, "schemaVersion": version, "effectiveAt": definition.EffectiveAt.Format(time.RFC3339Nano)})
	}
	if definition.RetiredAt != nil && !at.Before(*definition.RetiredAt) {
		return EventSchemaDefinition{}, Reject(CodeSchemaRetired, "event schema version is retired", map[string]string{"eventType": eventType, "schemaVersion": version, "retiredAt": definition.RetiredAt.Format(time.RFC3339Nano)})
	}
	return cloneSchemaDefinition(definition), nil
}

func (r *SchemaRegistry) ValidateEnvelope(event EventEnvelope) error {
	definition, err := r.Resolve(event.EventType, event.SchemaVersion, event.Timestamp)
	if err != nil {
		return err
	}
	if definition.Product != event.Product {
		return Reject(CodeSchemaProductMismatch, "event product does not own the registered schema", map[string]string{"eventType": event.EventType, "schemaVersion": event.SchemaVersion, "expectedProduct": definition.Product, "actualProduct": event.Product})
	}
	if definition.EnforceDataClassification && definition.PrivacyClassification != event.PrivacyClassification {
		return Reject(CodeInvalidPrivacyClassification, "event privacy classification differs from the registered schema", map[string]string{"eventType": event.EventType, "expected": definition.PrivacyClassification, "actual": event.PrivacyClassification})
	}
	if definition.EnforceDataClassification && definition.RetentionClass != event.RetentionClass {
		return Reject(CodeInvalidPrivacyClassification, "event retention class differs from the registered schema", map[string]string{"eventType": event.EventType, "expectedRetention": definition.RetentionClass, "actualRetention": event.RetentionClass})
	}
	return validatePayloadAgainstDefinition(event.Payload, definition)
}

func (r *SchemaRegistry) Compatibility(eventType, fromVersion, toVersion string) (CompatibilityReport, error) {
	from, err := r.Resolve(eventType, fromVersion, time.Now().UTC())
	if err != nil {
		return CompatibilityReport{}, err
	}
	to, err := r.Resolve(eventType, toVersion, time.Now().UTC())
	if err != nil {
		return CompatibilityReport{}, err
	}
	return CheckSchemaCompatibility(from, to), nil
}

func CheckSchemaCompatibility(from, to EventSchemaDefinition) CompatibilityReport {
	mode := to.CompatibilityMode
	report := CompatibilityReport{EventType: to.EventType, FromVersion: from.Version, ToVersion: to.Version, Mode: mode}
	if from.EventType != to.EventType || from.Product != to.Product {
		report.Violations = append(report.Violations, CompatibilityViolation{Code: CodeSchemaCompatibilityViolation, Rule: "event type and product ownership cannot change"})
	}
	fromFields := fieldsByName(from.PayloadFields)
	toFields := fieldsByName(to.PayloadFields)
	if from.EventType == to.EventType && from.Version == to.Version {
		report.Compatible = len(report.Violations) == 0
		return report
	}
	checkBackward := mode == CompatibilityBackward || mode == CompatibilityFull
	checkForward := mode == CompatibilityForward || mode == CompatibilityFull
	if mode == CompatibilityNone {
		checkBackward, checkForward = true, true
		report.Violations = append(report.Violations, CompatibilityViolation{
			Code: CodeSchemaCompatibilityViolation,
			Rule: "compatibility mode none provides no cross-version compatibility guarantee",
		})
	}
	fromEnvelopeFields := stringSet(from.RequiredEnvelopeFields)
	toEnvelopeFields := stringSet(to.RequiredEnvelopeFields)
	if checkBackward {
		for field := range toEnvelopeFields {
			if !fromEnvelopeFields[field] {
				report.Violations = append(report.Violations, compatibilityViolation(field, "adding a required envelope field breaks old producers"))
			}
		}
	}
	if checkForward {
		for field := range fromEnvelopeFields {
			if !toEnvelopeFields[field] {
				report.Violations = append(report.Violations, compatibilityViolation(field, "removing a required envelope field breaks old consumers"))
			}
		}
	}
	for name, oldField := range fromFields {
		newField, exists := toFields[name]
		if !exists {
			if checkForward && oldField.Required {
				report.Violations = append(report.Violations, compatibilityViolation(name, "removing a required field breaks old consumers"))
			}
			if checkBackward && !to.AllowUnknownPayloadFields {
				report.Violations = append(report.Violations, compatibilityViolation(name, "removing a field breaks old payloads when unknown fields are rejected"))
			}
			continue
		}
		if oldField.Type != newField.Type || !sameScale(oldField.Scale, newField.Scale) {
			report.Violations = append(report.Violations, compatibilityViolation(name, "field type or numeric scale changed"))
		}
		if checkForward && !oldField.Required && newField.Required {
			report.Violations = append(report.Violations, compatibilityViolation(name, "optional field became required"))
		}
		if checkBackward && !enumContainsAll(newField.Enum, oldField.Enum) {
			report.Violations = append(report.Violations, compatibilityViolation(name, "new schema contracts an existing enum"))
		}
		if checkForward && !enumContainsAll(oldField.Enum, newField.Enum) {
			report.Violations = append(report.Violations, compatibilityViolation(name, "enum expansion is not accepted by old consumers"))
		}
	}
	for name, newField := range toFields {
		if _, exists := fromFields[name]; exists {
			continue
		}
		if checkBackward && newField.Required {
			report.Violations = append(report.Violations, compatibilityViolation(name, "adding a required field breaks old producers"))
		}
		if checkForward && !from.AllowUnknownPayloadFields {
			report.Violations = append(report.Violations, compatibilityViolation(name, "adding a field breaks old consumers when unknown fields are rejected"))
		}
	}
	report.Compatible = len(report.Violations) == 0
	return report
}

func (r *SchemaRegistry) register(definition EventSchemaDefinition) error {
	if err := validateSchemaDefinition(definition); err != nil {
		return err
	}
	versions := r.definitions[definition.EventType]
	if versions == nil {
		versions = make(map[string]EventSchemaDefinition)
		r.definitions[definition.EventType] = versions
	}
	if _, exists := versions[definition.Version]; exists {
		return fmt.Errorf("schema %s version %s is duplicated", definition.EventType, definition.Version)
	}
	for _, existing := range versions {
		if existing.Owner != definition.Owner || existing.Product != definition.Product {
			return fmt.Errorf("schema %s has conflicting owner or product", definition.EventType)
		}
	}
	versions[definition.Version] = cloneSchemaDefinition(definition)
	return nil
}

func validateSchemaDefinition(definition EventSchemaDefinition) error {
	if !typePattern.MatchString(definition.EventType) || !schemaVersionPattern.MatchString(definition.Version) || !slugPattern.MatchString(definition.Product) {
		return errors.New("schema event type, version, or product is invalid")
	}
	if strings.TrimSpace(definition.Owner) == "" || strings.TrimSpace(definition.Producer) == "" || len(definition.Consumers) == 0 || definition.EffectiveAt.IsZero() || definition.EffectiveAt.Location() != time.UTC || !commitPattern.MatchString(definition.SourceCommit) || strings.TrimSpace(definition.Release) == "" {
		return errors.New("schema ownership, lifecycle, and source provenance are required")
	}
	if !oneOf(string(definition.CompatibilityMode), string(CompatibilityNone), string(CompatibilityBackward), string(CompatibilityForward), string(CompatibilityFull)) {
		return errors.New("schema compatibility mode is invalid")
	}
	if definition.DeprecatedAt != nil && (definition.DeprecatedAt.Location() != time.UTC || definition.DeprecatedAt.Before(definition.EffectiveAt)) {
		return errors.New("schema deprecatedAt must be UTC and not precede effectiveAt")
	}
	if definition.RetiredAt != nil && (definition.RetiredAt.Location() != time.UTC || definition.RetiredAt.Before(definition.EffectiveAt) || (definition.DeprecatedAt != nil && definition.RetiredAt.Before(*definition.DeprecatedAt))) {
		return errors.New("schema retiredAt must be UTC and follow lifecycle dates")
	}
	if strings.TrimSpace(definition.Migration) == "" || strings.TrimSpace(definition.Rollback) == "" || len(definition.TestVectors) == 0 || len(definition.ExamplePayload) == 0 || !json.Valid(definition.ExamplePayload) {
		return errors.New("schema migration, rollback, test vectors, and example payload are required")
	}
	if !oneOf(definition.PrivacyClassification, "public", "internal", "confidential", "restricted") || !oneOf(definition.RetentionClass, "transient", "operational", "financial-7y", "audit-7y", "legal-hold") || !oneOf(definition.ResidencyClass, "global", "regional", "account-home", "legal-hold") {
		return errors.New("schema privacy, retention, or residency classification is invalid")
	}
	if len(definition.RequiredEnvelopeFields) == 0 {
		return errors.New("schema required envelope fields are required")
	}
	envelopeFields := map[string]bool{}
	for _, field := range definition.RequiredEnvelopeFields {
		if strings.TrimSpace(field) == "" || envelopeFields[field] {
			return errors.New("schema required envelope fields must be unique")
		}
		envelopeFields[field] = true
	}
	fieldNames := map[string]bool{}
	for _, field := range definition.PayloadFields {
		if strings.TrimSpace(field.Name) == "" || fieldNames[field.Name] || !oneOf(field.Type, "string", "integer", "number", "boolean", "object", "array") {
			return errors.New("schema payload fields must be unique and have supported types")
		}
		fieldNames[field.Name] = true
		if field.Scale != nil && ((field.Type != "number" && field.Type != "integer") || *field.Scale < 0 || *field.Scale > 18) {
			return errors.New("schema numeric scale is invalid")
		}
	}
	return nil
}

func validatePayloadAgainstDefinition(raw json.RawMessage, definition EventSchemaDefinition) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var object map[string]any
	if err := decoder.Decode(&object); err != nil {
		return WrapReject(CodeMissingRequiredField, "event payload is not a JSON object", err, map[string]string{"eventType": definition.EventType, "schemaVersion": definition.Version})
	}
	fields := fieldsByName(definition.PayloadFields)
	for name, field := range fields {
		value, exists := object[name]
		if !exists {
			if field.Required {
				return Reject(CodeMissingRequiredField, "required payload field is missing", map[string]string{"eventType": definition.EventType, "schemaVersion": definition.Version, "field": name})
			}
			continue
		}
		if !payloadTypeMatches(value, field.Type) {
			return Reject(CodeSchemaCompatibilityViolation, "payload field type does not match the registered schema", map[string]string{"eventType": definition.EventType, "schemaVersion": definition.Version, "field": name, "expectedType": field.Type})
		}
		if len(field.Enum) > 0 {
			text, ok := value.(string)
			if !ok || !contains(field.Enum, text) {
				return Reject(CodeSchemaCompatibilityViolation, "payload enum value is not registered", map[string]string{"eventType": definition.EventType, "schemaVersion": definition.Version, "field": name})
			}
		}
	}
	if !definition.AllowUnknownPayloadFields {
		for name := range object {
			if _, exists := fields[name]; !exists {
				return Reject(CodeUnknownField, "payload contains an unknown field", map[string]string{"eventType": definition.EventType, "schemaVersion": definition.Version, "field": name})
			}
		}
	}
	return nil
}

func payloadTypeMatches(value any, expected string) bool {
	switch expected {
	case "string":
		_, ok := value.(string)
		return ok
	case "integer":
		number, ok := value.(json.Number)
		if !ok {
			return false
		}
		_, err := number.Int64()
		return err == nil
	case "number":
		_, ok := value.(json.Number)
		return ok
	case "boolean":
		_, ok := value.(bool)
		return ok
	case "object":
		_, ok := value.(map[string]any)
		return ok
	case "array":
		_, ok := value.([]any)
		return ok
	default:
		return false
	}
}

func fieldsByName(fields []PayloadField) map[string]PayloadField {
	result := make(map[string]PayloadField, len(fields))
	for _, field := range fields {
		result[field.Name] = field
	}
	return result
}

func sameScale(left, right *int) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func enumContainsAll(container, values []string) bool {
	if len(values) == 0 {
		return true
	}
	if len(container) == 0 {
		return false
	}
	for _, value := range values {
		if !contains(container, value) {
			return false
		}
	}
	return true
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func stringSet(values []string) map[string]bool {
	result := make(map[string]bool, len(values))
	for _, value := range values {
		result[value] = true
	}
	return result
}

func compatibilityViolation(field, rule string) CompatibilityViolation {
	return CompatibilityViolation{Code: CodeSchemaCompatibilityViolation, Field: field, Rule: rule}
}

func cloneSchemaDefinition(definition EventSchemaDefinition) EventSchemaDefinition {
	copy := definition
	copy.Consumers = append([]string(nil), definition.Consumers...)
	copy.TestVectors = append([]string(nil), definition.TestVectors...)
	copy.ErrorCodes = append([]ErrorCode(nil), definition.ErrorCodes...)
	copy.RequiredEnvelopeFields = append([]string(nil), definition.RequiredEnvelopeFields...)
	copy.PayloadFields = append([]PayloadField{}, definition.PayloadFields...)
	copy.ExamplePayload = append(json.RawMessage(nil), definition.ExamplePayload...)
	for index := range copy.PayloadFields {
		copy.PayloadFields[index].Enum = append([]string(nil), definition.PayloadFields[index].Enum...)
	}
	return copy
}

// DefaultSchemaRegistry freezes the event types currently accepted by the Data
// Fabric. Product owners may add versions only through a reviewed registry
// document; unknown event types fail closed.
func DefaultSchemaRegistry() *SchemaRegistry {
	effectiveAt := time.Date(2026, 7, 22, 0, 0, 0, 0, time.UTC)
	contracts := map[string][]string{
		"wallet":   {"wallet.session.opened", "wallet.session.revoked", "wallet.session.expired"},
		"pay":      {"pay.invoice.created", "pay.invoice.authorized", "pay.invoice.state_changed", "pay.invoice.settled", "pay.receipt.issued", "pay.refund.completed"},
		"shop":     {"shop.order.created", "shop.inventory.reserved", "shop.payment.captured", "shop.fulfillment.completed"},
		"merchant": {"merchant.webhook.accepted", "merchant.reconciliation.completed", "merchant.settlement.created", "merchant.settlement.completed"},
		"exchange": {"exchange.order.accepted", "exchange.fill.recorded", "exchange.funding.applied", "exchange.fee.posted", "exchange.settlement.completed"},
		"dex":      {"dex.swap.submitted", "dex.swap.finalized", "dex.liquidity.changed", "dex.vault.changed"},
		"quant":    {"quant.mandate.activated", "quant.pnl.recorded", "quant.fee.posted", "quant.kill_switch.activated"},
		"trust":    {"trust.case.opened", "trust.appeal.decided", "trust.correction.published"},
		"resource": {"resource.usage.recorded", "resource.settlement.completed"},
		"cloud":    {"cloud.usage.recorded", "cloud.billing.posted"},
		"ai":       {"ai.usage.recorded", "ai.cost.posted"},
		"mail":     {"mail.delivery.accepted", "mail.delivery.completed", "mail.delivery.failed"},
		"creator":  {"creator.revenue.recognized", "creator.settlement.completed"},
		"capacity": {"capacity.event.recorded"},
		"test":     {"test.event.created"},
	}
	v1EnvelopeFields := []string{"eventId", "eventType", "schemaVersion", "product", "service", "aggregateId", "actor", "correlationId", "sequence", "timestamp", "effectiveAt", "sourceCommit", "sourceRelease", "integrity", "privacyClassification", "retentionClass", "auditId", "source", "payload"}
	v2EnvelopeFields := append(append([]string(nil), v1EnvelopeFields...), "producer", "aggregateType", "actorId", "accountId", "productSessionId", "traceId", "requestId", "occurredAt", "receivedAt", "integrityHash", "signature", "residencyClass", "idempotencyKey", "partitionKey", "orderingKey", "metadata")
	var definitions []EventSchemaDefinition
	for product, eventTypes := range contracts {
		for _, eventType := range eventTypes {
			v1 := EventSchemaDefinition{
				EventType: eventType, Version: EnvelopeSchemaVersion, Owner: "ynx-" + product,
				Product: product, Producer: "ynx-" + product, Consumers: []string{"ynx-data-fabric"},
				CompatibilityMode: CompatibilityFull, EffectiveAt: effectiveAt,
				Migration: "consumer-dual-read-v1-v2", Rollback: "producer-version-pin-to-v1",
				SourceCommit: "719e1018267ed5a53e6fae5211c5fd8a1503c35c", Release: "data-fabric-contract-v1",
				TestVectors: []string{"integration/PRODUCER_TEST_VECTORS.md"}, ExamplePayload: json.RawMessage(`{"status":"recorded"}`),
				PrivacyClassification: "internal", RetentionClass: "operational", ResidencyClass: "global",
				ErrorCodes:                []ErrorCode{CodeUnknownField, CodeMissingRequiredField, CodeDuplicate, CodeOutOfOrder, CodeSequenceGap, CodeTampered, CodeWrongProduct, CodeReplay},
				AllowUnknownPayloadFields: true, RequiredEnvelopeFields: v1EnvelopeFields,
			}
			v2 := cloneSchemaDefinition(v1)
			v2.Version = EnvelopeSchemaVersionV2
			v2.CompatibilityMode = CompatibilityNone
			v2.Migration = "promote-v1-envelope-with-dual-field-consistency"
			v2.Rollback = "consumer-dual-read-and-producer-version-pin-to-v1"
			v2.Release = "data-fabric-contract-v2"
			v2.SourceCommit = "9fc1986067b92f3dd2ea2347223d94e94cc06de9"
			v2.TestVectors = []string{"internal/datafabric/envelope_v2_test.go", "internal/datafabric/schema_registry_test.go"}
			v2.RequiredEnvelopeFields = v2EnvelopeFields
			definitions = append(definitions, v1, v2)
		}
	}
	definitions = append(definitions, calendarSchemaDefinitions(v2EnvelopeFields)...)
	registry, err := NewSchemaRegistry("2.0", definitions)
	if err != nil {
		panic(err)
	}
	return registry
}

type calendarPayloadContract struct {
	fields  []PayloadField
	example json.RawMessage
}

func calendarSchemaDefinitions(requiredEnvelopeFields []string) []EventSchemaDefinition {
	effectiveAt := time.Date(2026, 8, 14, 0, 0, 0, 0, time.UTC)
	stringField := func(name string, required bool, values ...string) PayloadField {
		return PayloadField{Name: name, Type: "string", Required: required, Enum: values}
	}
	withVersion := func(fields ...PayloadField) []PayloadField {
		return append([]PayloadField{{Name: "aggregateVersion", Type: "integer", Required: true}}, fields...)
	}
	contracts := map[string]calendarPayloadContract{
		"calendar.event.created.v1": {
			fields:  withVersion(stringField("operation", true, "create"), stringField("scope", true)),
			example: json.RawMessage(`{"aggregateVersion":1,"operation":"create","scope":"entire_series"}`),
		},
		"calendar.event.updated.v1": {
			fields:  withVersion(stringField("operation", true, "update", "recurrence"), stringField("scope", true)),
			example: json.RawMessage(`{"aggregateVersion":2,"operation":"update","scope":"entire_series"}`),
		},
		"calendar.event.cancelled.v1": {
			fields:  withVersion(stringField("operation", true, "cancel"), stringField("scope", true)),
			example: json.RawMessage(`{"aggregateVersion":3,"operation":"cancel","scope":"entire_series"}`),
		},
		"calendar.invitation.created.v1": {
			fields:  withVersion(stringField("operation", true, "create"), stringField("recipient_ref", true), stringField("invitation_state", true)),
			example: json.RawMessage(`{"aggregateVersion":1,"operation":"create","recipient_ref":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","invitation_state":"pending"}`),
		},
		"calendar.invitation.updated.v1": {
			fields:  withVersion(stringField("operation", true, "update"), stringField("recipient_ref", true), stringField("invitation_state", true)),
			example: json.RawMessage(`{"aggregateVersion":2,"operation":"update","recipient_ref":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","invitation_state":"pending"}`),
		},
		"calendar.invitation.cancelled.v1": {
			fields:  withVersion(stringField("operation", true, "cancel"), stringField("recipient_ref", true), stringField("invitation_state", true)),
			example: json.RawMessage(`{"aggregateVersion":3,"operation":"cancel","recipient_ref":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","invitation_state":"cancelled"}`),
		},
		"calendar.rsvp.updated.v1": {
			fields:  withVersion(stringField("responder_ref", true), stringField("response", true, "yes", "no", "maybe", "pending")),
			example: json.RawMessage(`{"aggregateVersion":2,"responder_ref":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","response":"yes"}`),
		},
		"calendar.share.changed.v1": {
			fields:  withVersion(stringField("recipient_ref", true), stringField("role", false, "viewer", "editor", "availability"), stringField("state", true, "granted", "revoked")),
			example: json.RawMessage(`{"aggregateVersion":2,"recipient_ref":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","role":"viewer","state":"granted"}`),
		},
		"calendar.reminder.due.v1": {
			fields:  withVersion(stringField("reminder_id", true), stringField("occurrence_start", true), stringField("delivery_state", true)),
			example: json.RawMessage(`{"aggregateVersion":2,"reminder_id":"reminder.0001","occurrence_start":"2026-08-14T08:00:00Z","delivery_state":"due"}`),
		},
		"calendar.ai.previewed.v1": {
			fields:  withVersion(stringField("workflow", true), stringField("event_count", true), stringField("provider", true), stringField("model", true), stringField("cost_state", true)),
			example: json.RawMessage(`{"aggregateVersion":1,"workflow":"summarize","event_count":"2","provider":"ynx-ai","model":"qwen3","cost_state":"estimated"}`),
		},
	}
	eventTypes := make([]string, 0, len(contracts))
	for eventType := range contracts {
		eventTypes = append(eventTypes, eventType)
	}
	sort.Strings(eventTypes)
	definitions := make([]EventSchemaDefinition, 0, len(eventTypes))
	for _, eventType := range eventTypes {
		contract := contracts[eventType]
		definitions = append(definitions, EventSchemaDefinition{
			EventType: eventType, Version: EnvelopeSchemaVersionV2, Owner: "36-calendar",
			Product: "calendar", Producer: "ynx-calendar", Consumers: []string{"ynx-data-fabric"},
			CompatibilityMode: CompatibilityNone, EffectiveAt: effectiveAt,
			Migration:    "calendar-outbox-v1-to-data-fabric-envelope-v2",
			Rollback:     "stop-consumption-without-acknowledging-calendar-sequence",
			SourceCommit: "f1305e6b52c7484c099fe6b2f6cbc2b6d36508e2", Release: "calendar-canonical-event-v1",
			TestVectors:    []string{"internal/datafabriccalendar/adapter_test.go", "docs/integration/CROSS_PRODUCT_TEST_VECTORS.json#CAL-X-014"},
			ExamplePayload: contract.example, PrivacyClassification: "restricted", RetentionClass: "operational", ResidencyClass: "account-home",
			EnforceDataClassification: true,
			ErrorCodes:                []ErrorCode{CodeUnknownField, CodeMissingRequiredField, CodeDuplicate, CodeOutOfOrder, CodeSequenceGap, CodeTampered, CodeWrongProduct, CodeReplay},
			AllowUnknownPayloadFields: false, RequiredEnvelopeFields: append([]string(nil), requiredEnvelopeFields...), PayloadFields: contract.fields,
		})
	}
	return definitions
}
