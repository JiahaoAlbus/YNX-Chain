package oracle

import (
	"sort"
	"time"
)

type MarketStatus struct {
	Schema            string     `json:"schema"`
	Market            string     `json:"market"`
	Types             []DataType `json:"types"`
	ProviderCoverage  []string   `json:"providerCoverage"`
	LastAsOf          time.Time  `json:"lastAsOf,omitempty"`
	LastProducedAt    time.Time  `json:"lastProducedAt,omitempty"`
	LastQualityStatus string     `json:"lastQualityStatus,omitempty"`
	LastValueStale    bool       `json:"lastValueStale"`
	CorrectionCount   int        `json:"correctionCount"`
	ObservationCount  int        `json:"observationCount"`
	AggregateCount    int        `json:"aggregateCount"`
}

func (service *Service) Markets() []MarketStatus {
	state := service.store.Snapshot()
	type accumulator struct {
		market    MarketStatus
		types     map[DataType]struct{}
		providers map[string]struct{}
	}
	items := map[string]*accumulator{}
	ensure := func(market string) *accumulator {
		item := items[market]
		if item == nil {
			item = &accumulator{
				market: MarketStatus{Schema: SchemaVersion, Market: market, Types: []DataType{}, ProviderCoverage: []string{}},
				types:  map[DataType]struct{}{}, providers: map[string]struct{}{},
			}
			items[market] = item
		}
		return item
	}
	for _, provider := range service.Providers() {
		for _, market := range provider.AssetMarketCoverage {
			if !marketPattern.MatchString(market) {
				continue
			}
			ensure(market).providers[provider.ID] = struct{}{}
		}
	}
	for _, observation := range state.Observations {
		item := ensure(observation.Market)
		item.types[observation.Type] = struct{}{}
		item.market.ObservationCount++
	}
	for _, correction := range state.Corrections {
		item := ensure(correction.Corrected.Market)
		item.types[correction.Corrected.Type] = struct{}{}
		item.market.CorrectionCount++
	}
	for _, event := range state.AggregateEvents {
		item := ensure(event.Price.Market)
		item.types[event.Price.Type] = struct{}{}
		item.market.AggregateCount++
		if !event.Price.ProducedAt.Before(item.market.LastProducedAt) {
			item.market.LastAsOf = event.Price.AsOf
			item.market.LastProducedAt = event.Price.ProducedAt
			item.market.LastQualityStatus = event.Price.Quality.Status
			item.market.LastValueStale = event.Price.Quality.Stale
		}
	}
	result := make([]MarketStatus, 0, len(items))
	for _, item := range items {
		for kind := range item.types {
			item.market.Types = append(item.market.Types, kind)
		}
		for providerID := range item.providers {
			item.market.ProviderCoverage = append(item.market.ProviderCoverage, providerID)
		}
		sort.Slice(item.market.Types, func(i, j int) bool { return item.market.Types[i] < item.market.Types[j] })
		sort.Strings(item.market.ProviderCoverage)
		result = append(result, item.market)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Market < result[j].Market })
	return result
}

func (service *Service) History(market string, kind DataType, limit int) ([]AggregateEvent, error) {
	if !marketPattern.MatchString(market) || !kind.Scalar() || limit < 1 || limit > 1000 {
		return nil, errInvalid
	}
	state := service.store.Snapshot()
	result := make([]AggregateEvent, 0)
	for _, event := range state.AggregateEvents {
		if event.Price.Market == market && event.Price.Type == kind {
			result = append(result, event)
		}
	}
	if len(result) > limit {
		result = result[len(result)-limit:]
	}
	return result, nil
}

func (service *Service) Corrections(market string, kind DataType, limit int) ([]Correction, error) {
	if !marketPattern.MatchString(market) || !kind.Valid() || limit < 1 || limit > 1000 {
		return nil, errInvalid
	}
	state := service.store.Snapshot()
	result := make([]Correction, 0)
	for _, correction := range state.Corrections {
		if correction.Corrected.Market == market && correction.Corrected.Type == kind {
			result = append(result, correction)
		}
	}
	if len(result) > limit {
		result = result[len(result)-limit:]
	}
	return result, nil
}
