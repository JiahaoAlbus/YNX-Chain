package quantlab

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestPostgreSQLPaperKillFencesInFlightMarketAndSurvivesRestart(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("YNX_QUANT_POSTGRES_TEST_URL"))
	if databaseURL == "" {
		t.Skip("YNX_QUANT_POSTGRES_TEST_URL is not configured")
	}
	namespace := fmt.Sprintf("quant-kill-it-%d", time.Now().UnixNano())
	config := Config{StatePath: filepath.Join(t.TempDir(), "unused.json"), DatabaseURL: databaseURL, StateNamespace: namespace, MarketData: &submissionMarket{}}
	first, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := first.Close(); err != nil {
			t.Error(err)
		}
	})
	store := first.store.(*postgresStateStore)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := store.db.ExecContext(ctx, `DELETE FROM ynx_quant_state WHERE state_key = $1`, namespace); err != nil {
			t.Error(err)
		}
	})
	experiment, err := first.RunBacktest(request())
	if err != nil {
		t.Fatal(err)
	}
	digest := experiment.Strategy.StrategyHash
	committed, err := first.SubmitPaperSignalFromMarket(digest, "buy", 1_000_000, "before-kill-receipt")
	if err != nil {
		t.Fatal(err)
	}
	market := &submissionMarket{enter: make(chan struct{}), resume: make(chan struct{})}
	config.MarketData = market
	second, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	done := make(chan error, 1)
	go func() {
		_, err := second.SubmitPaperSignalFromMarket(digest, "buy", 1_000_000, "inflight-after-kill")
		done <- err
	}()
	select {
	case <-market.enter:
	case <-time.After(5 * time.Second):
		t.Fatal("market lookup did not start")
	}
	_, killErr := first.Kill("second-instance in-flight risk fence")
	close(market.resume)
	if killErr != nil {
		t.Fatal(killErr)
	}
	select {
	case err := <-done:
		if !errors.Is(err, ErrForbidden) {
			t.Fatalf("inflight error=%v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("inflight request did not finish")
	}
	config.MarketData = nil
	reopened, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	before := reopened.Snapshot()["paper"].(PaperState)
	if !before.KillSwitch || len(before.Orders) != 1 {
		t.Fatalf("kill or committed orders lost: %+v", before)
	}
	// Receipt replay is a read, never a new execution even after kill/offline.
	replayed, err := reopened.SubmitPaperSignalFromMarket(digest, "buy", 1_000_000, "before-kill-receipt")
	if err != nil || !reflect.DeepEqual(committed, replayed) {
		t.Fatalf("receipt replay changed: %+v %v", replayed, err)
	}
	if _, err := reopened.ApplyPaperSignal(digest, "sell", 1_200_000, 1_000_000, 20_000_000); !errors.Is(err, ErrForbidden) {
		t.Fatalf("restart bypassed kill: %v", err)
	}
	if after := reopened.Snapshot()["paper"].(PaperState); !reflect.DeepEqual(before, after) {
		t.Fatal("blocked or replayed request mutated Paper state")
	}
}
