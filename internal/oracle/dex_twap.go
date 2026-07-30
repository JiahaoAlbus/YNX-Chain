package oracle

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"math/big"
	"sort"
	"strconv"
	"time"
)

const DEXTWAPPolicyVersion = "dex-twap-v1"

type DEXTWAPPolicy struct {
	Version                        string        `json:"version"`
	Window                         time.Duration `json:"window"`
	MaximumAge                     time.Duration `json:"maximumAge"`
	MinimumWindow                  time.Duration `json:"minimumWindow"`
	MinimumObservations            int           `json:"minimumObservations"`
	RequiredReporters              int           `json:"requiredReporters"`
	RequiredConfirmations          uint64        `json:"requiredConfirmations"`
	MaximumSingleBlockDeviationPPM int64         `json:"maximumSingleBlockDeviationPpm"`
	MaximumRejectedBlocks          int           `json:"maximumRejectedBlocks"`
	MinimumWholeTokenReserve       int64         `json:"minimumWholeTokenReserve"`
	Scale                          int64         `json:"scale"`
}

func DefaultDEXTWAPPolicy() DEXTWAPPolicy {
	return DEXTWAPPolicy{
		Version:                        DEXTWAPPolicyVersion,
		Window:                         60 * time.Second,
		MaximumAge:                     30 * time.Second,
		MinimumWindow:                  48 * time.Second,
		MinimumObservations:            5,
		RequiredReporters:              3,
		RequiredConfirmations:          2,
		MaximumSingleBlockDeviationPPM: 100_000,
		MaximumRejectedBlocks:          1,
		MinimumWholeTokenReserve:       10,
		Scale:                          1_000_000,
	}
}

func (policy DEXTWAPPolicy) validate() error {
	if policy.Version == "" || policy.Window <= 0 || policy.MaximumAge <= 0 || policy.MinimumWindow <= 0 ||
		policy.MinimumWindow > policy.Window || policy.MinimumObservations < 3 || policy.RequiredReporters < 3 ||
		policy.RequiredConfirmations == 0 || policy.MaximumSingleBlockDeviationPPM <= 0 ||
		policy.MaximumSingleBlockDeviationPPM > 1_000_000 || policy.MaximumRejectedBlocks < 0 ||
		policy.MaximumRejectedBlocks >= policy.MinimumObservations || policy.MinimumWholeTokenReserve <= 0 || policy.Scale <= 0 {
		return errors.New("invalid DEX TWAP policy")
	}
	return nil
}

type dexBlockGroup struct {
	state        PoolState
	observations []Observation
	reporters    map[string]struct{}
	conflict     bool
}

type dexBlockSample struct {
	state         PoolState
	observations  []Observation
	reporterCount int
	price         int64
	guardedPrice  int64
}

