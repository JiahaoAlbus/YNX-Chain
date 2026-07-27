package finance

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var backupTestAuthenticationKey = []byte("ynx-finance-test-backup-authentication-key-v1")

func TestBackupVerifyRestoreRoundTrip(t *testing.T) {
	dir := t.TempDir()
	statePath := filepath.Join(dir, "live", "finance-state.json")
	backupPath := filepath.Join(dir, "backups", "finance-backup.json")
	store, err := OpenStore(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Update(testAccount, "fixture.created", "category-original", func(state *AccountState) error {
		state.Categories = append(state.Categories, Category{ID: "category-original", Name: "Original", Color: "#002FA7", CreatedAt: time.Now().UTC(), Source: "user"})
		state.Notes = append(state.Notes, Note{ID: "note-original", Body: "Preserve this private plan", Source: "user", CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()})
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.UseNonce("backup-round-trip-nonce", time.Now().UTC().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}

	manifest, err := store.Backup(backupPath, backupTestAuthenticationKey)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.SchemaVersion != backupSchemaVersion || manifest.StateVersion != currentStateVersion || manifest.AccountCount != 1 || manifest.AuditEventCount != 1 || manifest.UsedNonceCount != 1 || manifest.SHA256 == "" || manifest.Bytes == 0 {
		t.Fatalf("backup manifest is incomplete: %+v", manifest)
	}
	assertPrivateFile(t, backupPath)
	verified, err := VerifyBackup(backupPath, backupTestAuthenticationKey)
	if err != nil {
		t.Fatal(err)
	}
	if verified != manifest {
		t.Fatalf("verified manifest differs from written manifest: got %+v want %+v", verified, manifest)
	}

	if err := store.Update(testAccount, "fixture.mutated", "category-new", func(state *AccountState) error {
		state.Categories = append(state.Categories, Category{ID: "category-new", Name: "New", Color: "#111111", CreatedAt: time.Now().UTC(), Source: "user"})
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	receipt, err := RestoreStore(statePath, backupPath, backupTestAuthenticationKey)
	if err != nil {
		t.Fatal(err)
	}
	if receipt.Manifest != manifest || receipt.RestoredSHA256 != manifest.SHA256 || receipt.PreviousStatePath == "" || receipt.PreviousStateSHA256 == "" || receipt.PreviousStateBytes == 0 || receipt.ReceiptPath == "" {
		t.Fatalf("restore receipt is incomplete: %+v", receipt)
	}
	previousRaw, err := os.ReadFile(receipt.PreviousStatePath)
	if err != nil {
		t.Fatal(err)
	}
	previousDigest := sha256.Sum256(previousRaw)
	if receipt.PreviousStateSHA256 != hex.EncodeToString(previousDigest[:]) || receipt.PreviousStateBytes != len(previousRaw) {
		t.Fatalf("pre-restore evidence does not match preserved state: %+v", receipt)
	}
	assertPrivateFile(t, statePath)
	assertPrivateFile(t, receipt.PreviousStatePath)
	assertPrivateFile(t, receipt.ReceiptPath)

	restored, err := OpenStore(statePath)
	if err != nil {
		t.Fatal(err)
	}
	state := restored.Account(testAccount)
	if len(state.Categories) != 1 || state.Categories[0].ID != "category-original" || len(state.Notes) != 1 || state.Notes[0].ID != "note-original" {
		t.Fatalf("restored state does not match backup snapshot: %+v", state)
	}
	if err := restored.UseNonce("backup-round-trip-nonce", time.Now().UTC().Add(time.Hour)); err == nil || !strings.Contains(err.Error(), "already been used") {
		t.Fatalf("restored nonce replay protection is missing: %v", err)
	}
}

func TestBackupTamperAndUnknownFieldsFailClosed(t *testing.T) {
	dir := t.TempDir()
	statePath := filepath.Join(dir, "finance-state.json")
	backupPath := filepath.Join(dir, "finance-backup.json")
	store, err := OpenStore(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Update(testAccount, "fixture.created", "original", func(state *AccountState) error {
		state.Categories = append(state.Categories, Category{ID: "original", Name: "Original", Color: "#002FA7", CreatedAt: time.Now().UTC(), Source: "user"})
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Backup(backupPath, backupTestAuthenticationKey); err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(backupPath)
	if err != nil {
		t.Fatal(err)
	}
	var envelope backupEnvelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		t.Fatal(err)
	}
	var state persistedState
	if err := json.Unmarshal(envelope.State, &state); err != nil {
		t.Fatal(err)
	}
	account := state.Accounts[testAccount]
	account.Categories = append(account.Categories, Category{ID: "tampered", Name: "Tampered", Source: "attacker"})
	state.Accounts[testAccount] = account
	envelope.State, _ = json.Marshal(state)
	tamperedRaw, _ := json.MarshalIndent(envelope, "", "  ")
	if err := os.WriteFile(backupPath, tamperedRaw, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyBackup(backupPath, backupTestAuthenticationKey); err == nil || !strings.Contains(err.Error(), "authentication") {
		t.Fatalf("tampered backup was not rejected: %v", err)
	}
	if _, err := RestoreStore(statePath, backupPath, backupTestAuthenticationKey); err == nil {
		t.Fatal("tampered backup was restored")
	}
	live, err := OpenStore(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if categories := live.Account(testAccount).Categories; len(categories) != 1 || categories[0].ID != "original" {
		t.Fatalf("failed restore changed live state: %+v", categories)
	}

	if _, err := store.Backup(backupPath, backupTestAuthenticationKey); err != nil {
		t.Fatal(err)
	}
	raw, _ = os.ReadFile(backupPath)
	var object map[string]any
	if err := json.Unmarshal(raw, &object); err != nil {
		t.Fatal(err)
	}
	object["unexpected"] = true
	unknownRaw, _ := json.Marshal(object)
	if err := os.WriteFile(backupPath, unknownRaw, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyBackup(backupPath, backupTestAuthenticationKey); err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("backup with unknown fields was not rejected: %v", err)
	}
}

func TestBackupRejectsUnsafePathsAndUnsupportedState(t *testing.T) {
	dir := t.TempDir()
	statePath := filepath.Join(dir, "finance-state.json")
	store, err := OpenStore(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Backup(statePath, backupTestAuthenticationKey); err == nil {
		t.Fatal("backup overwrote the live state path")
	}
	if _, err := RestoreStore(statePath, statePath, backupTestAuthenticationKey); err == nil {
		t.Fatal("restore accepted the live state as its own backup")
	}

	unsupported := persistedState{Version: currentStateVersion + 1, Accounts: map[string]AccountState{}, Nonces: map[string]time.Time{}}
	raw, _ := json.Marshal(unsupported)
	if err := os.WriteFile(statePath, raw, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenStore(statePath); err == nil || !strings.Contains(err.Error(), "unsupported") {
		t.Fatalf("unsupported state version was not rejected: %v", err)
	}
}

func TestBackupAuthenticationFailsClosed(t *testing.T) {
	dir := t.TempDir()
	statePath := filepath.Join(dir, "finance-state.json")
	backupPath := filepath.Join(dir, "finance-backup.json")
	store, err := OpenStore(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Backup(backupPath, []byte("short")); err == nil || !strings.Contains(err.Error(), "at least") {
		t.Fatalf("short authentication key was accepted: %v", err)
	}
	if _, err := store.Backup(backupPath, backupTestAuthenticationKey); err != nil {
		t.Fatal(err)
	}
	wrongKey := []byte("ynx-finance-wrong-backup-authentication-key-v1")
	if _, err := VerifyBackup(backupPath, wrongKey); err == nil || !strings.Contains(err.Error(), "authentication") {
		t.Fatalf("wrong authentication key was accepted: %v", err)
	}
	if _, err := RestoreStore(statePath, backupPath, wrongKey); err == nil || !strings.Contains(err.Error(), "authentication") {
		t.Fatalf("restore accepted the wrong authentication key: %v", err)
	}
}

func assertPrivateFile(t *testing.T, path string) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("%s permissions are %o, want 600", path, info.Mode().Perm())
	}
}
