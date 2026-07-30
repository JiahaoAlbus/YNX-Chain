package datafabricpgbackup

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabricpostgres"
)

const ManifestSchemaVersion = 1

type DumpEvidence struct {
	Name   string `json:"name"`
	Bytes  int64  `json:"bytes"`
	SHA256 string `json:"sha256"`
}

type Manifest struct {
	SchemaVersion   int                   `json:"schemaVersion"`
	CreatedAt       time.Time             `json:"createdAt"`
	SourceCommit    string                `json:"sourceCommit"`
	SourceRelease   string                `json:"sourceRelease"`
	DatabaseVersion string                `json:"databaseVersion"`
	Migration       int                   `json:"migration"`
	Dump            DumpEvidence          `json:"dump"`
	Counts          datafabric.StoreStats `json:"counts"`
	Integrity       string                `json:"integrity"`
}

func Create(ctx context.Context, db *sql.DB, dsn, pgDumpPath, pgRestorePath, outputDir, sourceCommit, sourceRelease string, keys map[string][]byte, maintenanceWindowConfirmed bool, now time.Time) (Manifest, error) {
	if db == nil || strings.TrimSpace(dsn) == "" || !absoluteExecutable(pgDumpPath) || !absoluteExecutable(pgRestorePath) || !filepath.IsAbs(outputDir) || sourceCommit == "" || sourceRelease == "" || len(keys) == 0 || !maintenanceWindowConfirmed || now.IsZero() || now.Location() != time.UTC {
		return Manifest{}, errors.New("PostgreSQL backup requires database, private DSN, absolute tools/output, provenance, keys, UTC time, and confirmed write-maintenance window")
	}
	if _, err := os.Stat(outputDir); !errors.Is(err, os.ErrNotExist) {
		return Manifest{}, errors.New("PostgreSQL backup output already exists or cannot be inspected")
	}
	if err := datafabricpostgres.VerifySchema(ctx, db); err != nil {
		return Manifest{}, err
	}
	store, err := datafabricpostgres.NewStore(db)
	if err != nil {
		return Manifest{}, err
	}
	if err := store.AuditIntegrity(ctx, keys); err != nil {
		return Manifest{}, fmt.Errorf("source PostgreSQL integrity audit failed: %w", err)
	}
	counts, err := store.Stats(ctx)
	if err != nil {
		return Manifest{}, err
	}
	var databaseVersion string
	if err := db.QueryRowContext(ctx, `SELECT version()`).Scan(&databaseVersion); err != nil {
		return Manifest{}, err
	}
	if err := os.MkdirAll(outputDir, 0o700); err != nil {
		return Manifest{}, err
	}
	complete := false
	defer func() {
		if !complete {
			_ = os.RemoveAll(outputDir)
		}
	}()
	dumpPath := filepath.Join(outputDir, "database.dump")
	command := exec.CommandContext(ctx, pgDumpPath, "--format=custom", "--compress=none", "--no-owner", "--no-privileges", "--serializable-deferrable", "--schema=ynx_fabric", "--schema=ynx_analytics", "--file="+dumpPath)
	command.Env, err = postgresEnvironment(dsn)
	if err != nil {
		return Manifest{}, err
	}
	var dumpFailure bytes.Buffer
	command.Stderr = &dumpFailure
	if err := command.Run(); err != nil {
		return Manifest{}, fmt.Errorf("pg_dump failed without producing a verified backup: %s", sanitizedToolFailure(dumpFailure.String(), dsn))
	}
	if err := syncFile(dumpPath); err != nil {
		return Manifest{}, err
	}
	dump, err := fileEvidence(dumpPath)
	if err != nil {
		return Manifest{}, err
	}
	if err := verifyArchiveCommand(ctx, pgRestorePath, dumpPath); err != nil {
		return Manifest{}, err
	}
	manifest := Manifest{SchemaVersion: ManifestSchemaVersion, CreatedAt: now, SourceCommit: sourceCommit, SourceRelease: sourceRelease, DatabaseVersion: databaseVersion, Migration: 1, Dump: dump, Counts: counts, Integrity: "source-audited-archive-listed"}
	encoded, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return Manifest{}, err
	}
	encoded = append(encoded, '\n')
	manifestPath := filepath.Join(outputDir, "manifest.json")
	if err := os.WriteFile(manifestPath, encoded, 0o600); err != nil {
		return Manifest{}, err
	}
	if err := syncFile(manifestPath); err != nil {
		return Manifest{}, err
	}
	complete = true
	return manifest, nil
}

