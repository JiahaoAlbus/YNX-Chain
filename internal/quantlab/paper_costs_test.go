package quantlab

import (
	"math"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
)

func TestPaperCostIntegerSettlementAndAdverseRounding(t *testing.T) {
	for _, tc := range []struct {
		name, side               string
		price, fill              int64
		cost                     PaperExecutionCosts
		execution, notional, fee int64
	}{
		{"buy", "buy", 1_000_000, 1_000_000, PaperExecutionCosts{PaperCostPolicyV1, 10, 5}, 1_000_500, 1_000_500, 1001},
		{"sell", "sell", 1_000_000, 1_000_000, PaperExecutionCosts{PaperCostPolicyV1, 10, 5}, 999_500, 999_500, 1000},
		{"buy_fraction", "buy", 1, 1, PaperExecutionCosts{PaperCostPolicyV1, 1, 1}, 2, 1, 1},
		{"sell_fraction", "sell", 10001, 1, PaperExecutionCosts{PaperCostPolicyV1, 1, 1}, 9999, 0, 0},
		{"no_fill", "buy", 1_000_000, 0, PaperExecutionCosts{PaperCostPolicyV1, 10, 5}, 1_000_500, 0, 0},
		{"legacy", "buy", 1, 1, PaperExecutionCosts{}, 1, 0, 0},
		{"explicit_zero", "buy", 1, 1, PaperExecutionCosts{PaperCostPolicyV1, 0, 0}, 1, 1, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, n, f, err := paperCostSettlement(tc.side, tc.price, tc.fill, tc.cost)
			if err != nil || p != tc.execution || n != tc.notional || f != tc.fee {
				t.Fatalf("%d/%d/%d: %v", p, n, f, err)
			}
		})
	}
	for _, c := range []PaperExecutionCosts{{"unknown", 1, 1}, {"", 1, 0}, {PaperCostPolicyV1, -1, 0}, {PaperCostPolicyV1, 0, 10000}, {PaperCostPolicyV1, 10001, 0}} {
		if _, _, _, err := paperCostSettlement("buy", 1_000_000, 1, c); err != ErrInvalid {
			t.Fatalf("invalid model accepted: %+v", c)
		}
	}
	if _, _, _, err := paperCostSettlement("buy", math.MaxInt64, 1, PaperExecutionCosts{PaperCostPolicyV1, 0, 1}); err != ErrInvalid {
		t.Fatal("execution price overflow accepted")
	}
}

func TestPaperCostsSettlePersistAndReplayOnlyExactModel(t *testing.T) {
	for _, side := range []string{"buy", "sell"} {
		t.Run(side, func(t *testing.T) {
			cfg := Config{StatePath: filepath.Join(t.TempDir(), "state.json"), MarketData: adapterMarket{tick: MarketTick{Price: 1_000_000, Volume: 5_000_000, Source: "fixture://cost-model"}}}
			s, err := New(cfg)
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			experiment, err := s.RunBacktest(request())
			if err != nil {
				t.Fatal(err)
			}
			beforeCash := s.state.Paper.Cash
			cost := PaperExecutionCosts{PaperCostPolicyV1, 10, 5}
			order, err := s.SubmitPaperSignalWithCostsFromMarket(experiment.Strategy.StrategyHash, side, 1_000_000, "cost-identity-key", cost)
			if err != nil || order.Filled != 500_000 || order.Status != "partially_filled" {
				t.Fatalf("fill: %+v/%v", order, err)
			}
			price, notional, fee, err := paperCostSettlement(side, 1_000_000, 500_000, cost)
			if err != nil || order.ExecutionPriceMicro != price || order.ExecutedNotionalMicro != notional || order.FeeMicro != fee {
				t.Fatal("cost receipt mismatch")
			}
			delta := -notional - fee
			if side == "sell" {
				delta = notional - fee
			}
			if s.state.Paper.Cash != beforeCash+delta {
				t.Fatal("fees not settled")
			}
			wantLoss := int64(751)
			if side == "sell" {
				wantLoss = 750
			}
			if s.state.Paper.DailyRisk == nil || s.state.Paper.DailyRisk.Loss != wantLoss {
				t.Fatal("settled cost missing from immediate daily risk")
			}
			cfg.MarketData = nil
			reopened, err := New(cfg)
			if err != nil {
				t.Fatal(err)
			}
			defer reopened.Close()
			before := hash(reopened.state)
			replay, err := reopened.SubmitPaperSignalWithCostsFromMarket(experiment.Strategy.StrategyHash, side, 1_000_000, "cost-identity-key", cost)
			if err != nil || !reflect.DeepEqual(replay, order) || hash(reopened.state) != before {
				t.Fatal("restart replay changed state or costs")
			}
			changed := cost
			changed.FeeBPS++
			if _, err := reopened.SubmitPaperSignalWithCostsFromMarket(experiment.Strategy.StrategyHash, side, 1_000_000, "cost-identity-key", changed); err != ErrConflict {
				t.Fatal("changed model reused key")
			}
			if _, err := reopened.SubmitPaperSignalFromMarket(experiment.Strategy.StrategyHash, side, 1_000_000, "cost-identity-key"); err != ErrConflict {
				t.Fatal("legacy call reused cost key")
			}
			if hash(reopened.state) != before {
				t.Fatal("conflict changed state")
			}
		})
	}
}

