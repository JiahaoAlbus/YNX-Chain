package quantlab

import (
	"context"
	"encoding/json"
	"math/big"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestResearchIdleCapitalIncludesWarmupAndNonFillObservations(t *testing.T) {
	for _, kind := range []string{"held-position", "zero-volume", "data-gap", "no-trade"} {
		t.Run(kind, func(t *testing.T) {
			r := request()
			if kind == "zero-volume" {
				r.Bars[20].Volume = 0
			}
			if kind == "data-gap" {
				for i := 20; i < len(r.Bars); i++ {
					r.Bars[i].Time = r.Bars[i].Time.Add(3 * time.Minute)
				}
			}
			if kind == "no-trade" {
				for i := range r.Bars {
					r.Bars[i].Volume = 0
				}
			}
			metrics, attribution, curve, err := simulateDetailed(context.Background(), r.Bars, r.Strategy, r.Assumptions, 1, len(r.Bars))
			if err != nil {
				t.Fatal(err)
			}
			var sum big.Int
			const opening = int64(100_000_000_000)
			// One 1-YNXT entry at index 9 from the prior signal. After that
			// monotonic prices hold the position; no further fills occur.
			const heldCash = opening - 1_009_000 - 1009 - 504
			for index := 1; index < len(r.Bars); index++ {
				cash := opening
				if index >= 9 && kind != "no-trade" {
					cash = heldCash
				}
				sum.Add(&sum, big.NewInt(cash))
			}
			want := new(big.Int).Quo(&sum, big.NewInt(int64(len(curve)))).Int64()
			if attribution.AverageIdleCapital != want || attribution.IdleCapitalSamplingPolicy != "observed_bar_cash_mean_truncate_micro_v1" {
				t.Fatalf("idle samples differ: %+v want=%d", attribution, want)
			}
			if kind != "no-trade" && (metrics.Trades != 1 || want == heldCash) {
				t.Fatal("fixture failed to distinguish fill-only sampling")
			}
			if kind == "no-trade" && metrics.Trades != 0 {
				t.Fatal("unexpected fill")
			}
		})
	}
}

func TestResearchIdleSamplingReceiptPersistsWithoutRelabelingLegacy(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	s, err := New(Config{StatePath: path})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	receipt, err := s.RunBacktest(request())
	if err != nil {
		t.Fatal(err)
	}
	restarted, err := New(Config{StatePath: path})
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	stored := restarted.Snapshot()["experiments"].(map[string]Experiment)[receipt.ID]
	if stored.Attribution.IdleCapitalSamplingPolicy != receipt.Attribution.IdleCapitalSamplingPolicy || stored.Attribution.AverageIdleCapital != receipt.Attribution.AverageIdleCapital {
		t.Fatal("restart changed sampling receipt")
	}
	var old PnLAttribution
	if err := json.Unmarshal([]byte(`{"averageIdleCapital":123}`), &old); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(old)
	if err != nil {
		t.Fatal(err)
	}
	if old.AverageIdleCapital != 123 || old.IdleCapitalSamplingPolicy != "" || strings.Contains(string(encoded), "idleCapitalSamplingPolicy") {
		t.Fatal("legacy receipt relabeled")
	}
}