func Verify(ctx context.Context, backupDir, pgRestorePath string) (Manifest, error) {
	if !filepath.IsAbs(backupDir) || !absoluteExecutable(pgRestorePath) {
		return Manifest{}, errors.New("PostgreSQL backup verification requires absolute backup and pg_restore paths")
	}
	encoded, err := os.ReadFile(filepath.Join(backupDir, "manifest.json"))
	if err != nil {
		return Manifest{}, err
	}
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.DisallowUnknownFields()
	var manifest Manifest
	if err := decoder.Decode(&manifest); err != nil {
		return Manifest{}, err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return Manifest{}, errors.New("PostgreSQL backup manifest contains trailing JSON")
	}
	if manifest.SchemaVersion != ManifestSchemaVersion || manifest.Migration != 1 || manifest.Integrity != "source-audited-archive-listed" || manifest.SourceCommit == "" || manifest.SourceRelease == "" || manifest.CreatedAt.IsZero() || manifest.CreatedAt.Location() != time.UTC || manifest.Dump.Name != "database.dump" {
		return Manifest{}, errors.New("PostgreSQL backup manifest is incomplete or unsupported")
	}
	actual, err := fileEvidence(filepath.Join(backupDir, manifest.Dump.Name))
	if err != nil {
		return Manifest{}, err
	}
	if actual != manifest.Dump {
		return Manifest{}, errors.New("PostgreSQL backup dump hash or byte count mismatch")
	}
	if err := verifyArchiveCommand(ctx, pgRestorePath, filepath.Join(backupDir, manifest.Dump.Name)); err != nil {
		return Manifest{}, err
	}
	return manifest, nil
}

func Restore(ctx context.Context, db *sql.DB, dsn, pgRestorePath, backupDir string, keys map[string][]byte) (Manifest, error) {
	if db == nil || strings.TrimSpace(dsn) == "" || len(keys) == 0 {
		return Manifest{}, errors.New("PostgreSQL restore requires target database, private DSN, and event keys")
	}
	manifest, err := Verify(ctx, backupDir, pgRestorePath)
	if err != nil {
		return Manifest{}, err
	}
	var fabric, analytics sql.NullString
	if err := db.QueryRowContext(ctx, `SELECT to_regnamespace('ynx_fabric')::text,to_regnamespace('ynx_analytics')::text`).Scan(&fabric, &analytics); err != nil {
		return Manifest{}, err
	}
	if fabric.Valid || analytics.Valid {
		return Manifest{}, errors.New("PostgreSQL restore target must not contain Data Fabric schemas")
	}
	command := exec.CommandContext(ctx, pgRestorePath, "--exit-on-error", "--single-transaction", "--no-owner", "--no-privileges", "--dbname=", filepath.Join(backupDir, manifest.Dump.Name))
	command.Env, err = postgresEnvironment(dsn)
	if err != nil {
		return Manifest{}, err
	}
	var restoreFailure bytes.Buffer
	command.Stderr = &restoreFailure
	if err := command.Run(); err != nil {
		return Manifest{}, fmt.Errorf("pg_restore failed; target transaction was not accepted: %s", sanitizedToolFailure(restoreFailure.String(), dsn))
	}
	if err := datafabricpostgres.VerifySchema(ctx, db); err != nil {
		return Manifest{}, err
	}
	store, err := datafabricpostgres.NewStore(db)
	if err != nil {
		return Manifest{}, err
	}
	if err := store.AuditIntegrity(ctx, keys); err != nil {
		return Manifest{}, fmt.Errorf("restored PostgreSQL integrity audit failed: %w", err)
	}
	counts, err := store.Stats(ctx)
	if err != nil {
		return Manifest{}, err
	}
	if counts != manifest.Counts {
		return Manifest{}, errors.New("restored PostgreSQL counts do not match backup manifest")
	}
	return manifest, nil
}

