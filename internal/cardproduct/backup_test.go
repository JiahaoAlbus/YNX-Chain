package cardproduct

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestBackupRestoreRollbackAndTamper(t *testing.T) {
	now := time.Date(2026, 7, 27, 18, 0, 0, 0, time.UTC)
	integrity := bytes.Repeat([]byte{0x71}, 32)
	service, err := New(Config{
		StorePath:        filepath.Join(t.TempDir(), "card-state.json"),
		IntegrityKey:     integrity,
		GatewayKey:       bytes.Repeat([]byte{0x72}, 32),
		ProviderEventKey: bytes.Repeat([]byte{0x73}, 32),
		Provider:         NewSandboxProvider(func() time.Time { return now }),
		Now:              func() time.Time { return now },
	})
	if err != nil {
		t.Fatal(err)
	}
	_, card := applySandbox(t, service)
	originalHash := snapshotHash(t, service)

	backupPath := filepath.Join(t.TempDir(), "card-backup.json")
	manifest, err := service.ExportBackup(backupPath)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.SchemaVersion != BackupSchemaVersion || manifest.SourceStateVersion != StateVersion || manifest.EffectiveStateVersion != StateVersion || manifest.SnapshotSHA256 == "" || manifest.Bytes <= 0 {
		t.Fatalf("unexpected backup manifest: %+v", manifest)
	}
	assertPrivateFile(t, backupPath)
	if _, err := service.ExportBackup(backupPath); err == nil {
		t.Fatal("existing backup destination was overwritten")
	}
	if _, err := service.ExportBackup("relative-card-backup.json"); err == nil {
		t.Fatal("relative backup path was accepted")
	}

	updated, err := service.UpdateControls(context.Background(), testAccount, card.ID, ControlsInput{
		SpendLimitMinor:  88000,
		Currency:         "USD",
		Online:           true,
		International:    true,
		ATM:              false,
		AllowedMCC:       []string{"5942"},
		AllowedCountries: []string{"US"},
		IdempotencyKey:   "controls-backup-mutation-0001",
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Controls.SpendLimitMinor != 88000 {
		t.Fatalf("control mutation did not persist: %+v", updated.Controls)
	}
	mutatedHash := snapshotHash(t, service)
	if mutatedHash == originalHash {
		t.Fatal("test mutation did not change the live snapshot")
	}

	rollbackPath := filepath.Join(t.TempDir(), "before-restore.json")
	restored, err := service.RestoreBackup(backupPath, rollbackPath)
	if err != nil {
		t.Fatal(err)
	}
	if restored.Migrated || restored.RestoredSnapshotSHA256 != originalHash || restored.Rollback == nil || restored.Rollback.SnapshotSHA256 != mutatedHash {
		t.Fatalf("unexpected restore result: %+v", restored)
	}
	if got := snapshotHash(t, service); got != originalHash {
		t.Fatalf("backup restore mismatch: got %s want %s", got, originalHash)
	}
	assertPrivateFile(t, rollbackPath)

	rollbackOfRollback := filepath.Join(t.TempDir(), "before-rollback.json")
	rolledBack, err := service.RestoreBackup(rollbackPath, rollbackOfRollback)
	if err != nil {
		t.Fatal(err)
	}
	if rolledBack.RestoredSnapshotSHA256 != mutatedHash || snapshotHash(t, service) != mutatedHash {
		t.Fatalf("rollback backup did not restore the pre-restore state: %+v", rolledBack)
	}

	raw, err := os.ReadFile(backupPath)
	if err != nil {
		t.Fatal(err)
	}
	tampered := bytes.Replace(raw, []byte(`"spendLimitMinor": 50000`), []byte(`"spendLimitMinor": 50001`), 1)
	if bytes.Equal(raw, tampered) {
		t.Fatal("backup fixture did not contain the expected control value")
	}
	tamperedPath := filepath.Join(t.TempDir(), "tampered-backup.json")
	if err := os.WriteFile(tamperedPath, tampered, 0o600); err != nil {
		t.Fatal(err)
	}
	beforeTamperRestore := snapshotHash(t, service)
	tamperRollback := filepath.Join(t.TempDir(), "tamper-rollback-must-not-exist.json")
	if _, err := service.RestoreBackup(tamperedPath, tamperRollback); err == nil {
		t.Fatal("tampered backup was restored")
	}
	if got := snapshotHash(t, service); got != beforeTamperRestore {
		t.Fatalf("tampered restore changed live state: got %s want %s", got, beforeTamperRestore)
	}
	if _, err := os.Stat(tamperRollback); !os.IsNotExist(err) {
		t.Fatalf("rollback file should not be created before source verification: %v", err)
	}
}

func TestBackupLegacyMigrationRollbackAndValidation(t *testing.T) {
	now := time.Date(2026, 7, 27, 19, 0, 0, 0, time.UTC)
	integrity := bytes.Repeat([]byte{0x81}, 32)
	service, err := New(Config{
		StorePath:        filepath.Join(t.TempDir(), "card-state.json"),
		IntegrityKey:     integrity,
		GatewayKey:       bytes.Repeat([]byte{0x82}, 32),
		ProviderEventKey: bytes.Repeat([]byte{0x83}, 32),
		Provider:         NewSandboxProvider(func() time.Time { return now }),
		Now:              func() time.Time { return now },
	})
	if err != nil {
		t.Fatal(err)
	}
	_, card := applySandbox(t, service)
	current := snapshotValue(t, service)
	legacy := snapshotV0{
		Version:      LegacyStateVersion,
		Eligibility:  current.Eligibility,
		Applications: current.Applications,
		Cards:        current.Cards,
		Events:       current.Events,
		Disputes:     current.Disputes,
		AIRuns:       current.AIRuns,
		Idempotency:  current.Idempotency,
		ProviderSeen: current.ProviderSeen,
		GatewaySeen:  current.GatewaySeen,
		Audit:        current.Audit,
	}
	legacyRaw, _, err := encodeBackupDocument(legacy, LegacyStateVersion, now, integrity)
	if err != nil {
		t.Fatal(err)
	}
	legacyPath := filepath.Join(t.TempDir(), "legacy-v0-backup.json")
	if err := atomicWriteFile(legacyPath, legacyRaw, false); err != nil {
		t.Fatal(err)
	}

	if _, err := service.UpdateControls(context.Background(), testAccount, card.ID, ControlsInput{
		SpendLimitMinor: 91000,
		Currency:        "USD",
		Online:          true,
		International:   false,
		ATM:             true,
		IdempotencyKey:  "controls-before-v0-migration-0001",
	}); err != nil {
		t.Fatal(err)
	}
	preMigrationHash := snapshotHash(t, service)
	migrationRollback := filepath.Join(t.TempDir(), "pre-migration-v1.json")
	result, err := service.RestoreBackup(legacyPath, migrationRollback)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Migrated || result.Source.SourceStateVersion != LegacyStateVersion || result.Source.EffectiveStateVersion != StateVersion {
		t.Fatalf("legacy backup was not reported as migrated: %+v", result)
	}
	migrated := snapshotValue(t, service)
	if migrated.Version != StateVersion || migrated.Notifications == nil || len(migrated.Notifications) != 0 {
		t.Fatalf("legacy state migration did not initialize v1 notifications: %+v", migrated.Notifications)
	}

	rollbackOfMigration := filepath.Join(t.TempDir(), "before-migration-rollback.json")
	if _, err := service.RestoreBackup(migrationRollback, rollbackOfMigration); err != nil {
		t.Fatal(err)
	}
	if got := snapshotHash(t, service); got != preMigrationHash {
		t.Fatalf("migration rollback did not restore the original v1 state: got %s want %s", got, preMigrationHash)
	}

	unknownRaw, _, err := encodeBackupDocument(snapshotValue(t, service), 99, now, integrity)
	if err != nil {
		t.Fatal(err)
	}
	unknownPath := filepath.Join(t.TempDir(), "unknown-version.json")
	if err := atomicWriteFile(unknownPath, unknownRaw, false); err != nil {
		t.Fatal(err)
	}
	beforeUnknown := snapshotHash(t, service)
	if _, err := service.RestoreBackup(unknownPath, filepath.Join(t.TempDir(), "unknown-rollback.json")); err == nil {
		t.Fatal("unsupported backup state version was restored")
	}
	if snapshotHash(t, service) != beforeUnknown {
		t.Fatal("unsupported backup state version changed live state")
	}

	invalid := snapshotValue(t, service)
	invalid.Audit[0].Hash = "invalid-audit-hash"
	invalidRaw, _, err := encodeBackupDocument(invalid, StateVersion, now, integrity)
	if err != nil {
		t.Fatal(err)
	}
	invalidPath := filepath.Join(t.TempDir(), "invalid-audit.json")
	if err := atomicWriteFile(invalidPath, invalidRaw, false); err != nil {
		t.Fatal(err)
	}
	if _, err := service.RestoreBackup(invalidPath, filepath.Join(t.TempDir(), "invalid-audit-rollback.json")); err == nil {
		t.Fatal("signed backup with an invalid audit chain was restored")
	}

	wrongKeyRaw, _, err := encodeBackupDocument(snapshotValue(t, service), StateVersion, now, bytes.Repeat([]byte{0x99}, 32))
	if err != nil {
		t.Fatal(err)
	}
	wrongKeyPath := filepath.Join(t.TempDir(), "wrong-key.json")
	if err := atomicWriteFile(wrongKeyPath, wrongKeyRaw, false); err != nil {
		t.Fatal(err)
	}
	if _, err := service.RestoreBackup(wrongKeyPath, filepath.Join(t.TempDir(), "wrong-key-rollback.json")); err == nil {
		t.Fatal("backup signed by an untrusted integrity key was restored")
	}
}

func TestOfflineRestoreFromCorruptAndMissingPrimary(t *testing.T) {
	now := time.Date(2026, 7, 27, 20, 0, 0, 0, time.UTC)
	integrity := bytes.Repeat([]byte{0x91}, 32)
	statePath := filepath.Join(t.TempDir(), "card-state.json")
	service, err := New(Config{
		StorePath:        statePath,
		IntegrityKey:     integrity,
		GatewayKey:       bytes.Repeat([]byte{0x92}, 32),
		ProviderEventKey: bytes.Repeat([]byte{0x93}, 32),
		Provider:         NewSandboxProvider(func() time.Time { return now }),
		Now:              func() time.Time { return now },
	})
	if err != nil {
		t.Fatal(err)
	}
	_, _ = applySandbox(t, service)
	originalHash := snapshotHash(t, service)
	backupPath := filepath.Join(t.TempDir(), "offline-source.json")
	if _, err := ExportStoreBackup(statePath, backupPath, integrity, now); err != nil {
		t.Fatal(err)
	}
	verified, err := VerifyBackup(backupPath, integrity)
	if err != nil || verified.SnapshotSHA256 != originalHash {
		t.Fatalf("offline backup verification mismatch: %+v %v", verified, err)
	}

	corruptRaw := []byte("corrupt-card-state\n")
	if err := os.WriteFile(statePath, corruptRaw, 0o600); err != nil {
		t.Fatal(err)
	}
	quarantinePath := filepath.Join(t.TempDir(), "corrupt-primary.quarantine")
	result, err := RestoreStoreFileFromBackup(statePath, backupPath, quarantinePath, integrity, now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if !result.LiveStateExisted || !result.RollbackQuarantined || result.Rollback != nil || result.QuarantinedLiveStateSHA256 != hashBytes(corruptRaw) || result.RestoredSnapshotSHA256 != originalHash {
		t.Fatalf("corrupt-primary restore result is incomplete: %+v", result)
	}
	quarantined, err := os.ReadFile(quarantinePath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(quarantined, corruptRaw) {
		t.Fatal("corrupt primary bytes were not preserved exactly")
	}
	assertPrivateFile(t, quarantinePath)
	restoredStore, err := OpenStore(statePath, integrity)
	if err != nil {
		t.Fatal(err)
	}
	var restored Snapshot
	if err := restoredStore.View(func(snapshot Snapshot) error { restored = snapshot; return nil }); err != nil {
		t.Fatal(err)
	}
	if hashJSON(restored) != originalHash {
		t.Fatal("offline corrupt-primary restore produced the wrong snapshot")
	}

	if err := os.Remove(statePath); err != nil {
		t.Fatal(err)
	}
	missingRollback := filepath.Join(t.TempDir(), "missing-primary-rollback-must-not-exist.json")
	missingResult, err := RestoreStoreFileFromBackup(statePath, backupPath, missingRollback, integrity, now.Add(2*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if missingResult.LiveStateExisted || missingResult.RollbackQuarantined || missingResult.Rollback != nil || missingResult.RestoredSnapshotSHA256 != originalHash {
		t.Fatalf("missing-primary restore result is incorrect: %+v", missingResult)
	}
	if _, err := os.Stat(missingRollback); !os.IsNotExist(err) {
		t.Fatalf("missing primary should not create a rollback artifact: %v", err)
	}
	if _, err := OpenStore(statePath, integrity); err != nil {
		t.Fatalf("cold restore did not create a valid primary state: %v", err)
	}
}

func snapshotValue(t *testing.T, service *Service) Snapshot {
	t.Helper()
	var snapshot Snapshot
	if err := service.store.View(func(value Snapshot) error {
		snapshot = value
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func snapshotHash(t *testing.T, service *Service) string {
	t.Helper()
	return hashJSON(snapshotValue(t, service))
}

func assertPrivateFile(t *testing.T, path string) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("file permissions are %o, want 600", info.Mode().Perm())
	}
}