func deriveDEXTWAP(asOf time.Time, market string, observations []Observation, providers map[string]Provider, policy DEXTWAPPolicy) (Price, error) {
	if err := policy.validate(); err != nil {
		return Price{}, err
	}
	asOf = asOf.UTC()
	windowStart := asOf.Add(-policy.Window)
	byHeight := map[uint64]map[string]*dexBlockGroup{}
	poolIdentities := map[string]struct{}{}
	for _, observation := range observations {
		provider, exists := providers[observation.ProviderID]
		if !exists || provider.Status != "active" || observation.Type != DEXPoolState || observation.PoolState == nil ||
			!provider.CoversMarket(observation.Market) || observation.Source != provider.Endpoint || observation.SourceVersion != provider.APIVersion {
			continue
		}
		state := *observation.PoolState
		if state.BlockTime.Before(windowStart) || state.BlockTime.After(asOf) || state.Confirmations < policy.RequiredConfirmations {
			continue
		}
		identity := dexPoolIdentity(state)
		poolIdentities[identity] = struct{}{}
		hashes := byHeight[state.BlockNumber]
		if hashes == nil {
			hashes = map[string]*dexBlockGroup{}
			byHeight[state.BlockNumber] = hashes
		}
		group := hashes[state.BlockHash]
		if group == nil {
			group = &dexBlockGroup{state: state, reporters: map[string]struct{}{}}
			hashes[state.BlockHash] = group
		}
		if !samePoolState(group.state, state) {
			group.conflict = true
		}
		if _, duplicate := group.reporters[observation.ProviderID]; duplicate {
			group.conflict = true
			continue
		}
		group.reporters[observation.ProviderID] = struct{}{}
		group.observations = append(group.observations, observation)
	}
	if len(poolIdentities) == 0 {
		return failedDEXTWAP(asOf, market, "", "", "unavailable", true, "no confirmed DEX pool observations in the policy window"), errors.New("no confirmed DEX pool observations in the policy window")
	}
	if len(poolIdentities) != 1 {
		return failedDEXTWAP(asOf, market, "", "", "divergent", false, "multiple DEX pools require explicit pool selection"), errors.New("multiple DEX pools require explicit pool selection")
	}

	samples := make([]dexBlockSample, 0, len(byHeight))
	for height, hashes := range byHeight {
		if len(hashes) != 1 {
			return failedDEXTWAP(asOf, market, "", "", "divergent", false, fmt.Sprintf("competing block hashes at height %d require audited correction", height)), errors.New("DEX reorg or reporter divergence is unresolved")
		}
		for _, group := range hashes {
			if group.conflict {
				return failedDEXTWAP(asOf, market, group.state.ChainID, group.state.Pool, "divergent", false, fmt.Sprintf("conflicting pool state at block %d", height)), errors.New("conflicting DEX pool state")
			}
			if len(group.reporters) < policy.RequiredReporters {
				continue
			}
			price, err := poolPrice(group.state, policy.Scale)
			if err != nil {
				return failedDEXTWAP(asOf, market, group.state.ChainID, group.state.Pool, "unavailable", false, err.Error()), err
			}
			samples = append(samples, dexBlockSample{state: group.state, observations: group.observations, reporterCount: len(group.reporters), price: price, guardedPrice: price})
		}
	}
	if len(samples) < policy.MinimumObservations {
		return failedDEXTWAP(asOf, market, "", "", "limited_sources", false, fmt.Sprintf("DEX TWAP requires at least %d confirmed quorum blocks", policy.MinimumObservations)), errors.New("insufficient confirmed DEX TWAP blocks")
	}
	sort.Slice(samples, func(i, j int) bool { return samples[i].state.BlockNumber < samples[j].state.BlockNumber })
	for index := 1; index < len(samples); index++ {
		previous, current := samples[index-1].state, samples[index].state
		if current.BlockNumber != previous.BlockNumber+1 || current.ParentBlockHash != previous.BlockHash || !current.BlockTime.After(previous.BlockTime) {
			return failedDEXTWAP(asOf, market, current.ChainID, current.Pool, "divergent", false, "DEX block continuity is incomplete or reorged"), errors.New("DEX block continuity is incomplete or reorged")
		}
	}
	first, last := samples[0].state, samples[len(samples)-1].state
	observedWindow := last.BlockTime.Sub(first.BlockTime)
	if observedWindow < policy.MinimumWindow {
		return failedDEXTWAP(asOf, market, last.ChainID, last.Pool, "partial", false, "DEX TWAP observation window is too short"), errors.New("DEX TWAP observation window is too short")
	}
	if age := asOf.Sub(last.BlockTime); age < 0 || age > policy.MaximumAge {
		return failedDEXTWAP(asOf, market, last.ChainID, last.Pool, "unavailable", true, "latest confirmed DEX block is stale or future-dated"), errors.New("latest confirmed DEX block is stale or future-dated")
	}

	minimumReserve0, minimumReserve1 := new(big.Int), new(big.Int)
	minimumReserve0.SetString(samples[0].state.Reserve0, 10)
	minimumReserve1.SetString(samples[0].state.Reserve1, 10)
	for _, sample := range samples {
		reserve0, _ := new(big.Int).SetString(sample.state.Reserve0, 10)
		reserve1, _ := new(big.Int).SetString(sample.state.Reserve1, 10)
		if !hasMinimumReserve(reserve0, sample.state.Token0Decimals, policy.MinimumWholeTokenReserve) || !hasMinimumReserve(reserve1, sample.state.Token1Decimals, policy.MinimumWholeTokenReserve) {
			return failedDEXTWAP(asOf, market, sample.state.ChainID, sample.state.Pool, "degraded", false, fmt.Sprintf("low-liquidity DEX block %d rejected", sample.state.BlockNumber)), errors.New("DEX pool liquidity is below the governance minimum")
		}
		if reserve0.Cmp(minimumReserve0) < 0 {
			minimumReserve0.Set(reserve0)
		}
		if reserve1.Cmp(minimumReserve1) < 0 {
			minimumReserve1.Set(reserve1)
		}
	}

	prices := make([]int64, len(samples))
	for index := range samples {
		prices[index] = samples[index].price
	}
	median := medianInt64(prices)
	maximumDeviation := int64(0)
	rejectedBlocks := make([]uint64, 0)
	for index := range samples {
		deviation := relativeDeviationPPM(samples[index].price, median)
		if deviation > maximumDeviation {
			maximumDeviation = deviation
		}
		if deviation > policy.MaximumSingleBlockDeviationPPM {
			samples[index].guardedPrice = median
			rejectedBlocks = append(rejectedBlocks, samples[index].state.BlockNumber)
		}
	}
	if len(rejectedBlocks) > policy.MaximumRejectedBlocks {
		return failedDEXTWAP(asOf, market, last.ChainID, last.Pool, "divergent", false, "too many manipulated DEX blocks in the TWAP window"), errors.New("too many manipulated DEX blocks in the TWAP window")
	}

	weightedTotal := new(big.Int)
	totalNanos := new(big.Int)
	for index := 1; index < len(samples); index++ {
		duration := samples[index].state.BlockTime.Sub(samples[index-1].state.BlockTime)
		if duration <= 0 {
			return failedDEXTWAP(asOf, market, last.ChainID, last.Pool, "divergent", false, "DEX block time ordering is invalid"), errors.New("DEX block time ordering is invalid")
		}
		weight := big.NewInt(duration.Nanoseconds())
		weightedTotal.Add(weightedTotal, new(big.Int).Mul(big.NewInt(samples[index].guardedPrice), weight))
		totalNanos.Add(totalNanos, weight)
	}
	if totalNanos.Sign() <= 0 {
		return failedDEXTWAP(asOf, market, last.ChainID, last.Pool, "unavailable", false, "DEX TWAP has no positive time weight"), errors.New("DEX TWAP has no positive time weight")
	}
	weightedTotal.Div(weightedTotal, totalNanos)
	if !weightedTotal.IsInt64() || weightedTotal.Sign() <= 0 {
		return failedDEXTWAP(asOf, market, last.ChainID, last.Pool, "unavailable", false, "DEX TWAP arithmetic is outside the supported range"), errors.New("DEX TWAP arithmetic is outside the supported range")
	}

	ids, hashes := dexObservationReferences(samples)
	minimumReporters := math.MaxInt
	for _, sample := range samples {
		if sample.reporterCount < minimumReporters {
			minimumReporters = sample.reporterCount
		}
	}
	coverage := durationCoveragePPM(observedWindow, policy.Window)
	confidence := int64(1_000_000 - len(rejectedBlocks)*100_000)
	if coverage < 1_000_000 {
		confidence -= (1_000_000 - coverage) / 2
	}
	if confidence < 0 {
		confidence = 0
	}
	rejected := make([]string, len(rejectedBlocks))
	for index, block := range rejectedBlocks {
		rejected[index] = "dex-block:" + strconv.FormatUint(block, 10)
	}
	lineage := dexTWAPLineage(policy.Version, last, hashes)
	componentTypes := []DataType{DEXPoolState}
	price := Price{
		Schema: SchemaVersion, Market: market, Type: DEXTWAP, Value: weightedTotal.Int64(), Scale: policy.Scale,
		Source: "YNX Oracle manipulation-resistant confirmed multi-block DEX TWAP", Version: policy.Version,
		AsOf: last.BlockTime.UTC(), ProducedAt: asOf,
		Quality: Quality{
			Status: "good", SourceCount: minimumReporters, RequiredSourceCount: policy.RequiredReporters,
			RejectedSources: rejected, SourceLimitation: "single DEX pool venue; must not be the sole liquidation, bridge-release, reserve, or cross-market authority",
			DivergencePPM: maximumDeviation, ConfidencePPM: confidence, CoveragePPM: coverage,
		},
		ObservationIDs: ids, ObservationHash: hashes, LineageHash: lineage,
		Derivation: &PriceDerivation{
			Method: "confirmed_multi_block_guarded_twap", PolicyVersion: policy.Version,
			ComponentTypes: componentTypes, ComponentLineageHashes: append([]string(nil), hashes...),
			ObservationWindowSeconds: int64(observedWindow / time.Second), StartBlock: first.BlockNumber, EndBlock: last.BlockNumber,
			ConfirmationDepth: policy.RequiredConfirmations, ChainID: last.ChainID, Pool: last.Pool,
			ObservationCount: len(samples), ReporterCount: minimumReporters, RejectedBlockNumbers: rejectedBlocks,
			MinimumReserve0: minimumReserve0.String(), MinimumReserve1: minimumReserve1.String(),
		},
	}
	return price, nil
}

