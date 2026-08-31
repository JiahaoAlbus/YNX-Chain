package datafabric

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// ConnectionEventsContractVersion is the Integration-accepted, asynchronous
// observer contract. It must never be used as a Wallet, Gateway, signing, or
// transaction control-plane dependency.
const (
	ConnectionEventsContractVersion = "1.0.0-p0.0"
	ConnectionEventsSchemaVersion   = "1.0"
	ConnectionDiagnosticsConsumer   = "connection-diagnostics-v1"
)

var (
	connectionIDPattern  = regexp.MustCompile(`^pc_[A-Za-z0-9_-]{16,96}$`)
	payloadHashPattern   = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
	txHashPattern        = regexp.MustCompile(`^0x[0-9a-fA-F]{64}$`)
	clientVersionPattern = regexp.MustCompile(`^(0|[1-9][0-9]{0,1})\.[0-9]{1,3}\.[0-9]{1,3}$`)
)

// ConnectionEvent is the strict, privacy-safe input shared by producers. It
// contains an already product-scoped pseudonym, never an account, address,
// seed, token, key, full signature, private message, PAN, or CVV.
type ConnectionEvent struct {
	EventID       string                 `json:"eventId"`
	EventType     string                 `json:"eventType"`
	SchemaVersion string                 `json:"schemaVersion"`
	Tenant        string                 `json:"tenant"`
	Product       string                 `json:"product"`
	Platform      string                 `json:"platform"`
	Transport     string                 `json:"transport"`
	ConnectionID  string                 `json:"connectionId"`
	SessionClass  string                 `json:"sessionClass"`
	ChainID       string                 `json:"chainId"`
	Result        string                 `json:"result"`
	ErrorClass    string                 `json:"errorClass"`
	Retryable     bool                   `json:"retryable"`
	CorrelationID string                 `json:"correlationId"`
	CausationID   string                 `json:"causationId"`
	Sequence      uint64                 `json:"sequence"`
	SourceCommit  string                 `json:"sourceCommit"`
	ReleaseID     string                 `json:"releaseId"`
	Timestamp     time.Time              `json:"timestamp"`
	EffectiveAt   time.Time              `json:"effectiveAt"`
	PrivacyClass  string                 `json:"privacyClass"`
	Retention     string                 `json:"retention"`
	AuditID       string                 `json:"auditId"`
	PayloadHash   string                 `json:"payloadHash"`
	Status        string                 `json:"status"`
	Diagnostic    *ConnectionDiagnostic  `json:"diagnostic,omitempty"`
	Faucet        *FaucetCompletionProof `json:"faucet,omitempty"`
}

type ConnectionDiagnostic struct {
	HTTPStatusClass string `json:"httpStatusClass,omitempty"`
	EndpointClass   string `json:"endpointClass,omitempty"`
	ClientVersion   string `json:"clientVersion,omitempty"`
}

type FaucetCompletionProof struct {
	AcceptanceID           string `json:"acceptanceId"`
	TxHash                 string `json:"txHash"`
	AuthoritativeReceiptID string `json:"authoritativeReceiptId"`
	Finality               string `json:"finality"`
}

type ConnectionDiagnosticDimension struct {
	Metric    string
	Dimension string
}

func DecodeConnectionEventStrict(r io.Reader) (ConnectionEvent, error) {
	var event ConnectionEvent
	decoder := json.NewDecoder(r)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&event); err != nil {
		return ConnectionEvent{}, WrapReject(CodeUnknownField, "decode connection event", err, nil)
	}
	if err := ensureEOF(decoder); err != nil {
		return ConnectionEvent{}, err
	}
	if err := event.Validate(); err != nil {
		return ConnectionEvent{}, err
	}
	return event, nil
}

