package governance

import (
	"path/filepath"
	"testing"
	"time"
)

func TestRuntimeStatusReportsDegradedDependenciesWithoutFakeHealth(t *testing.T) {
	now := time.Date(2026, 7, 25, 16, 0, 0, 0, time.UTC)
	service := testService(t)
	path := filepath.Join(t.TempDir(), "state.json")
	if err := service.Save(path, now); err != nil {
		t.Fatal(err)
	}
	server, err := NewServer(service, &testAuth{}, path, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	status := server.runtimeStatus()
	if !status.OK || !status.Degraded || status.DatabaseStatus != "available" || status.ChainStatus != "not_integrated" || status.StartedAt != now || status.SchemaVersion != snapshotVersion || status.RegistryDigest == "" || status.Commit == "" || status.CommitSource == "" || status.Release == "" {
		t.Fatalf("runtime status is not truthful: %+v", status)
	}
	for _, dependency := range []string{"01-chain-core", "02-wallet-auth", "12-explorer", "13-monitor", "15-trust", "26-data-fabric", "29-integration", "30-security-sre"} {
		entry, ok := status.DependencyStatus[dependency]
		if !ok || !entry.Required || entry.Status == "healthy" || entry.Detail == "" {
			t.Fatalf("dependency %s was hidden or hard-coded healthy: %+v", dependency, entry)
		}
	}
}
