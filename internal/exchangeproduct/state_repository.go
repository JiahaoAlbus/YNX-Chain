package exchangeproduct

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	_ "github.com/lib/pq"
)

type stateRepository interface {
	Load() (persistentState, bool, error)
	Save(expectedIntegrity string, state *persistentState) error
	Mode() string
}

type fileStateRepository struct{ path string }

func (repository fileStateRepository) Load() (persistentState, bool, error) {
	return loadState(repository.path)
}

func (fileStateRepository) Mode() string { return "file-cas-single-host" }

func (repository fileStateRepository) Save(expectedIntegrity string, state *persistentState) error {
	if err := os.MkdirAll(filepath.Dir(repository.path), 0o700); err != nil {
		return err
	}
	lock, err := os.OpenFile(repository.path+".lock", os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX); err != nil {
		return err
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN) //nolint:errcheck
	current, exists, err := loadState(repository.path)
	if err != nil {
		return err
	}
	if (!exists && expectedIntegrity != "") || (exists && current.IntegrityHash != expectedIntegrity) {
		return fmt.Errorf("%w: exchange state changed by another process", ErrConflict)
	}
	return saveState(repository.path, state)
}

type postgresStateRepository struct {
	db            *sql.DB
	bootstrapPath string
}

func (*postgresStateRepository) Mode() string { return "postgres-cas-multi-instance" }

const exchangeStateMigration = `
CREATE TABLE IF NOT EXISTS ynx_exchange_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  schema_version INTEGER NOT NULL,
  integrity_hash CHAR(64) NOT NULL CHECK (integrity_hash ~ '^[0-9a-f]{64}$'),
  state_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
)`

func openStateRepository(path, databaseURL string) (stateRepository, error) {
	if databaseURL == "" {
		return fileStateRepository{path: path}, nil
	}
	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("open exchange database: %w", err)
	}
	db.SetMaxOpenConns(16)
	db.SetMaxIdleConns(8)
	db.SetConnMaxLifetime(30 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping exchange database: %w", err)
	}
	if _, err := db.ExecContext(ctx, exchangeStateMigration); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate exchange database: %w", err)
	}
	return &postgresStateRepository{db: db, bootstrapPath: path}, nil
}

func (repository *postgresStateRepository) Load() (persistentState, bool, error) {
	var raw []byte
	err := repository.db.QueryRow(`SELECT state_json FROM ynx_exchange_state WHERE singleton = TRUE`).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		if repository.bootstrapPath == "" {
			return newState(), false, nil
		}
		state, exists, loadErr := loadState(repository.bootstrapPath)
		if loadErr != nil || !exists {
			return state, exists, loadErr
		}
		if saveErr := repository.Save("", &state); saveErr != nil {
			if !errors.Is(saveErr, ErrConflict) {
				return persistentState{}, false, saveErr
			}
			return repository.Load()
		}
		return state, true, nil
	}
	if err != nil {
		return persistentState{}, false, fmt.Errorf("load exchange database state: %w", err)
	}
	var state persistentState
	if err := json.Unmarshal(raw, &state); err != nil {
		return persistentState{}, false, fmt.Errorf("decode exchange database state: %w", err)
	}
	if state.SchemaVersion < 1 || state.SchemaVersion > currentStateSchemaVersion || state.IntegrityHash == "" {
		return persistentState{}, false, errors.New("exchange database state schema or integrity hash invalid")
	}
	expected, err := stateIntegrity(state)
	if err != nil || expected != state.IntegrityHash {
		return persistentState{}, false, errors.New("exchange database state integrity verification failed")
	}
	normalizeState(&state)
	return state, true, nil
}

func (repository *postgresStateRepository) Save(expectedIntegrity string, state *persistentState) error {
	hash, err := stateIntegrity(*state)
	if err != nil {
		return err
	}
	state.IntegrityHash = hash
	raw, err := json.Marshal(state)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var result sql.Result
	if strings.TrimSpace(expectedIntegrity) == "" {
		result, err = repository.db.ExecContext(ctx, `INSERT INTO ynx_exchange_state (singleton, schema_version, integrity_hash, state_json, updated_at) VALUES (TRUE, $1, $2, $3, CURRENT_TIMESTAMP) ON CONFLICT (singleton) DO NOTHING`, state.SchemaVersion, hash, raw)
	} else {
		result, err = repository.db.ExecContext(ctx, `UPDATE ynx_exchange_state SET schema_version = $1, integrity_hash = $2, state_json = $3, updated_at = CURRENT_TIMESTAMP WHERE singleton = TRUE AND integrity_hash = $4`, state.SchemaVersion, hash, raw, expectedIntegrity)
	}
	if err != nil {
		return fmt.Errorf("save exchange database state: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows != 1 {
		return fmt.Errorf("%w: exchange database state changed by another instance", ErrConflict)
	}
	return nil
}
