package oracle

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	SchemaVersion     = "ynx.oracle.v1"
	PolicyVersion     = "weighted-median-mad-v1"
	NormalizerVersion = "observation-normalizer-v1"
	StoreVersion      = 3
	ProductID         = "ynx-oracle-market-data"
	Version           = "0.1.0-testnet"
)

var (
	marketPattern    = regexp.MustCompile(`^[A-Z0-9][A-Z0-9._/-]{2,63}$`)
	providerPattern  = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{2,63}$`)
	reporterPattern  = regexp.MustCompile(`^[a-z0-9][a-z0-9:_-]{2,127}$`)
	blockHashPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
	errInvalid       = errors.New("invalid oracle record")
)

type DataType string

const (
	SpotPrice         DataType = "spot_price"
	IndexPrice        DataType = "index_price"
	MarkPrice         DataType = "mark_price"
	FundingReference  DataType = "funding_reference"
	FX                DataType = "fx"
	StablecoinPrice   DataType = "stablecoin_price"
	StablecoinReserve DataType = "stablecoin_reserve_ratio"
	StablecoinDepeg   DataType = "stablecoin_depeg"
	OHLCV             DataType = "ohlcv"
	Trades            DataType = "trades"
	CLOBOrderBook     DataType = "clob_order_book"
	DEXPoolState      DataType = "dex_pool_state"
	DEXTWAP           DataType = "dex_twap"
	InterestRate      DataType = "interest_rate_candidate"
	DataCorrection    DataType = "data_correction"
	ProviderStatus    DataType = "provider_status"
	HistoricalReplay  DataType = "historical_replay"
)

func (value DataType) Valid() bool {
	switch value {
	case SpotPrice, IndexPrice, MarkPrice, FundingReference, FX, StablecoinPrice,
		StablecoinReserve, StablecoinDepeg, OHLCV, Trades, CLOBOrderBook,
		DEXPoolState, DEXTWAP, InterestRate, DataCorrection, ProviderStatus, HistoricalReplay:
		return true
	default:
		return false
	}
}

func (value DataType) Scalar() bool {
	switch value {
	case SpotPrice, IndexPrice, MarkPrice, FundingReference, FX, StablecoinPrice, StablecoinReserve, StablecoinDepeg, DEXTWAP, InterestRate:
		return true
	default:
		return false
	}
}

func (value DataType) Structured() bool {
	switch value {
	case OHLCV, Trades, CLOBOrderBook, DEXPoolState, ProviderStatus:
		return true
	default:
		return false
	}
}

type Candle struct {
	Open          int64     `json:"open"`
	High          int64     `json:"high"`
	Low           int64     `json:"low"`
	Close         int64     `json:"close"`
	Volume        int64     `json:"volume"`
	IntervalStart time.Time `json:"intervalStart"`
	IntervalEnd   time.Time `json:"intervalEnd"`
}

type TradePoint struct {
	ID     string    `json:"id"`
	Price  int64     `json:"price"`
	Amount int64     `json:"amount"`
	Side   string    `json:"side"`
	At     time.Time `json:"at"`
}

type DepthLevel struct {
	Price  int64 `json:"price"`
	Amount int64 `json:"amount"`
}

type OrderBookSnapshot struct {
	Sequence uint64       `json:"sequence"`
	Bids     []DepthLevel `json:"bids"`
	Asks     []DepthLevel `json:"asks"`
}

type PoolState struct {
	ChainID     string `json:"chainId"`
	Pool        string `json:"pool"`
	Token0      string `json:"token0"`
	Token1      string `json:"token1"`
	Reserve0    string `json:"reserve0"`
	Reserve1    string `json:"reserve1"`
	BlockNumber uint64 `json:"blockNumber"`
	BlockHash   string `json:"blockHash"`
}

type ProviderHealth struct {
	Status        string    `json:"status"`
	LatencyMillis int64     `json:"latencyMillis"`
	LastSuccess   time.Time `json:"lastSuccess,omitempty"`
	Failure       string    `json:"failure,omitempty"`
}

type Provider struct {
	ID                   string    `json:"id"`
	Name                 string    `json:"name"`
	Endpoint             string    `json:"endpoint"`
	APIVersion           string    `json:"apiVersion"`
	AssetMarketCoverage  []string  `json:"assetMarketCoverage"`
	License              string    `json:"license"`
	TermsURL             string    `json:"termsUrl"`
	PermittedStorage     string    `json:"permittedStorage"`
	Authentication       string    `json:"authentication"`
	RateLimit            string    `json:"rateLimit"`
	TimestampSemantics   string    `json:"timestampSemantics"`
	Precision            string    `json:"precision"`
	Timezone             string    `json:"timezone"`
	Region               string    `json:"region"`
	Jurisdiction         string    `json:"jurisdiction"`
	Cost                 string    `json:"cost"`
	Retention            string    `json:"retention"`
	DataRights           string    `json:"dataRights"`
	Fallback             string    `json:"fallback"`
	DecommissionPlan     string    `json:"decommissionPlan"`
	Status               string    `json:"status"`
	LastSuccess          time.Time `json:"lastSuccess,omitempty"`
	ReporterID           string    `json:"reporterId"`
	ReporterPublicKeyHex string    `json:"reporterPublicKeyHex"`
	WeightPPM            int64     `json:"weightPpm"`
	UpdatedAt            time.Time `json:"updatedAt"`
}

func (provider Provider) Validate() error {
	if !providerPattern.MatchString(provider.ID) || strings.TrimSpace(provider.Name) == "" ||
		strings.TrimSpace(provider.Endpoint) == "" || strings.TrimSpace(provider.APIVersion) == "" ||
		len(provider.AssetMarketCoverage) == 0 || strings.TrimSpace(provider.License) == "" ||
		strings.TrimSpace(provider.TermsURL) == "" || strings.TrimSpace(provider.PermittedStorage) == "" ||
		strings.TrimSpace(provider.Authentication) == "" || strings.TrimSpace(provider.RateLimit) == "" ||
		strings.TrimSpace(provider.TimestampSemantics) == "" || strings.TrimSpace(provider.Precision) == "" ||
		strings.TrimSpace(provider.Timezone) == "" || strings.TrimSpace(provider.Region) == "" ||
		strings.TrimSpace(provider.Jurisdiction) == "" || strings.TrimSpace(provider.Cost) == "" ||
		strings.TrimSpace(provider.Retention) == "" || strings.TrimSpace(provider.DataRights) == "" ||
		strings.TrimSpace(provider.Fallback) == "" || strings.TrimSpace(provider.DecommissionPlan) == "" ||
		provider.Status == "" || !reporterPattern.MatchString(provider.ReporterID) ||
		provider.WeightPPM <= 0 || provider.WeightPPM > 1_000_000 || provider.UpdatedAt.IsZero() {
		return fmt.Errorf("%w: incomplete provider registry entry", errInvalid)
	}
	key, err := hex.DecodeString(provider.ReporterPublicKeyHex)
	if err != nil || len(key) != ed25519.PublicKeySize {
		return fmt.Errorf("%w: reporter public key", errInvalid)
	}
	return nil
}

type Observation struct {
	Schema         string             `json:"schema"`
	ID             string             `json:"id"`
	ProviderID     string             `json:"providerId"`
	ReporterID     string             `json:"reporterId"`
	Sequence       uint64             `json:"sequence"`
	NonceDomain    string             `json:"nonceDomain"`
	Market         string             `json:"market"`
	Type           DataType           `json:"type"`
	Value          int64              `json:"value"`
	Scale          int64              `json:"scale"`
	Liquidity      int64              `json:"liquidity,omitempty"`
	Volume24H      int64              `json:"volume24h,omitempty"`
	Candle         *Candle            `json:"candle,omitempty"`
	Trades         []TradePoint       `json:"trades,omitempty"`
	OrderBook      *OrderBookSnapshot `json:"orderBook,omitempty"`
	PoolState      *PoolState         `json:"poolState,omitempty"`
	ProviderHealth *ProviderHealth    `json:"providerHealth,omitempty"`
	ObservedAt     time.Time          `json:"observedAt"`
	ReceivedAt     time.Time          `json:"receivedAt"`
	Source         string             `json:"source"`
	SourceVersion  string             `json:"sourceVersion"`
	SignatureHex   string             `json:"signatureHex"`
	Hash           string             `json:"hash"`
}

type observationSigningPayload struct {
	Schema         string             `json:"schema"`
	ID             string             `json:"id"`
	ProviderID     string             `json:"providerId"`
	ReporterID     string             `json:"reporterId"`
	Sequence       uint64             `json:"sequence"`
	NonceDomain    string             `json:"nonceDomain"`
	Market         string             `json:"market"`
	Type           DataType           `json:"type"`
	Value          int64              `json:"value"`
	Scale          int64              `json:"scale"`
	Liquidity      int64              `json:"liquidity,omitempty"`
	Volume24H      int64              `json:"volume24h,omitempty"`
	Candle         *Candle            `json:"candle,omitempty"`
	Trades         []TradePoint       `json:"trades,omitempty"`
	OrderBook      *OrderBookSnapshot `json:"orderBook,omitempty"`
	PoolState      *PoolState         `json:"poolState,omitempty"`
	ProviderHealth *ProviderHealth    `json:"providerHealth,omitempty"`
	ObservedAt     time.Time          `json:"observedAt"`
	Source         string             `json:"source"`
	SourceVersion  string             `json:"sourceVersion"`
}

func (observation Observation) signingBytes() ([]byte, error) {
	payload := observationSigningPayload{
		Schema: observation.Schema, ID: observation.ID, ProviderID: observation.ProviderID, ReporterID: observation.ReporterID,
		Sequence: observation.Sequence, NonceDomain: observation.NonceDomain, Market: observation.Market, Type: observation.Type,
		Value: observation.Value, Scale: observation.Scale, Liquidity: observation.Liquidity, Volume24H: observation.Volume24H,
		Candle: observation.Candle, Trades: observation.Trades, OrderBook: observation.OrderBook, PoolState: observation.PoolState, ProviderHealth: observation.ProviderHealth,
		ObservedAt: observation.ObservedAt.UTC(), Source: observation.Source, SourceVersion: observation.SourceVersion,
	}
	return json.Marshal(payload)
}

func (observation Observation) CalculatedHash() (string, error) {
	data, err := observation.signingBytes()
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:]), nil
}

func (observation Observation) Verify(provider Provider, nonceDomain string) error {
	if observation.Schema != SchemaVersion || observation.ID == "" || observation.ProviderID != provider.ID ||
		observation.ReporterID != provider.ReporterID || observation.Sequence == 0 ||
		observation.NonceDomain != nonceDomain || !marketPattern.MatchString(observation.Market) ||
		!observation.Type.Valid() || observation.Scale <= 0 ||
		observation.ObservedAt.IsZero() || observation.ReceivedAt.IsZero() ||
		observation.ReceivedAt.Before(observation.ObservedAt) || strings.TrimSpace(observation.Source) == "" ||
		strings.TrimSpace(observation.SourceVersion) == "" {
		return errInvalid
	}
	if err := observation.validatePayload(); err != nil {
		return err
	}
	calculated, err := observation.CalculatedHash()
	if err != nil || calculated != observation.Hash {
		return errors.New("observation hash mismatch")
	}
	signature, err := hex.DecodeString(observation.SignatureHex)
	if err != nil {
		return errors.New("observation signature encoding")
	}
	key, _ := hex.DecodeString(provider.ReporterPublicKeyHex)
	data, _ := observation.signingBytes()
	if !ed25519.Verify(ed25519.PublicKey(key), data, signature) {
		return errors.New("observation signature rejected")
	}
	return nil
}

func (observation Observation) validatePayload() error {
	payloads := 0
	if observation.Candle != nil {
		payloads++
	}
	if len(observation.Trades) != 0 {
		payloads++
	}
	if observation.OrderBook != nil {
		payloads++
	}
	if observation.PoolState != nil {
		payloads++
	}
	if observation.ProviderHealth != nil {
		payloads++
	}
	if observation.Type.Scalar() {
		if observation.Value <= 0 || payloads != 0 {
			return fmt.Errorf("%w: scalar payload", errInvalid)
		}
		return nil
	}
	if !observation.Type.Structured() || observation.Value != 0 || payloads != 1 {
		return fmt.Errorf("%w: structured payload", errInvalid)
	}
	switch observation.Type {
	case OHLCV:
		value := observation.Candle
		if value == nil || value.Open <= 0 || value.High <= 0 || value.Low <= 0 || value.Close <= 0 || value.Volume < 0 || value.High < value.Open || value.High < value.Close || value.High < value.Low || value.Low > value.Open || value.Low > value.Close || value.IntervalStart.IsZero() || !value.IntervalEnd.After(value.IntervalStart) {
			return fmt.Errorf("%w: OHLCV", errInvalid)
		}
	case Trades:
		if len(observation.Trades) == 0 || len(observation.Trades) > 1000 {
			return fmt.Errorf("%w: trade batch", errInvalid)
		}
		previous := time.Time{}
		seen := map[string]struct{}{}
		for _, trade := range observation.Trades {
			if trade.ID == "" || trade.Price <= 0 || trade.Amount <= 0 || (trade.Side != "buy" && trade.Side != "sell") || trade.At.IsZero() || trade.At.Before(previous) {
				return fmt.Errorf("%w: trade", errInvalid)
			}
			if _, exists := seen[trade.ID]; exists {
				return fmt.Errorf("%w: duplicate trade", errInvalid)
			}
			seen[trade.ID], previous = struct{}{}, trade.At
		}
	case CLOBOrderBook:
		book := observation.OrderBook
		if book == nil || book.Sequence == 0 || len(book.Bids) == 0 || len(book.Asks) == 0 || len(book.Bids) > 2000 || len(book.Asks) > 2000 {
			return fmt.Errorf("%w: order book", errInvalid)
		}
		for index, level := range book.Bids {
			if level.Price <= 0 || level.Amount <= 0 || (index > 0 && book.Bids[index-1].Price <= level.Price) {
				return fmt.Errorf("%w: bid levels", errInvalid)
			}
		}
		for index, level := range book.Asks {
			if level.Price <= 0 || level.Amount <= 0 || (index > 0 && book.Asks[index-1].Price >= level.Price) {
				return fmt.Errorf("%w: ask levels", errInvalid)
			}
		}
		if book.Bids[0].Price >= book.Asks[0].Price {
			return fmt.Errorf("%w: crossed order book", errInvalid)
		}
	case DEXPoolState:
		pool := observation.PoolState
		decimal := regexp.MustCompile(`^[0-9]{1,78}$`)
		if pool == nil || pool.ChainID == "" || pool.Pool == "" || pool.Token0 == "" || pool.Token1 == "" || pool.Token0 == pool.Token1 || !decimal.MatchString(pool.Reserve0) || !decimal.MatchString(pool.Reserve1) || pool.Reserve0 == "0" || pool.Reserve1 == "0" || pool.BlockNumber == 0 || !blockHashPattern.MatchString(pool.BlockHash) {
			return fmt.Errorf("%w: DEX pool state", errInvalid)
		}
	case ProviderStatus:
		health := observation.ProviderHealth
		if health == nil || (health.Status != "up" && health.Status != "degraded" && health.Status != "down") || health.LatencyMillis < 0 || (health.Status == "up" && health.LastSuccess.IsZero()) || (health.Status == "down" && strings.TrimSpace(health.Failure) == "") {
			return fmt.Errorf("%w: provider status", errInvalid)
		}
	}
	return nil
}

type Quality struct {
	Status              string   `json:"status"`
	Stale               bool     `json:"stale"`
	SourceCount         int      `json:"sourceCount"`
	RequiredSourceCount int      `json:"requiredSourceCount"`
	RejectedSources     []string `json:"rejectedSources"`
	SourceLimitation    string   `json:"sourceLimitation,omitempty"`
	DivergencePPM       int64    `json:"divergencePpm"`
	ConfidencePPM       int64    `json:"confidencePpm"`
	CoveragePPM         int64    `json:"coveragePpm"`
	CircuitBreaker      bool     `json:"circuitBreaker"`
	Failure             string   `json:"failure,omitempty"`
}

type Price struct {
	Schema          string    `json:"schema"`
	Market          string    `json:"market"`
	Type            DataType  `json:"type"`
	Value           int64     `json:"value"`
	Scale           int64     `json:"scale"`
	Source          string    `json:"source"`
	Version         string    `json:"version"`
	AsOf            time.Time `json:"asOf"`
	ProducedAt      time.Time `json:"producedAt"`
	Quality         Quality   `json:"quality"`
	ObservationIDs  []string  `json:"observationIds"`
	ObservationHash []string  `json:"observationHashes"`
	LineageHash     string    `json:"lineageHash"`
}

type NormalizedEvent struct {
	Schema            string             `json:"schema"`
	ID                string             `json:"id"`
	ObservationID     string             `json:"observationId"`
	CorrectionID      string             `json:"correctionId,omitempty"`
	ProviderID        string             `json:"providerId"`
	Market            string             `json:"market"`
	Type              DataType           `json:"type"`
	Value             int64              `json:"value"`
	Scale             int64              `json:"scale"`
	Liquidity         int64              `json:"liquidity,omitempty"`
	Volume24H         int64              `json:"volume24h,omitempty"`
	Candle            *Candle            `json:"candle,omitempty"`
	Trades            []TradePoint       `json:"trades,omitempty"`
	OrderBook         *OrderBookSnapshot `json:"orderBook,omitempty"`
	PoolState         *PoolState         `json:"poolState,omitempty"`
	ProviderHealth    *ProviderHealth    `json:"providerHealth,omitempty"`
	ObservedAt        time.Time          `json:"observedAt"`
	ReceivedAt        time.Time          `json:"receivedAt"`
	EffectiveAt       time.Time          `json:"effectiveAt,omitzero"`
	Source            string             `json:"source"`
	SourceVersion     string             `json:"sourceVersion"`
	ObservationHash   string             `json:"observationHash"`
	NormalizerVersion string             `json:"normalizerVersion"`
	Hash              string             `json:"hash"`
}

func normalizeObservation(observation Observation, correctionID string, effectiveAt time.Time) NormalizedEvent {
	event := NormalizedEvent{
		Schema: SchemaVersion, ID: "normalized_" + observation.Hash, ObservationID: observation.ID,
		CorrectionID: correctionID, ProviderID: observation.ProviderID, Market: observation.Market,
		Type: observation.Type, Value: observation.Value, Scale: observation.Scale,
		Liquidity: observation.Liquidity, Volume24H: observation.Volume24H,
		Candle: observation.Candle, Trades: append([]TradePoint(nil), observation.Trades...), OrderBook: observation.OrderBook, PoolState: observation.PoolState, ProviderHealth: observation.ProviderHealth,
		ObservedAt: observation.ObservedAt.UTC(), ReceivedAt: observation.ReceivedAt.UTC(),
		EffectiveAt: effectiveAt.UTC(),
		Source:      observation.Source, SourceVersion: observation.SourceVersion,
		ObservationHash: observation.Hash, NormalizerVersion: NormalizerVersion,
	}
	dataEvent := event
	dataEvent.Hash = ""
	data, _ := json.Marshal(dataEvent)
	digest := sha256.Sum256(data)
	event.Hash = hex.EncodeToString(digest[:])
	return event
}

type AggregateEvent struct {
	Schema    string    `json:"schema"`
	ID        string    `json:"id"`
	Price     Price     `json:"price"`
	CreatedAt time.Time `json:"createdAt"`
	Hash      string    `json:"hash"`
}

type ControlEvent struct {
	Schema      string    `json:"schema"`
	ID          string    `json:"id"`
	Action      string    `json:"action"`
	Reason      string    `json:"reason"`
	Actor       string    `json:"actor"`
	AuditID     string    `json:"auditId"`
	EffectiveAt time.Time `json:"effectiveAt"`
	CreatedAt   time.Time `json:"createdAt"`
	Hash        string    `json:"hash"`
}

func (event ControlEvent) calculatedHash() string {
	data, _ := json.Marshal(struct {
		Schema, ID, Action, Reason, Actor, AuditID string
		EffectiveAt, CreatedAt                     time.Time
	}{event.Schema, event.ID, event.Action, event.Reason, event.Actor, event.AuditID, event.EffectiveAt.UTC(), event.CreatedAt.UTC()})
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}

func newAggregateEvent(price Price) AggregateEvent {
	event := AggregateEvent{Schema: SchemaVersion, ID: "aggregate_" + price.LineageHash, Price: price, CreatedAt: price.ProducedAt.UTC()}
	data, _ := json.Marshal(struct {
		Schema, ID string
		Price      Price
		CreatedAt  time.Time
	}{event.Schema, event.ID, event.Price, event.CreatedAt})
	digest := sha256.Sum256(data)
	event.Hash = hex.EncodeToString(digest[:])
	return event
}

func lineage(observations []Observation, policyVersion string) string {
	hashes := make([]string, 0, len(observations)+1)
	for _, observation := range observations {
		hashes = append(hashes, observation.Hash)
	}
	sort.Strings(hashes)
	hashes = append(hashes, policyVersion)
	digest := sha256.Sum256([]byte(strings.Join(hashes, "\n")))
	return hex.EncodeToString(digest[:])
}

type Correction struct {
	Schema      string      `json:"schema"`
	ID          string      `json:"id"`
	OriginalID  string      `json:"originalId"`
	Corrected   Observation `json:"corrected"`
	Reason      string      `json:"reason"`
	EffectiveAt time.Time   `json:"effectiveAt"`
	Actor       string      `json:"actor"`
	AuditID     string      `json:"auditId"`
	CreatedAt   time.Time   `json:"createdAt"`
}
