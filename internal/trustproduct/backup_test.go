package trustproduct

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestBackupRestoreDrillIsImmutableAndStateEquivalent(t *testing.T) {
	now := time.Date(2026, 7, 27, 20, 0, 0, 0, time.UTC)
	root := t.TempDir()
	livePath := filepath.Join(root, "live", "state.json")
	backupPath := filepath.Join(root, "backups", "trust-20260727.json")
	restorePath := filepath.Join(root, "restore", "state.json")
	subject := Actor{ID: "ynx1backup-subject", Role: "user"}
	reporter := Actor{ID: "ynx1backup-reporter", Role: "reporter"}

	svc, err := New(Config{StorePath: livePath, Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.storeCentralSession("backup-session-token", CentralSession{
		ID:        "backup-session",
		Account:   subject.ID,
		DeviceID:  "backup-device",
		Scopes:    []string{scopeEvidenceRead},
		ExpiresAt: now.Add(time.Hour),
	}); err != nil {
		t.Fatal(err)
	}
	caseBeforeBackup := do(t, svc, reporter, Action{
		Type:            "submit_case",
		IdempotencyKey:  "backup-case-1",
		Subject:         subject.ID,
		Purpose:         "prove a clean Trust restore",
		RequestScope:    "one account and event",
		RequestedAction: "review",
		Evidence:        evidence(),
	}).Case
	do(t, svc, subject, Action{
		Type:           "ai_prepare",
		IdempotencyKey: "backup-ai-1",
		CaseID:         caseBeforeBackup.ID,
		Purpose:        "prepare an appeal explanation",
		Context:        []string{"evidence_summary", "appeal"},
	})
	expectedExport, err := svc.ExportSubject(subject)
	if err != nil {
		t.Fatal(err)
	}

	manifest, err := svc.CreateBackup(backupPath)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.SchemaVersion != backupSchemaVersion || manifest.Product != "ynx-trust-center" || manifest.CaseCount != 1 || manifest.AIRecordCount != 1 {
		t.Fatalf("bad backup manifest: %+v", manifest)
	}
	assertMode0600(t, backupPath)
	if _, err := svc.CreateBackup(backupPath); err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Fatalf("immutable backup destination was overwritten: %v", err)
	}

	backupRaw, err := os.ReadFile(backupPath)
	if err != nil {
		t.Fatal(err)
	}
	var envelope backupEnvelope
	if err := decodeStrictJSON(backupRaw, &envelope); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(envelope.State), "backup-session-token") || !strings.Contains(string(envelope.State), `"tokenHash"`) {
		t.Fatal("backup leaked a plaintext session token or omitted its bounded session-hash record")
	}

	unsafeRestorePath := filepath.Join(root, "unsafe-restore", "state.json")
	if err := os.Chmod(backupPath, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := RestoreBackup(backupPath, unsafeRestorePath); err == nil || !strings.Contains(err.Error(), "mode must be 0600") {
		t.Fatalf("permissive backup source was accepted: %v", err)
	}
	if _, err := os.Stat(unsafeRestorePath); !os.IsNotExist(err) {
		t.Fatalf("unsafe backup restore created a target: %v", err)
	}
	if err := os.Chmod(backupPath, 0o600); err != nil {
		t.Fatal(err)
	}

	// Mutate the live store after the immutable backup. The restored store must
	// reproduce the earlier checkpoint rather than the later live state.
	now = now.Add(time.Minute)
	do(t, svc, reporter, Action{
		Type:            "submit_case",
		IdempotencyKey:  "backup-case-2",
		Subject:         subject.ID,
		Purpose:         "later live mutation",
		RequestScope:    "one later event",
		RequestedAction: "review",
		Evidence:        evidence(),
	})

	restoredManifest, err := RestoreBackup(backupPath, restorePath)
	if err != nil {
		t.Fatal(err)
	}
	if restoredManifest != manifest {
		t.Fatalf("restore manifest changed: got=%+v want=%+v", restoredManifest, manifest)
	}
	assertMode0600(t, restorePath)
	restoredRaw, err := os.ReadFile(restorePath)
	if err != nil {
		t.Fatal(err)
	}
	if sha256String(restoredRaw) != manifest.StateSHA256 || int64(len(restoredRaw)) != manifest.StateBytes {
		t.Fatal("restored state bytes do not match the backup manifest")
	}

	// New performs the cold-start admission path, including the embedded state
	// seal and persisted central-session validation.
	restarted, err := New(Config{StorePath: restorePath, Now: func() time.Time { return now }})
	if err != nil {
		t.Fatalf("restored Trust state did not cold start: %v", err)
	}
	actualExport, err := restarted.ExportSubject(subject)
	if err != nil {
		t.Fatal(err)
	}
	if actualExport.GeneratedAt != now.UTC().Format("2006-01-02T15:04:05.000000000Z07:00") {
		t.Fatalf("restored export generation time=%q", actualExport.GeneratedAt)
	}
	expectedExport.GeneratedAt = actualExport.GeneratedAt
	if mustJSON(t, actualExport) != mustJSON(t, expectedExport) {
		t.Fatalf("restored subject state differs\nactual=%s\nexpected=%s", mustJSON(t, actualExport), mustJSON(t, expectedExport))
	}
	if _, err := RestoreBackup(backupPath, restorePath); err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Fatalf("restore overwrote an existing store: %v", err)
	}
}

