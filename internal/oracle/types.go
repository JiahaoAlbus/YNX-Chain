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
	SchemaVersion = "ynx.oracle.v1"
	PolicyVersion = "weighted-median-mad-v1"
	ProductID     = "ynx-oracle-market-data"
	Version       = "0.1.0-testnet"
)

var (
	marketPattern   = regexp.MustCompile(`^[A-Z0-9][A-Z0-9._/-]{2,63}$`)
	providerPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{2,63}$`)
	reporterPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9:_-]{2,127}$`)
	errInvalid      = errors.New("invalid oracle record")
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
	Schema        string    `json:"schema"`
	ID            string    `json:"id"`
	ProviderID    string    `json:"providerId"`
	ReporterID    string    `json:"reporterId"`
	Sequence      uint64    `json:"sequence"`
	NonceDomain   string    `json:"nonceDomain"`
	Market        string    `json:"market"`
	Type          DataType  `json:"type"`
	Value         int64     `json:"value"`
	Scale         int64     `json:"scale"`
	Liquidity     int64     `json:"liquidity,omitempty"`
	Volume24H     int64     `json:"volume24h,omitempty"`
	ObservedAt    time.Time `json:"observedAt"`
	ReceivedAt    time.Time `json:"receivedAt"`
	Source        string    `json:"source"`
	SourceVersion string    `json:"sourceVersion"`
	SignatureHex  string    `json:"signatureHex"`
	Hash          string    `json:"hash"`
}

type observationSigningPayload struct {
	Schema        string    `json:"schema"`
	ID            string    `json:"id"`
	ProviderID    string    `json:"providerId"`
	ReporterID    string    `json:"reporterId"`
	Sequence      uint64    `json:"sequence"`
	NonceDomain   string    `json:"nonceDomain"`
	Market        string    `json:"market"`
	Type          DataType  `json:"type"`
	Value         int64     `json:"value"`
	Scale         int64     `json:"scale"`
	Liquidity     int64     `json:"liquidity,omitempty"`
	Volume24H     int64     `json:"volume24h,omitempty"`
	ObservedAt    time.Time `json:"observedAt"`
	Source        string    `json:"source"`
	SourceVersion string    `json:"sourceVersion"`
}

func (observation Observation) signingBytes() ([]byte, error) {
	payload := observationSigningPayload{
		observation.Schema, observation.ID, observation.ProviderID, observation.ReporterID,
		observation.Sequence, observation.NonceDomain, observation.Market, observation.Type,
		observation.Value, observation.Scale, observation.Liquidity, observation.Volume24H,
		observation.ObservedAt.UTC(), observation.Source,
		observation.SourceVersion,
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
		!observation.Type.Valid() || observation.Value <= 0 || observation.Scale <= 0 ||
		observation.ObservedAt.IsZero() || observation.ReceivedAt.IsZero() ||
		observation.ReceivedAt.Before(observation.ObservedAt) || strings.TrimSpace(observation.Source) == "" ||
		strings.TrimSpace(observation.SourceVersion) == "" {
		return errInvalid
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
