package datafabric

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestOpenStoreMigratesLegacySchemaToCurrentWithoutDroppingState(t *testing.T) {
	path := filepath.Join(t.TempDir(), "fabric.json")
	legacy := newState()
	legacy.SchemaVersion = 1
	legacy.RedeliveryRuns = nil
	encoded, err := json.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, encoded, 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(store.RedeliveryRuns()) != 0 {
		t.Fatal("schema migration created synthetic redelivery history")
	}
	persisted, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var state persistedState
	if err := json.Unmarshal(persisted, &state); err != nil {
		t.Fatal(err)
	}
	if state.SchemaVersion != storeSchemaVersion || state.RedeliveryRuns == nil {
		t.Fatalf("schema v1 was not migrated in place: version=%d redeliveryRuns=%v", state.SchemaVersion, state.RedeliveryRuns)
	}
}
