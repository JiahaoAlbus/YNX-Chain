package exchangeproduct

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFileStateRepositoryRejectsStaleMultiProcessWriteAndReloadsAuthority(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "exchange.json")
	first := fileStateRepository{path: path}
	second := fileStateRepository{path: path}
	initial := newState()
	if err := first.Save("", &initial); err != nil {
		t.Fatalf("bootstrap state: %v", err)
	}
	left, _, err := first.Load()
	if err != nil {
		t.Fatal(err)
	}
	right, _, err := second.Load()
	if err != nil {
		t.Fatal(err)
	}
	left.Sequence = 1
	if err := first.Save(left.IntegrityHash, &left); err != nil {
		t.Fatalf("first compare-and-swap: %v", err)
	}
	right.Sequence = 2
	if err := second.Save(right.IntegrityHash, &right); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale writer error=%v", err)
	}
	authoritative, exists, err := second.Load()
	if err != nil || !exists || authoritative.Sequence != 1 || authoritative.IntegrityHash != left.IntegrityHash {
		t.Fatalf("authoritative reload=%+v exists=%v err=%v", authoritative, exists, err)
	}
}

func TestPostgresMigrationProvidesSingletonCASState(t *testing.T) {
	for _, clause := range []string{"PRIMARY KEY", "schema_version INTEGER NOT NULL", "integrity_hash CHAR(64) NOT NULL", "state_json JSONB NOT NULL", "updated_at TIMESTAMPTZ NOT NULL"} {
		if !strings.Contains(exchangeStateMigration, clause) {
			t.Fatalf("migration missing %q", clause)
		}
	}
}

func TestTwoServicesRefreshAuthorityAndRejectStaleMutation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	config := Config{StatePath: path, APIKey: "multi-instance-key-123456", WalletCallback: "ynxexchange://wallet/callback"}
	first, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	second, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	first.mu.Lock()
	before := cloneState(first.state)
	first.state.Sequence++
	if err := first.saveOrRollbackLocked(before); err != nil {
		first.mu.Unlock()
		t.Fatalf("first service write: %v", err)
	}
	firstHash := first.state.IntegrityHash
	first.mu.Unlock()
	second.mu.Lock()
	stale := cloneState(second.state)
	second.state.Sequence += 2
	err = second.saveOrRollbackLocked(stale)
	second.mu.Unlock()
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("stale service write error=%v", err)
	}
	if err := second.refreshState(); err != nil {
		t.Fatal(err)
	}
	second.mu.Lock()
	defer second.mu.Unlock()
	if second.state.Sequence != 1 || second.state.IntegrityHash != firstHash {
		t.Fatalf("second service authority=%+v", second.state)
	}
}

func TestPostgresStateRepositoryBootstrapAndCAS(t *testing.T) {
	databaseURL := os.Getenv("YNX_EXCHANGE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("YNX_EXCHANGE_TEST_DATABASE_URL is required for PostgreSQL integration")
	}
	bootstrap := filepath.Join(t.TempDir(), "bootstrap.json")
	state := newState()
	state.Sequence = 7
	if err := saveState(bootstrap, &state); err != nil {
		t.Fatal(err)
	}
	repositoryValue, err := openStateRepository(bootstrap, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	repository := repositoryValue.(*postgresStateRepository)
	t.Cleanup(func() { repository.db.Close() })
	if _, err := repository.db.Exec(`DELETE FROM ynx_exchange_state`); err != nil {
		t.Fatal(err)
	}
	loaded, exists, err := repository.Load()
	if err != nil || !exists || loaded.Sequence != 7 {
		t.Fatalf("bootstrap loaded=%+v exists=%v err=%v", loaded, exists, err)
	}
	first, _, _ := repository.Load()
	second, _, _ := repository.Load()
	first.Sequence = 8
	if err := repository.Save(first.IntegrityHash, &first); err != nil {
		t.Fatalf("postgres CAS write: %v", err)
	}
	second.Sequence = 9
	if err := repository.Save(second.IntegrityHash, &second); !errors.Is(err, ErrConflict) {
		t.Fatalf("postgres stale writer error=%v", err)
	}
	authoritative, exists, err := repository.Load()
	if err != nil || !exists || authoritative.Sequence != 8 || authoritative.IntegrityHash != first.IntegrityHash {
		t.Fatalf("postgres authority=%+v exists=%v err=%v", authoritative, exists, err)
	}
}
