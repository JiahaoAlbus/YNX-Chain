package datafabricpostgres

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"embed"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"sort"
	"strconv"
	"strings"
)

//go:embed migrations/*.up.sql
var migrations embed.FS

type AppliedMigration struct {
	Version  int64  `json:"version"`
	Checksum string `json:"checksum"`
}

func Migrate(ctx context.Context, db *sql.DB) ([]AppliedMigration, error) {
	if db == nil {
		return nil, errors.New("PostgreSQL database is required")
	}
	if _, err := db.ExecContext(ctx, `CREATE SCHEMA IF NOT EXISTS ynx_fabric; CREATE TABLE IF NOT EXISTS ynx_fabric.schema_migrations (version bigint PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp())`); err != nil {
		return nil, fmt.Errorf("initialize migration ledger: %w", err)
	}
	connection, err := db.Conn(ctx)
	if err != nil {
		return nil, fmt.Errorf("reserve migration connection: %w", err)
	}
	defer connection.Close()
	if _, err := connection.ExecContext(ctx, `SELECT pg_advisory_lock(978624031)`); err != nil {
		return nil, fmt.Errorf("acquire migration lock: %w", err)
	}
	defer connection.ExecContext(context.Background(), `SELECT pg_advisory_unlock(978624031)`) //nolint:errcheck
	entries, err := fs.Glob(migrations, "migrations/*.up.sql")
	if err != nil {
		return nil, err
	}
	sort.Strings(entries)
	var applied []AppliedMigration
	for _, name := range entries {
		version, err := migrationVersion(name)
		if err != nil {
			return nil, err
		}
		body, err := migrations.ReadFile(name)
		if err != nil {
			return nil, err
		}
		digest := sha256.Sum256(body)
		checksum := hex.EncodeToString(digest[:])
		var existing string
		err = connection.QueryRowContext(ctx, `SELECT checksum FROM ynx_fabric.schema_migrations WHERE version = $1`, version).Scan(&existing)
		if err == nil {
			if existing != checksum {
				return nil, fmt.Errorf("migration %d checksum drift: database=%s binary=%s", version, existing, checksum)
			}
			continue
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		tx, err := connection.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
		if err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, string(body)); err == nil {
			_, err = tx.ExecContext(ctx, `INSERT INTO ynx_fabric.schema_migrations(version, checksum) VALUES ($1, $2)`, version, checksum)
		}
		if err != nil {
			_ = tx.Rollback()
			return nil, fmt.Errorf("apply migration %d: %w", version, err)
		}
		if err := tx.Commit(); err != nil {
			return nil, fmt.Errorf("commit migration %d: %w", version, err)
		}
		applied = append(applied, AppliedMigration{Version: version, Checksum: checksum})
	}
	return applied, nil
}

func migrationVersion(name string) (int64, error) {
	base := strings.TrimPrefix(name, "migrations/")
	prefix, _, ok := strings.Cut(base, "_")
	if !ok {
		return 0, fmt.Errorf("invalid migration filename %q", name)
	}
	version, err := strconv.ParseInt(prefix, 10, 64)
	if err != nil || version <= 0 {
		return 0, fmt.Errorf("invalid migration version in %q", name)
	}
	return version, nil
}

func MigrationFiles() ([]string, error) {
	files, err := fs.Glob(migrations, "migrations/*.up.sql")
	sort.Strings(files)
	return files, err
}

// VerifySchema fails closed if any required migration is absent or its stored
// checksum differs from the migration embedded in the running binary.
func VerifySchema(ctx context.Context, db *sql.DB) error {
	if db == nil {
		return errors.New("PostgreSQL database is required")
	}
	files, err := MigrationFiles()
	if err != nil {
		return err
	}
	for _, name := range files {
		version, err := migrationVersion(name)
		if err != nil {
			return err
		}
		body, err := migrations.ReadFile(name)
		if err != nil {
			return err
		}
		digest := sha256.Sum256(body)
		expected := hex.EncodeToString(digest[:])
		var actual string
		if err := db.QueryRowContext(ctx, `SELECT checksum FROM ynx_fabric.schema_migrations WHERE version=$1`, version).Scan(&actual); err != nil {
			return fmt.Errorf("required migration %d is not verifiable: %w", version, err)
		}
		if actual != expected {
			return fmt.Errorf("migration %d checksum drift: database=%s binary=%s", version, actual, expected)
		}
	}
	return nil
}
