package finance

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
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

var errFinanceStateConflict = errors.New("finance state conflict")

type financeStateRepository interface {
	Load() (persistedState, string, bool, error)
	Save(expectedHash string, state persistedState) (string, error)
	Mode() string
}

type financeRateLimitRepository interface {
	AllowRate(key string, limit int, window time.Duration, now time.Time) (bool, error)
	RateLimitMode() string
}

func decodeFinanceState(raw []byte) (persistedState, string, error) {
	var state persistedState
	if err := decodeStrictJSON(raw, &state); err != nil {
		return persistedState{}, "", fmt.Errorf("decode finance state: %w", err)
	}
	if err := validatePersistedState(state); err != nil {
		return persistedState{}, "", err
	}
	normalizePersistedState(&state)
	canonical, err := json.Marshal(state)
	if err != nil {
		return persistedState{}, "", err
	}
	digest := sha256.Sum256(canonical)
	return state, hex.EncodeToString(digest[:]), nil
}

func encodeFinanceState(state persistedState) ([]byte, string, error) {
	if err := validatePersistedState(state); err != nil {
		return nil, "", err
	}
	normalizePersistedState(&state)
	canonical, err := json.Marshal(state)
	if err != nil {
		return nil, "", err
	}
	digest := sha256.Sum256(canonical)
	pretty, err := json.MarshalIndent(state, "", "  ")
	return pretty, hex.EncodeToString(digest[:]), err
}

type financeFileRepository struct{ path string }

func (financeFileRepository) Mode() string { return "file-cas-single-host" }

func (repository financeFileRepository) Load() (persistedState, string, bool, error) {
	raw, err := os.ReadFile(repository.path)
	if errors.Is(err, os.ErrNotExist) {
		return persistedState{}, "", false, nil
	}
	if err != nil {
		return persistedState{}, "", false, fmt.Errorf("read finance state: %w", err)
	}
	state, hash, err := decodeFinanceState(raw)
	return state, hash, err == nil, err
}

func (repository financeFileRepository) Save(expectedHash string, state persistedState) (string, error) {
	if err := os.MkdirAll(filepath.Dir(repository.path), 0o700); err != nil {
		return "", err
	}
	lock, err := os.OpenFile(repository.path+".lock", os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return "", err
	}
	defer lock.Close()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX); err != nil {
		return "", err
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN) //nolint:errcheck
	_, currentHash, exists, err := repository.Load()
	if err != nil {
		return "", err
	}
	if (!exists && expectedHash != "") || (exists && currentHash != expectedHash) {
		return "", fmt.Errorf("%w: state changed by another process", errFinanceStateConflict)
	}
	raw, hash, err := encodeFinanceState(state)
	if err != nil {
		return "", err
	}
	if err := atomicWritePrivateFile(repository.path, raw); err != nil {
		return "", err
	}
	return hash, nil
}

type financePostgresRepository struct {
	db            *sql.DB
	bootstrapPath string
}

func (*financePostgresRepository) Mode() string { return "postgres-cas-multi-instance" }

const financeStateMigration = `
CREATE TABLE IF NOT EXISTS ynx_finance_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  state_version INTEGER NOT NULL,
  state_hash CHAR(64) NOT NULL CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  state_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
)`

const financeRateLimitMigration = `
CREATE TABLE IF NOT EXISTS ynx_finance_rate_limits (
  rate_key VARCHAR(256) PRIMARY KEY,
  tokens DOUBLE PRECISION NOT NULL CHECK (tokens >= 0),
  updated_at TIMESTAMPTZ NOT NULL
)`

func openFinanceStateRepository(path, databaseURL string) (financeStateRepository, error) {
	databaseURL = strings.TrimSpace(databaseURL)
	if databaseURL == "" {
		if path == "" {
			return nil, nil
		}
		return financeFileRepository{path: path}, nil
	}
	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("open finance database: %w", err)
	}
	db.SetMaxOpenConns(16)
	db.SetMaxIdleConns(8)
	db.SetConnMaxLifetime(30 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping finance database: %w", err)
	}
	if _, err := db.ExecContext(ctx, financeStateMigration); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate finance database: %w", err)
	}
	if _, err := db.ExecContext(ctx, financeRateLimitMigration); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate finance rate limit database: %w", err)
	}
	return &financePostgresRepository{db: db, bootstrapPath: path}, nil
}

