package oracle

import (
	"errors"
	"fmt"
	"time"
)

func (service *Service) aggregateDerivedAndPersist(market string, kind DataType) (Price, error) {
	now := service.now().UTC()
	service.mu.RLock()
	providers := make(map[string]Provider, len(service.providers))
	for key, value := range service.providers {
		providers[key] = value
	}
	service.mu.RUnlock()

	price, err := service.computeDerivedPrice(now, market, kind, providers)
	if price.Market != "" && price.Type.Valid() && price.LineageHash != "" {
		if _, persistErr := service.store.AppendAggregate(price); persistErr != nil {
			return price, fmt.Errorf("%w: derived aggregate event: %v", ErrPersistence, persistErr)
		}
	}
	if err == nil {
		key := market + "|" + string(kind)
		service.mu.Lock()
		service.lastGood[key] = price
		service.mu.Unlock()
	}
	return price, err
}

func (service *Service) computeDerivedPrice(now time.Time, market string, kind DataType, providers map[string]Provider) (Price, error) {
	switch kind {
	case IndexPrice:
		spot, err := service.aggregateComponent(now, market, SpotPrice, providers)
		if err != nil {
			return failedDerivedPrice(now, market, IndexPrice, service.derivatives.Version, "spot index input unavailable: "+err.Error()), err
		}
		return deriveIndexPrice(now, spot, service.derivatives)
	case FundingReference:
		premium, premiumErr := service.aggregateComponent(now, market, PremiumReference, providers)
		basis, basisErr := service.aggregateComponent(now, market, BasisReference, providers)
		if premiumErr != nil {
			return failedDerivedPrice(now, market, FundingReference, service.derivatives.Version, "premium reference unavailable: "+premiumErr.Error()), premiumErr
		}
		if basisErr != nil {
			return failedDerivedPrice(now, market, FundingReference, service.derivatives.Version, "basis reference unavailable: "+basisErr.Error()), basisErr
		}
		return deriveFundingReference(now, premium, basis, service.derivatives)
	case MarkPrice:
		index, indexErr := service.computeDerivedPrice(now, market, IndexPrice, providers)
		funding, fundingErr := service.computeDerivedPrice(now, market, FundingReference, providers)
		if indexErr != nil {
			return failedDerivedPrice(now, market, MarkPrice, service.derivatives.Version, "index price unavailable: "+indexErr.Error()), indexErr
		}
		if fundingErr != nil {
			return failedDerivedPrice(now, market, MarkPrice, service.derivatives.Version, "funding reference unavailable: "+fundingErr.Error()), fundingErr
		}
		return deriveMarkPrice(now, index, funding, service.derivatives)
	default:
		return Price{}, errors.New("unsupported derived price type")
	}
}

func (service *Service) aggregateComponent(now time.Time, market string, kind DataType, providers map[string]Provider) (Price, error) {
	observations := service.store.Replay(market, kind, now.Add(service.policy.MaximumFutureSkew))
	return Aggregate(now, observations, providers, service.policy)
}

func derivedDependents(kind DataType) []DataType {
	switch kind {
	case SpotPrice:
		return []DataType{IndexPrice, MarkPrice}
	case PremiumReference, BasisReference:
		return []DataType{FundingReference, MarkPrice}
	case DEXPoolState:
		return []DataType{DEXTWAP}
	case ReserveEvidence:
		return []DataType{StablecoinReserve}
	default:
		return nil
	}
}
