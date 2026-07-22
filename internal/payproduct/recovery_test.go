package payproduct

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestBackupVerifyRestoreAndRollbackDrill(t *testing.T) {
	root := t.TempDir()
	storePath := filepath.Join(root, "state.json")
	backupPath := filepath.Join(root, "backup.json")
	key := bytes32(7)
	store, err := OpenStore(storePath, key)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Update(func(snapshot *Snapshot) error {
		snapshot.Merchants["mrc_original"] = Merchant{ID: "mrc_original", DisplayName: "Original", Status: "active"}
		snapshot.Audit = append(snapshot.Audit, AuditEntry{ID: "aud_original", Action: "drill.seed", Outcome: "committed"})
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	original, err := os.ReadFile(storePath)
	if err != nil {
		t.Fatal(err)
	}
	commit := strings.Repeat("a", 40)
	createdAt := time.Date(2026, 7, 22, 6, 0, 0, 0, time.UTC)
	manifest, err := CreateBackup(storePath, backupPath, key, commit, createdAt)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.SourceSHA256 != sha256Hex(original) || manifest.SourceBytes != int64(len(original)) || manifest.SnapshotVersion != SnapshotVersion || manifest.RecordCounts["merchants"] != 1 || manifest.RecordCounts["auditEntries"] != 1 {
		t.Fatalf("backup manifest is incomplete: %+v", manifest)
	}
	verified, err := VerifyBackup(backupPath, key)
	if err != nil || verified.BackupID != manifest.BackupID {
		t.Fatalf("backup verification failed: %+v %v", verified, err)
	}
	if _, err := CreateBackup(storePath, backupPath, key, commit, createdAt); err == nil {
		t.Fatal("backup silently overwrote an existing archive")
	}
	if err := store.Update(func(snapshot *Snapshot) error {
		snapshot.Merchants["mrc_changed"] = Merchant{ID: "mrc_changed", DisplayName: "Changed", Status: "active"}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	changed, err := os.ReadFile(storePath)
	if err != nil {
		t.Fatal(err)
	}
	changedHash := sha256Hex(changed)
	if _, err := RestoreBackup(backupPath, storePath, key, strings.Repeat("0", 64), createdAt.Add(time.Hour)); err == nil {
		t.Fatal("restore accepted an incorrect current-state confirmation")
	}
	evidence, err := RestoreBackup(backupPath, storePath, key, changedHash, createdAt.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if !evidence.Verified || evidence.BeforeSHA256 != changedHash || evidence.AfterSHA256 != manifest.SourceSHA256 || evidence.SourceCommit != commit || evidence.RollbackFileName == "" {
		t.Fatalf("restore evidence is incomplete: %+v", evidence)
	}
	restored, err := os.ReadFile(storePath)
	if err != nil || string(restored) != string(original) {
		t.Fatalf("restored bytes differ from verified backup: %v", err)
	}
	rollback, err := os.ReadFile(filepath.Join(root, evidence.RollbackFileName))
	if err != nil || string(rollback) != string(changed) {
		t.Fatalf("rollback copy does not preserve pre-restore state: %v", err)
	}
	reopened, err := OpenStore(storePath, key)
	if err != nil {
		t.Fatal(err)
	}
	if err := reopened.View(func(snapshot Snapshot) error {
		if _, exists := snapshot.Merchants["mrc_original"]; !exists {
			t.Fatal("original record is missing after restore")
		}
		if _, exists := snapshot.Merchants["mrc_changed"]; exists {
			t.Fatal("post-backup record survived restore")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestBackupTamperWrongKeyAndInvalidSourceCommitFailClosed(t *testing.T) {
	root := t.TempDir()
	storePath := filepath.Join(root, "state.json")
	backupPath := filepath.Join(root, "backup.json")
	store, err := OpenStore(storePath, bytes32(7))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Update(func(*Snapshot) error { return nil }); err != nil {
		t.Fatal(err)
	}
	if _, err := CreateBackup(storePath, backupPath, bytes32(7), "short", time.Now()); err == nil {
		t.Fatal("backup accepted an imprecise source commit")
	}
	if _, err := CreateBackup(storePath, backupPath, bytes32(7), strings.Repeat("b", 40), time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyBackup(backupPath, bytes32(8)); err == nil {
		t.Fatal("backup verified with the wrong integrity key")
	}
	raw, err := os.ReadFile(backupPath)
	if err != nil {
		t.Fatal(err)
	}
	var archive map[string]any
	if err := json.Unmarshal(raw, &archive); err != nil {
		t.Fatal(err)
	}
	archive["mac"] = strings.Repeat("0", 64)
	tampered, _ := json.Marshal(archive)
	tamperedPath := filepath.Join(root, "tampered.json")
	if err := os.WriteFile(tamperedPath, tampered, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyBackup(tamperedPath, bytes32(7)); err == nil {
		t.Fatal("tampered backup archive verified")
	}
}

func TestRestoreToAbsentDestinationRequiresExplicitConfirmation(t *testing.T) {
	root := t.TempDir()
	storePath := filepath.Join(root, "source.json")
	backupPath := filepath.Join(root, "backup.json")
	restorePath := filepath.Join(root, "restored", "state.json")
	key := bytes32(7)
	store, err := OpenStore(storePath, key)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Update(func(*Snapshot) error { return nil }); err != nil {
		t.Fatal(err)
	}
	if _, err := CreateBackup(storePath, backupPath, key, strings.Repeat("c", 40), time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := RestoreBackup(backupPath, restorePath, key, "", time.Now()); err == nil {
		t.Fatal("absent restore destination did not require explicit confirmation")
	}
	evidence, err := RestoreBackup(backupPath, restorePath, key, "absent", time.Now())
	if err != nil || !evidence.Verified || evidence.BeforeSHA256 != "absent" || evidence.RollbackFileName != "" {
		t.Fatalf("new-destination restore failed: %+v %v", evidence, err)
	}
}

func TestRunningServiceLockBlocksRestoreAndOwnershipChangeBlocksUnlock(t *testing.T) {
	root := t.TempDir()
	storePath := filepath.Join(root, "state.json")
	backupPath := filepath.Join(root, "backup.json")
	key := bytes32(7)
	store, err := OpenStore(storePath, key)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Update(func(*Snapshot) error { return nil }); err != nil {
		t.Fatal(err)
	}
	if _, err := CreateBackup(storePath, backupPath, key, strings.Repeat("d", 40), time.Now()); err != nil {
		t.Fatal(err)
	}
	current, _ := os.ReadFile(storePath)
	serviceLock, err := AcquireStoreOperationLock(storePath, "service", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := RestoreBackup(backupPath, storePath, key, sha256Hex(current), time.Now()); err == nil || !strings.Contains(err.Error(), "locked") {
		t.Fatalf("restore was not blocked by running service lock: %v", err)
	}
	if err := serviceLock.Release(); err != nil {
		t.Fatal(err)
	}
	lock, err := AcquireStoreOperationLock(storePath, "restore", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(storePath+".operation.lock", []byte(`{"version":1,"purpose":"other"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := lock.Release(); err == nil || !strings.Contains(err.Error(), "changed ownership") {
		t.Fatalf("changed lock ownership was removed: %v", err)
	}
	if _, err := os.Stat(storePath + ".operation.lock"); err != nil {
		t.Fatalf("changed lock file was unexpectedly removed: %v", err)
	}
}
