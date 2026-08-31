package datafabric

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestConnectionEventAdapterUsesOutboxAndInboxWithoutWalletControlDependency(t *testing.T) {
	path := filepath.Join(t.TempDir(), "connection-events.json")
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	input := connectionEventFixture("event.connection.requested.0001", "wallet.connection.requested", 1)
	event, err := store.EmitConnectionEvent(input, "key.connection.0001", testKey)
	if err != nil {
		t.Fatalf("append accepted connection event: %v", err)
	}
	if event.Product != "wallet" || event.Service != "connection-events" || event.Actor.AccountID != "" || event.Actor.SessionID != "" || event.AggregateID == input.ConnectionID || !strings.HasPrefix(event.AggregateID, "connection.") {
		t.Fatalf("adapter leaked a Wallet identity or did not bind a private aggregate: %+v", event)
	}
	encoded, _ := json.Marshal(event)
	for _, prohibited := range []string{"accountId", "walletAddress", "privateKey", "bearerToken", "walletConnectSymmetricKey", "pan", "cvv"} {
		if bytes.Contains(encoded, []byte(prohibited)) {
			t.Fatalf("adapter persisted prohibited field %q", prohibited)
		}
	}

	publisher := &recordingPublisher{fail: true}
	now := time.Now().UTC().Add(time.Second)
	dispatcher := Dispatcher{Store: store, Publisher: publisher, BatchSize: 10, MaxAttempts: 3, Now: func() time.Time { return now }}
	report, err := dispatcher.DispatchOnce(context.Background())
	if err != nil || report.Failed != 1 || len(store.PendingOutbox(now.Add(time.Hour), 10)) != 1 {
		t.Fatalf("broker outage did not retain the asynchronous Outbox record: report=%+v err=%v", report, err)
	}
	publisher.fail = false
	now = now.Add(3 * time.Second)
	report, err = dispatcher.DispatchOnce(context.Background())
	if err != nil || report.Published != 1 {
		t.Fatalf("broker recovery did not publish the retained Outbox record: report=%+v err=%v", report, err)
	}

	applied, err := store.ConsumeConnectionDiagnostics(event.EventID)
	if err != nil || !applied {
		t.Fatalf("diagnostic Inbox effect failed: applied=%t err=%v", applied, err)
	}
	applied, err = store.ConsumeConnectionDiagnostics(event.EventID)
	if err != nil || applied {
		t.Fatalf("duplicate delivery recreated a diagnostic effect: applied=%t err=%v", applied, err)
	}
	restarted, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := restarted.Projection("connection-diagnostics-v1.connection_attempts_total.all"); got != "1" {
		t.Fatalf("restart lost Inbox-protected aggregate: %q", got)
	}
	if got := restarted.Projection("connection-diagnostics-v1.connection_events_total.wallet.connection.requested"); got != "1" {
		t.Fatalf("unexpected connection event aggregate: %q", got)
	}
}

func TestConnectionEventAdapterRejectsGapsUnknownFieldsAndFaucetDeepLinkCompletion(t *testing.T) {
	store, err := OpenStore(filepath.Join(t.TempDir(), "connection-events.json"))
	if err != nil {
		t.Fatal(err)
	}
	gap := connectionEventFixture("event.connection.gap.0003", "wallet.connection.established", 3)
	if _, err := store.EmitConnectionEvent(gap, "key.connection.0001", testKey); !errors.Is(err, ErrOutOfOrder) {
		t.Fatalf("connection sequence gap was accepted: %v", err)
	}

	unknown := []byte(`{"eventId":"event.connection.unknown.0001","eventType":"wallet.connection.requested","schemaVersion":"1.0","tenant":"wallet","product":"wallet","platform":"web","transport":"eip1193","connectionId":"pc_abcdefghijklmnopqrst","sessionClass":"standard-wallet","chainId":"0x1917","result":"requested","errorClass":"none","retryable":false,"correlationId":"correlation.connection.0001","causationId":"causation.connection.0001","sequence":1,"sourceCommit":"0123456789abcdef0123456789abcdef01234567","releaseId":"wallet-testnet","timestamp":"2026-08-20T00:00:00Z","effectiveAt":"2026-08-20T00:00:00Z","privacyClass":"pseudonymous","retention":"operational","auditId":"audit.connection.0001","payloadHash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","status":"queued","walletAddress":"0xdeadbeef"}`)
	if _, err := DecodeConnectionEventStrict(bytes.NewReader(unknown)); ErrorCodeOf(err) != CodeUnknownField {
		t.Fatalf("unknown privacy-sensitive field was accepted: %v", err)
	}

	faucet := connectionEventFixture("event.faucet.completed.0001", "faucet.completed", 1)
	faucet.Transport = "deep-link"
	faucet.Result, faucet.ErrorClass, faucet.Retryable = "completed", "none", false
	faucet.Faucet = &FaucetCompletionProof{AcceptanceID: "acceptance.faucet.0001", TxHash: "0x" + strings.Repeat("a", 64), AuthoritativeReceiptID: "receipt.faucet.0001", Finality: "finalized"}
	if err := faucet.Validate(); err == nil {
		t.Fatal("a deep-link return was accepted as faucet.completed")
	}
}

