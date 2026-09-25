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

func TestMarketTradesEndpointBoundsAndSeparatesVenueTapes(t *testing.T) {
	service, err := New(Config{StatePath: t.TempDir() + "/state.json", APIKey: "test-admin-key-123456", WalletCallback: "ynxexchange://wallet/callback"})
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 8, 11, 10, 0, 0, 0, time.UTC)
	for index := 0; index < 4; index++ {
		service.state.Trades = append(service.state.Trades, Trade{ID: "spot-" + string(rune('a'+index)), Market: DefaultMarket, PriceMicro: int64(index+1) * AmountScale, AmountMicro: AmountScale, CreatedAt: base.Add(time.Duration(index) * time.Second)})
	}
	service.state.PerpetualTrades = append(service.state.PerpetualTrades, PerpetualTrade{ID: "perp-a", Market: DefaultPerpetualMarket, PriceMicro: 9 * AmountScale, AmountMicro: 2 * AmountScale, CreatedAt: base})
	server := httptest.NewServer(NewServer(service))
	defer server.Close()

	response, err := http.Get(server.URL + "/v1/market-data/trades?market=" + DefaultMarket + "&limit=2")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var spot struct {
		Market string  `json:"market"`
		Limit  int     `json:"limit"`
		Trades []Trade `json:"trades"`
	}
	if err := json.NewDecoder(response.Body).Decode(&spot); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || spot.Market != DefaultMarket || spot.Limit != 2 || len(spot.Trades) != 2 || spot.Trades[0].ID != "spot-c" || spot.Trades[1].ID != "spot-d" {
		t.Fatalf("unexpected bounded spot tape: status=%d body=%#v", response.StatusCode, spot)
	}

	perpetualResponse, err := http.Get(server.URL + "/v1/market-data/trades?market=" + DefaultPerpetualMarket + "&limit=5")
	if err != nil {
		t.Fatal(err)
	}
	defer perpetualResponse.Body.Close()
	var perpetual struct {
		Market string           `json:"market"`
		Trades []PerpetualTrade `json:"trades"`
	}
	if err := json.NewDecoder(perpetualResponse.Body).Decode(&perpetual); err != nil {
		t.Fatal(err)
	}
	if perpetualResponse.StatusCode != http.StatusOK || perpetual.Market != DefaultPerpetualMarket || len(perpetual.Trades) != 1 || perpetual.Trades[0].ID != "perp-a" {
		t.Fatalf("unexpected perpetual tape: status=%d body=%#v", perpetualResponse.StatusCode, perpetual)
	}

	for _, query := range []string{"?market=BTC-USD", "?limit=0", "?limit=1001", "?limit=not-a-number"} {
		invalid, err := http.Get(server.URL + "/v1/market-data/trades" + query)
		if err != nil {
			t.Fatal(err)
		}
		invalid.Body.Close()
		if invalid.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected query %q to fail, got %d", query, invalid.StatusCode)
		}
	}
}

func TestMarketTradesEndpointReturnsEmptyArrayForEmptyPerpetualTape(t *testing.T) {
	service, err := New(Config{StatePath: t.TempDir() + "/state.json", APIKey: "test-admin-key-123456", WalletCallback: "ynxexchange://wallet/callback"})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServer(service))
	defer server.Close()

	response, err := http.Get(server.URL + "/v1/market-data/trades?market=" + DefaultPerpetualMarket + "&limit=2")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var body map[string]json.RawMessage
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || string(body["trades"]) != "[]" {
		t.Fatalf("empty tape must be a stable JSON array: status=%d trades=%s", response.StatusCode, body["trades"])
	}
}
