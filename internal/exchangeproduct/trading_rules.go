package exchangeproduct

import "strconv"

// TradingRules exposes only the venue's existing admission and fee rules.
// Micro amounts are decimal strings so browser consumers cannot round int64s.
// This is not a quote, funds check, order authorization or settlement receipt.
type TradingRules struct {
	SchemaVersion         string   `json:"schemaVersion"`
	Market                string   `json:"market"`
	OrderTypes            []string `json:"orderTypes"`
	Scale                 string   `json:"scale"`
	MinPriceMicro         string   `json:"minPriceMicro"`
	MaxPriceMicro         string   `json:"maxPriceMicro"`
	MinAmountMicro        string   `json:"minAmountMicro"`
	MaxAmountMicro        string   `json:"maxAmountMicro"`
	MaxOrderNotionalMicro string   `json:"maxOrderNotionalMicro"`
	MakerFeeBPS           int64    `json:"makerFeeBps"`
	TakerFeeBPS           int64    `json:"takerFeeBps"`
	NotionalRounding      string   `json:"notionalRounding"`
	FeeRounding           string   `json:"feeRounding"`
	QuoteAssetType        string   `json:"quoteAssetType"`
	AdmissionMinimumQuote string   `json:"admissionMinimumQuote"`
	ReservationShortfall  string   `json:"reservationShortfall"`
}

func (s *Service) TradingRules() TradingRules {
	return TradingRules{
		SchemaVersion: "exchange-limit-rules-v2", Market: DefaultMarket, OrderTypes: []string{"limit"},
		Scale: strconv.FormatInt(AmountScale, 10), MinPriceMicro: "1", MinAmountMicro: "1",
		MaxPriceMicro: strconv.FormatInt(1_000_000*AmountScale, 10), MaxAmountMicro: strconv.FormatInt(1_000_000*AmountScale, 10),
		MaxOrderNotionalMicro: strconv.FormatInt(s.cfg.MaxOrderNotionalMicro, 10),
		MakerFeeBPS:           s.cfg.MakerFeeBPS, TakerFeeBPS: s.cfg.TakerFeeBPS,
		NotionalRounding: "floor_micro", FeeRounding: "ceil_micro_per_fill",
		QuoteAssetType: "venue_only_test_credit_not_token", AdmissionMinimumQuote: "one_micro_credit",
		ReservationShortfall: "atomic_order_request_rejection",
	}
}
