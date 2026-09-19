package finance

import (
	"bytes"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"
)

func budgetFixture() Budget {
	return Budget{ID: "test-budget", CategoryID: "category", Period: "weekly", LimitYNXT: 100, StartsAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
}
func budgetActivity(at time.Time, amount, fee int64) Activity {
	return Activity{ID: "local-fixture-record", Direction: "outgoing", Category: "category", Timestamp: at, Amount: amount, Fee: fee}
}
func observedPortfolioFixture(items ...Activity) Portfolio {
	return Portfolio{ExplorerStatus: SourceStatus{Available: true, SyncStatus: "synced"}, Activity: items}
}

func TestBudgetObservationUTCPeriodAndActivation(t *testing.T) {
	monday := time.Date(2026, 9, 7, 0, 0, 0, 0, time.UTC)
	at := monday.Add(5*24*time.Hour + 19*time.Hour + 23*time.Minute)
	p := observedPortfolioFixture(budgetActivity(monday.Add(-time.Nanosecond), 80, 0), budgetActivity(monday, 5, 1), budgetActivity(monday.Add(time.Hour), 7, 2), budgetActivity(at, 3, 1), budgetActivity(at.Add(time.Nanosecond), 80, 0))
	for _, clock := range []time.Time{at, at.In(time.FixedZone("fixture-plus14", 14*3600))} {
		got := budgetObservation(budgetFixture(), p, clock)
		if !got["periodStart"].(time.Time).Equal(monday) || got["observedSpentYnxt"] != int64(19) || got["observedActivityCount"] != 3 || got["periodTimezone"] != "UTC" {
			t.Fatalf("UTC weekly boundary: %#v", got)
		}
	}
	b := budgetFixture()
	b.Period = "monthly"
	boundary := time.Date(2026, 10, 1, 0, 30, 0, 0, time.FixedZone("fixture-plus8", 8*3600)) // Still September in UTC.
	got := budgetObservation(b, observedPortfolioFixture(), boundary)
	if got["periodStart"] != time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC) {
		t.Fatalf("monthly period used local month: %#v", got)
	}
	b = budgetFixture()
	b.StartsAt = monday.Add(2 * time.Hour)
	got = budgetObservation(b, p, at)
	if got["effectiveFrom"] != b.StartsAt || got["observedSpentYnxt"] != int64(4) {
		t.Fatalf("pre-activation records counted: %#v", got)
	}
	b.StartsAt = at.Add(time.Hour)
	got = budgetObservation(b, p, at)
	if got["calculationStatus"] != "not-started" || got["observedSpentYnxt"] != nil || got["remainingYnxt"] != nil {
		t.Fatalf("future budget invented a total: %#v", got)
	}
}

func TestBudgetObservationIncompleteHistoryNeverZeroFullTotals(t *testing.T) {
	at := time.Date(2026, 9, 12, 12, 0, 0, 0, time.UTC)
	for _, p := range []Portfolio{{}, observedPortfolioFixture(), observedPortfolioFixture(budgetActivity(at, 120, 3))} {
		got := budgetObservation(budgetFixture(), p, at)
		if got["spentYnxt"] != nil || got["remainingYnxt"] != nil || got["coverageComplete"] != false {
			t.Fatalf("bounded source promoted complete totals: %#v", got)
		}
		if !p.ExplorerStatus.Available && (got["observedSpentYnxt"] != nil || got["observedActivityCount"] != nil) {
			t.Fatalf("unavailable source invented zero: %#v", got)
		}
		if p.ExplorerStatus.Available && got["calculationStatus"] != "partial" {
			t.Fatalf("synced/empty source must remain partial: %#v", got)
		}
		encoded, err := json.Marshal(got)
		if err != nil || !bytes.Contains(encoded, []byte(`"remainingYnxt":null`)) || !bytes.Contains(encoded, []byte(`"spentYnxt":null`)) {
			t.Fatalf("wire unknown contract: %s %v", encoded, err)
		}
	}
	if got := budgetObservation(budgetFixture(), observedPortfolioFixture(), at); got["observedSpentYnxt"] != int64(0) {
		t.Fatalf("zero returned-record observation is distinct from full total: %#v", got)
	}
}

