package providers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const maximumResponseBytes = 1 << 20

type Candidate struct {
	ProviderID    string
	Market        string
	Value         int64
	Scale         int64
	Volume24H     int64
	ObservedAt    time.Time
	Source        string
	SourceVersion string
}

type OfficialHTTP struct{ client *http.Client }

func NewOfficialHTTP(client *http.Client) (*OfficialHTTP, error) {
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	if client.Timeout <= 0 {
		return nil, errors.New("provider HTTP client requires an overall timeout")
	}
	return &OfficialHTTP{client: client}, nil
}

func (adapter *OfficialHTTP) CoinbaseTicker(ctx context.Context, product, market string, scale int64) (Candidate, error) {
	if !allowedCoinbaseProduct(product) {
		return Candidate{}, errors.New("Coinbase product is not allowlisted")
	}
	endpoint := "https://api.exchange.coinbase.com/products/" + url.PathEscape(product) + "/ticker"
	var payload struct {
		Price  string    `json:"price"`
		Time   time.Time `json:"time"`
		Volume string    `json:"volume"`
	}
	if err := adapter.get(ctx, endpoint, &payload); err != nil {
		return Candidate{}, err
	}
	value, err := decimalToScaled(payload.Price, scale)
	if err != nil || payload.Time.IsZero() {
		return Candidate{}, errors.New("invalid Coinbase ticker")
	}
	volume, _ := decimalToScaled(payload.Volume, scale)
	return Candidate{"coinbase-exchange", market, value, scale, volume, payload.Time.UTC(), endpoint, "exchange-rest-v1"}, nil
}

func (adapter *OfficialHTTP) BitstampTicker(ctx context.Context, pair, market string, scale int64) (Candidate, error) {
	if !allowedBitstampPair(pair) {
		return Candidate{}, errors.New("Bitstamp pair is not allowlisted")
	}
	endpoint := "https://www.bitstamp.net/api/v2/ticker/" + url.PathEscape(pair) + "/"
	var payload struct{ Last, Volume, Timestamp string }
	if err := adapter.get(ctx, endpoint, &payload); err != nil {
		return Candidate{}, err
	}
	value, err := decimalToScaled(payload.Last, scale)
	seconds, timeErr := strconv.ParseInt(payload.Timestamp, 10, 64)
	if err != nil || timeErr != nil || seconds <= 0 {
		return Candidate{}, errors.New("invalid Bitstamp ticker")
	}
	volume, _ := decimalToScaled(payload.Volume, scale)
	return Candidate{"bitstamp", market, value, scale, volume, time.Unix(seconds, 0).UTC(), endpoint, "public-api-v2"}, nil
}

func (adapter *OfficialHTTP) KrakenPostTrade(ctx context.Context, symbol, market string, scale int64) (Candidate, error) {
	if !allowedKrakenSymbol(symbol) {
		return Candidate{}, errors.New("Kraken symbol is not allowlisted")
	}
	endpoint := "https://api.kraken.com/0/public/PostTrade?symbol=" + url.QueryEscape(symbol) + "&count=1"
	var payload struct {
		Error  []string `json:"error"`
		Result struct {
			Trades []struct {
				Price    string `json:"price"`
				Quantity string `json:"quantity"`
				TradeTS  string `json:"trade_ts"`
			} `json:"trades"`
		} `json:"result"`
	}
	if err := adapter.get(ctx, endpoint, &payload); err != nil {
		return Candidate{}, err
	}
	if len(payload.Error) != 0 || len(payload.Result.Trades) != 1 {
		return Candidate{}, errors.New("invalid Kraken post-trade response")
	}
	trade := payload.Result.Trades[0]
	value, err := decimalToScaled(trade.Price, scale)
	at, timeErr := time.Parse(time.RFC3339Nano, trade.TradeTS)
	if err != nil || timeErr != nil {
		return Candidate{}, errors.New("invalid Kraken trade")
	}
	volume, _ := decimalToScaled(trade.Quantity, scale)
	return Candidate{"kraken", market, value, scale, volume, at.UTC(), endpoint, "spot-rest-post-trade-v1"}, nil
}

func (adapter *OfficialHTTP) get(ctx context.Context, endpoint string, target any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "YNX-Oracle-Market-Data/0.1-testnet")
	response, err := adapter.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("official provider unavailable: HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maximumResponseBytes+1))
	if err != nil {
		return err
	}
	if len(data) > maximumResponseBytes {
		return errors.New("official provider response exceeds limit")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	if err := decoder.Decode(target); err != nil {
		return errors.New("official provider response schema invalid")
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return errors.New("official provider response framing invalid")
	}
	return nil
}

func decimalToScaled(input string, scale int64) (int64, error) {
	if scale <= 0 || input == "" || strings.HasPrefix(input, "-") || strings.ContainsAny(input, "eE+") {
		return 0, errors.New("invalid decimal")
	}
	parts := strings.Split(input, ".")
	if len(parts) > 2 || parts[0] == "" {
		return 0, errors.New("invalid decimal")
	}
	whole, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return 0, errors.New("invalid decimal")
	}
	if whole > (1<<63-1)/scale {
		return 0, errors.New("decimal overflow")
	}
	value := whole * scale
	fraction := ""
	if len(parts) == 2 {
		fraction = parts[1]
	}
	digits := 0
	for divisor := scale; divisor > 1; divisor /= 10 {
		if divisor%10 != 0 {
			return 0, errors.New("scale must be a power of ten")
		}
		digits++
	}
	if len(fraction) > digits {
		return 0, errors.New("decimal precision exceeds scale")
	}
	for len(fraction) < digits {
		fraction += "0"
	}
	if fraction != "" {
		fractionValue, err := strconv.ParseInt(fraction, 10, 64)
		if err != nil || value > (1<<63-1)-fractionValue {
			return 0, errors.New("decimal overflow")
		}
		value += fractionValue
	}
	if value <= 0 {
		return 0, errors.New("decimal must be positive")
	}
	return value, nil
}

func allowedCoinbaseProduct(value string) bool {
	return value == "BTC-USD" || value == "ETH-USD" || value == "USDC-USD"
}
func allowedBitstampPair(value string) bool {
	return value == "btcusd" || value == "ethusd" || value == "usdcusd"
}
func allowedKrakenSymbol(value string) bool {
	return value == "BTC/USD" || value == "ETH/USD" || value == "USDC/USD"
}