func (event ConnectionEvent) Validate() error {
	if event.SchemaVersion != ConnectionEventsSchemaVersion {
		return Reject(CodeUnsupportedVersion, "connection event schemaVersion is not accepted", map[string]string{"schemaVersion": event.SchemaVersion})
	}
	if !containsConnectionEventType(event.EventType) {
		return Reject(CodeUnknownEventType, "connection event type is not accepted", map[string]string{"eventType": event.EventType})
	}
	for name, value := range map[string]string{
		"eventId": event.EventID, "correlationId": event.CorrelationID, "causationId": event.CausationID, "auditId": event.AuditID,
	} {
		if !idPattern.MatchString(value) {
			return Reject(CodeMissingRequiredField, "connection event identifier is invalid", map[string]string{"field": name})
		}
	}
	if !slugPattern.MatchString(event.Tenant) || !slugPattern.MatchString(event.Product) {
		return Reject(CodeWrongProduct, "connection event tenant and product must be canonical slugs", nil)
	}
	if !connectionIDPattern.MatchString(event.ConnectionID) {
		return Reject(CodeInvalidPrivacyClassification, "connectionId must be a product-scoped pseudonym", nil)
	}
	if !contains([]string{"web", "ios", "android", "desktop", "extension", "server", "unknown"}, event.Platform) ||
		!contains([]string{"eip1193", "eip6963", "walletconnect-v2", "deep-link", "product-session", "gateway", "faucet", "unknown"}, event.Transport) ||
		!contains([]string{"standard-wallet", "product-session", "walletconnect", "none"}, event.SessionClass) ||
		event.ChainID != canonicalWalletConnectivityChainID ||
		!contains([]string{"requested", "approved", "rejected", "established", "disconnected", "recovered", "expired", "revoked", "completed", "failed", "degraded"}, event.Result) ||
		!contains([]string{"none", "user-rejected", "device-proof", "device-key", "session-binding", "protocol", "expiry-or-clock-skew", "callback", "registry", "endpoint-schema", "gateway-unavailable", "relay-unavailable", "client-retired", "faucet-not-accepted", "faucet-pending-finality", "unknown"}, event.ErrorClass) ||
		!contains([]string{"queued", "pending", "published", "dead-letter"}, event.Status) {
		return Reject(CodeSchemaCompatibilityViolation, "connection event contains an unaccepted enum value", map[string]string{"eventType": event.EventType})
	}
	if event.Sequence == 0 || event.Timestamp.IsZero() || event.EffectiveAt.IsZero() || event.Timestamp.Location() != time.UTC || event.EffectiveAt.Location() != time.UTC {
		return Reject(CodeMissingRequiredField, "connection event sequence and UTC timestamps are required", nil)
	}
	if !commitPattern.MatchString(event.SourceCommit) || strings.TrimSpace(event.ReleaseID) == "" || len(event.ReleaseID) > 128 || event.PrivacyClass != "pseudonymous" || !contains([]string{"operational", "audit-7y"}, event.Retention) || !payloadHashPattern.MatchString(event.PayloadHash) {
		return Reject(CodeInvalidPrivacyClassification, "connection event provenance or privacy fields are invalid", nil)
	}
	if event.Diagnostic != nil {
		if !contains([]string{"", "none", "400", "403", "other"}, event.Diagnostic.HTTPStatusClass) ||
			!contains([]string{"", "gateway", "relay", "faucet", "registry", "callback", "unknown"}, event.Diagnostic.EndpointClass) ||
			(event.Diagnostic.ClientVersion != "" && !clientVersionPattern.MatchString(event.Diagnostic.ClientVersion)) {
			return Reject(CodeSchemaCompatibilityViolation, "connection diagnostic is invalid or would create unbounded metric cardinality", nil)
		}
	}
	if event.EventType == "faucet.completed" {
		if event.Transport == "deep-link" || event.Faucet == nil || !idPattern.MatchString(event.Faucet.AcceptanceID) || !txHashPattern.MatchString(event.Faucet.TxHash) || !idPattern.MatchString(event.Faucet.AuthoritativeReceiptID) || event.Faucet.Finality != "finalized" || event.Result != "completed" || event.ErrorClass != "none" || event.Retryable {
			return Reject(CodeMissingRequiredField, "faucet.completed requires accepted, finalized authoritative proof", map[string]string{"eventType": event.EventType})
		}
	} else if event.Faucet != nil {
		return Reject(CodeUnknownField, "faucet proof is only permitted for faucet.completed", map[string]string{"eventType": event.EventType})
	}
	return nil
}

func containsConnectionEventType(value string) bool {
	return contains([]string{
		"wallet.connection.requested", "wallet.connection.approved", "wallet.connection.rejected", "wallet.connection.established", "wallet.connection.disconnected", "wallet.connection.recovered", "wallet.connection.expired", "wallet.connection.revoked",
		"product.session.upgrade.requested", "product.session.upgrade.completed", "product.session.upgrade.failed", "product.session.revoked",
		"walletconnect.pairing.created", "walletconnect.session.established", "walletconnect.session.disconnected",
		"endpoint.health.degraded", "endpoint.health.recovered", "endpoint.schema.mismatch",
		"faucet.requested", "faucet.completed", "faucet.failed", "client.retired", "client.retired.connection_rejected",
	}, value)
}

func chainIDPattern(value string) bool {
	if value == "unknown" {
		return true
	}
	if strings.HasPrefix(value, "ynx_") {
		parts := strings.Split(strings.TrimPrefix(value, "ynx_"), "-")
		return len(parts) == 2 && parts[0] != "" && parts[1] != ""
	}
	if !strings.HasPrefix(value, "0x") || len(value) < 3 {
		return false
	}
	for _, digit := range value[2:] {
		if !strings.ContainsRune("0123456789abcdefABCDEF", digit) {
			return false
		}
	}
	return true
}