func (service *Service) aggregateDEXTWAPAndPersist(market string) (Price, error) {
	now := service.now().UTC()
	providers := service.providerSnapshot()
	observations := service.store.Replay(market, DEXPoolState, now)
	price, err := deriveDEXTWAP(now, market, observations, providers, service.dexTWAP)
	if price.Market != "" && price.LineageHash != "" {
		if _, persistErr := service.store.AppendAggregate(price); persistErr != nil {
			return price, fmt.Errorf("%w: DEX TWAP aggregate event: %v", ErrPersistence, persistErr)
		}
	}
	if err == nil {
		service.mu.Lock()
		service.lastGood[market+"|"+string(DEXTWAP)] = price
		service.mu.Unlock()
	}
	return price, err
}

func (service *Service) DEXTWAPAt(market string, asOf time.Time) (Price, error) {
	if !marketPattern.MatchString(market) || asOf.IsZero() || asOf.After(service.now().Add(service.policy.MaximumFutureSkew)) {
		return Price{}, errInvalid
	}
	return deriveDEXTWAP(asOf.UTC(), market, service.store.Replay(market, DEXPoolState, asOf.UTC()), service.providerSnapshot(), service.dexTWAP)
}

func (service *Service) providerSnapshot() map[string]Provider {
	service.mu.RLock()
	defer service.mu.RUnlock()
	providers := make(map[string]Provider, len(service.providers))
	for id, provider := range service.providers {
		providers[id] = provider
	}
	return providers
}

