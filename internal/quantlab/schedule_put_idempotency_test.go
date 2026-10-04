package quantlab

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestScheduleIdenticalPUTPreservesDurableRunAcrossServices(t *testing.T) {
	for _, storage := range []string{"file", "postgres"} {
		for _, phase := range []string{"scheduled", "running", "completed", "stopped"} {
			t.Run(storage+"/"+phase, func(t *testing.T) {
				path := filepath.Join(t.TempDir(), "state.json")
				now := time.Date(2026, 10, 4, 0, 0, 0, 0, time.UTC)
				cfg := Config{StatePath: path, Now: func() time.Time { return now }, MarketData: fixtureMarket{bars: bars()}}
				if storage == "postgres" {
					cfg.DatabaseURL = os.Getenv("YNX_QUANT_POSTGRES_TEST_URL")
					if cfg.DatabaseURL == "" {
						t.Skip("YNX_QUANT_POSTGRES_TEST_URL is not configured")
					}
					cfg.StateNamespace = fmt.Sprintf("quant-schedule-put-it-%s-%d", phase, time.Now().UnixNano())
				}
				first, err := New(cfg)
				if err != nil {
					t.Fatal(err)
				}
				defer first.Close()
				readDurable := func() ([]byte, error) { return os.ReadFile(path) }
				if storage == "postgres" {
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
				experiment, err := first.RunBacktestFromMarket(request().Strategy, request().Assumptions)
				if err != nil {
					t.Fatal(err)
				}
				id := experiment.Strategy.ID
				var originalClaim scheduledRunClaim
				if _, err = first.ConfigureStrategySchedule(id, true, 60, request().Assumptions); err != nil {
					t.Fatal(err)
				}
				if phase == "running" || phase == "completed" {
					now = now.Add(time.Minute)
					if phase == "running" {
						claims, err := first.claimDueSchedules()
						if err != nil || len(claims) != 1 {
							t.Fatalf("claims=%v err=%v", claims, err)
						}
						originalClaim = claims[0]
					} else {
						runs, err := first.RunDueSchedules()
						if err != nil || len(runs) != 1 {
							t.Fatalf("runs=%v err=%v", runs, err)
						}
					}
				}
				if phase == "stopped" {
					if _, err = first.ConfigureStrategySchedule(id, false, 0, Assumptions{}); err != nil {
						t.Fatal(err)
					}
				}
				before, err := readDurable()
				if err != nil {
					t.Fatal(err)
				}
				original := first.state.Strategies[id]
				now = now.Add(10 * time.Second)
				second, err := New(cfg)
				if err != nil {
					t.Fatal(err)
				}
				defer second.Close()
				hosts := []*httptest.Server{httptest.NewServer(NewServer(first)), httptest.NewServer(NewServer(second))}
				for _, host := range hosts {
					host.Client().Timeout = 5 * time.Second
				}
				defer hosts[0].Close()
				defer hosts[1].Close()
				payload, err := json.Marshal(map[string]any{"enabled": phase != "stopped", "intervalSeconds": 60, "assumptions": request().Assumptions})
				if err != nil {
					t.Fatal(err)
				}
				if phase == "stopped" {
					payload = []byte(`{"enabled":false,"intervalSeconds":0,"assumptions":{}}`)
				}
				var wg sync.WaitGroup
				errors := make(chan error, 12)
				receipts := make(chan StrategySpec, 12)
				for i := 0; i < 12; i++ {
					host := hosts[i%2]
					wg.Add(1)
					go func() {
						defer wg.Done()
						var got StrategySpec
						r, err := http.NewRequest(http.MethodPut, host.URL+"/v1/strategies/"+url.PathEscape(id)+"/schedule", bytes.NewReader(payload))
						if err != nil {
							errors <- err
							return
						}
						r.Header.Set("X-YNX-Preview-Mode", "local-paper")
						r.Header.Set("Content-Type", "application/json")
						response, err := host.Client().Do(r)
						if err != nil {
							errors <- err
							return
						}
						defer response.Body.Close()
						if response.StatusCode != http.StatusOK {
							errors <- fmt.Errorf("PUT status=%d", response.StatusCode)
							return
						}
						err = json.NewDecoder(response.Body).Decode(&got)
						receipts <- got
						errors <- err
					}()
				}
				wg.Wait()
				close(errors)
				close(receipts)
				for err := range errors {
					if err != nil {
						t.Fatal(err)
					}
				}
				for got := range receipts {
					if hash(got) != hash(original) {
						t.Errorf("identical PUT replaced %s run/claim/next-run receipt", phase)
					}
				}
				after, err := readDurable()
				if err != nil || !bytes.Equal(before, after) {
					t.Fatalf("identical PUT changed audit/state bytes: %v", err)
				}
				restarted, err := New(cfg)
				if err != nil {
					t.Fatal(err)
				}
				defer restarted.Close()
				if hash(restarted.state.Strategies[id]) != hash(original) {
					t.Fatal("restart lost retained run")
				}
				if phase == "running" {
					completed, err := restarted.RunBacktest(BacktestRequest{Strategy: originalClaim.Strategy, Bars: bars(), Assumptions: originalClaim.Strategy.Runtime.Assumptions, scheduleRunID: originalClaim.RunID})
					if err != nil {
						t.Fatalf("retry invalidated original in-flight research: %v", err)
					}
					receipt, err := restarted.completeScheduledRun(originalClaim, completed, nil)
					if err != nil || receipt.RunID != originalClaim.RunID || receipt.Status != "completed" {
						t.Fatalf("original claim cannot complete: %+v %v", receipt, err)
					}
					if len(restarted.state.Paper.Orders) != 0 || len(restarted.state.TestnetOrders) != 0 {
						t.Fatal("research schedule submitted capital orders")
					}
				}
			})
		}
	}
}

func TestScheduleDifferentConfigurationStillChangesOnlyAfterValidation(t *testing.T) {
	now := time.Date(2026, 10, 4, 0, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "state.json")
	s, err := New(Config{StatePath: path, Now: func() time.Time { return now }, MarketData: fixtureMarket{bars: bars()}})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	x, err := s.RunBacktestFromMarket(request().Strategy, request().Assumptions)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.ConfigureStrategySchedule(x.Strategy.ID, true, 60, request().Assumptions); err != nil {
		t.Fatal(err)
	}
	now = now.Add(10 * time.Second)
	changed := request().Assumptions
	changed.FeeBPS++
	receipt, err := s.ConfigureStrategySchedule(x.Strategy.ID, true, 120, changed)
	if err != nil || receipt.Runtime.Assumptions != changed || receipt.Runtime.IntervalSeconds != 120 || !receipt.Runtime.NextRunAt.Equal(now.Add(120*time.Second)) {
		t.Fatalf("valid changed configuration=%+v err=%v", receipt.Runtime, err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.ConfigureStrategySchedule(x.Strategy.ID, true, 59, changed); err != ErrInvalid {
		t.Fatalf("invalid interval err=%v", err)
	}
	bad := changed
	bad.FeeBPS = -1
	if _, err = s.ConfigureStrategySchedule(x.Strategy.ID, true, 120, bad); err == nil {
		t.Fatal("invalid cost admitted")
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("invalid configuration mutated state: %v", err)
	}
}
