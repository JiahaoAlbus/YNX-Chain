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

const EnvelopeSchemaVersion = "1.0"

var (
	ErrDuplicate  = errors.New("data fabric: duplicate event")
	ErrOutOfOrder = errors.New("data fabric: event is out of order")
	ErrTampered   = errors.New("data fabric: event integrity check failed")
	idPattern     = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$`)
	slugPattern   = regexp.MustCompile(`^[a-z][a-z0-9-]{1,63}$`)
	typePattern   = regexp.MustCompile(`^[a-z][a-z0-9]*(\.[a-z][a-z0-9_-]*){2,7}$`)
	commitPattern = regexp.MustCompile(`^[0-9a-f]{7,64}$`)
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
	EventID               string          `json:"eventId"`
	EventType             string          `json:"eventType"`
	SchemaVersion         string          `json:"schemaVersion"`
	Product               string          `json:"product"`
	Service               string          `json:"service"`
	AggregateID           string          `json:"aggregateId"`
	Actor                 Actor           `json:"actor"`
	CorrelationID         string          `json:"correlationId"`
	CausationID           string          `json:"causationId,omitempty"`
	Sequence              uint64          `json:"sequence"`
	Timestamp             time.Time       `json:"timestamp"`
	EffectiveAt           time.Time       `json:"effectiveAt"`
	SourceCommit          string          `json:"sourceCommit"`
	SourceRelease         string          `json:"sourceRelease"`
	Integrity             Integrity       `json:"integrity"`
	PrivacyClassification string          `json:"privacyClassification"`
	RetentionClass        string          `json:"retentionClass"`
	AuditID               string          `json:"auditId"`
	Source                SourceMetadata  `json:"source"`
	Payload               json.RawMessage `json:"payload"`
}

// PartitionKey is the canonical aggregate-ordering key. Service is included so
// two bounded contexts cannot accidentally share an ordering sequence merely
// because they reuse an aggregate identifier.
func (e EventEnvelope) PartitionKey() string {
	return e.Product + ":" + e.Service + ":" + e.AggregateID
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
	if e.SchemaVersion != EnvelopeSchemaVersion {
		return fmt.Errorf("unsupported event schema version %q", e.SchemaVersion)
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
	canonical, err := e.integrityMaterial()
	if err != nil {
		return err
	}
	digest := sha256.Sum256(canonical)
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write(digest[:])
	e.Integrity.Digest = hex.EncodeToString(digest[:])
	e.Integrity.Signature = hex.EncodeToString(mac.Sum(nil))
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
	if err != nil || !hmac.Equal(wantDigest, digest[:]) {
		return ErrTampered
	}
	provided, err := hex.DecodeString(e.Integrity.Signature)
	if err != nil {
		return ErrTampered
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write(digest[:])
	if !hmac.Equal(provided, mac.Sum(nil)) {
		return ErrTampered
	}
	return nil
}

func (e EventEnvelope) integrityMaterial() ([]byte, error) {
	copy := e
	copy.Integrity.Digest = ""
	copy.Integrity.Signature = ""
	return json.Marshal(copy)
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