// BuildConnectionEventEnvelope produces the signed canonical EventEnvelope
// that is appended transactionally with the existing Outbox. ConnectionID is
// retained only in the accepted pseudonymous payload; aggregate and actor IDs
// use a domain-separated digest so the canonical envelope has no account or
// reusable cross-product identity field.
func BuildConnectionEventEnvelope(input ConnectionEvent, keyID string, key []byte) (EventEnvelope, error) {
	if err := input.Validate(); err != nil {
		return EventEnvelope{}, err
	}
	payload, err := json.Marshal(input)
	if err != nil {
		return EventEnvelope{}, fmt.Errorf("encode accepted connection event: %w", err)
	}
	boundID := connectionEnvelopeID(input)
	event := EventEnvelope{
		EventID: input.EventID, EventType: input.EventType, SchemaVersion: EnvelopeSchemaVersion,
		Product: input.Product, Service: "connection-events", AggregateID: boundID,
		Actor: Actor{ActorID: boundID}, CorrelationID: input.CorrelationID, CausationID: input.CausationID,
		Sequence: input.Sequence, Timestamp: input.Timestamp.UTC(), EffectiveAt: input.EffectiveAt.UTC(),
		SourceCommit: input.SourceCommit, SourceRelease: input.ReleaseID,
		PrivacyClassification: "confidential", RetentionClass: input.Retention, AuditID: input.AuditID,
		Source:  SourceMetadata{Source: "connection-event-producer", AsOf: input.Timestamp.UTC(), Version: ConnectionEventsContractVersion, Status: "authoritative"},
		Payload: payload,
	}
	if err := event.Sign(keyID, key); err != nil {
		return EventEnvelope{}, err
	}
	return event, nil
}

func connectionEnvelopeID(input ConnectionEvent) string {
	digest := sha256.Sum256([]byte("ynx-data-fabric-connection-v1\x00" + input.Tenant + "\x00" + input.Product + "\x00" + input.ConnectionID))
	return "connection." + hex.EncodeToString(digest[:])
}

// EmitConnectionEvent commits the producer outcome and Outbox record before
// returning. Its caller may log the returned error, but must never translate a
// Data Fabric failure into Wallet Offline or block a Wallet control flow.
func (s *Store) EmitConnectionEvent(input ConnectionEvent, keyID string, key []byte) (EventEnvelope, error) {
	event, err := BuildConnectionEventEnvelope(input, keyID, key)
	if err != nil {
		return EventEnvelope{}, err
	}
	if err := s.Append(event, key); err != nil {
		return EventEnvelope{}, err
	}
	return event, nil
}

func decodeConnectionPayload(event EventEnvelope) (ConnectionEvent, error) {
	if event.SchemaVersion != EnvelopeSchemaVersion || event.Service != "connection-events" || !containsConnectionEventType(event.EventType) {
		return ConnectionEvent{}, Reject(CodeSchemaProductMismatch, "event is not an accepted connection event envelope", map[string]string{"eventId": event.EventID})
	}
	input, err := DecodeConnectionEventStrict(strings.NewReader(string(event.Payload)))
	if err != nil {
		return ConnectionEvent{}, err
	}
	if input.EventID != event.EventID || input.EventType != event.EventType || input.Product != event.Product || input.Sequence != event.Sequence || input.CorrelationID != event.CorrelationID || input.CausationID != event.CausationID || input.AuditID != event.AuditID || input.SourceCommit != event.SourceCommit || input.ReleaseID != event.SourceRelease || !input.Timestamp.Equal(event.Timestamp) || !input.EffectiveAt.Equal(event.EffectiveAt) || connectionEnvelopeID(input) != event.AggregateID || event.Actor.ActorID != event.AggregateID {
		return ConnectionEvent{}, Reject(CodeTampered, "connection event payload and canonical envelope do not agree", map[string]string{"eventId": event.EventID})
	}
	return input, nil
}

