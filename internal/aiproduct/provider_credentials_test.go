package aiproduct

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestProviderCredentialsEncryptedIsolatedAndPersistent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	key := bytes.Repeat([]byte{17}, 32)
	store, err := NewStore(path, key)
	if err != nil {
		t.Fatal(err)
	}
	const secret = "test-provider-secret-not-real"
	metadata, err := store.SaveProviderCredential("account-a", "example", "model-1", secret)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(metadata)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte(secret)) || bytes.Contains(encoded, []byte(secret)) {
		t.Fatal("plaintext provider credential escaped")
	}
	if len(store.ListProviderCredentials("account-b")) != 0 {
		t.Fatal("cross-account metadata access")
	}
	if _, _, err := store.providerCredential("account-b", "example"); err == nil {
		t.Fatal("cross-account key access")
	}
	reopened, err := NewStore(path, key)
	if err != nil {
		t.Fatal(err)
	}
	_, actual, err := reopened.providerCredential("account-a", "example")
	if err != nil || actual != secret {
		t.Fatal("encrypted provider credential did not survive restart")
	}
	if err := reopened.DeleteProviderCredential("account-b", "example"); err != nil {
		t.Fatal(err)
	}
	if len(reopened.ListProviderCredentials("account-a")) != 1 {
		t.Fatal("foreign deletion changed owner record")
	}
	if err := reopened.DeleteProviderCredential("account-a", "example"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := reopened.providerCredential("account-a", "example"); err == nil {
		t.Fatal("deleted credential remained accessible")
	}
}

func TestProviderCredentialCiphertextBoundToAccountProviderAndModel(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "state.json"), bytes.Repeat([]byte{19}, 32))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveProviderCredential("account-a", "example", "model-1", "test-secret-value"); err != nil {
		t.Fatal(err)
	}
	record := store.state.ProviderCredentials["account-a"]["example"]
	store.state.ProviderCredentials["account-b"] = map[string]storedProviderCredential{"example": record}
	if _, _, err := store.providerCredential("account-b", "example"); err == nil {
		t.Fatal("account substitution accepted")
	}
	store.state.ProviderCredentials["account-a"]["other"] = record
	if _, _, err := store.providerCredential("account-a", "other"); err == nil {
		t.Fatal("provider substitution accepted")
	}
	record.Model = "model-2"
	store.state.ProviderCredentials["account-a"]["example"] = record
	if _, _, err := store.providerCredential("account-a", "example"); err == nil {
		t.Fatal("model substitution accepted")
	}
}

func TestProviderCredentialAccountDeletionPersistsWithoutAffectingOtherAccounts(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	key := bytes.Repeat([]byte{23}, 32)
	store, err := NewStore(path, key)
	if err != nil {
		t.Fatal(err)
	}
	for _, account := range []string{"account-a", "account-b"} {
		if _, err := store.SaveProviderCredential(account, "example", "model-1", "test-secret-"+account); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.DeleteAccount("account-a"); err != nil {
		t.Fatal(err)
	}
	reopened, err := NewStore(path, key)
	if err != nil {
		t.Fatal(err)
	}
	if len(reopened.ListProviderCredentials("account-a")) != 0 {
		t.Fatal("deleted account still has provider credentials")
	}
	if _, _, err := reopened.providerCredential("account-a", "example"); err == nil {
		t.Fatal("deleted key can still be resolved")
	}
	if _, key, err := reopened.providerCredential("account-b", "example"); err != nil || key != "test-secret-account-b" {
		t.Fatal("account deletion damaged another account")
	}
}

func TestProviderCredentialsEncryptedBackupRecovery(t *testing.T) {
	dir := t.TempDir()
	key := bytes.Repeat([]byte{29}, 32)
	store, err := NewStore(filepath.Join(dir, "source.json"), key)
	if err != nil {
		t.Fatal(err)
	}
	const secret = "test-backup-provider-secret"
	if _, err := store.SaveProviderCredential("account-a", "example", "model-1", secret); err != nil {
		t.Fatal(err)
	}
	backup := filepath.Join(dir, "backup.json")
	if _, err := store.CreateBackup(backup); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(backup)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte(secret)) {
		t.Fatal("backup contains plaintext provider key")
	}
	target, err := NewStore(filepath.Join(dir, "target.json"), key)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := target.RestoreBackup(backup); err != nil {
		t.Fatal(err)
	}
	if _, actual, err := target.providerCredential("account-a", "example"); err != nil || actual != secret {
		t.Fatal("backup lost encrypted credential")
	}
	if _, _, err := target.providerCredential("account-b", "example"); err == nil {
		t.Fatal("backup restore lost account isolation")
	}
}
