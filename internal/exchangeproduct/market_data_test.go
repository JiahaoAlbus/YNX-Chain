package exchangeproduct

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestAggregateCandlesUsesOnlyRealFillsAndOmitsEmptyIntervals(t *testing.T) {
	base := time.Date(2026, 8, 11, 10, 0, 0, 0, time.UTC)
	fills := []candleFill{
		{ID: "b", Market: DefaultMarket, PriceMicro: 1_200_000, AmountMicro: 2_000_000, CreatedAt: base.Add(40 * time.Second)},
		{ID: "a", Market: DefaultMarket, PriceMicro: 1_000_000, AmountMicro: 1_000_000, CreatedAt: base.Add(10 * time.Second)},
		{ID: "c", Market: DefaultMarket, PriceMicro: 900_000, AmountMicro: 3_000_000, CreatedAt: base.Add(5*time.Minute + 2*time.Second)},
		{ID: "other", Market: DefaultPerpetualMarket, PriceMicro: 5_000_000, AmountMicro: 9_000_000, CreatedAt: base},
	}
	got := aggregateCandles(fills, DefaultMarket, 300, 200)
	if len(got) != 2 {
		t.Fatalf("expected two non-empty candles, got %d: %#v", len(got), got)
	}
	first := got[0]
	if first.OpenMicro != 1_000_000 || first.HighMicro != 1_200_000 || first.LowMicro != 1_000_000 || first.CloseMicro != 1_200_000 || first.BaseVolumeMicro != 3_000_000 || first.QuoteVolumeMicro != 3_400_000 || first.Trades != 2 {
		t.Fatalf("unexpected first candle: %#v", first)
	}
	if !got[1].OpenTime.Equal(base.Add(5*time.Minute)) || got[1].Trades != 1 {
		t.Fatalf("unexpected second candle: %#v", got[1])
	}
}

func TestMarketCandlesEndpointValidatesQueryAndSeparatesVenues(t *testing.T) {
	service, err := New(Config{StatePath: t.TempDir() + "/state.json", APIKey: "test-admin-key-123456", WalletCallback: "ynxexchange://wallet/callback"})
	if err != nil {
		t.Fatal(err)
	}
	service.state.Trades = append(service.state.Trades, Trade{ID: "spot-1", Market: DefaultMarket, PriceMicro: AmountScale, AmountMicro: 2 * AmountScale, CreatedAt: time.Date(2026, 8, 11, 10, 0, 0, 0, time.UTC)})
	service.state.PerpetualTrades = append(service.state.PerpetualTrades, PerpetualTrade{ID: "perp-1", Market: DefaultPerpetualMarket, PriceMicro: 2 * AmountScale, AmountMicro: 3 * AmountScale, CreatedAt: time.Date(2026, 8, 11, 10, 1, 0, 0, time.UTC)})
	server := httptest.NewServer(NewServer(service))
	defer server.Close()

	response, err := http.Get(server.URL + "/v1/market-data/candles?market=" + DefaultPerpetualMarket + "&interval=60&limit=20")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var body struct {
		Market  string   `json:"market"`
		Candles []Candle `json:"candles"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || body.Market != DefaultPerpetualMarket || len(body.Candles) != 1 || body.Candles[0].CloseMicro != 2*AmountScale {
		t.Fatalf("unexpected response: status=%d body=%#v", response.StatusCode, body)
	}

	invalid, err := http.Get(server.URL + "/v1/market-data/candles?interval=17")
	if err != nil {
		t.Fatal(err)
	}
	defer invalid.Body.Close()
	if invalid.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected invalid interval to fail, got %d", invalid.StatusCode)
	}
}
