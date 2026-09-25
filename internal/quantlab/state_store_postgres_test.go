package quantlab

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPostgreSQLStateStoreMultiInstanceCASRestartAndTenantIsolation(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("YNX_QUANT_POSTGRES_TEST_URL"))
	if databaseURL == "" {
		t.Skip("YNX_QUANT_POSTGRES_TEST_URL is not configured")
	}
	namespace := "quant-it-" + strings.ToLower(strings.ReplaceAll(t.Name(), "/", "-"))
	config := func(stateNamespace string) Config {
		return Config{
			StatePath:      filepath.Join(t.TempDir(), "state.json"),
			DatabaseURL:    databaseURL,
			StateNamespace: stateNamespace,
		}
	}
	seed, err := New(config(namespace))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := seed.Kill("postgres state seed"); err != nil {
		_ = seed.Close()
		t.Fatal(err)
	}
	if err := seed.Close(); err != nil {
		t.Fatal(err)
	}
	first, err := New(config(namespace))
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	second, err := New(config(namespace))
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	firstErr := make(chan error, 1)
	secondErr := make(chan error, 1)
	first.state.Sequence++
	second.state.Sequence++
	go func() { firstErr <- first.save() }()
	go func() { secondErr <- second.save() }()
	errs := []error{<-firstErr, <-secondErr}
	successes, conflicts := 0, 0
	for _, err := range errs {
		if err == nil {
			successes++
		}
		if errors.Is(err, ErrConflict) {
			conflicts++
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("CAS results=%v", errs)
	}
	restarted, err := New(config(namespace))
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	if !restarted.Snapshot()["paper"].(PaperState).KillSwitch || restarted.StorageStatus()["multiInstance"] != true {
		t.Fatalf("restart state=%#v status=%#v", restarted.Snapshot()["paper"], restarted.StorageStatus())
	}
	tenant, err := New(config(namespace + ":tenant:" + strings.Repeat("a", 64)))
	if err != nil {
		t.Fatal(err)
	}
	defer tenant.Close()
	if tenant.Snapshot()["paper"].(PaperState).KillSwitch {
		t.Fatal("tenant observed another namespace state")
	}
	store, ok := first.store.(*postgresStateStore)
	if !ok {
		t.Fatal("PostgreSQL store was not selected")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := store.db.ExecContext(ctx, `DELETE FROM ynx_quant_state WHERE state_key = $1 OR state_key LIKE $2`, namespace, namespace+":tenant:%"); err != nil {
		t.Fatal(err)
	}
}
