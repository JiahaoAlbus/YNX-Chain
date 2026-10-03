package quantlab

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func testTenantSchedulerRestartsWithoutBrowser(t *testing.T, databaseURL string) {
	t.Helper()
	var now atomic.Int64
	now.Store(time.Date(2026, 10, 3, 0, 0, 0, 0, time.UTC).UnixNano())
	config := Config{StatePath: filepath.Join(t.TempDir(), "base.json"), DatabaseURL: databaseURL, StateNamespace: fmt.Sprintf("quant_scheduler-recovery-%d", time.Now().UnixNano()), Now: func() time.Time { return time.Unix(0, now.Load()).UTC() }, MarketData: fixtureMarket{bars: bars()}}
	first, err := NewTenantServer(config, "all")
	if err != nil {
		t.Fatal(err)
	}
	tenantID := strings.Repeat("a", 64)
	if _, err := first.tenant(tenantID); err != nil {
		t.Fatal(err)
	}
	service := first.servers[tenantID].service
	initial, err := service.RunBacktest(request())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.ConfigureStrategySchedule(initial.Strategy.ID, true, 60, request().Assumptions); err != nil {
		t.Fatal(err)
	}
	// Persist a second workspace with no enabled schedule. Discovery must not
	// allocate it after restart just because it has a research record.
	idleID := strings.Repeat("b", 64)
	if _, err := first.tenant(idleID); err != nil {
		t.Fatal(err)
	}
	if _, err := first.servers[idleID].service.RunBacktest(request()); err != nil {
		t.Fatal(err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	restarted, err := NewTenantServer(config, "all")
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	peer, err := NewTenantServer(config, "all")
	if err != nil {
		t.Fatal(err)
	}
	defer peer.Close()
	if len(restarted.servers) != 0 {
		t.Fatal("restart preloaded tenant outside scheduler")
	}
	if databaseURL != "" {
		store := restarted.baseService.store.(*postgresStateStore)
		foreignKey := strings.Replace(config.StateNamespace, "_", "x", 1) + ":tenant:" + strings.Repeat("c", 64)
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_, err := store.db.ExecContext(ctx, `INSERT INTO ynx_quant_state(state_key,revision,payload) SELECT $1,revision,payload FROM ynx_quant_state WHERE state_key=$2`, foreignKey, config.StateNamespace+":tenant:"+tenantID)
		cancel()
		if err != nil {
			t.Fatal(err)
		}
		defer func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if _, err := store.db.ExecContext(ctx, `DELETE FROM ynx_quant_state WHERE state_key IN ($1,$2,$3,$4)`, config.StateNamespace, config.StateNamespace+":tenant:"+tenantID, config.StateNamespace+":tenant:"+idleID, foreignKey); err != nil {
				t.Error(err)
			}
		}()
	}
	now.Add(int64(time.Minute))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := restarted.StartScheduler(ctx, 10*time.Millisecond)
	peerDone := peer.StartScheduler(ctx, 10*time.Millisecond)
	defer func() {
		cancel()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Error("scheduler did not stop")
		}
		select {
		case <-peerDone:
		case <-time.After(5 * time.Second):
			t.Error("peer scheduler did not stop")
		}
	}()
	// Direct store read observes persisted completion without an HTTP/browser
	// request or tenant() call that would otherwise populate the cache.
	child := config
	child.StatePath = filepath.Join(restarted.root, tenantID+".json")
	child.StateNamespace += ":tenant:" + tenantID
	var observer stateStore = fileStateStore{path: child.StatePath}
	if databaseURL != "" {
		observer = &postgresStateStore{db: restarted.baseService.store.(*postgresStateStore).db, key: child.StateNamespace}
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		loaded, found, err := observer.load()
		if err != nil {
			t.Fatal(err)
		}
		if found && len(loaded.Experiments) == 2 {
			if len(loaded.Paper.Orders) != 0 || len(loaded.TestnetOrders) != 0 {
				t.Fatal("research schedule executed capital orders")
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("persisted schedule did not resume without browser")
		}
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("scheduler did not stop")
	}
	select {
	case <-peerDone:
	case <-time.After(5 * time.Second):
		t.Fatal("peer scheduler did not stop")
	}
	final, found, err := observer.load()
	if err != nil || !found || len(final.Experiments) != 2 {
		t.Fatalf("restarted schedulers duplicated research: found=%t err=%v", found, err)
	}
	restarted.mu.Lock()
	_, idleLoaded := restarted.servers[idleID]
	_, foreignLoaded := restarted.servers[strings.Repeat("c", 64)]
	restarted.mu.Unlock()
	if idleLoaded {
		t.Fatal("disabled workspace allocated by discovery")
	}
	if foreignLoaded {
		t.Fatal("scheduler discovered a foreign namespace through pattern matching")
	}
}

func TestFileTenantSchedulerResumesAfterRestartWithoutBrowser(t *testing.T) {
	testTenantSchedulerRestartsWithoutBrowser(t, "")
}

func TestPostgreSQLTenantSchedulerResumesAfterRestartWithoutBrowser(t *testing.T) {
	url := strings.TrimSpace(os.Getenv("YNX_QUANT_POSTGRES_TEST_URL"))
	if url == "" {
		t.Skip("YNX_QUANT_POSTGRES_TEST_URL is not configured")
	}
	testTenantSchedulerRestartsWithoutBrowser(t, url)
}