// ConnectionDiagnosticDimensions returns a fixed-cardinality, privacy-safe
// metric set. It never exposes a connection pseudonym, account, address,
// client patch version, endpoint URL, certificate, or raw error.
func ConnectionDiagnosticDimensions(event EventEnvelope) ([]ConnectionDiagnosticDimension, error) {
	input, err := decodeConnectionPayload(event)
	if err != nil {
		return nil, err
	}
	dimensions := []ConnectionDiagnosticDimension{
		{Metric: "connection_events_total", Dimension: input.EventType},
		{Metric: "connection_result_total", Dimension: input.Result},
		{Metric: "connection_platform_total", Dimension: input.Platform},
		{Metric: "connection_transport_total", Dimension: input.Transport},
		{Metric: "connection_error_class_total", Dimension: input.ErrorClass},
	}
	if input.EventType == "wallet.connection.requested" {
		dimensions = append(dimensions, ConnectionDiagnosticDimension{Metric: "connection_attempts_total", Dimension: "all"})
	}
	if input.EventType == "wallet.connection.approved" {
		dimensions = append(dimensions, ConnectionDiagnosticDimension{Metric: "connection_approval_success_total", Dimension: "all"})
	}
	if input.EventType == "wallet.connection.recovered" {
		dimensions = append(dimensions, ConnectionDiagnosticDimension{Metric: "connection_reconnect_success_total", Dimension: "all"})
	}
	if strings.HasPrefix(input.EventType, "product.session.upgrade.") {
		dimensions = append(dimensions, ConnectionDiagnosticDimension{Metric: "product_session_upgrade_total", Dimension: strings.TrimPrefix(input.EventType, "product.session.upgrade.")})
	}
	if input.EventType == "endpoint.schema.mismatch" {
		dimensions = append(dimensions, ConnectionDiagnosticDimension{Metric: "endpoint_schema_mismatch_total", Dimension: "all"})
	}
	if strings.HasPrefix(input.EventType, "client.retired") {
		dimensions = append(dimensions, ConnectionDiagnosticDimension{Metric: "retired_client_attempts_total", Dimension: "all"})
	}
	if strings.HasPrefix(input.EventType, "faucet.") {
		dimensions = append(dimensions, ConnectionDiagnosticDimension{Metric: "faucet_events_total", Dimension: strings.TrimPrefix(input.EventType, "faucet.")})
	}
	if input.ErrorClass != "none" {
		dimensions = append(dimensions, ConnectionDiagnosticDimension{Metric: "connection_failure_reason_total", Dimension: input.ErrorClass})
	}
	if input.Diagnostic != nil {
		if input.Diagnostic.HTTPStatusClass == "400" || input.Diagnostic.HTTPStatusClass == "403" {
			dimensions = append(dimensions, ConnectionDiagnosticDimension{Metric: "connection_http_status_total", Dimension: input.Diagnostic.HTTPStatusClass})
		}
		if input.Diagnostic.EndpointClass != "" {
			dimensions = append(dimensions, ConnectionDiagnosticDimension{Metric: "connection_endpoint_class_total", Dimension: input.Diagnostic.EndpointClass})
		}
		if input.Diagnostic.ClientVersion != "" {
			major := strings.Split(input.Diagnostic.ClientVersion, ".")[0]
			dimensions = append(dimensions, ConnectionDiagnosticDimension{Metric: "connection_platform_version_major_total", Dimension: input.Platform + ":v" + major})
		}
	}
	return uniqueConnectionDimensions(dimensions), nil
}

func uniqueConnectionDimensions(input []ConnectionDiagnosticDimension) []ConnectionDiagnosticDimension {
	seen := make(map[string]bool, len(input))
	output := make([]ConnectionDiagnosticDimension, 0, len(input))
	for _, dimension := range input {
		key := dimension.Metric + "\x00" + dimension.Dimension
		if !seen[key] {
			seen[key] = true
			output = append(output, dimension)
		}
	}
	sort.Slice(output, func(i, j int) bool {
		if output[i].Metric == output[j].Metric {
			return output[i].Dimension < output[j].Dimension
		}
		return output[i].Metric < output[j].Metric
	})
	return output
}

// ConsumeConnectionDiagnostics applies a single Inbox-protected aggregate
// effect. Projection state stores counters only; no event payload, connection
// identifier, user identity, address, secret, or endpoint value is copied.
func (s *Store) ConsumeConnectionDiagnostics(eventID string) (bool, error) {
	return s.ApplyProjection(ConnectionDiagnosticsConsumer, eventID, func(event EventEnvelope, projection map[string]string) (string, error) {
		dimensions, err := ConnectionDiagnosticDimensions(event)
		if err != nil {
			return "", err
		}
		for _, dimension := range dimensions {
			key := "connection-diagnostics-v1." + dimension.Metric + "." + dimension.Dimension
			value, parseErr := strconv.ParseUint(projection[key], 10, 64)
			if parseErr != nil && projection[key] != "" {
				return "", errors.New("connection diagnostic counter is corrupted")
			}
			projection[key] = strconv.FormatUint(value+1, 10)
		}
		digest := sha256.Sum256([]byte("ynx-data-fabric-connection-diagnostics-v1\x00" + event.EventID + "\x00" + event.Integrity.Digest))
		return hex.EncodeToString(digest[:]), nil
	})
}