func TestPaperCostRejectionDoesNotMutateSettlementOrAudit(t *testing.T) {
	s, err := New(Config{StatePath: filepath.Join(t.TempDir(), "state.json"), MarketData: adapterMarket{tick: MarketTick{Price: math.MaxInt64, Volume: 20_000_000, Source: "fixture://overflow"}}})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	e, err := s.RunBacktest(request())
	if err != nil {
		t.Fatal(err)
	}
	before := hash(s.state)
	if _, err := s.SubmitPaperSignalWithCostsFromMarket(e.Strategy.StrategyHash, "buy", 1_000_000, "cost-overflow-key", PaperExecutionCosts{PaperCostPolicyV1, 10, 5}); err != ErrInvalid {
		t.Fatalf("%v", err)
	}
	if hash(s.state) != before {
		t.Fatal("unsafe cost changed state")
	}
}

func TestPaperCostConcurrentInstancesChargeOneReceipt(t *testing.T) {
	cfg := Config{StatePath: filepath.Join(t.TempDir(), "state.json"), MarketData: adapterMarket{tick: MarketTick{Price: 1_000_000, Volume: 20_000_000, Source: "fixture://concurrent-costs"}}}
	first, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	e, err := first.RunBacktest(request())
	if err != nil {
		t.Fatal(err)
	}
	second, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	cost := PaperExecutionCosts{PaperCostPolicyV1, 10, 5}
	beforeCash := first.state.Paper.Cash
	orders := make([]PaperOrder, 12)
	var wg sync.WaitGroup
	for i := range orders {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			s := []*Service{first, second}[i%2]
			var err error
			orders[i], err = s.SubmitPaperSignalWithCostsFromMarket(e.Strategy.StrategyHash, "buy", 1_000_000, "cost-concurrent-key", cost)
			if err != nil {
				t.Errorf("submission: %v", err)
			}
		}(i)
	}
	wg.Wait()
	for _, order := range orders {
		if !reflect.DeepEqual(order, orders[0]) {
			t.Fatal("concurrent receipt mismatch")
		}
	}
	if len(first.Snapshot()["paper"].(PaperState).Orders) != 1 {
		t.Fatal("duplicate cost orders")
	}
	if second.Snapshot()["paper"].(PaperState).Cash != beforeCash-orders[0].ExecutedNotionalMicro-orders[0].FeeMicro {
		t.Fatal("cost charged more than once")
	}
}

func TestPaperCostsCannotCrossDailyLossLimitAndInventSettlement(t *testing.T) {
	s, err := New(Config{StatePath: filepath.Join(t.TempDir(), "state.json"), MarketData: adapterMarket{tick: MarketTick{Price: 2_000_000_000, Volume: 20_000_000, Source: "fixture://daily-cost-limit"}}})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	e, err := s.RunBacktest(request())
	if err != nil {
		t.Fatal(err)
	}
	before := hash(s.state)
	if _, err := s.SubmitPaperSignalWithCostsFromMarket(e.Strategy.StrategyHash, "buy", 1_000_000, "cost-daily-bound-key", PaperExecutionCosts{PaperCostPolicyV1, 10000, 0}); err != ErrPaperDailyLoss {
		t.Fatalf("cost loss admitted: %v", err)
	}
	if hash(s.state) != before {
		t.Fatal("rejected projected cost became actual state/audit")
	}
}
