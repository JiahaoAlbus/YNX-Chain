package quantlab

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"
)

func TestScheduledResearchCommitReplayAndCompletionAreOneDurableRun(t *testing.T) {
	testScheduledResearchCommitReplay(t, "")
}

func TestScheduledResearchCommitReplayPostgres(t *testing.T) {
	databaseURL := os.Getenv("YNX_QUANT_POSTGRES_TEST_URL")
	if databaseURL == "" {
		t.Skip("YNX_QUANT_POSTGRES_TEST_URL is not configured")
	}
	testScheduledResearchCommitReplay(t, databaseURL)
}

func TestFailedScheduledCompletionCannotCommitALateExperiment(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	now := time.Date(2026, 10, 4, 0, 0, 0, 0, time.UTC)
	s, err := New(Config{StatePath: path, Now: func() time.Time { return now }, MarketData: fixtureMarket{bars: bars()}})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	initial, err := s.RunBacktestFromMarket(request().Strategy, request().Assumptions)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.ConfigureStrategySchedule(initial.Strategy.ID, true, 60, request().Assumptions); err != nil {
		t.Fatal(err)
	}
	now = now.Add(time.Minute)
	claims, err := s.claimDueSchedules()
	if err != nil || len(claims) != 1 {
		t.Fatalf("claims=%v err=%v", claims, err)
	}
	claim := claims[0]
	if _, err := s.completeScheduledRun(claim, Experiment{}, ErrUnavailable); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.RunBacktest(BacktestRequest{Strategy: claim.Strategy, Bars: bars(), Assumptions: claim.Strategy.Runtime.Assumptions, scheduleRunID: claim.RunID}); !errors.Is(err, ErrConflict) {
		t.Fatalf("late experiment accepted: %v", err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("late experiment changed completed failure")
	}
}

func testScheduledResearchCommitReplay(t *testing.T, databaseURL string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "state.json")
	now := time.Date(2026, 10, 4, 0, 0, 0, 0, time.UTC)
	cfg := Config{StatePath: path, DatabaseURL: databaseURL, StateNamespace: fmt.Sprintf("scheduled-research-replay-%d", time.Now().UnixNano()), Now: func() time.Time { return now }, MarketData: fixtureMarket{bars: bars()}}
	first, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	readDurable := func() ([]byte, error) { return os.ReadFile(path) }
	if databaseURL != "" {
		store := first.store.(*postgresStateStore)
		defer func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if _, err := store.db.ExecContext(ctx, `DELETE FROM ynx_quant_state WHERE state_key=$1`, cfg.StateNamespace); err != nil {
				t.Error(err)
			}
		}()
		readDurable = func() ([]byte, error) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			var revision int64
			var payload json.RawMessage
			if err := store.db.QueryRowContext(ctx, `SELECT revision,payload FROM ynx_quant_state WHERE state_key=$1`, cfg.StateNamespace).Scan(&revision, &payload); err != nil {
				return nil, err
			}
			return json.Marshal(struct {
				Revision int64
				Payload  json.RawMessage
			}{revision, payload})
		}
	}
	initial, err := first.RunBacktestFromMarket(request().Strategy, request().Assumptions)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = first.ConfigureStrategySchedule(initial.Strategy.ID, true, 60, request().Assumptions); err != nil {
		t.Fatal(err)
	}
	now = now.Add(time.Minute)
	claims, err := first.claimDueSchedules()
	if err != nil || len(claims) != 1 {
		t.Fatalf("claims=%v err=%v", claims, err)
	}
	claim := claims[0]
	r := BacktestRequest{Strategy: claim.Strategy, Bars: bars(), Assumptions: claim.Strategy.Runtime.Assumptions, scheduleRunID: claim.RunID}
	result, err := first.RunBacktest(r)
	if err != nil {
		t.Fatal(err)
	}
	before, err := readDurable()
	if err != nil {
		t.Fatal(err)
	}
	// Simulate a cold worker after the commit response was lost, before the
	// original completion was delivered. No fake provider or capital operation.
	second, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			service := first
			if i%2 != 0 {
				service = second
			}
			got, err := service.RunBacktest(r)
			if err != nil || !reflect.DeepEqual(got, result) {
				t.Errorf("scheduled commit replay: got=%s err=%v want=%s", got.ID, err, result.ID)
			}
		}(i)
	}
	wg.Wait()
	after, err := readDurable()
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Error("commit replay created experiments/audit or changed durable claim")
	}
	changed := r
	changed.Assumptions.FeeBPS++
	if _, err = second.RunBacktest(changed); !errors.Is(err, ErrConflict) {
		t.Errorf("changed cost accepted: %v", err)
	}
	changed = r
	changed.Bars = append([]Bar(nil), r.Bars...)
	changed.Bars[0].Volume++
	if _, err = second.RunBacktest(changed); !errors.Is(err, ErrConflict) {
		t.Errorf("changed data accepted: %v", err)
	}
	changed = r
	changed.Strategy.Name += " changed"
	if _, err = second.RunBacktest(changed); !errors.Is(err, ErrConflict) {
		t.Errorf("changed name accepted: %v", err)
	}
	terminal, err := second.completeScheduledRun(claim, result, nil)
	if err != nil {
		t.Fatal(err)
	}
	terminalBytes, err := readDurable()
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(time.Second)
	restarted, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	got, err := restarted.RunBacktest(r)
	if err != nil || !reflect.DeepEqual(got, result) {
		t.Errorf("terminal research replay=%s err=%v", got.ID, err)
	}
	if got, err := restarted.completeScheduledRun(claim, result, nil); err != nil || got != terminal {
		t.Errorf("terminal completion replay=%+v err=%v", got, err)
	}
	finalBytes, err := readDurable()
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(terminalBytes, finalBytes) {
		t.Error("terminal research/completion replay changed state")
	}
	got.Strategy.Params["fast"] = 99
	got.EquityCurve[0].Equity = 0
	if again, err := restarted.RunBacktest(r); err != nil || !reflect.DeepEqual(again, result) {
		t.Errorf("caller changed retained scheduled receipt: %s %v", again.ID, err)
	}
	snapshot := restarted.Snapshot()
	if len(snapshot["experiments"].(map[string]Experiment)) != 2 || len(snapshot["paper"].(PaperState).Orders) != 0 || len(snapshot["testnetOrders"].(map[string]TestnetOrder)) != 0 {
		t.Error("claim duplicated research or executed capital")
	}
	// A fresh due slot is a new run; the old claim remains retired as before.
	now = now.Add(time.Minute)
	next, err := restarted.RunDueSchedules()
	if err != nil || len(next) != 1 || next[0].RunID == claim.RunID {
		t.Fatalf("next due=%v err=%v", next, err)
	}
	if _, err = restarted.RunBacktest(r); !errors.Is(err, ErrConflict) {
		t.Errorf("retired claim accepted: %v", err)
	}
	// An inherited ambiguous run must not be silently deduplicated or rewritten.
	restarted.mu.Lock()
	release, err := restarted.lockAndReload()
	if err != nil {
		restarted.mu.Unlock()
		t.Fatal(err)
	}
	latest := restarted.state.Experiments[next[0].ExperimentID]
	duplicate := latest
	duplicate.ID = "historical-duplicate"
	restarted.state.Experiments[duplicate.ID] = duplicate
	err = restarted.save()
	release()
	restarted.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	ambiguousBefore, err := readDurable()
	if err != nil {
		t.Fatal(err)
	}
	latestRequest := BacktestRequest{Strategy: latest.Strategy, Bars: bars(), Assumptions: latest.Assumptions, scheduleRunID: next[0].RunID}
	if _, err := restarted.RunBacktest(latestRequest); !errors.Is(err, ErrConflict) {
		t.Errorf("ambiguous claim accepted: %v", err)
	}
	ambiguousAfter, err := readDurable()
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(ambiguousBefore, ambiguousAfter) {
		t.Error("ambiguous history was modified")
	}
}