func TestBudgetObservationRejectsInvalidAndOverflowingAmounts(t *testing.T) {
	at := time.Date(2026, 9, 12, 12, 0, 0, 0, time.UTC)
	missingTime := observedPortfolioFixture(budgetActivity(time.Time{}, 1, 0))
	if got := budgetObservation(budgetFixture(), missingTime, at); got["reason"] != "observed-timestamp-unavailable" || got["observedSpentYnxt"] != nil {
		t.Fatalf("missing date became zero observed spending: %#v", got)
	}
	for _, items := range [][]Activity{
		{budgetActivity(at, -1, 0)}, {budgetActivity(at, 1, -1)},
		{budgetActivity(at, math.MaxInt64, 1)},
		{budgetActivity(at, math.MaxInt64, 0), budgetActivity(at, 1, 0)},
	} {
		got := budgetObservation(budgetFixture(), observedPortfolioFixture(items...), at)
		if got["calculationStatus"] != "unknown" || got["reason"] != "invalid-or-overflowing-observed-amount" || got["observedSpentYnxt"] != nil {
			t.Fatalf("invalid amount became zero/negative/partial: %#v", got)
		}
	}
}

func TestMonthlyObservationBoundedEmptyUnavailableAndOverflow(t *testing.T) {
	from := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	to := from.AddDate(0, 1, 0)
	for _, p := range []Portfolio{{}, observedPortfolioFixture()} {
		got := monthlyActivityObservation(p, from, to)
		if got["totals"].(map[string]any)["outgoingYnxt"] != nil || got["categorySpendYnxt"] != nil || got["coverageComplete"] != false {
			t.Fatalf("monthly unknown totals: %#v", got)
		}
		if !p.ExplorerStatus.Available && (got["observedTotals"] != nil || got["activityCount"] != nil) {
			t.Fatalf("unavailable monthly source invents zero: %#v", got)
		}
	}
	incoming := budgetActivity(from, 5, 1)
	incoming.Direction = "incoming"
	p := observedPortfolioFixture(incoming, budgetActivity(from.Add(time.Hour), 7, 2), budgetActivity(to, 50, 0))
	got := monthlyActivityObservation(p, from, to)
	if got["activityCount"] != 2 || got["observedTotals"].(map[string]int64)["outgoingYnxt"] != 7 || got["observedCategorySpendYnxt"].(map[string]int64)["category"] != 9 {
		t.Fatalf("monthly observed interval/amount: %#v", got)
	}
	got = monthlyActivityObservation(observedPortfolioFixture(budgetActivity(from, math.MaxInt64, 1)), from, to)
	if got["observedTotals"] != nil || got["calculationStatus"] != "unknown" {
		t.Fatalf("monthly overflow was exposed: %#v", got)
	}
}

func TestBudgetObservationTwoAccountsConcurrentReadersAndRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "finance.json")
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	at := time.Date(2026, 9, 12, 12, 0, 0, 0, time.UTC)
	service := &Service{Store: store}
	accounts := []string{"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}
	observations := observedPortfolioFixture()
	for i, account := range accounts {
		category, err := service.AddCategory(account, "Own category", "#123456", "category-local-test-key")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := service.AddBudget(account, "Own budget", category.ID, int64(100+i), "weekly", at.AddDate(0, 0, -30), "budget-local-test-key"); err != nil {
			t.Fatal(err)
		}
		item := budgetActivity(at, int64(10+i), 1)
		item.Category = category.ID
		observations.Activity = append(observations.Activity, item)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	second, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	var group sync.WaitGroup
	for index := 0; index < 32; index++ {
		group.Add(1)
		go func(index int) {
			defer group.Done()
			i := index % 2
			reader := &Service{Store: []*Store{store, second}[index%2]}
			got := reader.BudgetProgress(accounts[i], observations, at)
			if len(got) != 1 || got[0]["limitYnxt"] != int64(100+i) || got[0]["spentYnxt"] != nil || got[0]["observedSpentYnxt"] != int64(11+i) {
				t.Errorf("tenant mix: %#v", got)
			}
		}(index)
	}
	group.Wait()
	reopened, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, account := range accounts {
		left := service.BudgetProgress(account, observations, at)
		right := (&Service{Store: reopened}).BudgetProgress(account, observations, at)
		if !reflect.DeepEqual(left, right) {
			t.Fatalf("restart changed progress: %#v != %#v", left, right)
		}
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("read-only calculation changed persisted state")
	}
}
