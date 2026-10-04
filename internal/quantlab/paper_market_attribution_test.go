package quantlab

import (
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func TestPaperReceiptsPreserveExactMarketObservationAcrossRestartAndReplay(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	observed := now.Add(-5 * time.Minute).In(time.FixedZone("fixture-offset", 2*3600))
	for _, timestamp := range []time.Time{observed, {}} {
		t.Run(timestamp.Format(time.RFC3339Nano), func(t *testing.T) {
			tick := MarketTick{Price: 1_200_001, Volume: 20_000_000, Source: "fixture://owned-match-source", At: timestamp}
			cfg := Config{StatePath: filepath.Join(t.TempDir(), "state.json"), Now: func() time.Time { return now }, MarketData: adapterMarket{tick: tick}}
			s, err := New(cfg)
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			experiment, err := s.RunBacktest(request())
			if err != nil {
				t.Fatal(err)
			}
			first, err := s.SubmitPaperSignalFromMarket(experiment.Strategy.StrategyHash, "buy", 1_000_000, "market-attribution-key")
			if err != nil {
				t.Fatal(err)
			}
			expectedAt := ""
			if !timestamp.IsZero() {
				expectedAt = timestamp.Format(time.RFC3339Nano)
			}
			if first.MarketSource != tick.Source || first.MarketPriceMicro != tick.Price || first.MarketVolumeMicro != tick.Volume || first.MarketObservedAt != expectedAt || !first.CreatedAt.Equal(now) {
				t.Fatalf("market/execution attribution lost: %+v", first)
			}
			cfg.MarketData = nil
			reopened, err := New(cfg)
			if err != nil {
				t.Fatal(err)
			}
			defer reopened.Close()
			before := hash(reopened.state)
			replayed, err := reopened.SubmitPaperSignalFromMarket(experiment.Strategy.StrategyHash, "buy", 1_000_000, "market-attribution-key")
			if err != nil || !reflect.DeepEqual(first, replayed) || hash(reopened.state) != before {
				t.Fatalf("offline replay rewrote observation: %v", err)
			}
		})
	}
}

func TestDirectMarketPaperAdapterRetainsObservationButCallerAmountsDoNotInventOne(t *testing.T) {
	tick := MarketTick{Price: 1_200_001, Volume: 20_000_000, Source: "fixture://explicit-market", At: time.Date(2026, 7, 22, 0, 0, 0, 123, time.UTC)}
	s, err := New(Config{StatePath: filepath.Join(t.TempDir(), "state.json"), MarketData: adapterMarket{tick: tick}})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	experiment, err := s.RunBacktest(request())
	if err != nil {
		t.Fatal(err)
	}
	fromMarket, err := s.ApplyPaperSignalFromMarket(experiment.Strategy.StrategyHash, "buy", 1_000_000)
	if err != nil || fromMarket.MarketSource != tick.Source || fromMarket.MarketObservedAt != tick.At.Format(time.RFC3339Nano) {
		t.Fatalf("market adapter metadata lost: %v", err)
	}
	manual, err := s.ApplyPaperSignal(experiment.Strategy.StrategyHash, "sell", tick.Price, 1_000_000, tick.Volume)
	if err != nil || manual.MarketSource != "" || manual.MarketObservedAt != "" || manual.MarketPriceMicro != 0 || manual.MarketVolumeMicro != 0 {
		t.Fatalf("caller-provided amounts invented market attribution: %v", err)
	}
}
