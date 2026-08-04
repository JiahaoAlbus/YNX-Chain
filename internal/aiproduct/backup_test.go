package aiproduct

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func newBackupTestStore(t *testing.T, path string, key []byte) *Store {
	t.Helper()
	store, err := NewStore(path, key)
	if err != nil {
		t.Fatal(err)
	}
	return store
}

func createBackupFixture(t *testing.T, store *Store, account string) Conversation {
	t.Helper()
	conversation, err := store.CreateConversation(account, "Confidential recovery title")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddMessage(account, conversation.ID, Message{Role: "user", Content: "confidential recovery message"}); err != nil {
		t.Fatal(err)
	}
	return conversation
}

func TestBackupRestoreRoundTripEncryptsWholeStateAndPreservesAuditContinuity(t *testing.T) {
	directory := t.TempDir()
	key := bytes.Repeat([]byte{21}, 32)
	account := "backup-account"
	source := newBackupTestStore(t, filepath.Join(directory, "source", "state.json"), key)
	conversation := createBackupFixture(t, source, account)
	backupPath := filepath.Join(directory, "backups", "state.ynxbackup")

	manifest, err := source.CreateBackup(backupPath)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.SchemaVersion != backupSchemaVersion || manifest.ProductID != ProductID || manifest.StateVersion != currentStateVersion || manifest.AuditSequence == 0 || manifest.PayloadBytes == 0 {
		t.Fatalf("invalid backup manifest: %+v", manifest)
	}
	raw, err := os.ReadFile(backupPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{account, "Confidential recovery title", "confidential recovery message"} {
		if bytes.Contains(raw, []byte(secret)) {
			t.Fatalf("backup leaked plaintext %q", secret)
		}
	}
	info, err := os.Stat(backupPath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("backup mode=%o want=600", info.Mode().Perm())
	}
	if _, err := source.CreateBackup(backupPath); err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Fatalf("backup overwrite was not rejected: %v", err)
	}

	targetPath := filepath.Join(directory, "target", "state.json")
	target := newBackupTestStore(t, targetPath, key)
	restoredManifest, err := target.RestoreBackup(backupPath)
	if err != nil {
		t.Fatal(err)
	}
	if restoredManifest.BackupID != manifest.BackupID {
		t.Fatalf("restored backup ID=%q want=%q", restoredManifest.BackupID, manifest.BackupID)
	}
	restoredConversation, messages, err := target.Conversation(account, conversation.ID)
	if err != nil {
		t.Fatal(err)
	}
	if restoredConversation.Title != "Confidential recovery title" || len(messages) != 1 || messages[0].Content != "confidential recovery message" {
		t.Fatalf("restored state mismatch: conversation=%+v messages=%+v", restoredConversation, messages)
	}
	systemAudits := target.Audits("system")
	if len(systemAudits) != 1 || systemAudits[0].Type != "state_restored" || systemAudits[0].ObjectID != manifest.BackupID {
		t.Fatalf("missing restore audit: %+v", systemAudits)
	}
	if err := validateAuditChain(target.state); err != nil {
		t.Fatalf("restored audit chain invalid: %v", err)
	}

	restarted := newBackupTestStore(t, targetPath, key)
	if _, _, err := restarted.Conversation(account, conversation.ID); err != nil {
		t.Fatalf("restored state did not survive restart: %v", err)
	}
	if _, err := restarted.RestoreBackup(backupPath); err == nil || !strings.Contains(err.Error(), "replay") {
		t.Fatalf("backup replay after restart was not rejected: %v", err)
	}
}

