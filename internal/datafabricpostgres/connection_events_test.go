package datafabricpostgres

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
)

func TestPostgresConnectionEventAdaptersUseExistingOutboxAndInboxTransaction(t *testing.T) {
	db, connection := openRecordingDB(t)
	store, err := NewStore(db)
	if err != nil {
		t.Fatal(err)
	}
	input := postgresConnectionEvent("event.connection.postgres.0001", 1)
	event, err := store.EmitConnectionEvent(context.Background(), input, "key.connection.0001", postgresTestKey)
	if err != nil {
		t.Fatalf("connection producer adapter rejected accepted event: %v", err)
	}
	connection.mu.Lock()
	if !connection.committed || len(connection.execs) != 3 || !strings.Contains(connection.execs[1], "ynx_fabric.events") || !strings.Contains(connection.execs[2], "ynx_fabric.outbox") {
		connection.mu.Unlock()
		t.Fatalf("connection producer did not share the authoritative Event/Outbox transaction: %+v", connection)
	}
	connection.execs = nil
	connection.committed = false
	encoded, _ := json.Marshal(event)
	connection.envelope = encoded
	connection.mu.Unlock()

	applied, err := store.ConsumeConnectionDiagnostics(context.Background(), event.EventID)
	if err != nil || !applied {
		t.Fatalf("connection diagnostics consumer failed: applied=%t err=%v", applied, err)
	}
	connection.mu.Lock()
	defer connection.mu.Unlock()
	joined := strings.Join(connection.execs, "\n")
	if !connection.committed || !strings.Contains(joined, "INSERT INTO ynx_fabric.connection_diagnostics") || !strings.Contains(joined, "INSERT INTO ynx_fabric.inbox") {
		t.Fatalf("connection diagnostics effect and Inbox were not one transaction: %+v", connection)
	}
}

func TestPostgresAcceptedWalletConnectivityConformanceRejectsBeforePersistence(t *testing.T) {
	db, connection := openRecordingDB(t)
	store, err := NewStore(db)
	if err != nil {
		t.Fatal(err)
	}
	for _, chainID := range []string{"9102", "0x238e"} {
		input := postgresConnectionEvent("event.connection.postgres.reject."+strings.ReplaceAll(chainID, "0x", "hex"), 1)
		input.ChainID = chainID
		if _, err := store.EmitConnectionEvent(context.Background(), input, "key.connection.0001", postgresTestKey); datafabric.ErrorCodeOf(err) != datafabric.CodeSchemaCompatibilityViolation {
			t.Fatalf("legacy chain %q was not rejected at the PostgreSQL producer boundary: %v", chainID, err)
		}
		connection.mu.Lock()
		if connection.begun != 0 || len(connection.execs) != 0 {
			connection.mu.Unlock()
			t.Fatalf("legacy chain %q reached PostgreSQL persistence: %+v", chainID, connection)
		}
		connection.mu.Unlock()
	}

	for _, field := range []string{"rawError", "developerMessage", "accountId", "sessionId"} {
		input := postgresConnectionEvent("event.connection.postgres.privacy.0001", 1)
		payload, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(payload, &fields); err != nil {
			t.Fatal(err)
		}
		fields[field] = json.RawMessage(`"redacted"`)
		payload, err = json.Marshal(fields)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := datafabric.DecodeConnectionEventStrict(bytes.NewReader(payload)); datafabric.ErrorCodeOf(err) != datafabric.CodeUnknownField {
			t.Fatalf("forbidden field %q was accepted: %v", field, err)
		}
	}

	aggregate, err := datafabric.AggregateWalletConnectivity("6423", "GATEWAY_UNAVAILABLE")
	if err != nil {
		t.Fatal(err)
	}
	input := postgresConnectionEvent("event.connection.postgres.6423.0001", 1)
	input.ChainID, input.ErrorClass, input.Retryable = aggregate.ChainID, aggregate.ErrorClass, aggregate.Retryable
	event, err := store.EmitConnectionEvent(context.Background(), input, "key.connection.0001", postgresTestKey)
	if err != nil || event.Service != "connection-events" {
		t.Fatalf("canonical 6423 event did not reach the asynchronous PostgreSQL adapter: event=%+v err=%v", event, err)
	}
	connection.mu.Lock()
	if !connection.committed || len(connection.execs) != 3 || !strings.Contains(connection.execs[1], "ynx_fabric.events") || !strings.Contains(connection.execs[2], "ynx_fabric.outbox") {
		connection.mu.Unlock()
		t.Fatalf("canonical 6423 event did not share the PostgreSQL Event/Outbox transaction: %+v", connection)
	}
	connection.execs = nil
	connection.committed = false
	encoded, _ := json.Marshal(event)
	connection.envelope = encoded
	connection.mu.Unlock()

	applied, err := store.ConsumeConnectionDiagnostics(context.Background(), event.EventID)
	if err != nil || !applied {
		t.Fatalf("canonical 6423 event did not reach the registered PostgreSQL diagnostics consumer: applied=%t err=%v", applied, err)
	}
}

func postgresConnectionEvent(eventID string, sequence uint64) datafabric.ConnectionEvent {
	now := time.Date(2026, 8, 20, 0, 0, int(sequence), 0, time.UTC)
	return datafabric.ConnectionEvent{
		EventID: eventID, EventType: "wallet.connection.requested", SchemaVersion: datafabric.ConnectionEventsSchemaVersion,
		Tenant: "wallet", Product: "wallet", Platform: "web", Transport: "eip1193", ConnectionID: "pc_abcdefghijklmnopqrst",
		SessionClass: "standard-wallet", ChainID: "0x1917", Result: "requested", ErrorClass: "none", CorrelationID: "correlation.connection.0001", CausationID: "causation.connection.0001", Sequence: sequence,
		SourceCommit: "0123456789abcdef0123456789abcdef01234567", ReleaseID: "wallet-testnet", Timestamp: now, EffectiveAt: now, PrivacyClass: "pseudonymous", Retention: "operational", AuditID: "audit.connection.0001", PayloadHash: "sha256:" + strings.Repeat("a", 64), Status: "queued",
	}
}
