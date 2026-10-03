package quantlab

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type pausedScheduleMarket struct {
	fixtureMarket
	enter, resume chan struct{}
}

func (m pausedScheduleMarket) History(market string, limit int) ([]Bar, string, error) {
	close(m.enter)
	<-m.resume
	return m.fixtureMarket.History(market, limit)
}

func TestPostgreSQLSchedulesFenceStoppedInflightAndRecoverClaimsAcrossInstances(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("YNX_QUANT_POSTGRES_TEST_URL"))
	if databaseURL == "" {
		t.Skip("YNX_QUANT_POSTGRES_TEST_URL is not configured")
	}
	namespace := fmt.Sprintf("quant-schedule-it-%d", time.Now().UnixNano())
	var now atomic.Int64
	now.Store(time.Date(2026, 10, 3, 0, 0, 0, 0, time.UTC).UnixNano())
	config := Config{StatePath: filepath.Join(t.TempDir(), "unused.json"), DatabaseURL: databaseURL, StateNamespace: namespace, Now: func() time.Time { return time.Unix(0, now.Load()).UTC() }, MarketData: fixtureMarket{bars: bars()}}
	first, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	store := first.store.(*postgresStateStore)
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := store.db.ExecContext(ctx, `DELETE FROM ynx_quant_state WHERE state_key=$1`, namespace); err != nil {
			t.Error(err)
		}
	}()
	experiment, err := first.RunBacktest(request())
	if err != nil {
		t.Fatal(err)
	}
	id := experiment.Strategy.ID
	if _, err := first.ConfigureStrategySchedule(id, true, 60, request().Assumptions); err != nil {
		t.Fatal(err)
	}
	second, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	enter, resume := make(chan struct{}), make(chan struct{})
	var unblock sync.Once
	defer unblock.Do(func() { close(resume) })
	pausedConfig := config
	pausedConfig.MarketData = pausedScheduleMarket{fixtureMarket: fixtureMarket{bars: bars()}, enter: enter, resume: resume}
	paused, err := New(pausedConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer paused.Close()
	now.Add(int64(time.Minute))
	type outcome struct {
		receipts []ScheduledRunReceipt
		err      error
	}
	done := make(chan outcome, 1)
	go func() { receipts, err := paused.RunDueSchedules(); done <- outcome{receipts, err} }()
	select {
	case <-enter:
	case <-time.After(5 * time.Second):
		t.Fatal("schedule never reached market")
	}
	if receipts, err := second.RunDueSchedules(); err != nil || len(receipts) != 0 {
		t.Fatalf("claimed due run duplicated: %+v %v", receipts, err)
	}
	if _, err := second.ConfigureStrategySchedule(id, false, 0, Assumptions{}); err != nil {
		t.Fatal(err)
	}
	unblock.Do(func() { close(resume) })
	select {
	case result := <-done:
		if result.err != nil || len(result.receipts) != 1 || result.receipts[0].Status != "cancelled_before_execution" || result.receipts[0].ExperimentID != "" {
			t.Fatalf("stopped work committed: %+v", result)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("stopped run never completed")
	}
	restarted, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	snapshot := restarted.Snapshot()
	runtime := snapshot["strategies"].(map[string]StrategySpec)[id].Runtime
	if runtime.Enabled || runtime.Running || len(snapshot["experiments"].(map[string]Experiment)) != 1 {
		t.Fatal("restart revived stopped research")
	}
	// Simulate process loss after a durable claim, not an actual live worker.
	if _, err := restarted.ConfigureStrategySchedule(id, true, 60, request().Assumptions); err != nil {
		t.Fatal(err)
	}
	now.Add(int64(time.Minute))
	claims, err := restarted.claimDueSchedules()
	if err != nil || len(claims) != 1 {
		t.Fatalf("claim=%+v err=%v", claims, err)
	}
	if receipts, err := second.RunDueSchedules(); err != nil || len(receipts) != 0 {
		t.Fatal("abandoned claim recovered before persisted next due")
	}
	now.Add(int64(time.Minute))
	receipts, err := second.RunDueSchedules()
	if err != nil || len(receipts) != 1 || receipts[0].Status != "completed" {
		t.Fatalf("next due recovery=%+v err=%v", receipts, err)
	}
	old := claims[0]
	if _, err := restarted.RunBacktest(BacktestRequest{Strategy: old.Strategy, Bars: bars(), Assumptions: old.Strategy.Runtime.Assumptions, scheduleRunID: old.RunID}); !errors.Is(err, ErrConflict) {
		t.Fatalf("retired claim committed: %v", err)
	}
	if _, err := restarted.completeScheduledRun(old, Experiment{}, ErrConflict); !errors.Is(err, ErrConflict) {
		t.Fatalf("retired completion replaced newer receipt: %v", err)
	}
	final := first.Snapshot()
	if len(final["experiments"].(map[string]Experiment)) != 2 || len(final["paper"].(PaperState).Orders) != 0 {
		t.Fatal("schedule duplicated research or executed Paper")
	}
	if len(final["testnetOrders"].(map[string]TestnetOrder)) != 0 {
		t.Fatal("research schedule submitted Testnet order")
	}
}
