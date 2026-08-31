package quantlab

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strings"
	"time"

	_ "github.com/lib/pq"
)

var (
	errStateConflict      = errors.New("quant state changed concurrently")
	stateNamespacePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._:-]{2,159}$`)
)

// stateStore persists the complete, integrity-protected Quant state. The
// filesystem backend is for a single shared filesystem only; PostgreSQL uses
// an optimistic revision so independent service instances fail closed rather
// than silently overwriting a newer state.
type stateStore interface {
	load() (state, bool, error)
	save(*state) error
	close() error
	backend() string
	multiInstance() bool
	requiresFilesystemLock() bool
}

type fileStateStore struct{ path string }

func (s fileStateStore) load() (state, bool, error) {
	b, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return state{}, false, nil
	}
	if err != nil {
		return state{}, false, err
	}
	var loaded state
	if json.Unmarshal(b, &loaded) != nil || !verifyIntegrity(loaded) {
		return state{}, false, fmt.Errorf("state integrity: %w", ErrForbidden)
	}
	normalizeQuantState(&loaded)
	return loaded, true, nil
}

func (s fileStateStore) save(value *state) error {
	b, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return writeAtomic(s.path, b)
}

func (fileStateStore) close() error                 { return nil }
func (fileStateStore) backend() string              { return "filesystem_json_snapshot" }
func (fileStateStore) multiInstance() bool          { return false }
func (fileStateStore) requiresFilesystemLock() bool { return true }

type postgresStateStore struct {
	db     *sql.DB
	key    string
	ownsDB bool
}

func openStateStore(cfg Config) (stateStore, error) {
	if strings.TrimSpace(cfg.DatabaseURL) == "" {
		return fileStateStore{path: cfg.StatePath}, nil
	}
	db := cfg.sharedDatabase
	ownsDB := false
	if db == nil {
		var err error
		db, err = sql.Open("postgres", cfg.DatabaseURL)
		if err != nil {
			return nil, fmt.Errorf("open Quant PostgreSQL state store: %w", err)
		}
		db.SetConnMaxLifetime(15 * time.Minute)
		db.SetMaxOpenConns(16)
		db.SetMaxIdleConns(4)
		ownsDB = true
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		if ownsDB {
			_ = db.Close()
		}
		return nil, fmt.Errorf("ping Quant PostgreSQL state store: %w", err)
	}
	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS ynx_quant_state (
		state_key TEXT PRIMARY KEY,
		revision BIGINT NOT NULL,
		payload JSONB NOT NULL,
		updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	)`); err != nil {
		if ownsDB {
			_ = db.Close()
		}
		return nil, fmt.Errorf("migrate Quant PostgreSQL state store: %w", err)
	}
	return &postgresStateStore{db: db, key: cfg.StateNamespace, ownsDB: ownsDB}, nil
}

func (s *postgresStateStore) load() (state, bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var revision int64
	var payload []byte
	err := s.db.QueryRowContext(ctx, `SELECT revision, payload FROM ynx_quant_state WHERE state_key = $1`, s.key).Scan(&revision, &payload)
	if errors.Is(err, sql.ErrNoRows) {
		return state{}, false, nil
	}
	if err != nil {
		return state{}, false, fmt.Errorf("load Quant PostgreSQL state: %w", err)
	}
	var loaded state
	if json.Unmarshal(payload, &loaded) != nil || !verifyIntegrity(loaded) {
		return state{}, false, fmt.Errorf("PostgreSQL state integrity: %w", ErrForbidden)
	}
	loaded.Revision = revision
	normalizeQuantState(&loaded)
	return loaded, true, nil
}

func (s *postgresStateStore) save(value *state) error {
	if value.Revision < 0 {
		return ErrInvalid
	}
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if value.Revision == 0 {
		result, err := s.db.ExecContext(ctx, `INSERT INTO ynx_quant_state (state_key, revision, payload) VALUES ($1, 1, $2::jsonb) ON CONFLICT (state_key) DO NOTHING`, s.key, string(payload))
		if err != nil {
			return fmt.Errorf("create Quant PostgreSQL state: %w", err)
		}
		rows, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if rows != 1 {
			return errStateConflict
		}
		value.Revision = 1
		return nil
	}
	result, err := s.db.ExecContext(ctx, `UPDATE ynx_quant_state SET revision = $1, payload = $2::jsonb, updated_at = NOW() WHERE state_key = $3 AND revision = $4`, value.Revision+1, string(payload), s.key, value.Revision)
	if err != nil {
		return fmt.Errorf("save Quant PostgreSQL state: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows != 1 {
		return errStateConflict
	}
	value.Revision++
	return nil
}

func (s *postgresStateStore) close() error {
	if s.ownsDB {
		return s.db.Close()
	}
	return nil
}
func (s *postgresStateStore) backend() string              { return "postgresql" }
func (s *postgresStateStore) multiInstance() bool          { return true }
func (s *postgresStateStore) requiresFilesystemLock() bool { return false }

func validStateNamespace(value string) bool {
	return stateNamespacePattern.MatchString(strings.TrimSpace(value))
}

func newQuantState() state {
	return state{
		Schema:           StateSchema,
		Experiments:      map[string]Experiment{},
		Strategies:       map[string]StrategySpec{},
		Datasets:         map[string]DatasetRecord{},
		Mandates:         map[string]Mandate{},
		Paper:            PaperState{Cash: 100_000_000_000},
		TestnetOrders:    map[string]TestnetOrder{},
		Idempotency:      map[string]string{},
		ExecutionLedger:  map[string]ExecutionLedgerRecord{},
		AdapterSequences: map[string]int64{},
	}
}

func normalizeQuantState(value *state) {
	if value.Experiments == nil {
		value.Experiments = map[string]Experiment{}
	}
	if value.Strategies == nil {
		value.Strategies = map[string]StrategySpec{}
	}
	if value.Datasets == nil {
		value.Datasets = map[string]DatasetRecord{}
	}
	if value.Mandates == nil {
		value.Mandates = map[string]Mandate{}
	}
	if value.TestnetOrders == nil {
		value.TestnetOrders = map[string]TestnetOrder{}
	}
	if value.Idempotency == nil {
		value.Idempotency = map[string]string{}
	}
	if value.ExecutionLedger == nil {
		value.ExecutionLedger = map[string]ExecutionLedgerRecord{}
	}
	if value.AdapterSequences == nil {
		value.AdapterSequences = map[string]int64{}
	}
}
