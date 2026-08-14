package quantlab

import (
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestScheduledResearchRunPersistsAndIsClaimedOnceAcrossServices(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	now := time.Date(2026, 8, 14, 1, 0, 0, 0, time.UTC)
	clock := func() time.Time { return now }
	market := fixtureMarket{bars: bars()}
	first, err := New(Config{StatePath: path, Now: clock, MarketData: market})
	if err != nil {
		t.Fatal(err)
	}
	initial, err := first.RunBacktestFromMarket(request().Strategy, request().Assumptions)
	if err != nil {
		t.Fatal(err)
	}
	configured, err := first.ConfigureStrategySchedule(initial.Strategy.ID, true, 60, request().Assumptions)
	if err != nil || !configured.Runtime.Enabled || configured.Runtime.LastRunStatus != "scheduled" {
		t.Fatalf("configured=%+v err=%v", configured.Runtime, err)
	}
	if receipts, err := first.RunDueSchedules(); err != nil || len(receipts) != 0 {
		t.Fatalf("early due receipts=%+v err=%v", receipts, err)
	}
	now = now.Add(time.Minute)
	second, err := New(Config{StatePath: path, Now: clock, MarketData: market})
	if err != nil {
		t.Fatal(err)
	}
	var wait sync.WaitGroup
	results := make(chan []ScheduledRunReceipt, 2)
	errors := make(chan error, 2)
	for _, service := range []*Service{first, second} {
		wait.Add(1)
		go func(service *Service) {
			defer wait.Done()
			receipts, runErr := service.RunDueSchedules()
			results <- receipts
			errors <- runErr
		}(service)
	}
	wait.Wait()
	close(results)
	close(errors)
	completed := 0
	for runErr := range errors {
		if runErr != nil {
			t.Fatal(runErr)
		}
	}
	for receipts := range results {
		completed += len(receipts)
	}
	if completed != 1 {
		t.Fatalf("due run executed %d times", completed)
	}
	restarted, err := New(Config{StatePath: path, Now: clock, MarketData: market})
	if err != nil {
		t.Fatal(err)
	}
	snapshot := restarted.Snapshot()
	strategies := snapshot["strategies"].(map[string]StrategySpec)
	runtime := strategies[initial.Strategy.ID].Runtime
	if runtime.Running || runtime.LastRunStatus != "completed" || runtime.LastExperiment == "" || !runtime.NextRunAt.Equal(now.Add(time.Minute)) {
		t.Fatalf("restart runtime=%+v", runtime)
	}
	if len(snapshot["experiments"].(map[string]Experiment)) != 2 {
		t.Fatalf("scheduled experiment was not persisted")
	}
	stopped, err := restarted.ConfigureStrategySchedule(initial.Strategy.ID, false, 0, Assumptions{})
	if err != nil || stopped.Runtime.Enabled || stopped.Runtime.LastRunStatus != "stopped_by_user" {
		t.Fatalf("stopped=%+v err=%v", stopped.Runtime, err)
	}
}

func TestScheduleFailsClosedWithoutMarketOrEligibleStage(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	service, err := New(Config{StatePath: path})
	if err != nil {
		t.Fatal(err)
	}
	experiment, err := service.RunBacktest(request())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.ConfigureStrategySchedule(experiment.Strategy.ID, true, 60, request().Assumptions); err != ErrInvalid {
		t.Fatalf("schedule without authoritative market err=%v", err)
	}
}

func TestLifecycleAdvanceStopsResearchSchedule(t *testing.T) {
	service, err := New(Config{StatePath: filepath.Join(t.TempDir(), "state.json"), MarketData: fixtureMarket{bars: bars()}})
	if err != nil {
		t.Fatal(err)
	}
	experiment, err := service.RunBacktestFromMarket(request().Strategy, request().Assumptions)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.ConfigureStrategySchedule(experiment.Strategy.ID, true, 60, request().Assumptions); err != nil {
		t.Fatal(err)
	}
	advanced, err := service.AdvanceStrategy(experiment.Strategy.ID, LifecycleApproval{TargetStage: StageWalkForward, RiskApproved: true, EvidenceDigest: strings.Repeat("a", 64), Actor: "risk-reviewer"})
	if err != nil {
		t.Fatal(err)
	}
	if advanced.Runtime.Enabled || advanced.Runtime.LastRunStatus != "stopped_stage_advanced" {
		t.Fatalf("advanced runtime=%+v", advanced.Runtime)
	}
}
