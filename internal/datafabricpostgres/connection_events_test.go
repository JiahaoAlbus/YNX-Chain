package datafabricpostgres

import (
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

func postgresConnectionEvent(eventID string, sequence uint64) datafabric.ConnectionEvent {
	now := time.Date(2026, 8, 20, 0, 0, int(sequence), 0, time.UTC)
	return datafabric.ConnectionEvent{
		EventID: eventID, EventType: "wallet.connection.requested", SchemaVersion: datafabric.ConnectionEventsSchemaVersion,
		Tenant: "wallet", Product: "wallet", Platform: "web", Transport: "eip1193", ConnectionID: "pc_abcdefghijklmnopqrst",
		SessionClass: "standard-wallet", ChainID: "0x1917", Result: "requested", ErrorClass: "none", CorrelationID: "correlation.connection.0001", CausationID: "causation.connection.0001", Sequence: sequence,
		SourceCommit: "0123456789abcdef0123456789abcdef01234567", ReleaseID: "wallet-testnet", Timestamp: now, EffectiveAt: now, PrivacyClass: "pseudonymous", Retention: "operational", AuditID: "audit.connection.0001", PayloadHash: "sha256:" + strings.Repeat("a", 64), Status: "queued",
	}
}
