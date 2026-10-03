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

type cancelledScheduleHistory struct {
	fixtureMarket
	cancel                    context.CancelFunc
	beforeCancel              func()
	contextCalls, legacyCalls int
}

func (m *cancelledScheduleHistory) History(string, int) ([]Bar, string, error) {
	m.legacyCalls++
	return nil, "", ErrUnavailable
}

func (m *cancelledScheduleHistory) HistoryContext(ctx context.Context, market string, limit int) ([]Bar, string, error) {
	m.contextCalls++
	m.beforeCancel()
	m.cancel()
	// Even if an adapter returns valid bars after cancellation, no experiment
	// or completed schedule receipt may be written from this cancelled run.
	return m.fixtureMarket.History(market, limit)
}

func testScheduleContextCancellation(t *testing.T, databaseURL string) {
	t.Helper()
	now := time.Date(2026, 10, 3, 0, 0, 0, 0, time.UTC)
	namespace := fmt.Sprintf("quant-schedule-cancel-%d", time.Now().UnixNano())
	cfg := Config{StatePath: filepath.Join(t.TempDir(), "state.json"), DatabaseURL: databaseURL, StateNamespace: namespace, Now: func() time.Time { return now }, MarketData: fixtureMarket{bars: bars()}}
	s, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if databaseURL != "" {
		store := s.store.(*postgresStateStore)
		defer func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if _, err := store.db.ExecContext(ctx, `DELETE FROM ynx_quant_state WHERE state_key=$1`, namespace); err != nil {
				t.Error(err)
			}
		}()
	}
	initial, err := s.RunBacktest(request())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.ConfigureStrategySchedule(initial.Strategy.ID, true, 60, request().Assumptions); err != nil {
		t.Fatal(err)
	}
	now = now.Add(time.Minute)
	load := func() state {
		t.Helper()
		value, found, err := s.store.load()
		if err != nil || !found {
			t.Fatalf("state unavailable found=%t err=%v", found, err)
		}
		return value
	}
	before := load()
	preCancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if receipts, err := s.RunDueSchedulesContext(preCancelled); !errors.Is(err, context.Canceled) || len(receipts) != 0 {
		t.Fatalf("pre-cancelled=%+v %v", receipts, err)
	}
	if !reflect.DeepEqual(before, load()) {
		t.Fatal("pre-cancelled scheduler wrote a claim")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var claimed state
	market := &cancelledScheduleHistory{fixtureMarket: fixtureMarket{bars: bars()}, cancel: cancel, beforeCancel: func() { claimed = load() }}
	s.cfg.MarketData = market
	receipts, err := s.RunDueSchedulesContext(ctx)
	if !errors.Is(err, context.Canceled) || len(receipts) != 0 || market.contextCalls != 1 || market.legacyCalls != 0 {
		t.Fatalf("cancelled schedule=%+v err=%v contextual=%d legacy=%d", receipts, err, market.contextCalls, market.legacyCalls)
	}
	if !reflect.DeepEqual(claimed, load()) {
		t.Fatal("cancelled history created an experiment/completion or altered its claim")
	}
	if !claimed.Strategies[initial.Strategy.ID].Runtime.Running || len(claimed.Experiments) != 1 {
		t.Fatal("claim recovery boundary was not retained")
	}
	restarted, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	if receipts, err := restarted.RunDueSchedules(); err != nil || len(receipts) != 0 {
		t.Fatal("cancelled claim immediately replayed")
	}
	now = now.Add(time.Minute)
	if receipts, err := restarted.RunDueSchedules(); err != nil || len(receipts) != 1 || receipts[0].Status != "completed" {
		t.Fatalf("next due recovery=%+v %v", receipts, err)
	}
	final := load()
	if len(final.Experiments) != 2 || len(final.Paper.Orders) != 0 || len(final.TestnetOrders) != 0 {
		t.Fatal("cancelled run was duplicated or executed capital orders")
	}
}

func TestFileSchedulesPreserveContextCancellationAndNextDueRecovery(t *testing.T) {
	testScheduleContextCancellation(t, "")
}

func TestPostgreSQLSchedulesPreserveContextCancellationAndNextDueRecovery(t *testing.T) {
	url := strings.TrimSpace(os.Getenv("YNX_QUANT_POSTGRES_TEST_URL"))
	if url == "" {
		t.Skip("YNX_QUANT_POSTGRES_TEST_URL is not configured")
	}
	testScheduleContextCancellation(t, url)
}

func TestTenantSchedulerCancellationClosesDoneAfterNoLateCommit(t *testing.T) {
	now := time.Date(2026, 10, 3, 0, 0, 0, 0, time.UTC)
	handler, err := NewTenantServer(Config{StatePath: filepath.Join(t.TempDir(), "base.json"), Now: func() time.Time { return now }, MarketData: fixtureMarket{bars: bars()}}, "all")
	if err != nil {
		t.Fatal(err)
	}
	defer handler.Close()
	id := strings.Repeat("a", 64)
	if _, err := handler.tenant(id); err != nil {
		t.Fatal(err)
	}
	s := handler.servers[id].service
	initial, err := s.RunBacktest(request())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.ConfigureStrategySchedule(initial.Strategy.ID, true, 60, request().Assumptions); err != nil {
		t.Fatal(err)
	}
	now = now.Add(time.Minute)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var claimed state
	market := &cancelledScheduleHistory{fixtureMarket: fixtureMarket{bars: bars()}, cancel: cancel, beforeCancel: func() {
		value, found, err := s.store.load()
		if err != nil || !found {
			return
		}
		claimed = value
	}}
	s.cfg.MarketData = market
	done := handler.StartScheduler(ctx, 10*time.Millisecond)
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("cancelled ticker did not finish")
	}
	final, found, err := s.store.load()
	if err != nil || !found || market.contextCalls != 1 || market.legacyCalls != 0 || !reflect.DeepEqual(claimed, final) || len(final.Experiments) != 1 {
		t.Fatal("joined scheduler committed cancelled work or lost its claim")
	}
}
