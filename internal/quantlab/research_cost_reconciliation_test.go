package quantlab

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"testing"
)

func flatExecutionPriceRequest(price, fee, slippage int64) BacktestRequest {
	r := request()
	r.Assumptions.FeeBPS, r.Assumptions.SlippageBPS = fee, slippage
	for i := range r.Bars {
		close := price
		if i < r.Assumptions.TrainEnd {
			close += int64(i * 10)
		}
		r.Bars[i].Open, r.Bars[i].Close = close, close
		r.Bars[i].High, r.Bars[i].Low = close+1, close-1
	}
	return r
}

func assertFlatCostReconciliation(t *testing.T, metrics Metrics, attribution PnLAttribution, curve []EquityPoint) {
	t.Helper()
	if metrics.Trades < 2 || len(curve) == 0 {
		t.Fatal("fixture did not enter and close a position")
	}
	costs := attribution.TradingFee + attribution.Slippage
	if attribution.UserNetPnL != -costs || curve[len(curve)-1].Equity != 100_000_000_000-costs ||
		attribution.UserRealizedPnL != -costs || attribution.UserUnrealizedPnL != 0 ||
		attribution.Alpha != 0 || attribution.Beta != 0 || !attribution.Reconciled ||
		attribution.CostRoundingPolicy != "independent_cost_component_floor_micro_v1" {
		t.Fatalf("flat-price loss differs from disclosed costs: metrics=%+v attribution=%+v ending=%d", metrics, attribution, curve[len(curve)-1].Equity)
	}
}

func TestResearchIndependentCostComponentsMatchEquityAndRealizedLoss(t *testing.T) {
	for _, price := range []int64{5000, 9999, 10001} {
		for _, costs := range [][2]int64{{1, 1}, {7, 3}, {0, 1}, {1, 0}, {0, 0}} {
			t.Run(fmt.Sprintf("price%d-fee%d-slippage%d", price, costs[0], costs[1]), func(t *testing.T) {
				r := flatExecutionPriceRequest(price, costs[0], costs[1])
				metrics, attribution, curve, err := simulateDetailed(context.Background(), r.Bars, r.Strategy, r.Assumptions, r.Assumptions.TrainEnd, len(r.Bars))
				if err != nil {
					t.Fatal(err)
				}
				assertFlatCostReconciliation(t, metrics, attribution, curve)
			})
		}
	}
}

func TestResearchCostReconciliationReceiptSurvivesRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	s, err := New(Config{StatePath: path})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	x, err := s.RunBacktest(flatExecutionPriceRequest(5000, 1, 1))
	if err != nil {
		t.Fatal(err)
	}
	assertFlatCostReconciliation(t, x.Metrics, x.Attribution, x.EquityCurve)
	restarted, err := New(Config{StatePath: path})
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	stored := restarted.Snapshot()["experiments"].(map[string]Experiment)[x.ID]
	assertFlatCostReconciliation(t, stored.Metrics, stored.Attribution, stored.EquityCurve)
}

func TestResearchHistoricalAttributionDoesNotAcquireNewRoundingPolicy(t *testing.T) {
	var old PnLAttribution
	if err := json.Unmarshal([]byte(`{"currency":"YUSD_TEST_MICRO","userNetPnl":-4,"userUnrealizedPnl":-2,"reconciled":true}`), &old); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(old)
	if err != nil || old.CostRoundingPolicy != "" || bytes.Contains(encoded, []byte("costRoundingPolicy")) || old.UserNetPnL != -4 || old.UserUnrealizedPnL != -2 {
		t.Fatal("historical attribution was rewritten or relabeled")
	}
}
