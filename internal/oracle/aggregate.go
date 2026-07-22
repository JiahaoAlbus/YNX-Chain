package oracle

import (
	"errors"
	"math"
	"math/big"
	"sort"
	"time"
)

type Policy struct {
	Version                  string        `json:"version"`
	MinimumSources           int           `json:"minimumSources"`
	MaximumAge               time.Duration `json:"maximumAge"`
	MaximumFutureSkew        time.Duration `json:"maximumFutureSkew"`
	OutlierMADMultiple       float64       `json:"outlierMadMultiple"`
	MaximumDivergencePPM     int64         `json:"maximumDivergencePpm"`
	AllowLimitedSources      bool          `json:"allowLimitedSources"`
	ProviderUpdatesPerSecond float64       `json:"providerUpdatesPerSecond"`
	ProviderBurst            float64       `json:"providerBurst"`
}

func DefaultPolicy() Policy {
	return Policy{PolicyVersion, 3, 30 * time.Second, 2 * time.Second, 6, 50_000, false, 100, 200}
}

type weightedObservation struct {
	observation Observation
	weight      int64
}

func Aggregate(now time.Time, observations []Observation, providers map[string]Provider, policy Policy) (Price, error) {
	if policy.Version == "" || policy.MinimumSources < 1 || policy.MaximumAge <= 0 ||
		policy.MaximumFutureSkew < 0 || policy.OutlierMADMultiple <= 0 || policy.MaximumDivergencePPM <= 0 {
		return Price{}, errors.New("invalid aggregation policy")
	}
	if len(observations) == 0 {
		return failedPrice(now, policy, "no observations"), errors.New("no observations")
	}
	market, kind, scale := observations[0].Market, observations[0].Type, observations[0].Scale
	rejected := make([]string, 0)
	unique := make(map[string]weightedObservation)
	latest := time.Time{}
	for _, observation := range observations {
		provider, ok := providers[observation.ProviderID]
		if !ok || provider.Status != "active" || observation.Market != market || observation.Type != kind || observation.Scale != scale ||
			observation.ObservedAt.After(now.Add(policy.MaximumFutureSkew)) || now.Sub(observation.ObservedAt) > policy.MaximumAge {
			rejected = append(rejected, observation.ProviderID)
			continue
		}
		if previous, ok := unique[observation.ProviderID]; ok {
			if observation.ObservedAt.Before(previous.observation.ObservedAt) || (observation.ObservedAt.Equal(previous.observation.ObservedAt) && observation.Sequence <= previous.observation.Sequence) {
				rejected = append(rejected, observation.ID)
				continue
			}
			rejected = append(rejected, previous.observation.ID)
		}
		weight := provider.WeightPPM
		if observation.Liquidity > 0 {
			weight = saturatingMulSqrt(weight, observation.Liquidity)
		}
		unique[observation.ProviderID] = weightedObservation{observation, weight}
		if observation.ObservedAt.After(latest) {
			latest = observation.ObservedAt
		}
	}
	items := make([]weightedObservation, 0, len(unique))
	for _, item := range unique {
		items = append(items, item)
	}
	if len(items) == 0 {
		result := failedPrice(now, policy, "all observations rejected as stale, future-dated, inactive, or incompatible")
		result.Market, result.Type, result.Scale = market, kind, scale
		result.Quality.RejectedSources = rejected
		result.ObservationIDs, result.ObservationHash = observationReferences(observations)
		result.LineageHash = lineage(observations, policy.Version)
		return result, errors.New(result.Quality.Failure)
	}

	median := unweightedMedian(items)
	deviations := make([]int64, len(items))
	for index, item := range items {
		deviations[index] = absolute(item.observation.Value - median)
	}
	sort.Slice(deviations, func(i, j int) bool { return deviations[i] < deviations[j] })
	mad := deviations[len(deviations)/2]
	filtered := items[:0]
	for _, item := range items {
		deviation := absolute(item.observation.Value - median)
		if mad > 0 && float64(deviation) > policy.OutlierMADMultiple*float64(mad) {
			rejected = append(rejected, item.observation.ProviderID)
			continue
		}
		filtered = append(filtered, item)
	}
	items = filtered
	if len(items) == 0 {
		result := failedPrice(now, policy, "outlier rejection removed every observation")
		result.Market, result.Type, result.Scale = market, kind, scale
		result.ObservationIDs, result.ObservationHash = observationReferences(observations)
		result.LineageHash = lineage(observations, policy.Version)
		return result, errors.New("outlier rejection removed every observation")
	}
	value := weightedMedian(items)
	minimum, maximum := items[0].observation.Value, items[0].observation.Value
	used := make([]Observation, 0, len(items))
	for _, item := range items {
		used = append(used, item.observation)
		if item.observation.Value < minimum {
			minimum = item.observation.Value
		}
		if item.observation.Value > maximum {
			maximum = item.observation.Value
		}
	}
	divergence := ratioPPM(maximum-minimum, value)
	limited := len(items) < policy.MinimumSources
	circuit := divergence > policy.MaximumDivergencePPM || (limited && !policy.AllowLimitedSources)
	coverage := int64(len(items) * 1_000_000 / policy.MinimumSources)
	if coverage > 1_000_000 {
		coverage = 1_000_000
	}
	confidence := coverage - divergence
	if confidence < 0 {
		confidence = 0
	}
	status := "good"
	failure := ""
	limitation := ""
	if limited {
		status = "limited_sources"
		limitation = "fewer than the policy-required independent sources"
	}
	if circuit {
		status = "circuit_breaker"
		failure = "price is not safe for authoritative consumption"
	}
	ids, hashes := make([]string, 0, len(used)), make([]string, 0, len(used))
	for _, observation := range used {
		ids, hashes = append(ids, observation.ID), append(hashes, observation.Hash)
	}
	result := Price{
		Schema: SchemaVersion, Market: market, Type: kind, Value: value, Scale: scale,
		Source: "YNX Oracle aggregated provider observations", Version: policy.Version,
		AsOf: latest.UTC(), ProducedAt: now.UTC(), ObservationIDs: ids, ObservationHash: hashes,
		LineageHash: lineage(used, policy.Version),
		Quality: Quality{Status: status, SourceCount: len(items), RequiredSourceCount: policy.MinimumSources,
			RejectedSources: rejected, SourceLimitation: limitation, DivergencePPM: divergence,
			ConfidencePPM: confidence, CoveragePPM: coverage, CircuitBreaker: circuit, Failure: failure},
	}
	if circuit {
		return result, errors.New(failure)
	}
	return result, nil
}

