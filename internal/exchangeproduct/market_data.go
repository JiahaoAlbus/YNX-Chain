package exchangeproduct

import (
	"sort"
	"time"
)

// Candle is an exact aggregation of persisted matching-engine fills. Empty
// intervals are deliberately omitted; callers must not infer fabricated volume.
type Candle struct {
	Market           string    `json:"market"`
	IntervalSeconds  int64     `json:"intervalSeconds"`
	OpenTime         time.Time `json:"openTime"`
	CloseTime        time.Time `json:"closeTime"`
	OpenMicro        int64     `json:"openMicro"`
	HighMicro        int64     `json:"highMicro"`
	LowMicro         int64     `json:"lowMicro"`
	CloseMicro       int64     `json:"closeMicro"`
	BaseVolumeMicro  int64     `json:"baseVolumeMicro"`
	QuoteVolumeMicro int64     `json:"quoteVolumeMicro"`
	Trades           int       `json:"trades"`
}

type candleFill struct {
	ID          string
	Market      string
	PriceMicro  int64
	AmountMicro int64
	CreatedAt   time.Time
}

var candleIntervals = map[int64]bool{60: true, 300: true, 900: true, 3600: true, 14400: true, 86400: true}

func aggregateCandles(fills []candleFill, market string, intervalSeconds int64, limit int) []Candle {
	if !candleIntervals[intervalSeconds] || limit < 1 || limit > 500 {
		return []Candle{}
	}
	sort.Slice(fills, func(i, j int) bool {
		if fills[i].CreatedAt.Equal(fills[j].CreatedAt) {
			return fills[i].ID < fills[j].ID
		}
		return fills[i].CreatedAt.Before(fills[j].CreatedAt)
	})
	items := make([]Candle, 0)
	byBucket := make(map[int64]int)
	for _, fill := range fills {
		if fill.Market != market || fill.PriceMicro <= 0 || fill.AmountMicro <= 0 || fill.CreatedAt.IsZero() {
			continue
		}
		bucket := fill.CreatedAt.UTC().Unix() / intervalSeconds * intervalSeconds
		index, exists := byBucket[bucket]
		if !exists {
			index = len(items)
			byBucket[bucket] = index
			open := time.Unix(bucket, 0).UTC()
			items = append(items, Candle{Market: market, IntervalSeconds: intervalSeconds, OpenTime: open, CloseTime: open.Add(time.Duration(intervalSeconds) * time.Second), OpenMicro: fill.PriceMicro, HighMicro: fill.PriceMicro, LowMicro: fill.PriceMicro, CloseMicro: fill.PriceMicro})
		}
		candle := &items[index]
		if fill.PriceMicro > candle.HighMicro {
			candle.HighMicro = fill.PriceMicro
		}
		if fill.PriceMicro < candle.LowMicro {
			candle.LowMicro = fill.PriceMicro
		}
		candle.CloseMicro = fill.PriceMicro
		candle.BaseVolumeMicro += fill.AmountMicro
		candle.QuoteVolumeMicro += mulDiv(fill.AmountMicro, fill.PriceMicro, AmountScale)
		candle.Trades++
	}
	if len(items) > limit {
		items = items[len(items)-limit:]
	}
	return items
}

func (s *Service) Candles(market string, intervalSeconds int64, limit int) []Candle {
	s.mu.Lock()
	defer s.mu.Unlock()
	fills := make([]candleFill, 0)
	switch market {
	case DefaultMarket:
		for _, trade := range s.state.Trades {
			fills = append(fills, candleFill{ID: trade.ID, Market: trade.Market, PriceMicro: trade.PriceMicro, AmountMicro: trade.AmountMicro, CreatedAt: trade.CreatedAt})
		}
	case DefaultPerpetualMarket:
		for _, trade := range s.state.PerpetualTrades {
			fills = append(fills, candleFill{ID: trade.ID, Market: trade.Market, PriceMicro: trade.PriceMicro, AmountMicro: trade.AmountMicro, CreatedAt: trade.CreatedAt})
		}
	}
	return aggregateCandles(fills, market, intervalSeconds, limit)
}