func failedDEXTWAP(asOf time.Time, market, chainID, pool, status string, stale bool, failure string) Price {
	return Price{
		Schema: SchemaVersion, Market: market, Type: DEXTWAP, Source: "YNX Oracle DEX TWAP unavailable", Version: DEXTWAPPolicyVersion,
		ProducedAt: asOf.UTC(), Quality: Quality{Status: status, Stale: stale, CircuitBreaker: true, Failure: failure, RejectedSources: []string{}},
		Derivation: &PriceDerivation{Method: "confirmed_multi_block_guarded_twap", PolicyVersion: DEXTWAPPolicyVersion, ComponentTypes: []DataType{DEXPoolState}, ChainID: chainID, Pool: pool},
	}
}

func dexPoolIdentity(state PoolState) string {
	return state.ChainID + "|" + state.Pool + "|" + state.Token0 + "|" + state.Token1 + "|" + strconv.Itoa(int(state.Token0Decimals)) + "|" + strconv.Itoa(int(state.Token1Decimals))
}

func samePoolState(left, right PoolState) bool {
	return left.ChainID == right.ChainID && left.Pool == right.Pool && left.Token0 == right.Token0 && left.Token1 == right.Token1 &&
		left.Token0Decimals == right.Token0Decimals && left.Token1Decimals == right.Token1Decimals && left.Reserve0 == right.Reserve0 &&
		left.Reserve1 == right.Reserve1 && left.BlockNumber == right.BlockNumber && left.BlockHash == right.BlockHash &&
		left.ParentBlockHash == right.ParentBlockHash && left.BlockTime.Equal(right.BlockTime)
}

