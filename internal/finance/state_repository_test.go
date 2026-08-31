package finance

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func financeStateWithCategory(name string) persistedState {
	state := persistedState{Version: currentStateVersion, Accounts: map[string]AccountState{}, Nonces: map[string]time.Time{}}
	state.Accounts["ynx1test"] = AccountState{
		Categories:      []Category{{ID: "category-1", Name: name, Color: "#123456", CreatedAt: time.Now().UTC(), Source: "user"}},
		Classifications: map[string]Classification{},
		Idempotency:     map[string]string{},
	}
	return state
}

func TestFinanceFileRepositoryRejectsStaleWriter(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "finance.json")
	first := financeFileRepository{path: path}
	second := financeFileRepository{path: path}
	initial := financeStateWithCategory("Initial")
	initialHash, err := first.Save("", initial)
	if err != nil {
		t.Fatal(err)
	}
	left, _, _, err := first.Load()
	if err != nil {
		t.Fatal(err)
	}
	right, _, _, err := second.Load()
	if err != nil {
		t.Fatal(err)
	}
	left.Accounts["ynx1test"] = financeStateWithCategory("Left").Accounts["ynx1test"]
	leftHash, err := first.Save(initialHash, left)
	if err != nil {
		t.Fatalf("first CAS write: %v", err)
	}
	right.Accounts["ynx1test"] = financeStateWithCategory("Right").Accounts["ynx1test"]
	if _, err := second.Save(initialHash, right); !errors.Is(err, errFinanceStateConflict) {
		t.Fatalf("stale writer error=%v", err)
	}
	authoritative, authoritativeHash, exists, err := second.Load()
	if err != nil || !exists || authoritativeHash != leftHash || authoritative.Accounts["ynx1test"].Categories[0].Name != "Left" {
		t.Fatalf("authoritative state=%+v hash=%q exists=%v err=%v", authoritative, authoritativeHash, exists, err)
	}
}

func TestTwoFinanceStoresRefreshAndPreserveIndependentAccounts(t *testing.T) {
	path := filepath.Join(t.TempDir(), "finance.json")
	first, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	second, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	add := func(store *Store, account, name string) error {
		return store.Update(account, "category.created", name, func(state *AccountState) error {
			state.Categories = append(state.Categories, Category{ID: name, Name: name, Color: "#123456", CreatedAt: time.Now().UTC(), Source: "user"})
			return nil
		})
	}
	if err := add(first, "ynx1alice", "Alice"); err != nil {
		t.Fatal(err)
	}
	if err := add(second, "ynx1bob", "Bob"); err != nil {
		t.Fatal(err)
	}
	if got := first.Account("ynx1bob").Categories; len(got) != 1 || got[0].Name != "Bob" {
		t.Fatalf("first store did not refresh Bob: %+v", got)
	}
	if got := second.Account("ynx1alice").Categories; len(got) != 1 || got[0].Name != "Alice" {
		t.Fatalf("second store did not preserve Alice: %+v", got)
	}
}

func TestFinancePostgresMigrationProvidesSingletonCASState(t *testing.T) {
	for _, clause := range []string{"PRIMARY KEY", "state_version INTEGER NOT NULL", "state_hash CHAR(64) NOT NULL", "state_json JSONB NOT NULL", "updated_at TIMESTAMPTZ NOT NULL"} {
		if !strings.Contains(financeStateMigration, clause) {
			t.Fatalf("migration missing %q", clause)
		}
	}
	for _, clause := range []string{"rate_key VARCHAR(256) PRIMARY KEY", "tokens DOUBLE PRECISION NOT NULL", "updated_at TIMESTAMPTZ NOT NULL"} {
		if !strings.Contains(financeRateLimitMigration, clause) {
			t.Fatalf("rate limit migration missing %q", clause)
		}
	}
}

