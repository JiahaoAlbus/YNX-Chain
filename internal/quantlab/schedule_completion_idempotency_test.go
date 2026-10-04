package quantlab

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestScheduledCompletionReplayPreservesTerminalReceipt(t *testing.T) {
	for _, outcome := range []string{"completed", "failed", "cancelled"} {
		t.Run(outcome, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "state.json")
			now := time.Date(2026, 10, 4, 0, 0, 0, 0, time.UTC)
			cfg := Config{StatePath: path, Now: func() time.Time { return now }, MarketData: fixtureMarket{bars: bars()}}
			first, err := New(cfg)
			if err != nil {
				t.Fatal(err)
			}
			defer first.Close()
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
				t.Fatalf("claim=%v err=%v", claims, err)
			}
			claim := claims[0]
			var experiment Experiment
			var runErr error
			switch outcome {
			case "completed":
				experiment, err = first.RunBacktest(BacktestRequest{Strategy: claim.Strategy, Bars: bars(), Assumptions: claim.Strategy.Runtime.Assumptions, scheduleRunID: claim.RunID})
				if err != nil {
					t.Fatal(err)
				}
			case "failed":
				runErr = ErrUnavailable
			case "cancelled":
				if _, err = first.ConfigureStrategySchedule(initial.Strategy.ID, false, 0, Assumptions{}); err != nil {
					t.Fatal(err)
				}
			}
			terminal, err := first.completeScheduledRun(claim, experiment, runErr)
			if err != nil {
				t.Fatal(err)
			}
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			now = now.Add(time.Second)
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
					receipt, replayErr := service.completeScheduledRun(claim, experiment, runErr)
					if replayErr != nil || receipt != terminal {
						t.Errorf("replay changed terminal: %+v err=%v want=%+v", receipt, replayErr, terminal)
					}
				}(i)
			}
			wg.Wait()
			conflicting := experiment
			conflicting.ID = "conflicting-experiment"
			if _, err = second.completeScheduledRun(claim, conflicting, runErr); !errors.Is(err, ErrConflict) {
				t.Errorf("conflicting terminal accepted: %v", err)
			}
			after, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(before, after) {
				t.Fatal("terminal replay changed durable state/audit")
			}
			restarted, err := New(cfg)
			if err != nil {
				t.Fatal(err)
			}
			defer restarted.Close()
			if got, err := restarted.completeScheduledRun(claim, experiment, runErr); err != nil || got != terminal {
				t.Fatalf("cold replay=%+v err=%v", got, err)
			}
		})
	}
}
