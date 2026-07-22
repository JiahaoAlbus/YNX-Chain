package oracle

import (
	"errors"
	"fmt"
	"sort"
	"sync"
	"time"
)

var (
	ErrEmergencyPause        = errors.New("oracle publication is emergency paused")
	ErrProviderRateLimit     = errors.New("provider rate limit exceeded")
	ErrProviderNotRegistered = errors.New("provider is not registered")
	ErrPersistence           = errors.New("oracle persistence failed")
)

type Service struct {
	mu        sync.RWMutex
	store     *Store
	providers map[string]Provider
	policy    Policy
	now       func() time.Time
	lastGood  map[string]Price
	rate      map[string]rateBucket
}

type rateBucket struct {
	tokens  float64
	updated time.Time
}

func NewService(store *Store, providers []Provider, policy Policy, now func() time.Time) (*Service, error) {
	if store == nil {
		return nil, errors.New("oracle store required")
	}
	if now == nil {
		now = time.Now
	}
	registry := make(map[string]Provider, len(providers))
	for _, provider := range providers {
		if err := provider.Validate(); err != nil {
			return nil, err
		}
		if _, exists := registry[provider.ID]; exists {
			return nil, errors.New("duplicate provider ID")
		}
		registry[provider.ID] = provider
	}
	if len(registry) == 0 {
		return nil, errors.New("at least one explicit provider registry entry required")
	}
	if policy.ProviderUpdatesPerSecond <= 0 || policy.ProviderBurst < 1 {
		return nil, errors.New("provider rate policy is invalid")
	}
	return &Service{store: store, providers: registry, policy: policy, now: now, lastGood: map[string]Price{}, rate: map[string]rateBucket{}}, nil
}

func (service *Service) Ingest(observation Observation) (bool, error) {
	now := service.now().UTC()
	observation.ReceivedAt = now
	service.mu.Lock()
	provider, exists := service.providers[observation.ProviderID]
	if exists {
		bucket := service.rate[observation.ProviderID]
		if bucket.updated.IsZero() {
			bucket.tokens = service.policy.ProviderBurst
			bucket.updated = now
		}
		if now.After(bucket.updated) {
			bucket.tokens += now.Sub(bucket.updated).Seconds() * service.policy.ProviderUpdatesPerSecond
			if bucket.tokens > service.policy.ProviderBurst {
				bucket.tokens = service.policy.ProviderBurst
			}
			bucket.updated = now
		}
		if bucket.tokens < 1 {
			service.mu.Unlock()
			return false, ErrProviderRateLimit
		}
		bucket.tokens--
		service.rate[observation.ProviderID] = bucket
	}
	service.mu.Unlock()
	if !exists {
		return false, ErrProviderNotRegistered
	}
	created, err := service.store.Ingest(observation, provider)
	if err != nil || !created {
		return created, err
	}
	_, aggregateErr := service.aggregateAndPersist(observation.Market, observation.Type)
	if errors.Is(aggregateErr, ErrPersistence) {
		return true, aggregateErr
	}
	return true, nil
}

func (service *Service) Correct(correction Correction) error {
	correction.Corrected.ReceivedAt = service.now().UTC()
	service.mu.RLock()
	provider, exists := service.providers[correction.Corrected.ProviderID]
	service.mu.RUnlock()
	if !exists {
		return ErrProviderNotRegistered
	}
	if err := service.store.Correct(correction, provider); err != nil {
		return err
	}
	_, aggregateErr := service.aggregateAndPersist(correction.Corrected.Market, correction.Corrected.Type)
	if errors.Is(aggregateErr, ErrPersistence) {
		return aggregateErr
	}
	return nil
}

func (service *Service) aggregateAndPersist(market string, kind DataType) (Price, error) {
	now := service.now().UTC()
	observations := service.store.Replay(market, kind, now.Add(service.policy.MaximumFutureSkew))
	service.mu.RLock()
	providers := make(map[string]Provider, len(service.providers))
	for key, value := range service.providers {
		providers[key] = value
	}
	service.mu.RUnlock()
	price, err := Aggregate(now, observations, providers, service.policy)
	if price.Market != "" && price.Type.Valid() && price.LineageHash != "" {
		if _, persistErr := service.store.AppendAggregate(price); persistErr != nil {
			return price, fmt.Errorf("%w: aggregate event: %v", ErrPersistence, persistErr)
		}
	}
	key := market + "|" + string(kind)
	service.mu.Lock()
	if err == nil {
		service.lastGood[key] = price
	}
	service.mu.Unlock()
	return price, err
}

