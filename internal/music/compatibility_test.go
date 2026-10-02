package music

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestStateCompatibilityPolicy(t *testing.T) {
	policy := StateCompatibility()
	if !validStateCompatibility(policy) {
		t.Fatalf("invalid compatibility policy: %#v", policy)
	}
	if policy.CurrentSchemaVersion != currentStateSchemaVersion || policy.MinimumReadableSchemaVersion != 1 || policy.MinimumWritableSchemaVersion != currentStateSchemaVersion {
		t.Fatalf("unexpected compatibility boundaries: %#v", policy)
	}
	if policy.DowngradeSupported || !strings.Contains(policy.RollbackStrategy, "pre-upgrade backup") {
		t.Fatalf("rollback boundary is overstated: %#v", policy)
	}
	first := StateCompatibility()
	first.ReadableSchemaVersions[0] = 99
	second := StateCompatibility()
	if second.ReadableSchemaVersions[0] != 1 {
		t.Fatal("compatibility slices are shared between callers")
	}
	encoded, err := json.Marshal(second)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"currentSchemaVersion", "minimumReadableSchemaVersion", "minimumWritableSchemaVersion", "downgradeSupported", "rollbackStrategy"} {
		if !strings.Contains(string(encoded), `"`+field+`"`) {
			t.Fatalf("compatibility JSON omitted %s: %s", field, encoded)
		}
	}
}

func TestBackupManifestCarriesCompatibilityPolicy(t *testing.T) {
	s := testService(t)
	publishTrack(t, s, testAccount(t, 8), false)
	manifest, err := s.CreateBackup(t.TempDir() + "/compatibility-backup")
	if err != nil {
		t.Fatal(err)
	}
	if manifest.StateCompatibility == nil || !validStateCompatibility(*manifest.StateCompatibility) || manifest.StateCompatibility.CurrentSchemaVersion != manifest.StateSchemaVersion {
		t.Fatalf("backup omitted or corrupted compatibility policy: %#v", manifest.StateCompatibility)
	}
}
