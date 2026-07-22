package providers

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

type roundTrip func(*http.Request) (*http.Response, error)

func (function roundTrip) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func fixtureClient(t *testing.T, expectedURL, body string) *http.Client {
	t.Helper()
	return &http.Client{Timeout: time.Second, Transport: roundTrip(func(request *http.Request) (*http.Response, error) {
		if request.URL.String() != expectedURL || request.Method != http.MethodGet || request.Header.Get("Accept") != "application/json" {
			t.Fatalf("request=%s headers=%v", request.URL.String(), request.Header)
		}
		return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(body)), Request: request}, nil
	})}
}

func TestCoinbaseOfficialTickerAdapter(t *testing.T) {
	client := fixtureClient(t, "https://api.exchange.coinbase.com/products/BTC-USD/ticker", `{"price":"67500.123456","time":"2026-07-22T12:00:00Z","volume":"1200.500000","bid":"67499","ask":"67501"}`)
	adapter, _ := NewOfficialHTTP(client)
	candidate, err := adapter.CoinbaseTicker(context.Background(), "BTC-USD", "BTC/USD", 1_000_000)
	if err != nil || candidate.Value != 67_500_123_456 || candidate.Volume24H != 1_200_500_000 || candidate.ProviderID != "coinbase-exchange" {
		t.Fatalf("candidate=%+v err=%v", candidate, err)
	}
}

func TestBitstampOfficialTickerAdapter(t *testing.T) {
	client := fixtureClient(t, "https://www.bitstamp.net/api/v2/ticker/btcusd/", `{"last":"67500.123456","volume":"1200.500000","timestamp":"1784721600","high":"68000"}`)
	adapter, _ := NewOfficialHTTP(client)
	candidate, err := adapter.BitstampTicker(context.Background(), "btcusd", "BTC/USD", 1_000_000)
	if err != nil || candidate.Value != 67_500_123_456 || candidate.ObservedAt.Unix() != 1784721600 || candidate.ProviderID != "bitstamp" {
		t.Fatalf("candidate=%+v err=%v", candidate, err)
	}
}

func TestKrakenOfficialPostTradeAdapter(t *testing.T) {
	client := fixtureClient(t, "https://api.kraken.com/0/public/PostTrade?symbol=BTC%2FUSD&count=1", `{"error":[],"result":{"trades":[{"price":"67500.123456","quantity":"0.250000","trade_ts":"2026-07-22T12:00:00.123456Z"}],"count":1}}`)
	adapter, _ := NewOfficialHTTP(client)
	candidate, err := adapter.KrakenPostTrade(context.Background(), "BTC/USD", "BTC/USD", 1_000_000)
	if err != nil || candidate.Value != 67_500_123_456 || candidate.Volume24H != 250_000 || candidate.ProviderID != "kraken" {
		t.Fatalf("candidate=%+v err=%v", candidate, err)
	}
}

func TestOfficialAdaptersFailClosed(t *testing.T) {
	if _, err := NewOfficialHTTP(&http.Client{}); err == nil {
		t.Fatal("client without timeout accepted")
	}
	adapter, _ := NewOfficialHTTP(fixtureClient(t, "unused", `{}`))
	if _, err := adapter.CoinbaseTicker(context.Background(), "../../metadata", "BTC/USD", 1_000_000); err == nil {
		t.Fatal("unallowlisted Coinbase product accepted")
	}
	if _, err := decimalToScaled("1.0000001", 1_000_000); err == nil {
		t.Fatal("excess precision accepted")
	}
	if _, err := decimalToScaled("1e9", 1_000_000); err == nil {
		t.Fatal("exponent accepted")
	}
	if _, err := decimalToScaled("1.0", 3); err == nil {
		t.Fatal("non-decimal scale accepted")
	}
}
