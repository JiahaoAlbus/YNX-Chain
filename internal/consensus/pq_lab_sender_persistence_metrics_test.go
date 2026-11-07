//go:build unix

package consensus

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPQLabSenderPUBLICPersistenceRolesKeepOriginalWrites(t *testing.T) {
	for name, role := range map[string]string{"request.json": "request", "INTENT.json": "intent", "transaction.wire": "wire", "transaction.abci": "envelope", "RESULT.json": "result", "CONFIRMED.json": "confirmed"} {
		t.Run(role, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), name)
			original := []byte("original-public-fixture\x00")
			metrics := &PQLabMetrics{}
			if err := pqLabWriteExclusiveMeasured(path, original, metrics); err != nil {
				t.Fatal(err)
			}
			if err := pqLabWriteExclusiveMeasured(path, []byte("replacement"), metrics); err == nil {
				t.Fatal("exclusive original was replaced")
			}
			got, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(got, original) {
				t.Fatal("original bytes changed", err)
			}
			info, err := os.Stat(path)
			if err != nil || info.Mode().Perm() != 0600 {
				t.Fatal("original permissions changed", err)
			}
			snapshot := metrics.Snapshot()
			for stage, calls := range map[string]uint64{"sender.exclusivePersistenceTotal": 2, "sender.fileFsync": 1, "sender.directoryFsync": 1, "sender.persistence." + role + ".total": 2, "sender.persistence." + role + ".write": 1, "sender.persistence." + role + ".fileFsync": 1, "sender.persistence." + role + ".directoryFsync": 1} {
				if v, ok := snapshot.Stages[stage]; !ok || v.Calls != calls || v.ElapsedNS < 0 {
					t.Fatal("missing successful or failed original boundary", stage, v)
				}
			}
			for stage := range snapshot.Stages {
				if strings.Contains(stage, path) {
					t.Fatal("path leaked in metrics")
				}
			}
		})
	}
	t.Run("unknown-name-keeps-original-generic-only", func(t *testing.T) {
		metrics := &PQLabMetrics{}
		if err := pqLabWriteExclusiveMeasured(filepath.Join(t.TempDir(), "caller-private-label"), []byte("original"), metrics); err != nil {
			t.Fatal(err)
		}
		for stage := range metrics.Snapshot().Stages {
			if strings.HasPrefix(stage, "sender.persistence.") {
				t.Fatal("unbounded caller label became a role", stage)
			}
		}
	})
}
