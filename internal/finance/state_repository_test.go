package finance

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/finance/brokerage"
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
}

func TestFinancePostgresTwoInstancesFenceBrokerCancelAndRecoverReconciliation(t *testing.T) {
	databaseURL := os.Getenv("YNX_FINANCE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("YNX_FINANCE_TEST_DATABASE_URL is required for PostgreSQL integration")
	}
	bootstrap, account, orderID, now := consumedBrokerFixture(t)
	initial, err := OpenStoreWithDatabase(bootstrap.path, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	db := initial.repository.(*financePostgresRepository).db
	if _, err := db.Exec(`DELETE FROM ynx_finance_state`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	first, err := OpenStoreWithDatabase(bootstrap.path, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	second, err := OpenStoreWithDatabase(bootstrap.path, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		first.repository.(*financePostgresRepository).db.Close()
		second.repository.(*financePostgresRepository).db.Close()
	})
	claim, err := first.ClaimBrokerDispatch(account, orderID, now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	providerOrder := brokerage.Order{ID: "22222222-3333-4444-8555-666666666666", ClientOrderID: orderID, AssetID: claim.Order.Order.AssetID, Symbol: claim.Order.Order.Symbol, Side: claim.Order.Order.Side, Qty: claim.Order.Order.Qty, FilledQty: "0", Type: claim.Order.Order.OrderType, LimitPrice: claim.Order.Order.LimitPrice, TimeInForce: claim.Order.Order.TimeInForce, Status: "accepted"}
	if _, err := first.CompleteBrokerDispatch(account, orderID, &providerOrder, nil, now.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if _, err := second.RequestBrokerCancel(account, orderID, now.Add(3*time.Minute)); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, store := range []*Store{first, second} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := store.ClaimBrokerCancel(account, orderID, now.Add(4*time.Minute))
			results <- err
		}()
	}
	wg.Wait()
	close(results)
	succeeded, rejected := 0, 0
	for err := range results {
		if err == nil {
			succeeded++
		} else {
			rejected++
		}
	}
	if succeeded != 1 || rejected != 1 {
		t.Fatalf("two PostgreSQL instances claimed cancellation success=%d rejected=%d", succeeded, rejected)
	}
	if err := second.ApplyBrokerReconciliation(account, brokerage.AccountSnapshot{RequestIDs: []string{"postgres-accepted-interim"}, Orders: []brokerage.Order{providerOrder}}, now.Add(5*time.Minute)); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenStoreWithDatabase(bootstrap.path, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { reopened.repository.(*financePostgresRepository).db.Close() })
	pending := reopened.BrokerWorkspace(account, now.Add(6*time.Minute)).Orders[0]
	if pending.State != "cancel_requested" || pending.CancelAttemptedAt.IsZero() || pending.ProviderRawStatus != "accepted" {
		t.Fatalf("PostgreSQL restart lost the one-shot cancel fence: %+v", pending)
	}
	if _, err := reopened.ClaimBrokerCancel(account, orderID, now.Add(6*time.Minute)); err == nil {
		t.Fatal("reopened PostgreSQL instance claimed a second provider DELETE")
	}
	providerOrder.Status = "canceled"
	if err := reopened.ApplyBrokerReconciliation(account, brokerage.AccountSnapshot{RequestIDs: []string{"postgres-canceled-terminal"}, Orders: []brokerage.Order{providerOrder}}, now.Add(7*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if final := first.BrokerWorkspace(account, now.Add(8*time.Minute)).Orders[0]; final.State != "canceled" {
		t.Fatalf("another PostgreSQL instance did not observe final cancellation: %+v", final)
	}
}
