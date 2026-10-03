package quantlab

import (
	"context"
	"math/big"
	"path/filepath"
	"testing"
	"time"
)

// Derive the published definition independently from every retained equity
// point, including the starting capital. This is research-only fixture data.
func curveDrawdownBPS(curve []EquityPoint) int64 {
	peak, worst := int64(100_000_000_000), int64(0)
	for _, point := range curve {
		if point.Equity > peak {
			peak = point.Equity
		}
		loss := new(big.Int).Sub(big.NewInt(peak), big.NewInt(point.Equity))
		loss.Mul(loss, big.NewInt(10000)).Quo(loss, big.NewInt(peak))
		if loss.Int64() > worst {
			worst = loss.Int64()
		}
	}
	return worst
}

func TestResearchDrawdownIncludesMarksWithoutTrades(t *testing.T) {
	for _, kind := range []string{"unchanged-position", "zero-volume", "data-gap"} {
		t.Run(kind, func(t *testing.T) {
			r := request()
			for i := range r.Bars {
				price := int64(1_000_000_000 + i*1_000_000)
				r.Bars[i].Open, r.Bars[i].Close = price, price
				r.Bars[i].High, r.Bars[i].Low = price+1000, price-1000
			}
			last := &r.Bars[len(r.Bars)-1]
			last.Open, last.Close, last.High, last.Low = 500_000_000, 500_000_000, 500_001_000, 499_999_000
			if kind == "zero-volume" {
				last.Volume = 0
			}
			if kind == "data-gap" {
				last.Time = last.Time.Add(3 * time.Minute)
			}
			metrics, _, curve, err := simulateDetailed(context.Background(), r.Bars, r.Strategy, r.Assumptions, r.Assumptions.TrainEnd, len(r.Bars))
			if err != nil {
				t.Fatal(err)
			}
			want := curveDrawdownBPS(curve)
			if want == 0 || metrics.Trades != 1 || metrics.MaxDrawdownBPS != want {
				t.Fatalf("%s: held-position loss omitted: trades=%d drawdown=%d curve=%d", kind, metrics.Trades, metrics.MaxDrawdownBPS, want)
			}
		})
	}
}

func TestResearchDrawdownPeakIncludesNoFillRecovery(t *testing.T) {
	r := request()
	for i := range r.Bars {
		price := int64(1_000_000_000 + i*1_000_000)
		r.Bars[i].Open, r.Bars[i].Close = price, price
	}
	r.Bars[len(r.Bars)-2].Close = 2_000_000_000
	r.Bars[len(r.Bars)-1].Close = 1_000_000_000
	metrics, _, curve, err := simulateDetailed(context.Background(), r.Bars, r.Strategy, r.Assumptions, r.Assumptions.TrainEnd, len(r.Bars))
	if err != nil {
		t.Fatal(err)
	}
	if want := curveDrawdownBPS(curve); metrics.MaxDrawdownBPS != want || want == 0 {
		t.Fatalf("untraded peak omitted: got=%d want=%d", metrics.MaxDrawdownBPS, want)
	}
}

func TestResearchDrawdownReceiptSurvivesRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	s, err := New(Config{StatePath: path})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	r := request()
	for i := range r.Bars {
		price := int64(1_000_000_000 + i*1_000_000)
		r.Bars[i].Open, r.Bars[i].Close = price, price
		r.Bars[i].High, r.Bars[i].Low = price+1000, price-1000
	}
	last := &r.Bars[len(r.Bars)-1]
	last.Open, last.Close, last.High, last.Low = 500_000_000, 500_000_000, 500_001_000, 499_999_000
	x, err := s.RunBacktest(r)
	if err != nil {
		t.Fatal(err)
	}
	want := curveDrawdownBPS(x.EquityCurve)
	if want != 54 || x.Metrics.MaxDrawdownBPS != want {
		t.Fatalf("new receipt curve mismatch: %+v want=%d", x.Metrics, want)
	}
	restarted, err := New(Config{StatePath: path})
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	stored := restarted.Snapshot()["experiments"].(map[string]Experiment)[x.ID]
	if stored.Metrics.MaxDrawdownBPS != want || curveDrawdownBPS(stored.EquityCurve) != want {
		t.Fatal("restart lost marked-equity drawdown receipt")
	}
}
