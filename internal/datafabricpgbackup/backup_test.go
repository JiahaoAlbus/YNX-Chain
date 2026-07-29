package datafabricpgbackup

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPostgresEnvironmentKeepsURLAndPasswordOutOfArguments(t *testing.T) {
	dsn := "postgres://backup_user:private-password@db.internal:5544/ynx_backup?sslmode=verify-full&application_name=data-fabric-backup"
	environment, err := postgresEnvironment(dsn)
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(environment, "\n")
	for _, required := range []string{"PGHOST=db.internal", "PGPORT=5544", "PGUSER=backup_user", "PGPASSWORD=private-password", "PGDATABASE=ynx_backup", "PGSSLMODE=verify-full", "PGAPPNAME=data-fabric-backup"} {
		if !strings.Contains(joined, required) {
			t.Fatalf("missing decomposed libpq environment %q", required)
		}
	}
	if strings.Contains(joined, dsn) {
		t.Fatal("complete private DSN was copied into a child variable")
	}
	for _, invalid := range []string{"postgres://db.internal", "mysql://db.internal/name", "postgres://db.internal/name?unknown=value", "postgres://db.internal/a/b"} {
		if _, err := postgresEnvironment(invalid); err == nil {
			t.Fatalf("unsafe or unsupported DSN was accepted: %s", invalid)
		}
	}
}

func TestVerifyRejectsArchiveTampering(t *testing.T) {
	truePath, err := exec.LookPath("true")
	if err != nil {
		t.Skip("true executable is unavailable")
	}
	truePath, _ = filepath.Abs(truePath)
	directory := t.TempDir()
	dumpPath := filepath.Join(directory, "database.dump")
	if err := os.WriteFile(dumpPath, []byte("test-only-archive-catalog"), 0o600); err != nil {
		t.Fatal(err)
	}
	dump, err := fileEvidence(dumpPath)
	if err != nil {
		t.Fatal(err)
	}
	manifest := Manifest{SchemaVersion: ManifestSchemaVersion, CreatedAt: time.Date(2026, 7, 22, 17, 0, 0, 0, time.UTC), SourceCommit: "719e1018267ed5a53e6fae5211c5fd8a1503c35c", SourceRelease: "test", DatabaseVersion: "PostgreSQL 17.10", Migration: 1, Dump: dump, Integrity: "source-audited-archive-listed"}
	encoded, _ := json.Marshal(manifest)
	if err := os.WriteFile(filepath.Join(directory, "manifest.json"), encoded, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Verify(context.Background(), directory, truePath); err != nil {
		t.Fatalf("valid bounded archive evidence was rejected: %v", err)
	}
	if err := os.WriteFile(dumpPath, []byte("tampered-test-archive"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Verify(context.Background(), directory, truePath); err == nil {
		t.Fatal("tampered archive verified")
	}
}