func TestRestoreRejectsTamperedStateDespiteRecomputedOuterSeal(t *testing.T) {
	now := time.Date(2026, 7, 27, 21, 0, 0, 0, time.UTC)
	root := t.TempDir()
	livePath := filepath.Join(root, "live", "state.json")
	backupPath := filepath.Join(root, "backups", "valid.json")
	tamperedPath := filepath.Join(root, "backups", "tampered.json")
	targetPath := filepath.Join(root, "restore", "state.json")

	svc, err := New(Config{StorePath: livePath, Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	do(t, svc, Actor{ID: "ynx1tamper-reporter", Role: "reporter"}, Action{
		Type:            "submit_case",
		IdempotencyKey:  "tamper-backup-case",
		Subject:         "ynx1tamper-subject",
		Purpose:         "prove nested integrity",
		RequestScope:    "one case",
		RequestedAction: "review",
		Evidence:        evidence(),
	})
	if _, err := svc.CreateBackup(backupPath); err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(backupPath)
	if err != nil {
		t.Fatal(err)
	}
	var envelope backupEnvelope
	if err := decodeStrictJSON(raw, &envelope); err != nil {
		t.Fatal(err)
	}
	tamperedState := strings.Replace(string(envelope.State), "ynx1tamper-subject", "ynx1tamper-altered", 1)
	if tamperedState == string(envelope.State) {
		t.Fatal("tamper fixture did not change embedded state")
	}
	envelope.State = []byte(tamperedState)
	envelope.Manifest.StateSHA256 = sha256String(envelope.State)
	envelope.Manifest.StateBytes = int64(len(envelope.State))
	envelope.Integrity = ""
	envelope.Integrity, err = backupEnvelopeIntegrity(envelope)
	if err != nil {
		t.Fatal(err)
	}
	tamperedRaw, err := json.MarshalIndent(envelope, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(tamperedPath, tamperedRaw, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := RestoreBackup(tamperedPath, targetPath); err == nil || !strings.Contains(err.Error(), "state: trust snapshot integrity mismatch") {
		t.Fatalf("nested state tamper was accepted: %v", err)
	}
	if _, err := os.Stat(targetPath); !os.IsNotExist(err) {
		t.Fatalf("failed restore created a target file: %v", err)
	}
}

func assertMode0600(t *testing.T, path string) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("%s mode=%o", path, info.Mode().Perm())
	}
}
