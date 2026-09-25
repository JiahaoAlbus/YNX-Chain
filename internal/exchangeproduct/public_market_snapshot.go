package exchangeproduct

import (
	"fmt"
	"sort"
)

// MarketDataSnapshot keeps the newer guest transport on the restored schema-v10
// engine. Its contents come only from persisted Exchange orders and matches.
type MarketDataSnapshot struct {
	SchemaVersion  string          `json:"schemaVersion"`
	Revision       int64           `json:"revision"`
	Market         string          `json:"market"`
	OrderBook      PublicOrderBook `json:"orderBook"`
	Trades         []PublicTrade   `json:"trades"`
	TradingRules   TradingRules    `json:"tradingRules"`
	SourceMetadata SourceMetadata  `json:"sourceMetadata"`
}

func (s *Service) readSource(coverage string) SourceMetadata {
	backend, multiInstance := s.StorageStatus()
	status := "live"
	if !multiInstance {
		status = "degraded_single_host"
	}
	return SourceMetadata{Authority: "YNX-owned deterministic order state", Version: "exchange-public-state-v1", AsOf: s.cfg.Now().UTC(), Classification: "testnet", Status: status, Coverage: coverage, StateBackend: backend, MultiInstance: multiInstance}
}

func (s *Service) marketDataSnapshot() (MarketDataSnapshot, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	source := s.readSource("stream-orderbook-matched-trades")
	book := s.publicBookLocked(source)
	trades := append([]Trade(nil), s.state.Trades...)
	sort.Slice(trades, func(i, j int) bool {
		if trades[i].CreatedAt.Equal(trades[j].CreatedAt) {
			return trades[i].ID < trades[j].ID
		}
		return trades[i].CreatedAt.Before(trades[j].CreatedAt)
	})
	if len(trades) > 1000 {
		trades = trades[len(trades)-1000:]
	}
	return MarketDataSnapshot{SchemaVersion: "exchange-public-market-v1", Revision: s.state.Sequence, Market: DefaultMarket, OrderBook: book, Trades: publicTrades(trades), TradingRules: s.TradingRules(), SourceMetadata: source}, fmt.Sprintf("%d:%s", s.state.Sequence, s.state.IntegrityHash)
}

func (s *Service) PublicBook() PublicOrderBook {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.publicBookLocked(s.readSource("open-orders-price-time-priority"))
}

func (s *Service) publicBookLocked(source SourceMetadata) PublicOrderBook {
	book := OrderBook{Market: DefaultMarket, Bids: []Order{}, Asks: []Order{}, SourceMetadata: source}
	for _, order := range s.state.Orders {
		if order.Market != DefaultMarket || !isOpenOrder(order) || executableRemaining(order) <= 0 {
			continue
		}
		// An iceberg never exposes its hidden total. A regular order retains its
		// actual amount and fill count for the guest terminal's depth display.
		visible := publicBookOrder(order)
		if order.DisplayAmountMicro == 0 {
			visible.AmountMicro = order.AmountMicro
			visible.FilledMicro = order.FilledMicro
		}
		if visible.Side == "buy" {
			book.Bids = append(book.Bids, visible)
		} else {
			book.Asks = append(book.Asks, visible)
		}
	}
	sort.Slice(book.Bids, func(i, j int) bool { return bookPriority(book.Bids[i], book.Bids[j], true) })
	sort.Slice(book.Asks, func(i, j int) bool { return bookPriority(book.Asks[i], book.Asks[j], false) })
	return publicBook(book)
}
