package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabricbackup"
	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabricconfig"
	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabricpgbackup"
	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabricpostgres"
	_ "github.com/lib/pq"
)

func main() {
	if len(os.Args) < 2 {
		fatal(errors.New("usage: ynx-data-fabricctl verify|backup|restore|export-schema-registry|migrate-postgres|backup-postgres|verify-postgres-backup|restore-postgres"))
	}
	var err error
	switch os.Args[1] {
	case "verify":
		err = verify(os.Args[2:])
	case "backup":
		err = backup(os.Args[2:])
	case "restore":
		err = restore(os.Args[2:])
	case "export-schema-registry":
		err = exportSchemaRegistry(os.Args[2:])
	case "migrate-postgres":
		err = migratePostgres(os.Args[2:])
	case "backup-postgres":
		err = backupPostgres(os.Args[2:])
	case "verify-postgres-backup":
		err = verifyPostgresBackup(os.Args[2:])
	case "restore-postgres":
		err = restorePostgres(os.Args[2:])
	default:
		err = fmt.Errorf("unknown command %q", os.Args[1])
	}
	if err != nil {
		fatal(err)
	}
}

func exportSchemaRegistry(arguments []string) error {
	flags := flag.NewFlagSet("export-schema-registry", flag.ContinueOnError)
	outputPath := flags.String("output", "", "absolute schema registry output path")
	generatedAtText := flags.String("generated-at", "", "required reproducible UTC RFC3339 timestamp")
	overwrite := flags.Bool("overwrite", false, "replace an existing regular output file")
	if err := flags.Parse(arguments); err != nil {
		return err
	}
	if !filepath.IsAbs(*outputPath) {
		return errors.New("schema registry export requires an absolute --output path")
	}
	generatedAt, err := time.Parse(time.RFC3339, *generatedAtText)
	if err != nil || generatedAt.Location() != time.UTC {
		return errors.New("schema registry export requires a UTC RFC3339 --generated-at timestamp")
	}
	registry := datafabric.DefaultSchemaRegistry()
	encoded, err := registry.MarshalDocument(generatedAt)
	if err != nil {
		return err
	}
	loaded, err := datafabric.LoadSchemaRegistry(bytes.NewReader(encoded))
	if err != nil {
		return fmt.Errorf("self-verify exported schema registry: %w", err)
	}
	if loaded.Version() != registry.Version() || len(loaded.Definitions("")) != len(registry.Definitions("")) {
		return errors.New("self-verified schema registry differs from the runtime registry")
	}
	if err := writeAtomicPublicFile(*outputPath, encoded, *overwrite); err != nil {
		return err
	}
	digest := sha256.Sum256(encoded)
	return output(map[string]any{
		"status": "exported-and-strictly-reloaded", "path": filepath.Clean(*outputPath),
		"registryVersion": registry.Version(), "definitions": len(registry.Definitions("")),
		"generatedAt": generatedAt, "sha256": hex.EncodeToString(digest[:]), "bytes": len(encoded),
	})
}

