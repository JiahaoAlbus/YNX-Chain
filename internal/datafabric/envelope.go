// Package datafabric provides the canonical cross-product event and financial
// record primitives. It deliberately contains no product-specific authority.
package datafabric

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"
)

const (
	EnvelopeSchemaVersion   = "1.0"
	EnvelopeSchemaVersionV2 = "2.0"
)

var (
	ErrDuplicate             = errors.New("data fabric: duplicate event")
	ErrOutOfOrder            = errors.New("data fabric: event is out of order")
	ErrTampered              = errors.New("data fabric: event integrity check failed")
	idPattern                = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$`)
	slugPattern              = regexp.MustCompile(`^[a-z][a-z0-9-]{1,63}$`)
	typePattern              = regexp.MustCompile(`^[a-z][a-z0-9]*(\.[a-z][a-z0-9_-]*){2,7}$`)
	commitPattern            = regexp.MustCompile(`^[0-9a-f]{7,64}$`)
	chainCommitmentIDPattern = regexp.MustCompile(`^[0-9a-f]{32}$`)
)

type Actor struct {
	ActorID   string `json:"actorId"`
	AccountID string `json:"accountId,omitempty"`
	SessionID string `json:"sessionId,omitempty"`
}

type SourceMetadata struct {
	Source     string    `json:"source"`
	AsOf       time.Time `json:"asOf"`
	Version    string    `json:"version"`
	Confidence *float64  `json:"confidence,omitempty"`
	Coverage   *float64  `json:"coverage,omitempty"`
	Status     string    `json:"status"`
	Failure    string    `json:"failure,omitempty"`
}

type Integrity struct {
	Algorithm string `json:"algorithm"`
	KeyID     string `json:"keyId"`
	Digest    string `json:"digest"`
	Signature string `json:"signature"`
}

type EventEnvelope struct {
	EventID               string            `json:"eventId"`
	EventType             string            `json:"eventType"`
	SchemaVersion         string            `json:"schemaVersion"`
	Producer              string            `json:"producer,omitempty"`
	Product               string            `json:"product"`
	Service               string            `json:"service"`
	AggregateType         string            `json:"aggregateType,omitempty"`
	AggregateID           string            `json:"aggregateId"`
	Actor                 Actor             `json:"actor"`
	ActorID               string            `json:"actorId,omitempty"`
	AccountID             string            `json:"accountId,omitempty"`
	ProductSessionID      string            `json:"productSessionId,omitempty"`
	CorrelationID         string            `json:"correlationId"`
	CausationID           string            `json:"causationId,omitempty"`
	TraceID               string            `json:"traceId,omitempty"`
	RequestID             string            `json:"requestId,omitempty"`
	Sequence              uint64            `json:"sequence"`
	Timestamp             time.Time         `json:"timestamp"`
	OccurredAt            time.Time         `json:"occurredAt,omitempty"`
	EffectiveAt           time.Time         `json:"effectiveAt"`
	ReceivedAt            time.Time         `json:"receivedAt,omitempty"`
	SourceCommit          string            `json:"sourceCommit"`
	SourceRelease         string            `json:"sourceRelease"`
	Integrity             Integrity         `json:"integrity"`
	IntegrityHash         string            `json:"integrityHash,omitempty"`
	Signature             string            `json:"signature,omitempty"`
	PrivacyClassification string            `json:"privacyClassification"`
	RetentionClass        string            `json:"retentionClass"`
	ResidencyClass        string            `json:"residencyClass,omitempty"`
	AuditID               string            `json:"auditId"`
	ChainCommitmentID     string            `json:"chainCommitmentId,omitempty"`
	IdempotencyKey        string            `json:"idempotencyKey,omitempty"`
	Partition             string            `json:"partitionKey,omitempty"`
	OrderingKey           string            `json:"orderingKey,omitempty"`
	Source                SourceMetadata    `json:"source"`
	Payload               json.RawMessage   `json:"payload"`
	Metadata              map[string]string `json:"metadata,omitempty"`
}

// PartitionKey is the canonical aggregate-ordering key. Service is included so
// two bounded contexts cannot accidentally share an ordering sequence merely
// because they reuse an aggregate identifier.
func (e EventEnvelope) PartitionKey() string {
	if e.SchemaVersion == EnvelopeSchemaVersionV2 && e.AggregateType != "" {
		return e.Product + ":" + e.Service + ":" + e.AggregateType + ":" + e.AggregateID
	}
	return e.Product + ":" + e.Service + ":" + e.AggregateID
}

type V2EnvelopeContext struct {
	Producer          string
	AggregateType     string
	TraceID           string
	RequestID         string
	ResidencyClass    string
	ChainCommitmentID string
	IdempotencyKey    string
	ReceivedAt        time.Time
	Metadata          map[string]string
}

// PromoteToV2 creates the canonical v2 bindings while retaining the v1 fields
// during the migration window. Call Sign after promotion so both integrity
// representations are committed by one digest.
func (e *EventEnvelope) PromoteToV2(context V2EnvelopeContext) error {
	if e == nil {
		return errors.New("event envelope is required")
	}
	e.SchemaVersion = EnvelopeSchemaVersionV2
	e.Producer = context.Producer
	e.AggregateType = context.AggregateType
	e.ActorID = e.Actor.ActorID
	e.AccountID = e.Actor.AccountID
	e.ProductSessionID = e.Actor.SessionID
	e.TraceID = context.TraceID
	e.RequestID = context.RequestID
	e.OccurredAt = e.Timestamp
	e.ReceivedAt = context.ReceivedAt.UTC()
	e.ResidencyClass = context.ResidencyClass
	e.ChainCommitmentID = context.ChainCommitmentID
	e.IdempotencyKey = context.IdempotencyKey
	e.Metadata = cloneEvidence(context.Metadata)
	e.Partition = e.PartitionKey()
	e.OrderingKey = e.Partition
	return nil
}

func DecodeEnvelopeStrict(r io.Reader) (EventEnvelope, error) {
	var event EventEnvelope
	decoder := json.NewDecoder(r)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&event); err != nil {
		return EventEnvelope{}, fmt.Errorf("decode canonical event: %w", err)
	}
	if err := ensureEOF(decoder); err != nil {
		return EventEnvelope{}, err
	}
	if err := event.Validate(); err != nil {
		return EventEnvelope{}, err
	}
	return event, nil
}

func ensureEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("decode canonical event: multiple JSON values")
		}
		return fmt.Errorf("decode canonical event trailer: %w", err)
	}
	return nil
}

func (e EventEnvelope) Validate() error {
	if e.SchemaVersion == "" {
		return Reject(CodeMissingRequiredField, "schemaVersion is required", map[string]string{"field": "schemaVersion"})
	}
	if e.SchemaVersion != EnvelopeSchemaVersion && e.SchemaVersion != EnvelopeSchemaVersionV2 {
		return Reject(CodeUnsupportedVersion, "event schema version is unsupported", map[string]string{"schemaVersion": e.SchemaVersion})
	}
	for name, value := range map[string]string{
		"eventId": e.EventID, "aggregateId": e.AggregateID, "actor.actorId": e.Actor.ActorID,
		"correlationId": e.CorrelationID, "auditId": e.AuditID,
	} {
		if !idPattern.MatchString(value) {
			return fmt.Errorf("%s is not a canonical identifier", name)
		}
	}
	if !slugPattern.MatchString(e.Product) || !slugPattern.MatchString(e.Service) {
		return errors.New("product and service must be canonical lower-case slugs")
	}
	if e.CausationID != "" && !idPattern.MatchString(e.CausationID) {
		return errors.New("causationId is not a canonical identifier")
	}
	if e.Actor.AccountID != "" && !idPattern.MatchString(e.Actor.AccountID) {
		return errors.New("actor.accountId is not a canonical identifier")
	}
	if e.Actor.SessionID != "" && !idPattern.MatchString(e.Actor.SessionID) {
		return errors.New("actor.sessionId is not a canonical identifier")
	}
	if !typePattern.MatchString(e.EventType) {
		return errors.New("eventType must be a namespaced lower-case event name")
	}
	if e.Sequence == 0 {
		return errors.New("sequence must be greater than zero")
	}
	if e.Timestamp.IsZero() || e.EffectiveAt.IsZero() || e.Source.AsOf.IsZero() {
		return errors.New("timestamp, effectiveAt, and source.asOf are required")
	}
	if e.Timestamp.Location() != time.UTC || e.EffectiveAt.Location() != time.UTC || e.Source.AsOf.Location() != time.UTC {
		return errors.New("event timestamps must use UTC")
	}
	if !commitPattern.MatchString(e.SourceCommit) || strings.TrimSpace(e.SourceRelease) == "" {
		return errors.New("sourceCommit and sourceRelease are required")
	}
	if !oneOf(e.PrivacyClassification, "public", "internal", "confidential", "restricted") {
		return errors.New("privacyClassification is invalid")
	}
	if !oneOf(e.RetentionClass, "transient", "operational", "financial-7y", "audit-7y", "legal-hold") {
		return errors.New("retentionClass is invalid")
	}
	if strings.TrimSpace(e.Source.Source) == "" || strings.TrimSpace(e.Source.Version) == "" || !oneOf(e.Source.Status, "authoritative", "third-party", "estimated", "ai-inferred", "cached", "user-input", "unavailable") {
		return errors.New("source metadata is incomplete or invalid")
	}
	if e.Source.Status == "unavailable" && strings.TrimSpace(e.Source.Failure) == "" {
		return errors.New("unavailable source requires a failure reason")
	}
	for name, value := range map[string]*float64{"confidence": e.Source.Confidence, "coverage": e.Source.Coverage} {
		if value != nil && (*value < 0 || *value > 1) {
			return fmt.Errorf("source.%s must be between zero and one", name)
		}
	}
	if len(e.Payload) == 0 || !json.Valid(e.Payload) {
		return errors.New("payload must be valid JSON")
	}
	if err := validatePayloadPrivacy(e.Payload); err != nil {
		return err
	}
	if e.Integrity.Algorithm != "hmac-sha256" || !idPattern.MatchString(e.Integrity.KeyID) {
		return errors.New("integrity algorithm or keyId is invalid")
	}
	if e.ChainCommitmentID != "" {
		if e.SchemaVersion != EnvelopeSchemaVersionV2 {
			return Reject(CodeInvalidVersion, "chainCommitmentId is supported only by Envelope v2", map[string]string{"eventId": e.EventID})
		}
		if !chainCommitmentIDPattern.MatchString(e.ChainCommitmentID) {
			return Reject(CodeChainCommitmentRejected, "chainCommitmentId must be a canonical Chain Core commitment ID", map[string]string{"eventId": e.EventID})
		}
	}
	if e.SchemaVersion == EnvelopeSchemaVersionV2 {
		if err := e.validateV2(); err != nil {
			return err
		}
	}
	return nil
}

func (e EventEnvelope) validateV2() error {
	for name, value := range map[string]string{"producer": e.Producer, "aggregateType": e.AggregateType} {
		if !slugPattern.MatchString(value) && !idPattern.MatchString(value) {
			return Reject(CodeMissingRequiredField, name+" is required and must be canonical", map[string]string{"field": name})
		}
	}
	for name, value := range map[string]string{
		"actorId": e.ActorID, "accountId": e.AccountID, "productSessionId": e.ProductSessionID, "traceId": e.TraceID,
		"requestId": e.RequestID, "idempotencyKey": e.IdempotencyKey,
	} {
		if !idPattern.MatchString(value) {
			return Reject(CodeMissingRequiredField, name+" is required and must be canonical", map[string]string{"field": name})
		}
	}
	if e.ActorID != e.Actor.ActorID || e.AccountID != e.Actor.AccountID || e.ProductSessionID != e.Actor.SessionID {
		return Reject(CodeWrongAggregate, "v2 direct actor bindings must match the compatibility actor object", map[string]string{"eventId": e.EventID})
	}
	if e.OccurredAt.IsZero() || e.ReceivedAt.IsZero() || e.OccurredAt.Location() != time.UTC || e.ReceivedAt.Location() != time.UTC {
		return Reject(CodeMissingRequiredField, "occurredAt and receivedAt are required UTC timestamps", map[string]string{"eventId": e.EventID})
	}
	if !e.OccurredAt.Equal(e.Timestamp) {
		return Reject(CodeInvalidVersion, "occurredAt must equal the v1 timestamp compatibility field", map[string]string{"eventId": e.EventID})
	}
	if e.ReceivedAt.Before(e.OccurredAt.Add(-time.Minute)) {
		return Reject(CodeInvalidVersion, "receivedAt cannot materially precede occurredAt", map[string]string{"eventId": e.EventID})
	}
	if e.OccurredAt.After(time.Now().UTC().Add(5 * time.Minute)) {
		return Reject(CodeFutureTimestamp, "occurredAt exceeds the accepted future clock-skew window", map[string]string{"eventId": e.EventID, "occurredAt": e.OccurredAt.Format(time.RFC3339Nano)})
	}
	if !oneOf(e.ResidencyClass, "global", "regional", "account-home", "legal-hold") {
		return Reject(CodeInvalidPrivacyClassification, "residencyClass is invalid", map[string]string{"eventId": e.EventID, "residencyClass": e.ResidencyClass})
	}
	if e.Partition != e.PartitionKey() {
		return Reject(CodeWrongPartition, "partitionKey does not match the canonical aggregate partition", map[string]string{"eventId": e.EventID, "expected": e.PartitionKey(), "actual": e.Partition})
	}
	if e.OrderingKey != e.Partition {
		return Reject(CodeWrongPartition, "orderingKey must equal partitionKey for ordered aggregate events", map[string]string{"eventId": e.EventID})
	}
	if e.IntegrityHash != e.Integrity.Digest || e.Signature != e.Integrity.Signature {
		return Reject(CodeWrongSignature, "v2 integrityHash and signature must match the compatibility integrity object", map[string]string{"eventId": e.EventID})
	}
	if e.Metadata == nil {
		return Reject(CodeMissingRequiredField, "metadata is required", map[string]string{"field": "metadata"})
	}
	for key, value := range e.Metadata {
		if strings.TrimSpace(key) == "" || len(key) > 64 || len(value) > 1024 {
			return Reject(CodeOversizedPayload, "metadata keys and values must remain bounded", map[string]string{"eventId": e.EventID})
		}
	}
	return nil
}

func validatePayloadPrivacy(payload json.RawMessage) error {
	if len(payload) > 256*1024 {
		return errors.New("payload exceeds the 262144-byte event limit")
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return errors.New("payload must be valid JSON")
	}
	object, ok := value.(map[string]any)
	if !ok {
		return errors.New("payload must be a JSON object")
	}
	if err := inspectPayloadObject(object); err != nil {
		return err
	}
	return nil
}

func inspectPayloadObject(object map[string]any) error {
	for key, value := range object {
		normalized := strings.ToLower(strings.NewReplacer("_", "", "-", "", ".", "").Replace(key))
		if forbiddenPayloadKey(normalized) {
			return fmt.Errorf("payload field %q is prohibited; store a bounded reference or digest instead", key)
		}
		if err := inspectPayloadValue(value); err != nil {
			return err
		}
	}
	return nil
}

func inspectPayloadValue(value any) error {
	switch typed := value.(type) {
	case map[string]any:
		return inspectPayloadObject(typed)
	case []any:
		for _, item := range typed {
			if err := inspectPayloadValue(item); err != nil {
				return err
			}
		}
	case string:
		upper := strings.ToUpper(typed)
		if strings.Contains(upper, "BEGIN PRIVATE KEY") || strings.Contains(upper, "BEGIN EC PRIVATE KEY") || strings.Contains(upper, "BEGIN OPENSSH PRIVATE KEY") {
			return errors.New("payload contains private key material")
		}
	}
	return nil
}

func forbiddenPayloadKey(key string) bool {
	exact := map[string]bool{
		"privatekey": true, "seed": true, "seedphrase": true, "mnemonic": true, "password": true,
		"authorization": true, "accesstoken": true, "refreshtoken": true, "sessiontoken": true,
		"apikey": true, "secret": true, "cvv": true, "cvc": true, "pan": true, "cardnumber": true,
		"content": true, "body": true, "html": true, "mailbody": true, "messagecontent": true,
		"documentcontent": true, "filecontent": true, "socialcontent": true, "prompt": true, "response": true,
	}
	if exact[key] {
		return true
	}
	for _, suffix := range []string{"privatekey", "password", "secret", "token", "cvv", "cvc", "mnemonic", "seedphrase"} {
		if strings.HasSuffix(key, suffix) && !strings.HasSuffix(key, suffix+"hash") {
			return true
		}
	}
	return false
}

func (e *EventEnvelope) Sign(keyID string, key []byte) error {
	if len(key) < 32 {
		return errors.New("event signing key must contain at least 32 bytes")
	}
	e.Integrity = Integrity{Algorithm: "hmac-sha256", KeyID: keyID}
	e.IntegrityHash = ""
	e.Signature = ""
	canonical, err := e.integrityMaterial()
	if err != nil {
		return err
	}
	digest := sha256.Sum256(canonical)
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write(digest[:])
	e.Integrity.Digest = hex.EncodeToString(digest[:])
	e.Integrity.Signature = hex.EncodeToString(mac.Sum(nil))
	if e.SchemaVersion == EnvelopeSchemaVersionV2 {
		e.IntegrityHash = e.Integrity.Digest
		e.Signature = e.Integrity.Signature
	}
	return e.Validate()
}

func (e EventEnvelope) Verify(key []byte) error {
	if err := e.Validate(); err != nil {
		return err
	}
	canonical, err := e.integrityMaterial()
	if err != nil {
		return err
	}
	digest := sha256.Sum256(canonical)
	wantDigest, err := hex.DecodeString(e.Integrity.Digest)
	if err != nil {
		return ErrTampered
	}
	if !hmac.Equal(wantDigest, digest[:]) {
		legacy, legacyErr := e.legacyIntegrityMaterial()
		if legacyErr != nil {
			return legacyErr
		}
		legacyDigest := sha256.Sum256(legacy)
		if !hmac.Equal(wantDigest, legacyDigest[:]) {
			return ErrTampered
		}
	}
	provided, err := hex.DecodeString(e.Integrity.Signature)
	if err != nil {
		return ErrTampered
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write(wantDigest)
	if !hmac.Equal(provided, mac.Sum(nil)) {
		return ErrTampered
	}
	return nil
}

func (e EventEnvelope) integrityMaterial() ([]byte, error) {
	copy := e
	copy.Integrity.Digest = ""
	copy.Integrity.Signature = ""
	copy.IntegrityHash = ""
	copy.Signature = ""
	payload, err := canonicalizeRawJSON(copy.Payload)
	if err != nil {
		return nil, err
	}
	copy.Payload = payload
	return json.Marshal(copy)
}

func (e EventEnvelope) legacyIntegrityMaterial() ([]byte, error) {
	copy := e
	copy.Integrity.Digest = ""
	copy.Integrity.Signature = ""
	copy.IntegrityHash = ""
	copy.Signature = ""
	return json.Marshal(copy)
}

func canonicalizeRawJSON(raw json.RawMessage) (json.RawMessage, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, err
	}
	if err := ensureEOF(decoder); err != nil {
		return nil, err
	}
	return json.Marshal(value)
}

func oneOf(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}

func StrictPayload[T any](raw json.RawMessage) (T, error) {
	var result T
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&result); err != nil {
		return result, err
	}
	if err := ensureEOF(decoder); err != nil {
		return result, err
	}
	return result, nil
}