func (service *Service) Price(market string, kind DataType) (Price, error) {
	now := service.now().UTC()
	if !marketPattern.MatchString(market) || !kind.Scalar() {
		return Price{}, errInvalid
	}
	if paused, reason, _ := service.store.ControlState(now); paused {
		previous, exists := service.store.LatestGood(market, kind)
		if !exists {
			previous = failedPrice(now, service.policy, ErrEmergencyPause.Error())
			previous.Market, previous.Type = market, kind
		} else {
			previous.ProducedAt = now
		}
		previous.Quality.Status = "emergency_pause"
		previous.Quality.Stale = true
		previous.Quality.CircuitBreaker = true
		previous.Quality.Failure = ErrEmergencyPause.Error()
		previous.Quality.SourceLimitation = reason
		return previous, ErrEmergencyPause
	}
	price, err := service.aggregateAndPersist(market, kind)
	key := market + "|" + string(kind)
	service.mu.Lock()
	defer service.mu.Unlock()
	if err == nil {
		service.lastGood[key] = price
		return price, nil
	}
	previous, exists := service.lastGood[key]
	if !exists {
		previous, exists = service.store.LatestGood(market, kind)
	}
	if exists {
		previous.ProducedAt = now
		previous.Quality.Status = "last_good_stale"
		previous.Quality.Stale = true
		previous.Quality.CircuitBreaker = true
		previous.Quality.Failure = err.Error()
		previous.Quality.SourceLimitation = "last known good value is informational only and unsafe for settlement"
		return previous, err
	}
	return price, err
}

func (service *Service) ApplyControl(event ControlEvent) error {
	return service.store.ApplyControl(event)
}

func (service *Service) Providers() []Provider {
	service.mu.RLock()
	defer service.mu.RUnlock()
	result := make([]Provider, 0, len(service.providers))
	for _, provider := range service.providers {
		result = append(result, provider)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return result
}

func (service *Service) Replay(market string, kind DataType, asOf time.Time) ([]Observation, error) {
	if !marketPattern.MatchString(market) || !kind.Valid() || asOf.IsZero() || asOf.After(service.now().Add(service.policy.MaximumFutureSkew)) {
		return nil, errInvalid
	}
	return service.store.Replay(market, kind, asOf), nil
}

type MarketDataFeed struct {
	Schema      string            `json:"schema"`
	Market      string            `json:"market"`
	Type        DataType          `json:"type"`
	Source      string            `json:"source"`
	Version     string            `json:"version"`
	AsOf        time.Time         `json:"asOf"`
	ProducedAt  time.Time         `json:"producedAt"`
	SourceCount int               `json:"sourceCount"`
	CoveragePPM int64             `json:"coveragePpm"`
	Stale       bool              `json:"stale"`
	Failure     string            `json:"failure,omitempty"`
	Items       []NormalizedEvent `json:"items"`
}

func (service *Service) LiveData(market string, kind DataType, limit int) (MarketDataFeed, error) {
	now := service.now().UTC()
	feed := MarketDataFeed{Schema: SchemaVersion, Market: market, Type: kind, Source: "YNX Oracle normalized signed provider events", Version: NormalizerVersion, ProducedAt: now, Items: []NormalizedEvent{}}
	if !marketPattern.MatchString(market) || !kind.Structured() || limit < 1 || limit > 1000 {
		feed.Failure = "invalid request"
		return feed, errInvalid
	}
	feed.Items = service.store.Normalized(market, kind, now, limit)
	providers := map[string]struct{}{}
	for _, event := range feed.Items {
		providers[event.ProviderID] = struct{}{}
		if event.ObservedAt.After(feed.AsOf) {
			feed.AsOf = event.ObservedAt
		}
	}
	feed.SourceCount = len(providers)
	if feed.SourceCount > 0 {
		feed.CoveragePPM = 1_000_000
	}
	if len(feed.Items) == 0 {
		feed.Stale = true
		feed.Failure = "no normalized events"
		return feed, errors.New(feed.Failure)
	}
	if now.Sub(feed.AsOf) > service.policy.MaximumAge {
		feed.Stale = true
		feed.Failure = "normalized feed is stale"
		return feed, errors.New(feed.Failure)
	}
	return feed, nil
}

type Health struct {
	Status              string    `json:"status"`
	ProductID           string    `json:"productId"`
	Version             string    `json:"version"`
	Schema              string    `json:"schema"`
	PolicyVersion       string    `json:"policyVersion"`
	NormalizerVersion   string    `json:"normalizerVersion"`
	StoreVersion        int       `json:"storeVersion"`
	ProviderCount       int       `json:"providerCount"`
	ActiveProviderCount int       `json:"activeProviderCount"`
	MinimumSources      int       `json:"minimumSources"`
	SourceLimitation    string    `json:"sourceLimitation,omitempty"`
	AsOf                time.Time `json:"asOf"`
	EmergencyPaused     bool      `json:"emergencyPaused"`
	PauseReason         string    `json:"pauseReason,omitempty"`
	PauseAuditID        string    `json:"pauseAuditId,omitempty"`
}

func (service *Service) Health() Health {
	providers := service.Providers()
	active := 0
	for _, provider := range providers {
		if provider.Status == "active" {
			active++
		}
	}
	status, limitation := "ok", ""
	if active < service.policy.MinimumSources {
		status = "degraded"
		limitation = "fewer than the policy-required active independent providers"
	}
	now := service.now().UTC()
	paused, reason, auditID := service.store.ControlState(now)
	if paused {
		status = "paused"
		limitation = "authoritative publication is disabled by an audited emergency control event"
	}
	return Health{Status: status, ProductID: ProductID, Version: Version, Schema: SchemaVersion, PolicyVersion: service.policy.Version, NormalizerVersion: NormalizerVersion, StoreVersion: StoreVersion,
		ProviderCount: len(providers), ActiveProviderCount: active, MinimumSources: service.policy.MinimumSources,
		SourceLimitation: limitation, AsOf: now, EmergencyPaused: paused, PauseReason: reason, PauseAuditID: auditID}
}
