package payproduct

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"
)

func TestStoreFixtureMigrationBackupRestoreAndRollback(t *testing.T) {
	dir := t.TempDir()
	key := bytes32(31)
	legacyPath := filepath.Join(dir, "legacy-backup.json")
	statePath := filepath.Join(dir, "state.json")
	canonicalBackupPath := filepath.Join(dir, "backups", "pay-state.json")
	now := time.Date(2026, 7, 27, 14, 0, 0, 0, time.UTC)

	legacySnapshot := emptySnapshot()
	legacySnapshot.Merchants["merchant-legacy"] = Merchant{ID: "merchant-legacy", DisplayName: "Legacy Merchant"}
	legacySnapshot.Invoices["inv_legacy"] = Invoice{Version: 1, ID: "inv_legacy", MerchantID: "merchant-legacy", Amount: 9, Asset: NativeAsset, Network: ChainID, Status: "pending"}
	legacySnapshot.Deliveries["delivery-legacy"] = WebhookDelivery{ID: "delivery-legacy", Status: "failed", UpdatedAt: now}
	writeLegacyStoreFixture(t, legacyPath, key, legacySnapshot)

	current := emptySnapshot()
	current.Merchants["merchant-current"] = Merchant{ID: "merchant-current", DisplayName: "Current Merchant"}
	raw, err := encodeStoreSnapshot(current, key)
	if err != nil {
		t.Fatal(err)
	}
	if err := atomicWritePrivateFile(statePath, raw); err != nil {
		t.Fatal(err)
	}

	restore, err := RestoreStoreFromBackup(legacyPath, statePath, key)
	if err != nil {
		t.Fatal(err)
	}
	if !restore.Verified || !restore.RollbackVerified || restore.DurationNanos <= 0 || restore.RollbackPath == "" || restore.RollbackSHA256 == "" || restore.QuarantinePath != "" {
		t.Fatalf("restore receipt is incomplete: %+v", restore)
	}
	for _, expected := range []string{"drop-legacy-walletChallenges", "drop-legacy-walletSessions", "initialize-quantBills", "initialize-recurringDrafts", "initialize-splitPayments", "normalize-failed-webhook-to-dead-letter"} {
		if !slices.Contains(restore.Migrations, expected) {
			t.Fatalf("migration %q not reported: %+v", expected, restore.Migrations)
		}
	}
	restored, err := OpenStore(statePath, key)
	if err != nil {
		t.Fatal(err)
	}
	if err := restored.View(func(snapshot Snapshot) error {
		if _, ok := snapshot.Merchants["merchant-legacy"]; !ok {
			return errors.New("legacy merchant was not restored")
		}
		if _, ok := snapshot.Merchants["merchant-current"]; ok {
			return errors.New("pre-restore merchant leaked into restored state")
		}
		if snapshot.RecurringDrafts == nil || snapshot.SplitPayments == nil || snapshot.QuantBills == nil {
			return errors.New("additive maps were not migrated")
		}
		delivery := snapshot.Deliveries["delivery-legacy"]
		if delivery.Status != "dead_letter" || delivery.DeadLetteredAt == nil || !delivery.NextAttemptAt.IsZero() {
			return errors.New("legacy webhook was not migrated to dead letter")
		}
		if snapshot.Invoices["inv_legacy"].Version != 1 {
			return errors.New("legacy invoice version changed")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	rollback, err := RestoreStoreFromBackup(restore.RollbackPath, statePath, key)
	if err != nil {
		t.Fatal(err)
	}
	if !rollback.Verified || rollback.DurationNanos <= 0 {
		t.Fatalf("rollback receipt is incomplete: %+v", rollback)
	}
	rolledBack, err := OpenStore(statePath, key)
	if err != nil {
		t.Fatal(err)
	}
	if err := rolledBack.View(func(snapshot Snapshot) error {
		if _, ok := snapshot.Merchants["merchant-current"]; !ok {
			return errors.New("rollback did not restore current merchant")
		}
		if _, ok := snapshot.Merchants["merchant-legacy"]; ok {
			return errors.New("rollback retained restored legacy state")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	backup, err := rolledBack.CreateBackup(canonicalBackupPath)
	if err != nil {
		t.Fatal(err)
	}
	if !backup.Verified || backup.DurationNanos <= 0 || backup.Bytes <= 0 || backup.SHA256 == "" || backup.SnapshotVersion != 1 {
		t.Fatalf("backup receipt is incomplete: %+v", backup)
	}
	info, err := os.Stat(canonicalBackupPath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("backup mode is %o, want 600", info.Mode().Perm())
	}
	verification, err := VerifyStoreBackup(canonicalBackupPath, key)
	if err != nil || !verification.Verified || verification.SHA256 != backup.SHA256 || verification.RecordCount != backup.RecordCount {
		t.Fatalf("backup verification mismatch: %+v %v", verification, err)
	}
}

func TestStoreRestoreRejectsCorruptionWrongKeyAndFutureVersionWithoutMutation(t *testing.T) {
	dir := t.TempDir()
	key := bytes32(41)
	statePath := filepath.Join(dir, "state.json")
	backupPath := filepath.Join(dir, "backup.json")
	store, err := OpenStore(statePath, key)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Update(func(snapshot *Snapshot) error {
		snapshot.Merchants["merchant-safe"] = Merchant{ID: "merchant-safe"}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateBackup(backupPath); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}

	corruptPath := filepath.Join(dir, "corrupt.json")
	corrupt, err := os.ReadFile(backupPath)
	if err != nil {
		t.Fatal(err)
	}
	corrupt[len(corrupt)/2] ^= 1
	if err := os.WriteFile(corruptPath, corrupt, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := RestoreStoreFromBackup(corruptPath, statePath, key); err == nil {
		t.Fatal("corrupted backup was restored")
	}
	if _, err := RestoreStoreFromBackup(backupPath, statePath, bytes32(42)); err == nil {
		t.Fatal("backup was restored with the wrong integrity key")
	}
	after, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if sha256Hex(after) != sha256Hex(before) {
		t.Fatal("failed restore mutated the destination")
	}
	if _, err := store.CreateBackup(backupPath); err == nil {
		t.Fatal("existing backup artifact was overwritten")
	}

	corruptDestination := append([]byte(nil), before...)
	corruptDestination[len(corruptDestination)/3] ^= 1
	if err := os.WriteFile(statePath, corruptDestination, 0o600); err != nil {
		t.Fatal(err)
	}
	recovered, err := RestoreStoreFromBackup(backupPath, statePath, key)
	if err != nil {
		t.Fatal(err)
	}
	if !recovered.Verified || recovered.RollbackVerified || recovered.RollbackPath != "" || recovered.QuarantinePath == "" || recovered.QuarantineSHA256 != sha256Hex(corruptDestination) {
		t.Fatalf("corrupt destination was not quarantined correctly: %+v", recovered)
	}
	quarantined, err := os.ReadFile(recovered.QuarantinePath)
	if err != nil {
		t.Fatal(err)
	}
	if sha256Hex(quarantined) != sha256Hex(corruptDestination) {
		t.Fatal("quarantine artifact did not preserve the corrupt destination bytes")
	}
	if _, err := VerifyStoreBackup(statePath, key); err != nil {
		t.Fatalf("valid backup did not recover corrupt destination: %v", err)
	}

	future := emptySnapshot()
	future.Version = 2
	payload, err := json.Marshal(future)
	if err != nil {
		t.Fatal(err)
	}
	env := diskEnvelope{Version: 1, Payload: payload, MAC: (&Store{integrityKey: key}).mac(payload)}
	futureRaw, err := json.Marshal(env)
	if err != nil {
		t.Fatal(err)
	}
	futurePath := filepath.Join(dir, "future.json")
	if err := os.WriteFile(futurePath, futureRaw, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenStore(futurePath, key); err == nil {
		t.Fatal("future snapshot version was accepted")
	}
	if _, err := store.CreateBackup(statePath); err == nil {
		t.Fatal("backup was allowed to overwrite the live store")
	}
}

func writeLegacyStoreFixture(t *testing.T, path string, key []byte, snapshot Snapshot) {
	t.Helper()
	payload, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(payload, &fields); err != nil {
		t.Fatal(err)
	}
	delete(fields, "recurringDrafts")
	delete(fields, "splitPayments")
	delete(fields, "quantBills")
	fields["walletChallenges"] = json.RawMessage(`{"legacy":true}`)
	fields["walletSessions"] = json.RawMessage(`{"legacy":true}`)
	payload, err = json.Marshal(fields)
	if err != nil {
		t.Fatal(err)
	}
	env := diskEnvelope{Version: 1, Payload: payload, MAC: (&Store{integrityKey: key}).mac(payload)}
	raw, err := json.MarshalIndent(env, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
}