func TestFinanceLocalRateLimitUsesSlidingWindow(t *testing.T) {
	store, err := OpenStore("")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 8, 31, 12, 0, 0, 0, time.UTC)
	for range 2 {
		allowed, err := store.AllowRate("GET:hashed-session", 2, time.Minute, now)
		if err != nil || !allowed {
			t.Fatalf("initial local rate allowance allowed=%v err=%v", allowed, err)
		}
	}
	if allowed, err := store.AllowRate("GET:hashed-session", 2, time.Minute, now.Add(time.Second)); err != nil || allowed {
		t.Fatalf("expected local rate rejection allowed=%v err=%v", allowed, err)
	}
	if allowed, err := store.AllowRate("GET:hashed-session", 2, time.Minute, now.Add(time.Minute+time.Nanosecond)); err != nil || !allowed {
		t.Fatalf("expected expired local rate allowance allowed=%v err=%v", allowed, err)
	}
	if mode := store.RateLimitMode(); mode != "memory-sliding-window-single-process" || store.MultiInstanceReady() {
		t.Fatalf("unexpected local rate mode=%q multiInstance=%v", mode, store.MultiInstanceReady())
	}
}

func TestFinancePostgresRepositoryBootstrapAndCAS(t *testing.T) {
	databaseURL := os.Getenv("YNX_FINANCE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("YNX_FINANCE_TEST_DATABASE_URL is required for PostgreSQL integration")
	}
	bootstrap := filepath.Join(t.TempDir(), "bootstrap.json")
	bootstrapRepository := financeFileRepository{path: bootstrap}
	initial := financeStateWithCategory("Initial")
	if _, err := bootstrapRepository.Save("", initial); err != nil {
		t.Fatal(err)
	}
	repositoryValue, err := openFinanceStateRepository(bootstrap, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	repository := repositoryValue.(*financePostgresRepository)
	t.Cleanup(func() { repository.db.Close() })
	if _, err := repository.db.Exec(`DELETE FROM ynx_finance_state`); err != nil {
		t.Fatal(err)
	}
	if _, err := repository.db.Exec(`DELETE FROM ynx_finance_rate_limits`); err != nil {
		t.Fatal(err)
	}
	loaded, initialHash, exists, err := repository.Load()
	if err != nil || !exists || loaded.Accounts["ynx1test"].Categories[0].Name != "Initial" {
		t.Fatalf("bootstrap state=%+v exists=%v err=%v", loaded, exists, err)
	}
	left, _, _, _ := repository.Load()
	right, _, _, _ := repository.Load()
	left.Accounts["ynx1test"] = financeStateWithCategory("Left").Accounts["ynx1test"]
	leftHash, err := repository.Save(initialHash, left)
	if err != nil {
		t.Fatalf("postgres CAS write: %v", err)
	}
	right.Accounts["ynx1test"] = financeStateWithCategory("Right").Accounts["ynx1test"]
	if _, err := repository.Save(initialHash, right); !errors.Is(err, errFinanceStateConflict) {
		t.Fatalf("postgres stale writer error=%v", err)
	}
	authoritative, authoritativeHash, exists, err := repository.Load()
	if err != nil || !exists || authoritativeHash != leftHash || authoritative.Accounts["ynx1test"].Categories[0].Name != "Left" {
		t.Fatalf("postgres authority=%+v hash=%q exists=%v err=%v", authoritative, authoritativeHash, exists, err)
	}
	now := time.Date(2026, 8, 31, 12, 0, 0, 0, time.UTC)
	for range 2 {
		allowed, rateErr := repository.AllowRate("GET:postgres-rate-test", 2, time.Minute, now)
		if rateErr != nil || !allowed {
			t.Fatalf("postgres initial rate allowance allowed=%v err=%v", allowed, rateErr)
		}
	}
	if allowed, rateErr := repository.AllowRate("GET:postgres-rate-test", 2, time.Minute, now); rateErr != nil || allowed {
		t.Fatalf("postgres rate rejection allowed=%v err=%v", allowed, rateErr)
	}
	if allowed, rateErr := repository.AllowRate("GET:postgres-rate-test", 2, time.Minute, now.Add(time.Minute)); rateErr != nil || !allowed {
		t.Fatalf("postgres rate refill allowed=%v err=%v", allowed, rateErr)
	}
}
