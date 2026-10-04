package quantlab

import (
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func provenanceTape(t *testing.T, trades []exchangeTrade) HTTPExchangeMarketData {
	t.Helper()
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(tradeTape{Market: "YNXT-YUSD_TEST", Source: "persisted deterministic matching-engine fills only", ExternalPrice: false, Trades: trades})
	}))
	t.Cleanup(s.Close)
	return HTTPExchangeMarketData{BaseURL: s.URL, Client: s.Client()}
}

func provenanceTrades() []exchangeTrade {
	start := time.Date(2026, 10, 4, 0, 0, 0, 0, time.UTC)
	trades := make([]exchangeTrade, 21)
	for i := range trades {
		trades[i] = exchangeTrade{PriceMicro: int64(100 + i), AmountMicro: 10, CreatedAt: start.Add(time.Duration(i) * time.Second)}
	}
	return trades
}

func TestMarketHistoryPreservesOriginalTimesAndAggregatesSameTimestamp(t *testing.T) {
	trades := provenanceTrades()
	// The first timestamp is carried out of chronological order but equal-time
	// tape order (100, 130, 90) is authoritative for open/close.
	trades = append(trades, exchangeTrade{PriceMicro: 130, AmountMicro: 20, CreatedAt: trades[0].CreatedAt}, exchangeTrade{PriceMicro: 90, AmountMicro: 30, CreatedAt: trades[0].CreatedAt})
	adapter := provenanceTape(t, trades)
	bars, _, err := adapter.History("YNXT-YUSD_TEST", 100)
	if err != nil || len(bars) != 21 {
		t.Fatalf("bars=%d err=%v", len(bars), err)
	}
	first := bars[0]
	if !first.Time.Equal(trades[0].CreatedAt) || first.Open != 100 || first.High != 130 || first.Low != 90 || first.Close != 90 || first.Volume != 60 {
		t.Fatalf("aggregated=%+v", first)
	}
	for i, bar := range bars {
		if !bar.Time.Equal(trades[i].CreatedAt) {
			t.Fatalf("fabricated time index=%d time=%v", i, bar.Time)
		}
	}
	limited, _, err := adapter.History("YNXT-YUSD_TEST", 20)
	if err != nil || len(limited) != 20 || !limited[0].Time.Equal(trades[1].CreatedAt) {
		t.Fatalf("limit=%d err=%v", len(limited), err)
	}
}

func TestMarketHistoryDoesNotManufactureIndependentSamples(t *testing.T) {
	trades := provenanceTrades()
	for i := range trades {
		trades[i].CreatedAt = trades[0].CreatedAt
	}
	if bars, source, err := provenanceTape(t, trades).History("YNXT-YUSD_TEST", 100); err != ErrUnavailable || bars != nil || source != "" {
		t.Fatalf("bars=%v source=%s err=%v", bars, source, err)
	}
}

func TestMarketLatestMatchesEqualTimeBarClose(t *testing.T) {
	trades := provenanceTrades()
	last := trades[len(trades)-1].CreatedAt
	trades = append(trades, exchangeTrade{PriceMicro: 150, AmountMicro: 7, CreatedAt: last})
	adapter := provenanceTape(t, trades)
	tick, err := adapter.Latest("YNXT-YUSD_TEST")
	if err != nil || tick.Price != 150 || tick.Volume != 7 || !tick.At.Equal(last) {
		t.Fatalf("latest=%+v err=%v", tick, err)
	}
	bars, _, err := adapter.History("YNXT-YUSD_TEST", 100)
	if err != nil || bars[len(bars)-1].Close != tick.Price || !bars[len(bars)-1].Time.Equal(tick.At) {
		t.Fatalf("latest/history mismatch err=%v", err)
	}
}

func TestMarketHistoryAggregateVolumeOverflowFailsClosed(t *testing.T) {
	trades := provenanceTrades()
	trades[0].AmountMicro = math.MaxInt64
	trades = append(trades, exchangeTrade{PriceMicro: 100, AmountMicro: 1, CreatedAt: trades[0].CreatedAt})
	if _, _, err := provenanceTape(t, trades).History("YNXT-YUSD_TEST", 100); err != ErrUnavailable {
		t.Fatalf("overflow err=%v", err)
	}
}