func poolPrice(state PoolState, scale int64) (int64, error) {
	reserve0, ok0 := new(big.Int).SetString(state.Reserve0, 10)
	reserve1, ok1 := new(big.Int).SetString(state.Reserve1, 10)
	if !ok0 || !ok1 || reserve0.Sign() <= 0 || reserve1.Sign() <= 0 || scale <= 0 {
		return 0, errors.New("invalid DEX reserve arithmetic")
	}
	numerator := new(big.Int).Mul(reserve1, pow10(state.Token0Decimals))
	numerator.Mul(numerator, big.NewInt(scale))
	denominator := new(big.Int).Mul(reserve0, pow10(state.Token1Decimals))
	if denominator.Sign() <= 0 {
		return 0, errors.New("invalid DEX reserve denominator")
	}
	numerator.Div(numerator, denominator)
	if !numerator.IsInt64() || numerator.Sign() <= 0 {
		return 0, errors.New("DEX pool price is outside the supported range")
	}
	return numerator.Int64(), nil
}

func pow10(decimals uint8) *big.Int {
	return new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(decimals)), nil)
}

func hasMinimumReserve(reserve *big.Int, decimals uint8, wholeTokens int64) bool {
	minimum := new(big.Int).Mul(big.NewInt(wholeTokens), pow10(decimals))
	return reserve != nil && reserve.Cmp(minimum) >= 0
}

func medianInt64(values []int64) int64 {
	ordered := append([]int64(nil), values...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })
	middle := len(ordered) / 2
	if len(ordered)%2 == 1 {
		return ordered[middle]
	}
	return saturatingAverage(ordered[middle-1], ordered[middle])
}

func saturatingAverage(left, right int64) int64 {
	value := new(big.Int).Add(big.NewInt(left), big.NewInt(right))
	value.Div(value, big.NewInt(2))
	if value.IsInt64() {
		return value.Int64()
	}
	if value.Sign() < 0 {
		return math.MinInt64
	}
	return math.MaxInt64
}

func relativeDeviationPPM(value, reference int64) int64 {
	if reference <= 0 {
		return math.MaxInt64
	}
	difference := new(big.Int).Sub(big.NewInt(value), big.NewInt(reference))
	difference.Abs(difference)
	difference.Mul(difference, big.NewInt(1_000_000))
	difference.Div(difference, big.NewInt(reference))
	if !difference.IsInt64() {
		return math.MaxInt64
	}
	return difference.Int64()
}

func durationCoveragePPM(observed, required time.Duration) int64 {
	if observed <= 0 || required <= 0 {
		return 0
	}
	value := new(big.Int).Mul(big.NewInt(observed.Nanoseconds()), big.NewInt(1_000_000))
	value.Div(value, big.NewInt(required.Nanoseconds()))
	if value.Cmp(big.NewInt(1_000_000)) > 0 {
		return 1_000_000
	}
	if !value.IsInt64() {
		return 0
	}
	return value.Int64()
}

func dexObservationReferences(samples []dexBlockSample) ([]string, []string) {
	type reference struct {
		id   string
		hash string
	}
	byHash := map[string]reference{}
	for _, sample := range samples {
		for _, observation := range sample.observations {
			byHash[observation.Hash] = reference{id: observation.ID, hash: observation.Hash}
		}
	}
	ordered := make([]reference, 0, len(byHash))
	for _, item := range byHash {
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

func dexTWAPLineage(version string, state PoolState, observationHashes []string) string {
	digest := sha256.New()
	digest.Write([]byte(version))
	digest.Write([]byte("\nconfirmed_multi_block_guarded_twap\n"))
	digest.Write([]byte(dexPoolIdentity(state)))
	digest.Write([]byte("\n"))
	for _, hash := range observationHashes {
		digest.Write([]byte(hash))
		digest.Write([]byte("\n"))
	}
	return hex.EncodeToString(digest.Sum(nil))
}
