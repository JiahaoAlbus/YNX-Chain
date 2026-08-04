package video

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLegacyStateMigratesAndPersistsSchemaVersion(t *testing.T) {
	root := t.TempDir()
	key := []byte(strings.Repeat("m", 32))
	legacy := emptyState()
	legacy.SchemaVersion = 0
	persistStateFixture(t, root, key, legacy)

	store, err := OpenStore(root, key)
	if err != nil {
		t.Fatal(err)
	}
	if store.state.SchemaVersion != currentStateSchemaVersion {
		t.Fatalf("schema version = %d, want %d", store.state.SchemaVersion, currentStateSchemaVersion)
	}
	persisted, err := os.ReadFile(filepath.Join(root, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(persisted), `"schema_version": 2`) {
		t.Fatalf("migrated state did not persist schema version: %s", persisted)
	}
	if _, err = OpenStore(root, key); err != nil {
		t.Fatalf("reopen migrated state: %v", err)
	}
}

func TestNewerStateSchemaFailsClosed(t *testing.T) {
	root := t.TempDir()
	key := []byte(strings.Repeat("n", 32))
	state := emptyState()
	state.SchemaVersion = currentStateSchemaVersion + 1
	persistStateFixture(t, root, key, state)

	_, err := OpenStore(root, key)
	if err == nil || !strings.Contains(err.Error(), "newer than supported") {
		t.Fatalf("expected downgrade guard, got %v", err)
	}
}

func TestStateMigrationRollbackRoundTrip(t *testing.T) {
	state := State{}
	normalize(&state)
	changed, err := migrateState(&state, currentStateSchemaVersion)
	if err != nil || !changed || state.SchemaVersion != currentStateSchemaVersion {
		t.Fatalf("upgrade failed: changed=%v version=%d err=%v", changed, state.SchemaVersion, err)
	}
	changed, err = migrateState(&state, 0)
	if err != nil || !changed || state.SchemaVersion != 0 {
		t.Fatalf("rollback failed: changed=%v version=%d err=%v", changed, state.SchemaVersion, err)
	}
	changed, err = migrateState(&state, currentStateSchemaVersion)
	if err != nil || !changed || state.SchemaVersion != currentStateSchemaVersion {
		t.Fatalf("re-upgrade failed: changed=%v version=%d err=%v", changed, state.SchemaVersion, err)
	}
}

func persistStateFixture(t *testing.T, root string, key []byte, state State) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(root, "objects"), 0700); err != nil {
		t.Fatal(err)
	}
	store := &Store{
		root:         root,
		statePath:    filepath.Join(root, "state.json"),
		integrityKey: append([]byte(nil), key...),
		state:        state,
	}
	if err := store.persistLocked(); err != nil {
		t.Fatal(err)
	}
}
