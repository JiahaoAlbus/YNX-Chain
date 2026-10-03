package quantlab

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

// Real PostgreSQL integration, not a replacement store or in-memory CAS model.
func TestPostgreSQLResearchReplayConcurrentInstancesRestartAndTenantIsolation(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("YNX_QUANT_POSTGRES_TEST_URL"))
	if databaseURL == "" {
		t.Skip("YNX_QUANT_POSTGRES_TEST_URL is not configured")
	}
	namespace := fmt.Sprintf("quant-research-it-%d", time.Now().UnixNano())
	market := &replayResearchMarket{}
	config := func(key string, connected bool) Config {
		cfg := Config{StatePath: filepath.Join(t.TempDir(), "unused.json"), DatabaseURL: databaseURL, StateNamespace: key}
		if connected {
			cfg.MarketData = market
		}
		return cfg
	}
	first, err := New(config(namespace, true))
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	store := first.store.(*postgresStateStore)
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := store.db.ExecContext(ctx, `DELETE FROM ynx_quant_state WHERE state_key = $1 OR state_key = $2`, namespace, namespace+":other"); err != nil {
			t.Error(err)
		}
	}()
	second, err := New(config(namespace, true))
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	request := request()
	var wg sync.WaitGroup
	start := make(chan struct{})
	results := make(chan Experiment, 12)
	failures := make(chan error, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			<-start
			service := first
			if index%2 == 1 {
				service = second
			}
			result, err := service.RunBacktestFromMarketOnce(request.Strategy, request.Assumptions, researchFixtureKey)
			// CAS contention is an explicit conflict, never a fabricated success.
			if err != nil {
				failures <- err
			} else {
				results <- result
			}
		}(i)
	}
	close(start)
	wg.Wait()
	close(results)
	close(failures)
	var receipt Experiment
	successes := 0
	for result := range results {
		if successes == 0 {
			receipt = result
		} else if !reflect.DeepEqual(receipt, result) {
			t.Fatal("concurrent successful receipts differ")
		}
		successes++
	}
	if successes == 0 {
		t.Fatal("no request committed")
	}
	for err := range failures {
		if !errors.Is(err, ErrConflict) {
			t.Fatalf("unexpected contention result: %v", err)
		}
	}
	// Restart without market availability: explicit same-intent retry reads the
	// exact committed receipt and must not run another backtest or adapter call.
	restarted, err := New(config(namespace, false))
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	before := market.calls.Load()
	for i := 0; i < 12; i++ {
		replayed, err := restarted.RunBacktestFromMarketOnce(request.Strategy, request.Assumptions, researchFixtureKey)
		if err != nil || !reflect.DeepEqual(receipt, replayed) {
			t.Fatalf("restart explicit retry failed: %v", err)
		}
	}
	if market.calls.Load() != before || len(restarted.Snapshot()["experiments"].(map[string]Experiment)) != 1 {
		t.Fatal("retry fetched market or duplicated persisted experiment")
	}
	changed := request.Assumptions
	changed.FeeBPS++
	if _, err := restarted.RunBacktestFromMarketOnce(request.Strategy, changed, researchFixtureKey); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed intent did not conflict: %v", err)
	}
	other, err := New(config(namespace+":other", true))
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	request.Strategy.Name = "Independent PostgreSQL tenant"
	otherReceipt, err := other.RunBacktestFromMarketOnce(request.Strategy, request.Assumptions, researchFixtureKey)
	if err != nil || otherReceipt.Strategy.Name == receipt.Strategy.Name {
		t.Fatalf("tenant key leaked or failed: %v", err)
	}
	if len(other.Snapshot()["experiments"].(map[string]Experiment)) != 1 {
		t.Fatal("wrong tenant experiment count")
	}
}