func TestConnectionEventRejectsLegacy9102AndUnnormalized6423(t *testing.T) {
	for _, chainID := range []string{"9102", "0x238e", "6423", "unknown"} {
		t.Run(chainID, func(t *testing.T) {
			event := connectionEventFixture("event.connection.chain."+strings.ReplaceAll(chainID, "0x", "hex")+".0001", "wallet.connection.requested", 1)
			event.ChainID = chainID
			if err := event.Validate(); ErrorCodeOf(err) != CodeSchemaCompatibilityViolation || strings.Contains(err.Error(), chainID) || len(ErrorEvidenceOf(err)) != 1 {
				t.Fatalf("unsupported chain was not rejected by the persistence boundary: %v", err)
			}
		})
	}
}

func TestAcceptedWalletConnectivityConformanceFileStore(t *testing.T) {
	fixture := loadAcceptedWalletConnectivityConformanceFixture(t)
	if fixture.ContractStatus != "ACCEPTED" || fixture.Contract != "connectionEvents@1.0.0-p0.0" || fixture.SynchronousDependency != "prohibited" {
		t.Fatalf("accepted conformance fixture has unsafe contract state: %+v", fixture)
	}
	if len(fixture.RegisteredConsumers) != 2 || fixture.RegisteredConsumers[0].Name != ConnectionDiagnosticsConsumer || fixture.RegisteredConsumers[0].Adapter != "file-store" || fixture.RegisteredConsumers[1].Name != ConnectionDiagnosticsConsumer || fixture.RegisteredConsumers[1].Adapter != "postgres" {
		t.Fatalf("fixture does not enumerate the registered diagnostics consumers: %+v", fixture.RegisteredConsumers)
	}

	for _, vector := range fixture.Vectors {
		switch vector.Outcome {
		case "accepted-asynchronous":
			aggregate, err := AggregateWalletConnectivity(vector.ProducerChainID, "GATEWAY_UNAVAILABLE")
			if err != nil || aggregate.ChainID != vector.PersistedChainID || aggregate.ErrorClass != "gateway-unavailable" || !aggregate.Retryable {
				t.Fatalf("%s did not normalize the accepted producer input: aggregate=%+v err=%v", vector.ID, aggregate, err)
			}
			store, err := OpenStore(filepath.Join(t.TempDir(), vector.ID+".json"))
			if err != nil {
				t.Fatal(err)
			}
			input := connectionEventFixture("event.connection.conformance."+strings.ToLower(strings.ReplaceAll(vector.ID, "-", "")), "wallet.connection.recovered", 1)
			input.ChainID, input.ErrorClass, input.Retryable = aggregate.ChainID, aggregate.ErrorClass, aggregate.Retryable
			event, err := store.EmitConnectionEvent(input, "key.connection.0001", testKey)
			if err != nil || len(store.PendingOutbox(time.Now().UTC().Add(time.Hour), 10)) != 1 {
				t.Fatalf("%s did not commit the non-blocking Outbox observation: event=%+v err=%v", vector.ID, event, err)
			}
			applied, err := store.ConsumeConnectionDiagnostics(event.EventID)
			if err != nil || !applied {
				t.Fatalf("%s did not apply the Inbox-protected aggregate: applied=%t err=%v", vector.ID, applied, err)
			}
		case "reject-before-persistence":
			if vector.ProducerChainID == "" {
				for _, field := range vector.ForbiddenFields {
					const sensitiveValue = "privacy-sentinel-must-not-reach-errors-or-evidence"
					raw := connectionEventJSONWithUnknownField(field, sensitiveValue)
					if _, err := DecodeConnectionEventStrict(bytes.NewReader(raw)); ErrorCodeOf(err) != CodeUnknownField || strings.Contains(err.Error(), sensitiveValue) || strings.Contains(strings.Join(evidenceValues(ErrorEvidenceOf(err)), "\x00"), sensitiveValue) {
						t.Fatalf("%s permitted forbidden field %q: %v", vector.ID, field, err)
					}
				}
				continue
			}
			store, err := OpenStore(filepath.Join(t.TempDir(), vector.ID+".json"))
			if err != nil {
				t.Fatal(err)
			}
			input := connectionEventFixture("event.connection.conformance."+strings.ToLower(strings.ReplaceAll(vector.ID, "-", "")), "wallet.connection.requested", 1)
			input.ChainID = vector.ProducerChainID
			if _, err := store.EmitConnectionEvent(input, "key.connection.0001", testKey); ErrorCodeOf(err) != CodeSchemaCompatibilityViolation || len(store.PendingOutbox(time.Now().UTC().Add(time.Hour), 10)) != 0 {
				t.Fatalf("%s reached persistence for legacy chain %q: %v", vector.ID, vector.ProducerChainID, err)
			}
		default:
			t.Fatalf("unknown conformance outcome %q", vector.Outcome)
		}
	}
}