func observationReferences(observations []Observation) ([]string, []string) {
	ids, hashes := make([]string, 0, len(observations)), make([]string, 0, len(observations))
	for _, observation := range observations {
		ids = append(ids, observation.ID)
		hashes = append(hashes, observation.Hash)
	}
	return ids, hashes
}

func failedPrice(now time.Time, policy Policy, failure string) Price {
	return Price{Schema: SchemaVersion, Source: "YNX Oracle unavailable", Version: policy.Version, ProducedAt: now.UTC(),
		Quality: Quality{Status: "unavailable", Stale: true, RequiredSourceCount: policy.MinimumSources,
			RejectedSources: []string{}, CircuitBreaker: true, Failure: failure}}
}

func weightedMedian(items []weightedObservation) int64 {
	sort.Slice(items, func(i, j int) bool { return items[i].observation.Value < items[j].observation.Value })
	total := new(big.Int)
	for _, item := range items {
		total.Add(total, big.NewInt(item.weight))
	}
	cumulative := new(big.Int)
	for _, item := range items {
		cumulative.Add(cumulative, big.NewInt(item.weight))
		doubled := new(big.Int).Lsh(new(big.Int).Set(cumulative), 1)
		if doubled.Cmp(total) >= 0 {
			return item.observation.Value
		}
	}
	return items[len(items)-1].observation.Value
}

func ratioPPM(numerator, denominator int64) int64 {
	if numerator <= 0 || denominator <= 0 {
		return 0
	}
	value := new(big.Int).Mul(big.NewInt(numerator), big.NewInt(1_000_000))
	value.Div(value, big.NewInt(denominator))
	if !value.IsInt64() {
		return math.MaxInt64
	}
	return value.Int64()
}

func unweightedMedian(items []weightedObservation) int64 {
	values := make([]int64, len(items))
	for index, item := range items {
		values[index] = item.observation.Value
	}
	sort.Slice(values, func(i, j int) bool { return values[i] < values[j] })
	return values[len(values)/2]
}

func saturatingMulSqrt(weight, liquidity int64) int64 {
	factor := int64(math.Sqrt(float64(liquidity)))
	if factor < 1 {
		factor = 1
	}
	if weight > math.MaxInt64/factor {
		return math.MaxInt64
	}
	return weight * factor
}

func absolute(value int64) int64 {
	if value < 0 {
		return -value
	}
	return value
}