func absoluteExecutable(path string) bool {
	if !filepath.IsAbs(path) {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular() && info.Mode().Perm()&0o111 != 0
}

func postgresEnvironment(dsn string) ([]string, error) {
	parsed, err := url.Parse(dsn)
	if err != nil || (parsed.Scheme != "postgres" && parsed.Scheme != "postgresql") || parsed.Hostname() == "" || parsed.Path == "" || parsed.Path == "/" || parsed.Fragment != "" {
		return nil, errors.New("PostgreSQL backup DSN must be a complete postgres:// or postgresql:// URL")
	}
	database, err := url.PathUnescape(strings.TrimPrefix(parsed.EscapedPath(), "/"))
	if err != nil || database == "" || strings.Contains(database, "/") {
		return nil, errors.New("PostgreSQL backup DSN database name is invalid")
	}
	port := parsed.Port()
	if port == "" {
		port = "5432"
	}
	values := map[string]string{"PGHOST": parsed.Hostname(), "PGPORT": port, "PGDATABASE": database, "PGCONNECT_TIMEOUT": "10"}
	if parsed.User != nil {
		if username := parsed.User.Username(); username != "" {
			values["PGUSER"] = username
		}
		if password, exists := parsed.User.Password(); exists {
			values["PGPASSWORD"] = password
		}
	}
	allowed := map[string]string{"sslmode": "PGSSLMODE", "sslrootcert": "PGSSLROOTCERT", "sslcert": "PGSSLCERT", "sslkey": "PGSSLKEY", "sslcrl": "PGSSLCRL", "target_session_attrs": "PGTARGETSESSIONATTRS", "application_name": "PGAPPNAME", "connect_timeout": "PGCONNECT_TIMEOUT"}
	for key, candidates := range parsed.Query() {
		environmentName, exists := allowed[key]
		if !exists || len(candidates) != 1 || strings.TrimSpace(candidates[0]) == "" {
			return nil, fmt.Errorf("PostgreSQL backup DSN parameter %q is unsupported or ambiguous", key)
		}
		values[environmentName] = candidates[0]
	}
	environment := make([]string, 0, len(os.Environ())+2)
	for _, variable := range os.Environ() {
		name, _, _ := strings.Cut(variable, "=")
		if _, replaced := values[name]; !replaced {
			environment = append(environment, variable)
		}
	}
	for name, value := range values {
		environment = append(environment, name+"="+value)
	}
	return environment, nil
}

func verifyArchiveCommand(ctx context.Context, pgRestorePath, dumpPath string) error {
	command := exec.CommandContext(ctx, pgRestorePath, "--list", dumpPath)
	if err := command.Run(); err != nil {
		return errors.New("pg_restore could not list the backup archive")
	}
	return nil
}

func fileEvidence(path string) (DumpEvidence, error) {
	file, err := os.Open(path)
	if err != nil {
		return DumpEvidence{}, err
	}
	defer file.Close()
	hash := sha256.New()
	count, err := io.Copy(hash, file)
	if err != nil {
		return DumpEvidence{}, err
	}
	return DumpEvidence{Name: filepath.Base(path), Bytes: count, SHA256: hex.EncodeToString(hash.Sum(nil))}, nil
}

func syncFile(path string) error {
	file, err := os.OpenFile(path, os.O_RDONLY, 0)
	if err != nil {
		return err
	}
	defer file.Close()
	return file.Sync()
}

func sanitizedToolFailure(message, dsn string) string {
	message = strings.TrimSpace(strings.ReplaceAll(message, dsn, "[redacted-dsn]"))
	if message == "" {
		return "tool returned a non-zero status"
	}
	return message
}