func writeAtomicPublicFile(path string, body []byte, overwrite bool) error {
	path = filepath.Clean(path)
	if info, err := os.Lstat(path); err == nil {
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return errors.New("schema registry output must not be a symlink or special file")
		}
		if !overwrite {
			return errors.New("schema registry output already exists; use --overwrite after review")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	parent := filepath.Dir(path)
	if info, err := os.Stat(parent); err != nil || !info.IsDir() {
		return errors.New("schema registry output directory must already exist")
	}
	temporary, err := os.CreateTemp(parent, ".schema-registry-*.tmp")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	removeTemporary := true
	defer func() {
		_ = temporary.Close()
		if removeTemporary {
			_ = os.Remove(temporaryPath)
		}
	}()
	if err := temporary.Chmod(0o644); err != nil {
		return err
	}
	if _, err := temporary.Write(body); err != nil {
		return err
	}
	if err := temporary.Sync(); err != nil {
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return err
	}
	removeTemporary = false
	return nil
}

func backupPostgres(arguments []string) error {
	flags := flag.NewFlagSet("backup-postgres", flag.ContinueOnError)
	dsnFile := flags.String("dsn-file", "", "absolute private source PostgreSQL DSN path")
	registry := flags.String("event-keys", "", "absolute event key registry path")
	outputDir := flags.String("output", "", "new absolute backup directory")
	pgDump := flags.String("pg-dump", "", "absolute pg_dump executable path")
	pgRestore := flags.String("pg-restore", "", "absolute pg_restore executable path")
	sourceCommit := flags.String("source-commit", "", "source commit")
	sourceRelease := flags.String("source-release", "", "source release")
	maintenance := flags.Bool("maintenance-window-confirmed", false, "confirm source writes are stopped for the backup")
	timeout := flags.Duration("timeout", 30*time.Minute, "backup timeout")
	if err := flags.Parse(arguments); err != nil {
		return err
	}
	if *timeout <= 0 || !allAbsolute(*dsnFile, *registry, *outputDir, *pgDump, *pgRestore) {
		return errors.New("PostgreSQL backup requires positive timeout and absolute DSN, key, output, pg_dump, and pg_restore paths")
	}
	keys, _, err := datafabricconfig.LoadEventKeys(*registry)
	if err != nil {
		return err
	}
	dsn, db, err := openPostgres(*dsnFile)
	if err != nil {
		return err
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	manifest, err := datafabricpgbackup.Create(ctx, db, string(dsn), *pgDump, *pgRestore, *outputDir, *sourceCommit, *sourceRelease, keys, *maintenance, time.Now().UTC())
	if err != nil {
		return err
	}
	return output(manifest)
}

func verifyPostgresBackup(arguments []string) error {
	flags := flag.NewFlagSet("verify-postgres-backup", flag.ContinueOnError)
	backupDir := flags.String("backup", "", "absolute PostgreSQL backup directory")
	pgRestore := flags.String("pg-restore", "", "absolute pg_restore executable path")
	timeout := flags.Duration("timeout", 5*time.Minute, "verification timeout")
	if err := flags.Parse(arguments); err != nil {
		return err
	}
	if *timeout <= 0 || !allAbsolute(*backupDir, *pgRestore) {
		return errors.New("PostgreSQL backup verification requires absolute backup/pg_restore paths and positive timeout")
	}
	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	manifest, err := datafabricpgbackup.Verify(ctx, *backupDir, *pgRestore)
	if err != nil {
		return err
	}
	return output(map[string]any{"status": "archive-hash-and-catalog-verified", "manifest": manifest, "verifiedAt": time.Now().UTC()})
}

func restorePostgres(arguments []string) error {
	flags := flag.NewFlagSet("restore-postgres", flag.ContinueOnError)
	dsnFile := flags.String("target-dsn-file", "", "absolute private empty-target PostgreSQL DSN path")
	registry := flags.String("event-keys", "", "absolute event key registry path")
	backupDir := flags.String("backup", "", "absolute PostgreSQL backup directory")
	pgRestore := flags.String("pg-restore", "", "absolute pg_restore executable path")
	timeout := flags.Duration("timeout", 30*time.Minute, "restore timeout")
	if err := flags.Parse(arguments); err != nil {
		return err
	}
	if *timeout <= 0 || !allAbsolute(*dsnFile, *registry, *backupDir, *pgRestore) {
		return errors.New("PostgreSQL restore requires positive timeout and absolute target DSN, key, backup, and pg_restore paths")
	}
	keys, _, err := datafabricconfig.LoadEventKeys(*registry)
	if err != nil {
		return err
	}
	dsn, db, err := openPostgres(*dsnFile)
	if err != nil {
		return err
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	manifest, err := datafabricpgbackup.Restore(ctx, db, string(dsn), *pgRestore, *backupDir, keys)
	if err != nil {
		return err
	}
	return output(map[string]any{"status": "restored-and-integrity-verified", "manifest": manifest, "restoredAt": time.Now().UTC()})
}

func openPostgres(dsnFile string) ([]byte, *sql.DB, error) {
	dsn, err := datafabricconfig.LoadSecretFile(dsnFile, "PostgreSQL DSN")
	if err != nil {
		return nil, nil, err
	}
	db, err := sql.Open("postgres", string(dsn))
	if err != nil {
		return nil, nil, err
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(0)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, nil, errors.New("connect to PostgreSQL failed")
	}
	return dsn, db, nil
}

func migratePostgres(arguments []string) error {
	flags := flag.NewFlagSet("migrate-postgres", flag.ContinueOnError)
	dsnFile := flags.String("dsn-file", "", "absolute private file containing the PostgreSQL DSN")
	timeout := flags.Duration("timeout", 2*time.Minute, "migration timeout")
	if err := flags.Parse(arguments); err != nil {
		return err
	}
	if *timeout <= 0 {
		return errors.New("migration timeout must be positive")
	}
	dsn, err := datafabricconfig.LoadSecretFile(*dsnFile, "PostgreSQL DSN")
	if err != nil {
		return err
	}
	db, err := sql.Open("postgres", string(dsn))
	if err != nil {
		return err
	}
	defer db.Close()
	db.SetMaxOpenConns(2)
	db.SetMaxIdleConns(0)
	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		return fmt.Errorf("connect to PostgreSQL: %w", err)
	}
	applied, err := datafabricpostgres.Migrate(ctx, db)
	if err != nil {
		return err
	}
	return output(map[string]any{"status": "migrated", "applied": applied, "completedAt": time.Now().UTC()})
}

func verify(arguments []string) error {
	flags := flag.NewFlagSet("verify", flag.ContinueOnError)
	state := flags.String("state", "", "absolute state path")
	eventLog := flags.String("event-log", "", "absolute event log path")
	registry := flags.String("event-keys", "", "absolute event key registry path")
	if err := flags.Parse(arguments); err != nil {
		return err
	}
	if !allAbsolute(*state, *eventLog, *registry) {
		return errors.New("verify requires absolute --state, --event-log, and --event-keys paths")
	}
	keys, _, err := datafabricconfig.LoadEventKeys(*registry)
	if err != nil {
		return err
	}
	store, err := datafabric.OpenStore(*state)
	if err != nil {
		return err
	}
	if err := store.AuditIntegrity(keys); err != nil {
		return err
	}
	logCount, err := datafabricbackup.VerifyEventLog(*eventLog)
	if err != nil {
		return err
	}
	return output(map[string]any{"status": "verified", "events": len(store.Events()), "journalEntries": len(store.Journal()), "eventLogRecords": logCount, "verifiedAt": time.Now().UTC()})
}

func backup(arguments []string) error {
	flags := flag.NewFlagSet("backup", flag.ContinueOnError)
	state := flags.String("state", "", "absolute state path")
	eventLog := flags.String("event-log", "", "absolute event log path")
	registry := flags.String("event-keys", "", "absolute event key registry path")
	outputDir := flags.String("output", "", "new absolute backup directory")
	sourceCommit := flags.String("source-commit", "", "source commit")
	sourceRelease := flags.String("source-release", "", "source release")
	if err := flags.Parse(arguments); err != nil {
		return err
	}
	if !allAbsolute(*state, *eventLog, *registry, *outputDir) {
		return errors.New("backup requires absolute state, event-log, event-keys, and output paths")
	}
	keys, _, err := datafabricconfig.LoadEventKeys(*registry)
	if err != nil {
		return err
	}
	manifest, err := datafabricbackup.Create(*state, *eventLog, *outputDir, *sourceCommit, *sourceRelease, keys, time.Now().UTC())
	if err != nil {
		return err
	}
	return output(manifest)
}

func restore(arguments []string) error {
	flags := flag.NewFlagSet("restore", flag.ContinueOnError)
	backupDir := flags.String("backup", "", "absolute backup directory")
	state := flags.String("target-state", "", "new absolute target state path")
	eventLog := flags.String("target-event-log", "", "new absolute target event log path")
	registry := flags.String("event-keys", "", "absolute event key registry path")
	if err := flags.Parse(arguments); err != nil {
		return err
	}
	if !allAbsolute(*backupDir, *state, *eventLog, *registry) {
		return errors.New("restore requires absolute backup, target-state, target-event-log, and event-keys paths")
	}
	keys, _, err := datafabricconfig.LoadEventKeys(*registry)
	if err != nil {
		return err
	}
	manifest, err := datafabricbackup.Restore(*backupDir, *state, *eventLog, keys)
	if err != nil {
		return err
	}
	return output(map[string]any{"status": "restored-and-verified", "manifest": manifest, "restoredAt": time.Now().UTC()})
}

func allAbsolute(paths ...string) bool {
	for _, path := range paths {
		if !filepath.IsAbs(path) {
			return false
		}
	}
	return true
}

func output(value any) error {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(value)
}

func fatal(err error) {
	_, _ = fmt.Fprintln(os.Stderr, "ynx-data-fabricctl:", err)
	os.Exit(1)
}