func (repository *financePostgresRepository) Load() (persistedState, string, bool, error) {
	var raw []byte
	var storedHash string
	err := repository.db.QueryRow(`SELECT state_json, state_hash FROM ynx_finance_state WHERE singleton = TRUE`).Scan(&raw, &storedHash)
	if errors.Is(err, sql.ErrNoRows) {
		if repository.bootstrapPath == "" {
			return persistedState{}, "", false, nil
		}
		state, hash, exists, loadErr := financeFileRepository{path: repository.bootstrapPath}.Load()
		if loadErr != nil || !exists {
			return state, hash, exists, loadErr
		}
		if _, saveErr := repository.Save("", state); saveErr != nil {
			if !errors.Is(saveErr, errFinanceStateConflict) {
				return persistedState{}, "", false, saveErr
			}
			return repository.Load()
		}
		return state, hash, true, nil
	}
	if err != nil {
		return persistedState{}, "", false, fmt.Errorf("load finance database state: %w", err)
	}
	state, hash, err := decodeFinanceState(raw)
	if err != nil || hash != storedHash {
		return persistedState{}, "", false, errors.New("finance database state integrity verification failed")
	}
	return state, hash, true, nil
}

func (repository *financePostgresRepository) Save(expectedHash string, state persistedState) (string, error) {
	pretty, hash, err := encodeFinanceState(state)
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var result sql.Result
	if strings.TrimSpace(expectedHash) == "" {
		result, err = repository.db.ExecContext(ctx, `INSERT INTO ynx_finance_state (singleton, state_version, state_hash, state_json, updated_at) VALUES (TRUE, $1, $2, $3, CURRENT_TIMESTAMP) ON CONFLICT (singleton) DO NOTHING`, state.Version, hash, pretty)
	} else {
		result, err = repository.db.ExecContext(ctx, `UPDATE ynx_finance_state SET state_version = $1, state_hash = $2, state_json = $3, updated_at = CURRENT_TIMESTAMP WHERE singleton = TRUE AND state_hash = $4`, state.Version, hash, pretty, expectedHash)
	}
	if err != nil {
		return "", fmt.Errorf("save finance database state: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return "", err
	}
	if rows != 1 {
		return "", fmt.Errorf("%w: database state changed by another instance", errFinanceStateConflict)
	}
	return hash, nil
}

func (*financePostgresRepository) RateLimitMode() string {
	return "postgres-token-bucket-multi-instance"
}

func (repository *financePostgresRepository) AllowRate(key string, limit int, window time.Duration, now time.Time) (bool, error) {
	if strings.TrimSpace(key) == "" || len(key) > 256 || limit <= 0 || window <= 0 {
		return false, errors.New("finance rate limit input is invalid")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var tokens float64
	err := repository.db.QueryRowContext(ctx, `
INSERT INTO ynx_finance_rate_limits (rate_key, tokens, updated_at)
VALUES ($1, $2 - 1, $3)
ON CONFLICT (rate_key) DO UPDATE
SET tokens = LEAST($2, ynx_finance_rate_limits.tokens + GREATEST(0, EXTRACT(EPOCH FROM ($3 - ynx_finance_rate_limits.updated_at)) * $4)) - 1,
    updated_at = $3
WHERE LEAST($2, ynx_finance_rate_limits.tokens + GREATEST(0, EXTRACT(EPOCH FROM ($3 - ynx_finance_rate_limits.updated_at)) * $4)) >= 1
RETURNING tokens`, key, float64(limit), now.UTC(), float64(limit)/window.Seconds()).Scan(&tokens)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("apply finance distributed rate limit: %w", err)
	}
	return true, nil
}
