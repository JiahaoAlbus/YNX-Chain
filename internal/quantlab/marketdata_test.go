package quantlab

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type fixtureMarket struct {
	bars []Bar
	tick MarketTick
}

func (f fixtureMarket) History(string, int) ([]Bar, string, error) {
	return append([]Bar(nil), f.bars...), "fixture://actual-matches", nil
}
func (f fixtureMarket) Latest(string) (MarketTick, error) { return f.tick, nil }

func TestHTTPMarketDataUsesOnlyOwnedActualTradeTape(t *testing.T) {
	start := time.Date(2026, 7, 18, 0, 0, 0, 0, time.UTC)
	trades := make([]map[string]any, 20)
	for i := range trades {
		trades[i] = map[string]any{"priceMicro": int64(1_000_000 + i), "amountMicro": int64(10_000 + i), "createdAt": start.Add(time.Duration(i) * time.Second)}
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/market-data/trades" {
			t.Fatalf("path=%s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"market": "YNXT-YUSD_TEST", "source": "YNX-owned deterministic matched trades only", "externalPrice": false, "trades": trades})
	}))
	defer server.Close()
	adapter := HTTPExchangeMarketData{BaseURL: server.URL, Client: server.Client()}
	bars, source, e := adapter.History("YNXT-YUSD_TEST", 100)
	if e != nil || len(bars) != 20 || bars[0].Close != 1_000_000 || source == "" {
		t.Fatalf("bars=%d source=%s err=%v", len(bars), source, e)
	}
	tick, e := adapter.Latest("YNXT-YUSD_TEST")
	if e != nil || tick.Price != 1_000_019 || tick.Source == "" {
		t.Fatalf("tick=%+v err=%v", tick, e)
	}
}

func TestMarketSourceEmptyAndExternalPriceFailClosed(t *testing.T) {
	for _, external := range []bool{false, true} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_ = json.NewEncoder(w).Encode(map[string]any{"market": "YNXT-YUSD_TEST", "source": "YNX-owned deterministic matched trades only", "externalPrice": external, "trades": []any{}})
		}))
		adapter := HTTPExchangeMarketData{BaseURL: server.URL, Client: server.Client()}
		if _, _, e := adapter.History("YNXT-YUSD_TEST", 100); e != ErrUnavailable {
			t.Fatalf("external=%v err=%v", external, e)
		}
		server.Close()
	}
}

func TestBacktestAndPaperConsumeConfiguredMarketAdapter(t *testing.T) {
	m := fixtureMarket{bars: bars(), tick: MarketTick{Price: 1_200_000, Volume: 5_000_000, Source: "fixture://actual-matches", At: time.Now().UTC()}}
	s, e := New(Config{StatePath: filepath.Join(t.TempDir(), "s.json"), MarketData: m})
	if e != nil {
		t.Fatal(e)
	}
	r := request()
	exp, e := s.RunBacktestFromMarket(r.Strategy, r.Assumptions)
	if e != nil || exp.Strategy.Source != "fixture://actual-matches" {
		t.Fatalf("exp=%+v err=%v", exp, e)
	}
	o, e := s.ApplyPaperSignalFromMarket(strings.Repeat("0", 64), "buy", 2_000_000)
	if e != nil || o.Price != 1_200_000 || o.Filled != 500_000 || o.Source != "authoritative_market_adapter" {
		t.Fatalf("order=%+v err=%v", o, e)
	}
}

func TestConfiguredMarketRequiredForProductFlows(t *testing.T) {
	s, _ := New(Config{StatePath: filepath.Join(t.TempDir(), "s.json")})
	r := request()
	if _, e := s.RunBacktestFromMarket(r.Strategy, r.Assumptions); e != ErrUnavailable {
		t.Fatalf("backtest=%v", e)
	}
	if _, e := s.ApplyPaperSignalFromMarket(strings.Repeat("0", 64), "buy", 1); e != ErrUnavailable {
		t.Fatalf("paper=%v", e)
	}
}
