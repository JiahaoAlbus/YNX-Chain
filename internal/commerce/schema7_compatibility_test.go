package commerce

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestProductionSchema7ReadPreservesExactAuthenticatedState(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "commerce.json")
	key := bytes.Repeat([]byte{0x73}, 32)
	now := time.Date(2026, 8, 22, 18, 29, 0, 0, time.UTC)

	snapshot := emptySnapshot()
	snapshot.ProviderConfigs["store_schema7:payments"] = ProviderConfig{
		StoreID:      "store_schema7",
		Kind:         "payments",
		Mode:         "testnet",
		Endpoint:     "https://pay.example.invalid",
		AccessRef:    "protected-reference",
		Health:       "healthy",
		Capabilities: []string{"authorize", "capture"},
		Revision:     7,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	original, err := encodePersisted(snapshot, key)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, original, 0o600); err != nil {
		t.Fatal(err)
	}

	opened, err := OpenWithIntegrity(path, key)
	if err != nil {
		t.Fatal(err)
	}
	config := opened.s.ProviderConfigs["store_schema7:payments"]
	if config.Revision != 7 || config.AccessRef != "protected-reference" || len(config.Capabilities) != 2 {
		t.Fatalf("schema 7 provider state was not preserved: %+v", config)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(after, original) {
		t.Fatal("opening current schema 7 state rewrote the authenticated production bytes")
	}
	if _, err := os.Stat(path + ".bak"); !os.IsNotExist(err) {
		t.Fatalf("current schema 7 read unexpectedly created a migration backup: %v", err)
	}
}

func TestSchema2MigrationCreatesExactRollbackBeforeSchema7Write(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "commerce.json")
	key := bytes.Repeat([]byte{0x27}, 32)

	legacy := emptySnapshot()
	legacy.Version = 2
	legacy.SellerRoles = nil
	legacy.SellerRevocations = nil
	legacy.SellerInvitations = nil
	legacy.SellerEvents = nil
	legacy.ProviderConfigs = nil
	original, err := encodePersisted(legacy, key)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, original, 0o600); err != nil {
		t.Fatal(err)
	}

	opened, err := OpenWithIntegrity(path, key)
	if err != nil {
		t.Fatal(err)
	}
	if opened.s.Version != CurrentPersistenceSchemaVersion {
		t.Fatalf("schema migration ended at %d, want %d", opened.s.Version, CurrentPersistenceSchemaVersion)
	}
	if opened.s.SellerRoles == nil || opened.s.SellerRevocations == nil || opened.s.SellerInvitations == nil || opened.s.SellerEvents == nil || opened.s.ProviderConfigs == nil {
		t.Fatal("schema 2 migration did not initialize the schema 7 state surfaces")
	}

	rollback, err := os.ReadFile(path + ".bak")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(rollback, original) {
		t.Fatal("schema migration rollback copy does not match the exact pre-migration bytes")
	}
	migrated, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(migrated, original) {
		t.Fatal("schema 2 state was not migrated")
	}
	var decoded Snapshot
	if err := decodePersisted(migrated, key, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Version != CurrentPersistenceSchemaVersion {
		t.Fatalf("persisted schema migration ended at %d, want %d", decoded.Version, CurrentPersistenceSchemaVersion)
	}
}
