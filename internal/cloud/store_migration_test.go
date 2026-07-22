package cloud

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLegacyV1MigrationBackupAndRollback(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "state.json")
	blank := `{"schemaVersion":1,"objects":{},"versions":{},"grants":{},"links":{},"accessRequests":{},"comments":{},"presence":{},"aiJobs":{},"sessions":{},"nonces":{},"audit":[],"integrityHash":""}`
	legacy := strings.Replace(blank, `"integrityHash":""`, `"integrityHash":"`+hashBytes([]byte(blank))+`"`, 1)
	if err := os.WriteFile(path, []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := New(Config{StatePath: path, ObjectDir: filepath.Join(dir, "objects")})
	if err != nil {
		t.Fatal(err)
	}
	if s.state.SchemaVersion != CurrentStateSchemaVersion {
		t.Fatalf("schema %d", s.state.SchemaVersion)
	}
	backup, err := os.ReadFile(path + ".v1.bak")
	if err != nil {
		t.Fatal(err)
	}
	if string(backup) != legacy {
		t.Fatal("migration backup is not byte-identical")
	}
	current, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var v2 persistentState
	if json.Unmarshal(current, &v2) != nil || v2.SchemaVersion != 2 || !verifyStoredState(current, v2) {
		t.Fatal("migrated v2 state is invalid")
	}
	rollback := filepath.Join(dir, "rollback-v1.json")
	if err := RollbackStateToV1(path, rollback); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(rollback)
	if err != nil {
		t.Fatal(err)
	}
	var v1 persistentState
	if json.Unmarshal(raw, &v1) != nil || v1.SchemaVersion != 1 || !verifyStoredState(raw, v1) {
		t.Fatal("rollback state is invalid")
	}
	if err := RollbackStateToV1(path, rollback); err == nil {
		t.Fatal("rollback overwrote existing destination")
	}
}

func TestMigrationRejectsTamperedLegacyState(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "state.json")
	raw := `{"schemaVersion":1,"objects":{},"versions":{},"grants":{},"links":{},"accessRequests":{},"comments":{},"presence":{},"aiJobs":{},"sessions":{},"nonces":{},"audit":[],"integrityHash":"` + strings.Repeat("0", 64) + `"}`
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := New(Config{StatePath: path}); err == nil || !strings.Contains(err.Error(), "integrity") {
		t.Fatalf("tampered migration accepted: %v", err)
	}
	if _, err := os.Stat(path + ".v1.bak"); !os.IsNotExist(err) {
		t.Fatalf("backup created for invalid source: %v", err)
	}
}
