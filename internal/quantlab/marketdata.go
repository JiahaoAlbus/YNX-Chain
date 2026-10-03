package quantlab

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode"
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

// Context-capable adapters retain the original request cancellation. Legacy
// local adapters stay compatible; they are not raced against abandoned workers.
type ContextMarketHistory interface {
	HistoryContext(context.Context, string, int) ([]Bar, string, error)
}

func marketHistory(ctx context.Context, adapter MarketData, market string, limit int) ([]Bar, string, error) {
	if err := ctx.Err(); err != nil {
		return nil, "", err
	}
	if contextual, ok := adapter.(ContextMarketHistory); ok {
		return contextual.HistoryContext(ctx, market, limit)
	}
	return adapter.History(market, limit)
}

type HTTPExchangeMarketData struct {
	BaseURL string
	Client  *http.Client
}
type exchangeTrade struct {
	ID           string    `json:"id"`
	Market       string    `json:"market"`
	PriceMicro   int64     `json:"priceMicro"`
	AmountMicro  int64     `json:"amountMicro"`
	BuyOrderID   string    `json:"buyOrderId"`
	SellOrderID  string    `json:"sellOrderId"`
	Buyer        string    `json:"buyer"`
	Seller       string    `json:"seller"`
	BuyerFee     int64     `json:"buyerFeeMicro"`
	SellerFee    int64     `json:"sellerFeeMicro"`
	CreatedAt    time.Time `json:"createdAt"`
	SourceType   string    `json:"sourceType"`
	SourceDigest string    `json:"sourceDigest"`
}
type tradeTape struct {
	Market        string          `json:"market"`
	Source        string          `json:"source"`
	ExternalPrice bool            `json:"externalPrice"`
	Trades        []exchangeTrade `json:"trades"`
}

func (h HTTPExchangeMarketData) tape() (tradeTape, error) {
	return h.tapeContext(context.Background())
}

func (h HTTPExchangeMarketData) tapeContext(ctx context.Context) (tradeTape, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	client := h.Client
	if client == nil {
		client = http.DefaultClient
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(h.BaseURL, "/")+"/v1/market-data/trades", nil)
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
	payload, readErr := io.ReadAll(io.LimitReader(resp.Body, (4<<20)+1))
	if readErr != nil || len(payload) > 4<<20 || !unambiguousMarketTapeDocument(payload) {
		return tradeTape{}, ErrUnavailable
	}
	d := json.NewDecoder(bytes.NewReader(payload))
	// Exchange trade records carry settlement/audit fields in addition to the
	// three market-data fields consumed here. Keep the adapter forward
	// compatible with additive fields while still fail-closing on the owned
	// market, source marker, external-price flag, and every consumed value.
	if d.Decode(&tape) != nil || tape.Market != "YNXT-YUSD_TEST" || tape.ExternalPrice || !ownedExchangeTapeSource(tape.Source) {
		return tradeTape{}, ErrUnavailable
	}
	return tape, nil
}

// Additive audit fields remain compatible, but one complete document cannot
// contain duplicate/case-folded keys or an omitted/null external-price boundary.
func unambiguousMarketTapeDocument(payload []byte) bool {
	d := json.NewDecoder(bytes.NewReader(payload))
	d.UseNumber()
	var scan func(int) bool
	scan = func(depth int) bool {
		if depth > 64 {
			return false
		}
		token, err := d.Token()
		if err != nil {
			return false
		}
		delim, container := token.(json.Delim)
		if !container {
			return true
		}
		switch delim {
		case '{':
			seen := map[string]bool{}
			for d.More() {
				token, err := d.Token()
				key, ok := token.(string)
				if err != nil || !ok {
					return false
				}
				key = canonicalMarketJSONKey(key)
				if seen[key] {
					return false
				}
				seen[key] = true
				if !scan(depth + 1) {
					return false
				}
			}
			end, err := d.Token()
			return err == nil && end == json.Delim('}')
		case '[':
			for d.More() {
				if !scan(depth + 1) {
					return false
				}
			}
			end, err := d.Token()
			return err == nil && end == json.Delim(']')
		default:
			return false
		}
	}
	if !scan(0) {
		return false
	}
	if _, err := d.Token(); err != io.EOF {
		return false
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(payload, &fields) != nil {
		return false
	}
	for key, value := range fields {
		if strings.EqualFold(key, "externalPrice") {
			return bytes.Equal(bytes.TrimSpace(value), []byte("false"))
		}
	}
	return false
}

// encoding/json also accepts Unicode simple-fold aliases (for example ſ/S),
// so ASCII lowercasing alone cannot fence duplicate consumed field names.
func canonicalMarketJSONKey(key string) string {
	var result strings.Builder
	for _, r := range key {
		canonical := r
		for folded := unicode.SimpleFold(r); folded != r; folded = unicode.SimpleFold(folded) {
			if folded < canonical {
				canonical = folded
			}
		}
		result.WriteRune(canonical)
	}
	return result.String()
}

func ownedExchangeTapeSource(source string) bool {
	switch strings.TrimSpace(source) {
	case "YNX-owned deterministic matched trades only", "persisted deterministic matching-engine fills only":
		return true
	default:
		return false
	}
}
func (h HTTPExchangeMarketData) History(market string, limit int) ([]Bar, string, error) {
	return h.HistoryContext(context.Background(), market, limit)
}

func (h HTTPExchangeMarketData) HistoryContext(ctx context.Context, market string, limit int) ([]Bar, string, error) {
	if err := ctx.Err(); err != nil {
		return nil, "", err
	}
	if market != "YNXT-YUSD_TEST" || limit < 20 || limit > 10000 {
		return nil, "", ErrInvalid
	}
	t, e := h.tapeContext(ctx)
	if err := ctx.Err(); err != nil {
		return nil, "", err
	}
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
