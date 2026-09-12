package exchangeproduct

import "time"

// Public projections deliberately omit account, reservation and authorization
// fields. Guest market data does not confer access to an account snapshot.
type PublicOrder struct {
	ID          string    `json:"id"`
	Market      string    `json:"market"`
	Side        string    `json:"side"`
	PriceMicro  int64     `json:"priceMicro"`
	AmountMicro int64     `json:"amountMicro"`
	FilledMicro int64     `json:"filledMicro"`
	CreatedAt   time.Time `json:"createdAt"`
}

type PublicOrderBook struct {
	Market         string         `json:"market"`
	Bids           []PublicOrder  `json:"bids"`
	Asks           []PublicOrder  `json:"asks"`
	SourceMetadata SourceMetadata `json:"sourceMetadata"`
}

type PublicTrade struct {
	ID           string    `json:"id"`
	Market       string    `json:"market"`
	PriceMicro   int64     `json:"priceMicro"`
	AmountMicro  int64     `json:"amountMicro"`
	CreatedAt    time.Time `json:"createdAt"`
	SourceType   string    `json:"sourceType"`
	SourceDigest string    `json:"sourceDigest"`
}

func publicBook(book OrderBook) PublicOrderBook {
	project := func(orders []Order) []PublicOrder {
		result := make([]PublicOrder, 0, len(orders))
		for _, o := range orders {
			result = append(result, PublicOrder{ID: o.ID, Market: o.Market, Side: o.Side, PriceMicro: o.PriceMicro, AmountMicro: o.AmountMicro, FilledMicro: o.FilledMicro, CreatedAt: o.CreatedAt})
		}
		return result
	}
	return PublicOrderBook{Market: book.Market, Bids: project(book.Bids), Asks: project(book.Asks), SourceMetadata: book.SourceMetadata}
}

func publicTrades(trades []Trade) []PublicTrade {
	result := make([]PublicTrade, 0, len(trades))
	for _, t := range trades {
		result = append(result, PublicTrade{ID: t.ID, Market: t.Market, PriceMicro: t.PriceMicro, AmountMicro: t.AmountMicro, CreatedAt: t.CreatedAt, SourceType: t.SourceType, SourceDigest: t.SourceDigest})
	}
	return result
}
