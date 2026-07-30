package oracle

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"math"
	"math/big"
	"sort"
	"time"
)

const DerivativesPolicyVersion = "index-funding-mark-v1"

type DerivativesPolicy struct {
	Version                  string        `json:"version"`
	FundingWindow            time.Duration `json:"fundingWindow"`
	MaximumComponentAge      time.Duration `json:"maximumComponentAge"`
	FundingReferenceClampPPM int64         `json:"fundingReferenceClampPpm"`
	MarkAdjustmentClampPPM   int64         `json:"markAdjustmentClampPpm"`
}

func DefaultDerivativesPolicy() DerivativesPolicy {
	return DerivativesPolicy{
		Version:                  DerivativesPolicyVersion,
		FundingWindow:            8 * time.Hour,
		MaximumComponentAge:      30 * time.Second,
		FundingReferenceClampPPM: 5_000,
		MarkAdjustmentClampPPM:   10_000,
	}
}

func (policy DerivativesPolicy) validate() error {
	if policy.Version == "" || policy.FundingWindow <= 0 || policy.MaximumComponentAge <= 0 ||
		policy.FundingReferenceClampPPM <= 0 || policy.FundingReferenceClampPPM > 1_000_000 ||
		policy.MarkAdjustmentClampPPM <= 0 || policy.MarkAdjustmentClampPPM > 1_000_000 {
		return errors.New("invalid derivatives policy")
	}
	return nil
}

func deriveIndexPrice(now time.Time, spot Price, policy DerivativesPolicy) (Price, error) {
	if err := policy.validate(); err != nil {
		return Price{}, err
	}
	if spot.Type != SpotPrice {
		return Price{}, errors.New("index price requires canonical spot input")
	}
	if err := validateDerivedComponent(now, spot, policy.MaximumComponentAge); err != nil {
		return failedDerivedPrice(now, spot.Market, IndexPrice, policy.Version, err.Error()), err
	}
	result := spot
	result.Type = IndexPrice
	result.Source = "YNX Oracle index derived from independent spot venue observations"
	result.Version = policy.Version
	result.ProducedAt = now.UTC()
	result.LineageHash = derivedLineage(policy.Version, "spot_index", spot)
	result.Derivation = &PriceDerivation{
		Method:                 "liquidity_weighted_median_spot_index",
		PolicyVersion:          policy.Version,
		ComponentTypes:         []DataType{SpotPrice},
		ComponentLineageHashes: []string{spot.LineageHash},
	}
	return result, nil
}

func deriveFundingReference(now time.Time, premium, basis Price, policy DerivativesPolicy) (Price, error) {
	if err := policy.validate(); err != nil {
		return Price{}, err
	}
	if premium.Type != PremiumReference || basis.Type != BasisReference || premium.Market != basis.Market {
		return Price{}, errors.New("funding reference requires matching premium and basis inputs")
	}
	if err := validateDerivedComponent(now, premium, policy.MaximumComponentAge); err != nil {
		return failedDerivedPrice(now, premium.Market, FundingReference, policy.Version, err.Error()), err
	}
	if err := validateDerivedComponent(now, basis, policy.MaximumComponentAge); err != nil {
		return failedDerivedPrice(now, basis.Market, FundingReference, policy.Version, err.Error()), err
	}
	premiumPPM := scaledToPPM(premium.Value, premium.Scale)
	basisPPM := scaledToPPM(basis.Value, basis.Scale)
	raw := saturatingAdd(premiumPPM, basisPPM)
	applied, clamped := clampSigned(raw, policy.FundingReferenceClampPPM)
	quality := mergeDerivedQuality(premium, basis)
	if clamped {
		quality.Status = "divergent"
		quality.CircuitBreaker = true
		quality.Failure = "funding reference exceeded the governance clamp"
	}
	ids, hashes := combinedObservationReferences(premium, basis)
	result := Price{
		Schema: SchemaVersion, Market: premium.Market, Type: FundingReference,
		Value: applied, Scale: 1_000_000,
		Source:  "YNX Oracle funding reference derived from premium and basis candidates",
		Version: policy.Version, AsOf: earliestTime(premium.AsOf, basis.AsOf), ProducedAt: now.UTC(),
		Quality: quality, ObservationIDs: ids, ObservationHash: hashes,
		LineageHash: derivedLineage(policy.Version, "funding_reference", premium, basis),
		Derivation: &PriceDerivation{
			Method:                 "premium_plus_basis_with_governance_clamp",
			PolicyVersion:          policy.Version,
			ComponentTypes:         []DataType{PremiumReference, BasisReference},
			ComponentLineageHashes: []string{premium.LineageHash, basis.LineageHash},
			FundingWindowSeconds:   int64(policy.FundingWindow / time.Second),
			PremiumPPM:             premiumPPM,
			BasisPPM:               basisPPM,
			RawAdjustmentPPM:       raw,
			AppliedAdjustmentPPM:   applied,
			ClampPPM:               policy.FundingReferenceClampPPM,
			Clamped:                clamped,
		},
	}
	if clamped {
		return result, errors.New(quality.Failure)
	}
	return result, nil
}

