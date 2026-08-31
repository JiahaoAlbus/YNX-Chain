package exchangeproduct

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

func TestPostgreSQLStateStoreMultiInstanceCASAndRestartRecovery(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("YNX_EXCHANGE_POSTGRES_TEST_URL"))
	if databaseURL == "" {
		t.Skip("YNX_EXCHANGE_POSTGRES_TEST_URL is not configured")
	}
	config := Config{DatabaseURL: databaseURL, APIKey: adminKey, WalletCallback: "ynxexchange://wallet/callback"}
	seed, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	store, ok := seed.store.(*postgresStateStore)
	if !ok {
		_ = seed.Close()
		t.Fatal("PostgreSQL store was not selected")
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = store.db.ExecContext(ctx, `DELETE FROM ynx_exchange_state WHERE id = 'primary'`)
	})
	if err := seed.Close(); err != nil {
		t.Fatal(err)
	}
	first, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	second, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	first.mu.Lock()
	first.state.Sequence++
	first.mu.Unlock()
	second.mu.Lock()
	second.state.Sequence++
	second.mu.Unlock()
	firstErr := make(chan error, 1)
	secondErr := make(chan error, 1)
	go func() { firstErr <- first.store.save(&first.state) }()
	go func() { secondErr <- second.store.save(&second.state) }()
	errs := []error{<-firstErr, <-secondErr}
	successes, conflicts := 0, 0
	for _, err := range errs {
		if err == nil {
			successes++
		}
		if errors.Is(err, errStateConflict) {
			conflicts++
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("CAS results=%v", errs)
	}
	restarted, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	if backend, multiInstance := restarted.StorageStatus(); backend != "postgresql" || !multiInstance || restarted.state.Revision != 2 {
		t.Fatalf("storage=%q/%t revision=%d", backend, multiInstance, restarted.state.Revision)
	}
	if _, err := restarted.CreditTestQuote(adminKey, bob, AmountScale, "postgres-restart-credit"); err != nil {
		t.Fatal(err)
	}
	readback, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	defer readback.Close()
	if readback.state.Revision != 3 {
		t.Fatalf("revision=%d", readback.state.Revision)
	}
	for _, balance := range readback.Snapshot(bob).Balances {
		if balance.Asset == QuoteAsset && balance.AvailableMicro == AmountScale {
			return
		}
	}
	t.Fatalf("restart did not retain test balance: %+v", readback.Snapshot(bob).Balances)
}
