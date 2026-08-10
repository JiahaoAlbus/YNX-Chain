package mail

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestBackupRestorePreservesProviderRecoveryAndSenderIdentity(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"id":"backup-provider-message"}`))
	}))
	defer provider.Close()

	root := t.TempDir()
	statePath := filepath.Join(root, "live", "state.json")
	store, err := NewStore(statePath)
	if err != nil {
		t.Fatal(err)
	}
	_, signer, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Truncate(time.Second)
	apiKey := "unit" + "-test" + "-credential-reference"
	bridge := ResendBridge{
		BaseURL:       provider.URL,
		APIKey:        apiKey,
		From:          "mail@ynxweb4.com",
		WebhookSecret: testWebhookSecret(),
		Client:        provider.Client(),
	}
	svc, err := NewServiceWithInternetBridge(store, testVerifier{}, testAI{}, bridge, signer)
	if err != nil {
		t.Fatal(err)
	}
	svc.now = func() time.Time { return now }
	token, _, _ := signIn(t, svc, "@backup", "ynx1backup")
	draft, err := svc.SaveDraft(token, Draft{To: []string{"restore@example.net"}, Subject: "Backup", Body: "Preserve provider recovery state"})
	if err != nil {
		t.Fatal(err)
	}
	message, err := svc.SendDraftContext(context.Background(), token, draft.ID)
	if err != nil || message.Deliveries[0].State != DeliveryProviderAccepted {
		t.Fatalf("provider submission failed: %v %+v", err, message.Deliveries)
	}
	complaintBody := []byte(`{"type":"email.complained","created_at":"` + now.Add(time.Second).Format(time.RFC3339Nano) + `","data":{"email_id":"backup-provider-message"}}`)
	complaintRec := httptest.NewRecorder()
	NewHandler(svc).ServeHTTP(complaintRec, signedWebhookRequest(t, bridge.WebhookSecret, "backup-complaint-event", now, complaintBody))
	if complaintRec.Code != http.StatusOK {
		t.Fatalf("complaint event failed: %d %s", complaintRec.Code, complaintRec.Body.String())
	}

	backupDir := filepath.Join(root, "backups", "mail-backup-1")
	manifest, err := store.Backup(backupDir, signer)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.Format != backupFormat || len(manifest.Files) != 3 {
		t.Fatalf("backup manifest mismatch: %+v", manifest)
	}
	for _, name := range []string{"manifest.json", "sender.ed25519", "state.hmac-key", "state.json"} {
		info, err := os.Stat(filepath.Join(backupDir, name))
		if err != nil || info.Mode().Perm() != 0o600 {
			t.Fatalf("unsafe backup file %s: %v", name, err)
		}
	}
	if info, err := os.Stat(backupDir); err != nil || info.Mode().Perm() != 0o700 {
		t.Fatalf("unsafe backup directory: %v", err)
	}

	restoreDir := filepath.Join(root, "restored")
	restoredStatePath, restoredManifest, err := RestoreStoreBackup(backupDir, restoreDir)
	if err != nil {
		t.Fatal(err)
	}
	if restoredManifest.Format != manifest.Format || restoredStatePath != filepath.Join(restoreDir, "state.json") {
		t.Fatalf("restore result mismatch: %s %+v", restoredStatePath, restoredManifest)
	}
	if _, _, err := RestoreStoreBackup(backupDir, restoreDir); err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Fatalf("restore overwrote existing destination: %v", err)
	}
	restoredSignerText, err := os.ReadFile(filepath.Join(restoreDir, "sender.ed25519"))
	if err != nil {
		t.Fatal(err)
	}
	restoredSigner, err := base64.RawStdEncoding.DecodeString(strings.TrimSpace(string(restoredSignerText)))
	if err != nil || !ed25519.PrivateKey(restoredSigner).Equal(signer) {
		t.Fatal("restored Mail sender identity does not match")
	}
	restoredStore, err := NewStore(restoredStatePath)
	if err != nil {
		t.Fatal(err)
	}
	restoredService, err := NewServiceWithInternetBridge(restoredStore, testVerifier{}, testAI{}, bridge, ed25519.PrivateKey(restoredSigner))
	if err != nil {
		t.Fatal(err)
	}
	restoredService.now = func() time.Time { return now.Add(2 * time.Second) }
	letters, err := restoredService.DeadLetters(token)
	if err != nil || len(letters) != 1 || letters[0].DeliveryState != DeliveryComplained {
		t.Fatalf("restored dead letters mismatch: %v %+v", err, letters)
	}
	health := restoredService.InternetBridgeHealth()
	if health.ActiveSuppressions != 1 || health.OpenDeadLetters != 1 || health.LastVerifiedWebhookAt.IsZero() {
		t.Fatalf("restored provider health mismatch: %+v", health)
	}
	blockedDraft, _ := restoredService.SaveDraft(token, Draft{To: []string{"restore@example.net"}, Subject: "Blocked", Body: "Suppression must survive restore"})
	blocked, err := restoredService.SendDraft(token, blockedDraft.ID)
	if err != nil || blocked.Deliveries[0].Reason != "recipient_suppressed" {
		t.Fatalf("restored suppression was bypassed: %v %+v", err, blocked.Deliveries)
	}
}

func TestBackupRejectsInconsistentSenderIdentity(t *testing.T) {
	root := t.TempDir()
	store, err := NewStore(filepath.Join(root, "live", "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	invalid := make(ed25519.PrivateKey, ed25519.PrivateKeySize)
	if _, err := store.Backup(filepath.Join(root, "backup"), invalid); err == nil || !strings.Contains(err.Error(), "valid Mail sender identity") {
		t.Fatalf("inconsistent sender identity was accepted: %v", err)
	}
}

func TestStagedInstallUsesNoReplaceDestinationReservation(t *testing.T) {
	root := t.TempDir()
	stageA := filepath.Join(root, "stage-a")
	stageB := filepath.Join(root, "stage-b")
	for path, body := range map[string]string{stageA: "alpha", stageB: "beta"} {
		if err := os.Mkdir(path, 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(path, "state.json"), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	destination := filepath.Join(root, "destination")
	start := make(chan struct{})
	results := make(chan error, 2)
	for _, stage := range []string{stageA, stageB} {
		stage := stage
		go func() {
			<-start
			results <- installStagedDirectoryNoReplace(stage, destination, []string{"state.json"})
		}()
	}
	close(start)
	first, second := <-results, <-results
	if (first == nil) == (second == nil) {
		t.Fatalf("expected exactly one no-replace install winner: %v / %v", first, second)
	}
	body, err := os.ReadFile(filepath.Join(destination, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != "alpha" && string(body) != "beta" {
		t.Fatalf("unexpected installed content: %q", body)
	}
}

func TestRestoreRejectsTamperingUnsafeLayoutAndInvalidSender(t *testing.T) {
	t.Run("state HMAC", func(t *testing.T) {
		backupDir := newBackupFixture(t)
		statePath := filepath.Join(backupDir, "state.json")
		body, err := os.ReadFile(statePath)
		if err != nil {
			t.Fatal(err)
		}
		var envelope diskEnvelope
		if err := decodeStrict(body, &envelope); err != nil {
			t.Fatal(err)
		}
		var state map[string]json.RawMessage
		if err := json.Unmarshal(envelope.State, &state); err != nil {
			t.Fatal(err)
		}
		state["users"] = json.RawMessage(`{"tampered":{}}`)
		envelope.State, err = json.Marshal(state)
		if err != nil {
			t.Fatal(err)
		}
		writeBackupEnvelope(t, backupDir, envelope)
		refreshBackupManifestEntry(t, backupDir, "state.json")
		if _, _, err := RestoreStoreBackup(backupDir, filepath.Join(filepath.Dir(backupDir), "restored")); err == nil || !strings.Contains(err.Error(), "HMAC mismatch") {
			t.Fatalf("state tampering was accepted: %v", err)
		}
	})

	t.Run("unexpected file", func(t *testing.T) {
		backupDir := newBackupFixture(t)
		if err := os.WriteFile(filepath.Join(backupDir, "undeclared.bin"), []byte("undeclared"), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, _, err := RestoreStoreBackup(backupDir, filepath.Join(filepath.Dir(backupDir), "restored")); err == nil || !strings.Contains(err.Error(), "unexpected files") {
			t.Fatalf("undeclared backup file was accepted: %v", err)
		}
	})

	t.Run("unsafe permissions", func(t *testing.T) {
		backupDir := newBackupFixture(t)
		if err := os.Chmod(filepath.Join(backupDir, "manifest.json"), 0o644); err != nil {
			t.Fatal(err)
		}
		if _, _, err := RestoreStoreBackup(backupDir, filepath.Join(filepath.Dir(backupDir), "restored")); err == nil || !strings.Contains(err.Error(), "manifest permissions") {
			t.Fatalf("unsafe manifest permissions were accepted: %v", err)
		}
	})

	t.Run("inconsistent sender key", func(t *testing.T) {
		backupDir := newBackupFixture(t)
		invalid := make([]byte, ed25519.PrivateKeySize)
		if err := os.WriteFile(filepath.Join(backupDir, "sender.ed25519"), []byte(base64.RawStdEncoding.EncodeToString(invalid)), 0o600); err != nil {
			t.Fatal(err)
		}
		refreshBackupManifestEntry(t, backupDir, "sender.ed25519")
		if _, _, err := RestoreStoreBackup(backupDir, filepath.Join(filepath.Dir(backupDir), "restored")); err == nil || !strings.Contains(err.Error(), "sender key is invalid") {
			t.Fatalf("inconsistent sender key was accepted: %v", err)
		}
	})
}

func TestRestoreAcceptsLegacyStateWithoutProviderRecoveryFields(t *testing.T) {
	backupDir := newBackupFixture(t)
	statePath := filepath.Join(backupDir, "state.json")
	body, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	var envelope diskEnvelope
	if err := decodeStrict(body, &envelope); err != nil {
		t.Fatal(err)
	}
	var legacy map[string]json.RawMessage
	if err := json.Unmarshal(envelope.State, &legacy); err != nil {
		t.Fatal(err)
	}
	delete(legacy, "provider_events")
	delete(legacy, "suppressions")
	delete(legacy, "dead_letters")
	delete(legacy, "provider_health")
	legacyState, err := json.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	key, err := os.ReadFile(filepath.Join(backupDir, "state.hmac-key"))
	if err != nil {
		t.Fatal(err)
	}
	envelope.State = legacyState
	envelope.HMAC = encodeRawURL(hmacSHA256(key, legacyState))
	writeBackupEnvelope(t, backupDir, envelope)
	refreshBackupManifestEntry(t, backupDir, "state.json")

	restoredPath, _, err := RestoreStoreBackup(backupDir, filepath.Join(filepath.Dir(backupDir), "restored"))
	if err != nil {
		t.Fatal(err)
	}
	restored, err := NewStore(restoredPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := restored.view(func(state State) error {
		if state.ProviderEvents == nil || state.Suppressions == nil || state.DeadLetters == nil || state.ProviderHealth == nil {
			t.Fatal("legacy state was not normalized with provider recovery maps")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func newBackupFixture(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	store, err := NewStore(filepath.Join(root, "live", "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	_, signer, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	backupDir := filepath.Join(root, "backup")
	if _, err := store.Backup(backupDir, signer); err != nil {
		t.Fatal(err)
	}
	return backupDir
}

func writeBackupEnvelope(t *testing.T, backupDir string, envelope diskEnvelope) {
	t.Helper()
	body, err := json.MarshalIndent(envelope, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(backupDir, "state.json"), body, 0o600); err != nil {
		t.Fatal(err)
	}
}

func refreshBackupManifestEntry(t *testing.T, backupDir, name string) {
	t.Helper()
	manifestPath := filepath.Join(backupDir, "manifest.json")
	body, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	var manifest BackupManifest
	if err := decodeStrict(body, &manifest); err != nil {
		t.Fatal(err)
	}
	entry, err := backupFileEntry(filepath.Join(backupDir, name), name)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for index := range manifest.Files {
		if manifest.Files[index].Name == name {
			manifest.Files[index] = entry
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("manifest entry %s not found", name)
	}
	body, err = json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(manifestPath, body, 0o600); err != nil {
		t.Fatal(err)
	}
}
