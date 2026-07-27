package main

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/cardproduct"
)

func TestAdminBackupVerifyAndCorruptPrimaryRestore(t *testing.T) {
	fixedNow := time.Date(2026, 7, 27, 21, 0, 0, 0, time.UTC)
	previousNow := now
	now = func() time.Time { return fixedNow }
	t.Cleanup(func() { now = previousNow })

	key := bytes.Repeat([]byte{0xa1}, 32)
	statePath := filepath.Join(t.TempDir(), "card-state.json")
	if _, err := cardproduct.OpenStore(statePath, key); err != nil {
		t.Fatal(err)
	}
	t.Setenv("YNX_CARD_PRODUCT_STORE", statePath)
	t.Setenv("YNX_CARD_PRODUCT_INTEGRITY_KEY", hex.EncodeToString(key))

	backupPath := filepath.Join(t.TempDir(), "card-backup.json")
	var output bytes.Buffer
	if err := run([]string{"backup", backupPath}, &output); err != nil {
		t.Fatal(err)
	}
	var backup cardproduct.BackupManifest
	if err := json.Unmarshal(output.Bytes(), &backup); err != nil {
		t.Fatal(err)
	}
	if backup.SchemaVersion != cardproduct.BackupSchemaVersion || backup.Bytes <= 0 {
		t.Fatalf("unexpected backup output: %+v", backup)
	}

	output.Reset()
	if err := run([]string{"verify", backupPath}, &output); err != nil {
		t.Fatal(err)
	}
	var verified cardproduct.BackupManifest
	if err := json.Unmarshal(output.Bytes(), &verified); err != nil {
		t.Fatal(err)
	}
	if verified.SnapshotSHA256 == "" || verified.EffectiveStateVersion != cardproduct.StateVersion {
		t.Fatalf("unexpected verification output: %+v", verified)
	}

	corrupt := []byte("not-a-valid-card-state\n")
	if err := os.WriteFile(statePath, corrupt, 0o600); err != nil {
		t.Fatal(err)
	}
	quarantinePath := filepath.Join(t.TempDir(), "primary-state.quarantine")
	output.Reset()
	if err := run([]string{"restore", backupPath, quarantinePath}, &output); err != nil {
		t.Fatal(err)
	}
	var restored cardproduct.RestoreResult
	if err := json.Unmarshal(output.Bytes(), &restored); err != nil {
		t.Fatal(err)
	}
	if !restored.LiveStateExisted || !restored.RollbackQuarantined || restored.Rollback != nil || restored.RestoredSnapshotSHA256 == "" {
		t.Fatalf("unexpected restore output: %+v", restored)
	}
	if got, err := os.ReadFile(quarantinePath); err != nil || !bytes.Equal(got, corrupt) {
		t.Fatalf("corrupt primary was not quarantined exactly: %q %v", got, err)
	}
	if _, err := cardproduct.OpenStore(statePath, key); err != nil {
		t.Fatalf("admin restore did not create a valid state: %v", err)
	}
}

func TestAdminRejectsUnsafeInvocationAndKeys(t *testing.T) {
	var output bytes.Buffer
	if err := run(nil, &output); err == nil || !strings.Contains(err.Error(), "usage") {
		t.Fatalf("missing command did not return usage: %v", err)
	}
	t.Setenv("YNX_CARD_PRODUCT_STORE", filepath.Join(t.TempDir(), "card-state.json"))
	t.Setenv("YNX_CARD_PRODUCT_INTEGRITY_KEY", "short")
	if err := run([]string{"verify", filepath.Join(t.TempDir(), "backup.json")}, &output); err == nil || !strings.Contains(err.Error(), "32+ byte") {
		t.Fatalf("short integrity key was accepted: %v", err)
	}
	if _, err := decodeIntegrityKey(""); err == nil {
		t.Fatal("empty integrity key was accepted")
	}
}
