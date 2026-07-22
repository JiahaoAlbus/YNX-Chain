package datafabricbackup

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
)

var backupKey = []byte("0123456789abcdef0123456789abcdef")

func TestBackupVerifyRestoreAndTamperFailure(t *testing.T) {
	root := t.TempDir()
	statePath, eventLogPath := root+"/source/state.json", root+"/source/events.jsonl"
	store, err := datafabric.OpenStore(statePath)
	if err != nil {
		t.Fatal(err)
	}
	event := backupEvent(t)
	if err := store.Append(event, backupKey); err != nil {
		t.Fatal(err)
	}
	dispatcher := datafabric.Dispatcher{Store: store, Publisher: &datafabric.EventLogPublisher{Path: eventLogPath}}
	if report, err := dispatcher.DispatchOnce(context.Background()); err != nil || report.Published != 1 {
		t.Fatalf("dispatch: %+v %v", report, err)
	}

	backupDir := root + "/backups/backup-0001"
	now := time.Date(2026, 7, 22, 19, 0, 0, 0, time.UTC)
	manifest, err := Create(statePath, eventLogPath, backupDir, event.SourceCommit, event.SourceRelease, map[string][]byte{event.Integrity.KeyID: backupKey}, now)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.EventCount != 1 || manifest.EventLogCount != 1 || manifest.Integrity != "verified" {
		t.Fatalf("manifest: %+v", manifest)
	}
	if _, err := Verify(backupDir, map[string][]byte{event.Integrity.KeyID: backupKey}); err != nil {
		t.Fatal(err)
	}

	restoreState, restoreLog := root+"/restored/state.json", root+"/restored/events.jsonl"
	if _, err := Restore(backupDir, restoreState, restoreLog, map[string][]byte{event.Integrity.KeyID: backupKey}); err != nil {
		t.Fatal(err)
	}
	restored, err := datafabric.OpenStore(restoreState)
	if err != nil || len(restored.Events()) != 1 {
		t.Fatalf("restore state: %v", err)
	}
	if _, err := Restore(backupDir, restoreState, restoreLog, map[string][]byte{event.Integrity.KeyID: backupKey}); err == nil {
		t.Fatal("restore overwrote existing targets")
	}

	tamperedDir := root + "/backups/backup-tampered"
	if _, err := Create(statePath, eventLogPath, tamperedDir, event.SourceCommit, event.SourceRelease, map[string][]byte{event.Integrity.KeyID: backupKey}, now); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(tamperedDir + "/events.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	data = []byte(strings.Replace(string(data), event.EventID, "event.pay.backup.tampered.0001", 1))
	if err := os.WriteFile(tamperedDir+"/events.jsonl", data, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Verify(tamperedDir, map[string][]byte{event.Integrity.KeyID: backupKey}); err == nil {
		t.Fatal("tampered backup verified")
	}
}

func backupEvent(t *testing.T) datafabric.EventEnvelope {
	t.Helper()
	now := time.Date(2026, 7, 22, 19, 0, 0, 0, time.UTC)
	event := datafabric.EventEnvelope{EventID: "event.pay.backup.created.0001", EventType: "pay.invoice.created", SchemaVersion: datafabric.EnvelopeSchemaVersion, Product: "pay", Service: "invoice", AggregateID: "invoice.backup.0001", Actor: datafabric.Actor{ActorID: "actor.wallet.0001", AccountID: "account.wallet.0001", SessionID: "session.wallet.0001"}, CorrelationID: "correlation.backup.0001", CausationID: "command.backup.0001", Sequence: 1, Timestamp: now, EffectiveAt: now, SourceCommit: "719e1018267ed5a53e6fae5211c5fd8a1503c35c", SourceRelease: "data-fabric-testnet-v0", PrivacyClassification: "confidential", RetentionClass: "financial-7y", AuditID: "audit.backup.0001", Source: datafabric.SourceMetadata{Source: "ynx-pay", AsOf: now, Version: "v1", Status: "authoritative"}, Payload: json.RawMessage(`{"status":"created"}`)}
	if err := event.Sign("key.pay.testnet.0001", backupKey); err != nil {
		t.Fatal(err)
	}
	return event
}