func deriveMarkPrice(now time.Time, index, funding Price, policy DerivativesPolicy) (Price, error) {
	if err := policy.validate(); err != nil {
		return Price{}, err
	}
	if index.Type != IndexPrice || funding.Type != FundingReference || index.Market != funding.Market {
		return Price{}, errors.New("mark price requires matching index and funding reference inputs")
	}
	if err := validateDerivedComponent(now, index, policy.MaximumComponentAge); err != nil {
		return failedDerivedPrice(now, index.Market, MarkPrice, policy.Version, err.Error()), err
	}
	if err := validateDerivedComponent(now, funding, policy.MaximumComponentAge); err != nil {
		return failedDerivedPrice(now, funding.Market, MarkPrice, policy.Version, err.Error()), err
	}
	rawAdjustment := scaledToPPM(funding.Value, funding.Scale)
	appliedAdjustment, clamped := clampSigned(rawAdjustment, policy.MarkAdjustmentClampPPM)
	value, ok := applyPPM(index.Value, appliedAdjustment)
	quality := mergeDerivedQuality(index, funding)
	if !ok || value <= 0 {
		quality.Status = "unavailable"
		quality.Stale = true
		quality.CircuitBreaker = true
		quality.Failure = "mark price arithmetic is outside the supported range"
	}
	if clamped {
		quality.Status = "divergent"
		quality.CircuitBreaker = true
		quality.Failure = "mark adjustment exceeded the governance clamp"
	}
	ids, hashes := combinedObservationReferences(index, funding)
	result := Price{
		Schema: SchemaVersion, Market: index.Market, Type: MarkPrice, Value: value, Scale: index.Scale,
		Source:  "YNX Oracle mark derived from canonical index and funding reference",
		Version: policy.Version, AsOf: earliestTime(index.AsOf, funding.AsOf), ProducedAt: now.UTC(),
		Quality: quality, ObservationIDs: ids, ObservationHash: hashes,
		LineageHash: derivedLineage(policy.Version, "mark_price", index, funding),
		Derivation: &PriceDerivation{
			Method:                 "index_times_one_plus_funding_reference",
			PolicyVersion:          policy.Version,
			ComponentTypes:         []DataType{IndexPrice, FundingReference},
			ComponentLineageHashes: []string{index.LineageHash, funding.LineageHash},
			FundingWindowSeconds:   int64(policy.FundingWindow / time.Second),
			RawAdjustmentPPM:       rawAdjustment,
			AppliedAdjustmentPPM:   appliedAdjustment,
			ClampPPM:               policy.MarkAdjustmentClampPPM,
			Clamped:                clamped,
		},
	}
	if quality.CircuitBreaker {
		return result, errors.New(quality.Failure)
	}
	return result, nil
}

func validateDerivedComponent(now time.Time, price Price, maximumAge time.Duration) error {
	if price.Schema != SchemaVersion || price.Market == "" || !price.Type.Scalar() || price.Scale <= 0 ||
		price.AsOf.IsZero() || price.ProducedAt.IsZero() || price.LineageHash == "" || len(price.ObservationIDs) == 0 ||
		len(price.ObservationIDs) != len(price.ObservationHash) {
		return errors.New("derived price component is incomplete")
	}
	if price.AsOf.After(now.Add(2*time.Second)) || now.Sub(price.AsOf) > maximumAge {
		return errors.New("derived price component is stale or future-dated")
	}
	if price.Quality.Status != "good" || price.Quality.Stale || price.Quality.CircuitBreaker || price.Quality.Failure != "" ||
		price.Quality.SourceCount < price.Quality.RequiredSourceCount {
		return errors.New("derived price component quality is unsafe")
	}
	return nil
}

