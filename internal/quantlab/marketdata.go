package quantlab

import (
	"encoding/json"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
)

type MarketTick struct {
	Price  int64
	Volume int64
	Source string
	At     time.Time
}
type MarketData interface {
	History(market string, limit int) ([]Bar, string, error)
	Latest(market string) (MarketTick, error)
}

type HTTPExchangeMarketData struct {
	BaseURL string
	Client  *http.Client
}
type exchangeTrade struct {
	PriceMicro  int64     `json:"priceMicro"`
	AmountMicro int64     `json:"amountMicro"`
	CreatedAt   time.Time `json:"createdAt"`
}
type tradeTape struct {
	Market        string          `json:"market"`
	Source        string          `json:"source"`
	ExternalPrice bool            `json:"externalPrice"`
	Trades        []exchangeTrade `json:"trades"`
}

func (h HTTPExchangeMarketData) tape() (tradeTape, error) {
	client := h.Client
	if client == nil {
		client = http.DefaultClient
	}
	req, err := http.NewRequest(http.MethodGet, strings.TrimRight(h.BaseURL, "/")+"/v1/market-data/trades", nil)
	if err != nil {
		return tradeTape{}, ErrUnavailable
	}
	resp, err := client.Do(req)
	if err != nil {
		return tradeTape{}, ErrUnavailable
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return tradeTape{}, ErrUnavailable
	}
	var tape tradeTape
	d := json.NewDecoder(io.LimitReader(resp.Body, 4<<20))
	d.DisallowUnknownFields()
	if d.Decode(&tape) != nil || tape.Market != "YNXT-YUSD_TEST" || tape.ExternalPrice || tape.Source != "YNX-owned deterministic matched trades only" {
		return tradeTape{}, ErrUnavailable
	}
	return tape, nil
}
func (h HTTPExchangeMarketData) History(market string, limit int) ([]Bar, string, error) {
	if market != "YNXT-YUSD_TEST" || limit < 20 || limit > 10000 {
		return nil, "", ErrInvalid
	}
	t, e := h.tape()
	if e != nil || len(t.Trades) < 20 {
		return nil, "", ErrUnavailable
	}
	sort.Slice(t.Trades, func(i, j int) bool { return t.Trades[i].CreatedAt.Before(t.Trades[j].CreatedAt) })
	if len(t.Trades) > limit {
		t.Trades = t.Trades[len(t.Trades)-limit:]
	}
	bars := make([]Bar, 0, len(t.Trades))
	var last time.Time
	for _, trade := range t.Trades {
		if trade.PriceMicro <= 0 || trade.AmountMicro <= 0 || trade.CreatedAt.IsZero() {
			return nil, "", ErrUnavailable
		}
		at := trade.CreatedAt
		if !at.After(last) {
			at = last.Add(time.Nanosecond)
		}
		bars = append(bars, Bar{Time: at, Open: trade.PriceMicro, High: trade.PriceMicro, Low: trade.PriceMicro, Close: trade.PriceMicro, Volume: trade.AmountMicro})
		last = at
	}
	return bars, h.BaseURL + "/v1/market-data/trades", nil
}
func (h HTTPExchangeMarketData) Latest(market string) (MarketTick, error) {
	if market != "YNXT-YUSD_TEST" {
		return MarketTick{}, ErrInvalid
	}
	t, e := h.tape()
	if e != nil || len(t.Trades) == 0 {
		return MarketTick{}, ErrUnavailable
	}
	latest := t.Trades[0]
	for _, trade := range t.Trades[1:] {
		if trade.CreatedAt.After(latest.CreatedAt) {
			latest = trade
		}
	}
	if latest.PriceMicro <= 0 || latest.AmountMicro <= 0 {
		return MarketTick{}, ErrUnavailable
	}
	return MarketTick{Price: latest.PriceMicro, Volume: latest.AmountMicro, Source: h.BaseURL + "/v1/market-data/trades", At: latest.CreatedAt}, nil
}
