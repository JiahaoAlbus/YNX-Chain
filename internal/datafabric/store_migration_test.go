package datafabric

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
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

func TestOpenStoreBindsReceiptForLegacyFileErasureRecord(t *testing.T) {
	path := filepath.Join(t.TempDir(), "fabric.json")
	pseudonym, err := SubjectPseudonym("account.user.0001", privacyTestKey)
	if err != nil {
		t.Fatal(err)
	}
	legacy := newState()
	legacy.SchemaVersion = 3
	legacy.ErasureRequests[pseudonym] = ErasureRecord{
		AccountPseudonym: pseudonym,
		AuditID:          "audit.erase.legacy.0001",
		RequestedAt:      time.Date(2026, 8, 31, 0, 0, 0, 0, time.UTC),
		Status:           "analytics-suppressed-authoritative-retention-applied",
	}
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
	records := store.ErasureRecords()
	if len(records) != 1 || records[0].DerivedAnalyticsDeleted != 0 || ValidateErasureRecord(records[0]) != nil {
		t.Fatalf("legacy erasure record was not bound to a zero-count local receipt: %+v", records)
	}
}