type acceptedWalletConnectivityConformanceFixture struct {
	ContractStatus        string `json:"contractStatus"`
	Contract              string `json:"contract"`
	SynchronousDependency string `json:"synchronousDependency"`
	RegisteredConsumers   []struct {
		Name    string `json:"name"`
		Adapter string `json:"adapter"`
	} `json:"registeredConsumers"`
	Vectors []struct {
		ID               string   `json:"id"`
		ProducerChainID  string   `json:"producerChainId"`
		PersistedChainID string   `json:"persistedChainId"`
		ForbiddenFields  []string `json:"forbiddenFields"`
		Outcome          string   `json:"outcome"`
	} `json:"vectors"`
}

func loadAcceptedWalletConnectivityConformanceFixture(t *testing.T) acceptedWalletConnectivityConformanceFixture {
	t.Helper()
	bytes, err := os.ReadFile(filepath.Join("..", "..", "schemas", "data-fabric", "wallet-connectivity-events-v1.accepted.conformance.vectors.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture acceptedWalletConnectivityConformanceFixture
	if err := json.Unmarshal(bytes, &fixture); err != nil {
		t.Fatal(err)
	}
	return fixture
}

func connectionEventJSONWithUnknownField(field, value string) []byte {
	event := connectionEventFixture("event.connection.privacy.0001", "wallet.connection.requested", 1)
	payload, err := json.Marshal(event)
	if err != nil {
		panic(err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(payload, &fields); err != nil {
		panic(err)
	}
	encodedValue, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	fields[field] = encodedValue
	payload, err = json.Marshal(fields)
	if err != nil {
		panic(err)
	}
	return payload
}

func evidenceValues(evidence map[string]string) []string {
	values := make([]string, 0, len(evidence))
	for _, value := range evidence {
		values = append(values, value)
	}
	return values
}

func TestConnectionDiagnosticsAreFixedCardinalityAndReplayIdempotent(t *testing.T) {
	store, err := OpenStore(filepath.Join(t.TempDir(), "connection-events.json"))
	if err != nil {
		t.Fatal(err)
	}
	first := connectionEventFixture("event.connection.recovered.0001", "wallet.connection.recovered", 1)
	first.Diagnostic = &ConnectionDiagnostic{HTTPStatusClass: "403", EndpointClass: "gateway", ClientVersion: "12.42.7"}
	first.ErrorClass = "gateway-unavailable"
	if _, err := store.EmitConnectionEvent(first, "key.connection.0001", testKey); err != nil {
		t.Fatal(err)
	}
	report, err := store.ReplayProjection(ConnectionDiagnosticsConsumer, 0, 0, func(event EventEnvelope, projection map[string]string) (string, error) {
		return "", errors.New("replay must use the connection diagnostics adapter")
	})
	if err == nil || report.Scanned != 1 {
		t.Fatalf("unsafe generic replay unexpectedly succeeded: report=%+v err=%v", report, err)
	}
	applied, err := store.ConsumeConnectionDiagnostics(first.EventID)
	if err != nil || !applied {
		t.Fatalf("diagnostic consumer failed: applied=%t err=%v", applied, err)
	}
	dimensions, err := ConnectionDiagnosticDimensions(mustConnectionEvent(t, first, testKey))
	if err != nil || len(dimensions) == 0 {
		t.Fatalf("fixed diagnostics were not derived: dimensions=%+v err=%v", dimensions, err)
	}
	for _, dimension := range dimensions {
		if strings.Contains(dimension.Dimension, first.ConnectionID) || strings.Contains(dimension.Dimension, "12.42.7") {
			t.Fatalf("diagnostic dimension leaked a pseudonym or patch version: %+v", dimension)
		}
	}
}

func connectionEventFixture(eventID, eventType string, sequence uint64) ConnectionEvent {
	now := time.Date(2026, 8, 20, 0, 0, int(sequence), 0, time.UTC)
	return ConnectionEvent{
		EventID: eventID, EventType: eventType, SchemaVersion: ConnectionEventsSchemaVersion,
		Tenant: "wallet", Product: "wallet", Platform: "web", Transport: "eip1193", ConnectionID: "pc_abcdefghijklmnopqrst",
		SessionClass: "standard-wallet", ChainID: "0x1917", Result: "requested", ErrorClass: "none", Retryable: false,
		CorrelationID: "correlation.connection.0001", CausationID: "causation.connection.0001", Sequence: sequence,
		SourceCommit: "0123456789abcdef0123456789abcdef01234567", ReleaseID: "wallet-testnet", Timestamp: now, EffectiveAt: now,
		PrivacyClass: "pseudonymous", Retention: "operational", AuditID: "audit.connection.0001", PayloadHash: "sha256:" + strings.Repeat("a", 64), Status: "queued",
	}
}

func mustConnectionEvent(t *testing.T, input ConnectionEvent, key []byte) EventEnvelope {
	t.Helper()
	event, err := BuildConnectionEventEnvelope(input, "key.connection.0001", key)
	if err != nil {
		t.Fatal(err)
	}
	return event
}
