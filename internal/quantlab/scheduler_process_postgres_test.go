package quantlab

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

// Actual killed worker, real PostgreSQL, actual recovered RunDueSchedules.
// The market bars and clock are declared local research fixtures, not public
// performance, real Wallet authorization or autonomous capital execution.
func TestPostgreSQLScheduledWorkerSIGKILLRecoversOnlyAtNextDue(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("YNX_QUANT_POSTGRES_TEST_URL"))
	if databaseURL == "" {
		t.Skip("YNX_QUANT_POSTGRES_TEST_URL is not configured")
	}
	namespace := fmt.Sprintf("quant-process-it-schedule-%d", time.Now().UnixNano())
	now := time.Date(2026, 10, 4, 0, 0, 0, 0, time.UTC)
	cfg := Config{DatabaseURL: databaseURL, StateNamespace: namespace, StatePath: filepath.Join(t.TempDir(), "unused.json"), Now: func() time.Time { return now }, MarketData: fixtureMarket{bars: bars()}}
	seed, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = seed.Close() })
	store := seed.store.(*postgresStateStore)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := store.db.ExecContext(ctx, `DELETE FROM ynx_quant_state WHERE state_key=$1`, namespace); err != nil {
			t.Error(err)
		}
	})
	experiment, err := seed.RunBacktest(request())
	if err != nil {
		t.Fatal(err)
	}
	id := experiment.Strategy.ID
	if _, err := seed.ConfigureStrategySchedule(id, true, 60, request().Assumptions); err != nil {
		t.Fatal(err)
	}
	now = now.Add(time.Minute)
	fixture := paperProcessFixture{DatabaseURL: databaseURL, Namespace: namespace, StatePath: cfg.StatePath, ScheduleAt: now.UnixNano(), HoldSchedule: true}
	blocked := startPaperProcess(t, fixture)
	claimed := seed.Snapshot()
	claim := claimed["strategies"].(map[string]StrategySpec)[id].Runtime
	if !claim.Running || claim.RunID == "" || len(claimed["experiments"].(map[string]Experiment)) != 1 {
		t.Fatal("readiness did not bind an actual persisted uncompleted claim")
	}
	blocked.Crash()
	// No local model or rewritten DB record substitutes for the killed worker.
	if current := seed.Snapshot()["strategies"].(map[string]StrategySpec)[id].Runtime; !reflect.DeepEqual(current, claim) {
		t.Fatal("worker SIGKILL lost or replaced its persisted claim")
	}
	fixture.HoldSchedule = false
	beforeDue := startPaperProcess(t, fixture)
	if current := seed.Snapshot()["strategies"].(map[string]StrategySpec)[id].Runtime; !reflect.DeepEqual(current, claim) {
		t.Fatal("restart ran abandoned claim before persisted next due")
	}
	beforeDue.Close()
	now = now.Add(time.Minute)
	fixture.ScheduleAt = now.UnixNano()
	recovered := startPaperProcess(t, fixture)
	final := seed.Snapshot()
	runtime := final["strategies"].(map[string]StrategySpec)[id].Runtime
	if runtime.Running || !runtime.Enabled || runtime.RunID == claim.RunID || runtime.LastRunStatus != "completed" || runtime.LastExperiment == "" || !runtime.LastRunAt.Equal(now) {
		t.Fatal("next-due process did not persist exactly one completed research run")
	}
	if len(final["experiments"].(map[string]Experiment)) != 2 || len(final["paper"].(PaperState).Orders) != 0 || len(final["testnetOrders"].(map[string]TestnetOrder)) != 0 {
		t.Fatal("schedule duplicated history or submitted Paper/Testnet capital")
	}
	recovered.Close()
	// Second opening at the same clock cannot create another completed run or
	// alter audit/state. The next due boundary, not restart, authorizes research.
	var revision int64
	var payload string
	if err := store.db.QueryRow(`SELECT revision,payload::text FROM ynx_quant_state WHERE state_key=$1`, namespace).Scan(&revision, &payload); err != nil {
		t.Fatal(err)
	}
	secondOpen := startPaperProcess(t, fixture)
	secondOpen.Close()
	var finalRevision int64
	var finalPayload string
	if err := store.db.QueryRow(`SELECT revision,payload::text FROM ynx_quant_state WHERE state_key=$1`, namespace).Scan(&finalRevision, &finalPayload); err != nil || finalRevision != revision || finalPayload != payload {
		t.Fatal("same-clock second opening reran research or mutated persisted audit")
	}
}