func failedDerivedPrice(now time.Time, market string, kind DataType, version, failure string) Price {
	return Price{
		Schema: SchemaVersion, Market: market, Type: kind, Source: "YNX Oracle derived value unavailable", Version: version,
		ProducedAt: now.UTC(), Quality: Quality{Status: "unavailable", Stale: true, CircuitBreaker: true, Failure: failure, RejectedSources: []string{}},
	}
}

func mergeDerivedQuality(prices ...Price) Quality {
	quality := Quality{Status: "good", SourceCount: math.MaxInt, ConfidencePPM: 1_000_000, CoveragePPM: 1_000_000, RejectedSources: []string{}}
	rejected := map[string]struct{}{}
	for _, price := range prices {
		if price.Quality.SourceCount < quality.SourceCount {
			quality.SourceCount = price.Quality.SourceCount
		}
		if price.Quality.RequiredSourceCount > quality.RequiredSourceCount {
			quality.RequiredSourceCount = price.Quality.RequiredSourceCount
		}
		if price.Quality.DivergencePPM > quality.DivergencePPM {
			quality.DivergencePPM = price.Quality.DivergencePPM
		}
		if price.Quality.ConfidencePPM < quality.ConfidencePPM {
			quality.ConfidencePPM = price.Quality.ConfidencePPM
		}
		if price.Quality.CoveragePPM < quality.CoveragePPM {
			quality.CoveragePPM = price.Quality.CoveragePPM
		}
		for _, source := range price.Quality.RejectedSources {
			rejected[source] = struct{}{}
		}
	}
	if quality.SourceCount == math.MaxInt {
		quality.SourceCount = 0
	}
	for source := range rejected {
		quality.RejectedSources = append(quality.RejectedSources, source)
	}
	sort.Strings(quality.RejectedSources)
	return quality
}

func scaledToPPM(value, scale int64) int64 {
	if scale <= 0 {
		return 0
	}
	result := new(big.Int).Mul(big.NewInt(value), big.NewInt(1_000_000))
	result.Div(result, big.NewInt(scale))
	if result.IsInt64() {
		return result.Int64()
	}
	if result.Sign() < 0 {
		return math.MinInt64
	}
	return math.MaxInt64
}

func saturatingAdd(left, right int64) int64 {
	result := new(big.Int).Add(big.NewInt(left), big.NewInt(right))
	if result.IsInt64() {
		return result.Int64()
	}
	if result.Sign() < 0 {
		return math.MinInt64
	}
	return math.MaxInt64
}

func clampSigned(value, limit int64) (int64, bool) {
	if value > limit {
		return limit, true
	}
	if value < -limit {
		return -limit, true
	}
	return value, false
}

func applyPPM(value, adjustmentPPM int64) (int64, bool) {
	multiplier := new(big.Int).Add(big.NewInt(1_000_000), big.NewInt(adjustmentPPM))
	result := new(big.Int).Mul(big.NewInt(value), multiplier)
	result.Div(result, big.NewInt(1_000_000))
	if !result.IsInt64() {
		return 0, false
	}
	return result.Int64(), true
}

func earliestTime(left, right time.Time) time.Time {
	if left.Before(right) {
		return left.UTC()
	}
	return right.UTC()
}

func combinedObservationReferences(prices ...Price) ([]string, []string) {
	type reference struct {
		id   string
		hash string
	}
	items := map[string]reference{}
	for _, price := range prices {
		for index, id := range price.ObservationIDs {
			if index < len(price.ObservationHash) {
				items[price.ObservationHash[index]] = reference{id: id, hash: price.ObservationHash[index]}
			}
		}
	}
	ordered := make([]reference, 0, len(items))
	for _, item := range items {
		ordered = append(ordered, item)
	}
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].hash < ordered[j].hash })
	ids := make([]string, 0, len(ordered))
	hashes := make([]string, 0, len(ordered))
	for _, item := range ordered {
		ids = append(ids, item.id)
		hashes = append(hashes, item.hash)
	}
	return ids, hashes
}

func derivedLineage(version, method string, prices ...Price) string {
	parts := []string{version, method}
	for _, price := range prices {
		parts = append(parts, price.LineageHash)
	}
	sort.Strings(parts[2:])
	digest := sha256.Sum256([]byte(parts[0] + "\n" + parts[1] + "\n" + joinLines(parts[2:])))
	return hex.EncodeToString(digest[:])
}

func joinLines(values []string) string {
	if len(values) == 0 {
		return ""
	}
	result := values[0]
	for _, value := range values[1:] {
		result += "\n" + value
	}
	return result
}