func TestBackupRestoreRejectsWrongKeyTamperManifestAndUnknownFields(t *testing.T) {
	directory := t.TempDir()
	key := bytes.Repeat([]byte{31}, 32)
	source := newBackupTestStore(t, filepath.Join(directory, "source.json"), key)
	createBackupFixture(t, source, "account-a")
	backupPath := filepath.Join(directory, "valid.ynxbackup")
	if _, err := source.CreateBackup(backupPath); err != nil {
		t.Fatal(err)
	}

	wrongKeyTarget := newBackupTestStore(t, filepath.Join(directory, "wrong-key.json"), bytes.Repeat([]byte{32}, 32))
	if _, err := wrongKeyTarget.RestoreBackup(backupPath); err == nil || !strings.Contains(err.Error(), "authentication") {
		t.Fatalf("wrong key was not rejected: %v", err)
	}

	raw, err := os.ReadFile(backupPath)
	if err != nil {
		t.Fatal(err)
	}
	var envelope backupEnvelope
	if err := decodeStrictJSON(raw, &envelope); err != nil {
		t.Fatal(err)
	}

	manifestTampered := envelope
	manifestTampered.Manifest.ProductID = "ynx-wallet"
	manifestRaw, _ := json.Marshal(manifestTampered)
	manifestPath := filepath.Join(directory, "manifest-tampered.ynxbackup")
	if err := os.WriteFile(manifestPath, manifestRaw, 0o600); err != nil {
		t.Fatal(err)
	}
	target := newBackupTestStore(t, filepath.Join(directory, "target.json"), key)
	if _, err := target.RestoreBackup(manifestPath); err == nil || !strings.Contains(err.Error(), "incompatible") {
		t.Fatalf("manifest substitution was not rejected: %v", err)
	}

	cipherTampered := envelope
	cipherBytes, err := base64.RawStdEncoding.DecodeString(cipherTampered.Ciphertext)
	if err != nil {
		t.Fatal(err)
	}
	cipherBytes[len(cipherBytes)/2] ^= 0x80
	cipherTampered.Ciphertext = base64.RawStdEncoding.EncodeToString(cipherBytes)
	cipherRaw, _ := json.Marshal(cipherTampered)
	cipherPath := filepath.Join(directory, "cipher-tampered.ynxbackup")
	if err := os.WriteFile(cipherPath, cipherRaw, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := target.RestoreBackup(cipherPath); err == nil || !strings.Contains(err.Error(), "authentication") {
		t.Fatalf("ciphertext tamper was not rejected: %v", err)
	}

	unknownPath := filepath.Join(directory, "unknown-field.ynxbackup")
	unknownRaw := append(bytes.TrimSuffix(raw, []byte("\n}")), []byte(",\n  \"unexpected\": true\n}")...)
	if err := os.WriteFile(unknownPath, unknownRaw, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := target.RestoreBackup(unknownPath); err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("unknown backup field was not rejected: %v", err)
	}
	if got := target.ListConversations("account-a", false); len(got) != 0 {
		t.Fatalf("failed restore mutated target state: %+v", got)
	}
}

func TestBackupRestoreRejectsRollbackOfNewerState(t *testing.T) {
	directory := t.TempDir()
	key := bytes.Repeat([]byte{41}, 32)
	source := newBackupTestStore(t, filepath.Join(directory, "source.json"), key)
	createBackupFixture(t, source, "source-account")
	backupPath := filepath.Join(directory, "older.ynxbackup")
	manifest, err := source.CreateBackup(backupPath)
	if err != nil {
		t.Fatal(err)
	}

	target := newBackupTestStore(t, filepath.Join(directory, "target.json"), key)
	for index := 0; index < 3; index++ {
		if _, err := target.CreateConversation("target-account", "newer state"); err != nil {
			t.Fatal(err)
		}
	}
	if target.state.AuditSequence <= manifest.AuditSequence {
		t.Fatalf("test setup did not create newer state: target=%d backup=%d", target.state.AuditSequence, manifest.AuditSequence)
	}
	if _, err := target.RestoreBackup(backupPath); err == nil || !strings.Contains(err.Error(), "roll back") {
		t.Fatalf("newer state rollback was not rejected: %v", err)
	}
	if got := target.ListConversations("target-account", false); len(got) != 3 {
		t.Fatalf("rollback rejection mutated newer state: %d conversations", len(got))
	}
}

func TestBackupRestoreRejectsDivergentTargetEvenWhenTargetSequenceIsOlder(t *testing.T) {
	directory := t.TempDir()
	key := bytes.Repeat([]byte{45}, 32)
	source := newBackupTestStore(t, filepath.Join(directory, "source.json"), key)
	createBackupFixture(t, source, "source-account")
	backupPath := filepath.Join(directory, "source.ynxbackup")
	manifest, err := source.CreateBackup(backupPath)
	if err != nil {
		t.Fatal(err)
	}

	target := newBackupTestStore(t, filepath.Join(directory, "target.json"), key)
	if _, err := target.CreateConversation("different-account", "divergent state"); err != nil {
		t.Fatal(err)
	}
	if target.state.AuditSequence >= manifest.AuditSequence {
		t.Fatalf("test target must be older: target=%d backup=%d", target.state.AuditSequence, manifest.AuditSequence)
	}
	if _, err := target.RestoreBackup(backupPath); err == nil || !strings.Contains(err.Error(), "divergent") {
		t.Fatalf("divergent restore was not rejected: %v", err)
	}
	if got := target.ListConversations("different-account", false); len(got) != 1 {
		t.Fatalf("divergent restore rejection mutated target: %+v", got)
	}
}

func TestStoreLoadRejectsAuditTamper(t *testing.T) {
	directory := t.TempDir()
	key := bytes.Repeat([]byte{51}, 32)
	statePath := filepath.Join(directory, "state.json")
	store := newBackupTestStore(t, statePath, key)
	if _, err := store.CreateConversation("audit-account", "audit title"); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	var state persistentState
	if err := json.Unmarshal(raw, &state); err != nil {
		t.Fatal(err)
	}
	state.Audits[0].Detail = "tampered detail"
	tampered, _ := json.MarshalIndent(state, "", "  ")
	if err := os.WriteFile(statePath, tampered, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewStore(statePath, key); err == nil || !strings.Contains(err.Error(), "authentication") {
		t.Fatalf("audit tamper was not rejected: %v", err)
	}
}

func TestStoreLoadRejectsTruncatedAuditChain(t *testing.T) {
	directory := t.TempDir()
	key := bytes.Repeat([]byte{55}, 32)
	statePath := filepath.Join(directory, "state.json")
	store := newBackupTestStore(t, statePath, key)
	createBackupFixture(t, store, "audit-account")
	raw, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	var state persistentState
	if err := json.Unmarshal(raw, &state); err != nil {
		t.Fatal(err)
	}
	state.Audits = append([]AuditRecord(nil), state.Audits[1:]...)
	truncated, _ := json.MarshalIndent(state, "", "  ")
	if err := os.WriteFile(statePath, truncated, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewStore(statePath, key); err == nil || !strings.Contains(err.Error(), "sequence one") {
		t.Fatalf("truncated audit chain was not rejected: %v", err)
	}
}

func TestBackupManifestTimeIsUTC(t *testing.T) {
	directory := t.TempDir()
	key := bytes.Repeat([]byte{61}, 32)
	store := newBackupTestStore(t, filepath.Join(directory, "state.json"), key)
	fixed := time.Date(2026, time.July, 29, 2, 55, 12, 0, time.FixedZone("test", 8*60*60))
	store.now = func() time.Time { return fixed }
	manifest, err := store.CreateBackup(filepath.Join(directory, "time.ynxbackup"))
	if err != nil {
		t.Fatal(err)
	}
	if manifest.CreatedAt.Location() != time.UTC || !manifest.CreatedAt.Equal(fixed) {
		t.Fatalf("backup time=%s location=%s", manifest.CreatedAt, manifest.CreatedAt.Location())
	}
}
