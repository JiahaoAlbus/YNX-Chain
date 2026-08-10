package oracleclient

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	SchemaVersion                  = "ynx.oracle.v1"
	DerivativesPolicyVersion       = "index-funding-mark-v1"
	DEXTWAPPolicyVersion           = "dex-twap-v1"
	StablecoinReservePolicyVersion = "stablecoin-reserve-v1"
	ReserveAttestationVersion      = "reserve-attestation-ed25519-v1"
)

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

type Attestor struct {
	ID                 string    `json:"id"`
	Name               string    `json:"name"`
	PublicKeyHex       string    `json:"publicKeyHex"`
	Status             string    `json:"status"`
	AssuranceStandards []string  `json:"assuranceStandards"`
	Jurisdictions      []string  `json:"jurisdictions"`
	ValidFrom          time.Time `json:"validFrom"`
	ValidUntil         time.Time `json:"validUntil"`
	UpdatedAt          time.Time `json:"updatedAt"`
	RevocationReason   string    `json:"revocationReason,omitempty"`
}

type Price struct {
	Schema          string           `json:"schema"`
	Market          string           `json:"market"`
	Type            string           `json:"type"`
	Value           int64            `json:"value"`
	Scale           int64            `json:"scale"`
	Source          string           `json:"source"`
	Version         string           `json:"version"`
	AsOf            time.Time        `json:"asOf"`
	ProducedAt      time.Time        `json:"producedAt"`
	Quality         Quality          `json:"quality"`
	ObservationIDs  []string         `json:"observationIds"`
	ObservationHash []string         `json:"observationHashes"`
	LineageHash     string           `json:"lineageHash"`
	Derivation      *PriceDerivation `json:"derivation,omitempty"`
}

type PriceDerivation struct {
	Method                   string    `json:"method"`
	PolicyVersion            string    `json:"policyVersion"`
	ComponentTypes           []string  `json:"componentTypes"`
	ComponentLineageHashes   []string  `json:"componentLineageHashes"`
	FundingWindowSeconds     int64     `json:"fundingWindowSeconds,omitempty"`
	PremiumPPM               int64     `json:"premiumPpm,omitempty"`
	BasisPPM                 int64     `json:"basisPpm,omitempty"`
	RawAdjustmentPPM         int64     `json:"rawAdjustmentPpm,omitempty"`
	AppliedAdjustmentPPM     int64     `json:"appliedAdjustmentPpm,omitempty"`
	ClampPPM                 int64     `json:"clampPpm,omitempty"`
	Clamped                  bool      `json:"clamped"`
	ObservationWindowSeconds int64     `json:"observationWindowSeconds,omitempty"`
	StartBlock               uint64    `json:"startBlock,omitempty"`
	EndBlock                 uint64    `json:"endBlock,omitempty"`
	ConfirmationDepth        uint64    `json:"confirmationDepth,omitempty"`
	ChainID                  string    `json:"chainId,omitempty"`
	Pool                     string    `json:"pool,omitempty"`
	ObservationCount         int       `json:"observationCount,omitempty"`
	ReporterCount            int       `json:"reporterCount,omitempty"`
	RejectedBlockNumbers     []uint64  `json:"rejectedBlockNumbers,omitempty"`
	MinimumReserve0          string    `json:"minimumReserve0,omitempty"`
	MinimumReserve1          string    `json:"minimumReserve1,omitempty"`
	AttestationVersion       string    `json:"attestationVersion,omitempty"`
	EvidenceID               string    `json:"evidenceId,omitempty"`
	IssuerID                 string    `json:"issuerId,omitempty"`
	AttestorID               string    `json:"attestorId,omitempty"`
	AssuranceStandard        string    `json:"assuranceStandard,omitempty"`
	Jurisdiction             string    `json:"jurisdiction,omitempty"`
	Unit                     string    `json:"unit,omitempty"`
	ReserveAssets            string    `json:"reserveAssets,omitempty"`
	OutstandingClaims        string    `json:"outstandingClaims,omitempty"`
	ReportingPeriodEnd       time.Time `json:"reportingPeriodEnd,omitempty"`
	PublishedAt              time.Time `json:"publishedAt,omitempty"`
	ExpiresAt                time.Time `json:"expiresAt,omitempty"`
	DocumentHash             string    `json:"documentHash,omitempty"`
	Conclusion               string    `json:"conclusion,omitempty"`
	AttestationSignatureHex  string    `json:"attestationSignatureHex,omitempty"`
}

func (price Price) Validate(now time.Time, maximumAge time.Duration, minimumConfidencePPM int64) error {
	if price.Schema != SchemaVersion || price.Market == "" || !validPriceValue(price.Type, price.Value) || price.Scale <= 0 ||
		price.Source == "" || price.Version == "" || price.AsOf.IsZero() || price.ProducedAt.IsZero() || len(price.ObservationIDs) == 0 ||
		len(price.ObservationIDs) != len(price.ObservationHash) {
		return errors.New("oracle response is incomplete")
	}
	lineage, err := hex.DecodeString(price.LineageHash)
	if err != nil || len(lineage) != 32 {
		return errors.New("oracle lineage is invalid")
	}
	if maximumAge <= 0 || price.AsOf.After(now.Add(2*time.Second)) || now.Sub(price.AsOf) > maximumAge {
		return errors.New("oracle response is stale or future-dated")
	}
	if price.Quality.Stale || price.Quality.CircuitBreaker || price.Quality.Status != "good" || price.Quality.Failure != "" {
		return errors.New("oracle quality is unsafe")
	}
	if price.Quality.RequiredSourceCount < 1 || price.Quality.SourceCount < price.Quality.RequiredSourceCount ||
		price.Quality.ConfidencePPM < minimumConfidencePPM || price.Quality.ConfidencePPM > 1_000_000 ||
		price.Quality.CoveragePPM < 0 || price.Quality.CoveragePPM > 1_000_000 || price.Quality.DivergencePPM < 0 {
		return errors.New("oracle coverage or confidence is unsafe")
	}
	for _, hash := range price.ObservationHash {
		decoded, err := hex.DecodeString(hash)
		if err != nil || len(decoded) != 32 {
			return errors.New("oracle observation hash is invalid")
		}
	}
	if err := price.validateDerivation(); err != nil {
		return err
	}
	return nil
}

func validPriceValue(kind string, value int64) bool {
	switch kind {
	case "funding_reference", "premium_reference", "basis_reference", "interest_rate_candidate":
		return true
	case "stablecoin_depeg":
		return value == 0 || value == 1
	case "stablecoin_reserve_ratio":
		return value >= 0
	case "spot_price", "index_price", "mark_price", "fx", "stablecoin_price", "dex_twap":
		return value > 0
	default:
		return false
	}
}

func (price Price) validateDerivation() error {
	derived := price.Type == "index_price" || price.Type == "funding_reference" || price.Type == "mark_price" || price.Type == "dex_twap" || price.Type == "stablecoin_reserve_ratio"
	if !derived {
		if price.Derivation != nil {
			return errors.New("direct oracle value contains unexpected derivation metadata")
		}
		return nil
	}
	value := price.Derivation
	if value == nil || value.Method == "" || value.PolicyVersion != price.Version || len(value.ComponentTypes) == 0 || len(value.ComponentLineageHashes) == 0 {
		return errors.New("derived oracle value is missing its versioned derivation")
	}
	expectedPolicy := DerivativesPolicyVersion
	if price.Type == "dex_twap" {
		expectedPolicy = DEXTWAPPolicyVersion
	} else if price.Type == "stablecoin_reserve_ratio" {
		expectedPolicy = StablecoinReservePolicyVersion
	}
	if value.PolicyVersion != expectedPolicy {
		return errors.New("derived oracle policy version is unsupported")
	}
	for _, hash := range value.ComponentLineageHashes {
		decoded, err := hex.DecodeString(hash)
		if err != nil || len(decoded) != 32 {
			return errors.New("derived oracle component lineage is invalid")
		}
	}
	if value.Clamped {
		return errors.New("clamped derived oracle value is unsafe")
	}
	switch price.Type {
	case "index_price":
		if len(value.ComponentTypes) != 1 || len(value.ComponentLineageHashes) != 1 || value.ComponentTypes[0] != "spot_price" || value.Method != "liquidity_weighted_median_spot_index" {
			return errors.New("index price derivation is invalid")
		}
	case "funding_reference":
		if len(value.ComponentTypes) != 2 || len(value.ComponentLineageHashes) != 2 || value.ComponentTypes[0] != "premium_reference" || value.ComponentTypes[1] != "basis_reference" ||
			value.Method != "premium_plus_basis_with_governance_clamp" || value.FundingWindowSeconds <= 0 || value.ClampPPM <= 0 || value.ClampPPM > 1_000_000 ||
			value.RawAdjustmentPPM != value.AppliedAdjustmentPPM || value.AppliedAdjustmentPPM > value.ClampPPM || value.AppliedAdjustmentPPM < -value.ClampPPM ||
			value.AppliedAdjustmentPPM != price.Value || price.Scale != 1_000_000 {
			return errors.New("funding reference derivation is invalid")
		}
	case "mark_price":
		if len(value.ComponentTypes) != 2 || len(value.ComponentLineageHashes) != 2 || value.ComponentTypes[0] != "index_price" || value.ComponentTypes[1] != "funding_reference" ||
			value.Method != "index_times_one_plus_funding_reference" || value.FundingWindowSeconds <= 0 || value.ClampPPM <= 0 || value.ClampPPM > 1_000_000 ||
			value.RawAdjustmentPPM != value.AppliedAdjustmentPPM || value.AppliedAdjustmentPPM > value.ClampPPM || value.AppliedAdjustmentPPM < -value.ClampPPM {
			return errors.New("mark price derivation is invalid")
		}
	case "dex_twap":
		if len(value.ComponentTypes) != 1 || value.ComponentTypes[0] != "dex_pool_state" || value.Method != "confirmed_multi_block_guarded_twap" ||
			value.ObservationWindowSeconds <= 0 || value.StartBlock == 0 || value.EndBlock < value.StartBlock || value.ConfirmationDepth == 0 ||
			value.ChainID == "" || value.Pool == "" || value.ObservationCount < 5 || value.ReporterCount < 3 ||
			!decimalString(value.MinimumReserve0) || !decimalString(value.MinimumReserve1) ||
			len(value.ComponentLineageHashes) != len(price.ObservationHash) {
			return errors.New("DEX TWAP derivation is invalid")
		}
		for index, hash := range value.ComponentLineageHashes {
			if hash != price.ObservationHash[index] {
				return errors.New("DEX TWAP component lineage does not match observations")
			}
		}
		for index, block := range value.RejectedBlockNumbers {
			if block < value.StartBlock || block > value.EndBlock || (index > 0 && value.RejectedBlockNumbers[index-1] >= block) {
				return errors.New("DEX TWAP rejected block metadata is invalid")
			}
		}
	case "stablecoin_reserve_ratio":
		documentHash, hashErr := hex.DecodeString(value.DocumentHash)
		attestationSignature, signatureErr := hex.DecodeString(value.AttestationSignatureHex)
		if len(value.ComponentTypes) != 1 || len(value.ComponentLineageHashes) != 1 ||
			value.ComponentTypes[0] != "stablecoin_reserve_evidence" ||
			value.ComponentLineageHashes[0] != price.ObservationHash[0] ||
			value.Method != "reserve_assets_divided_by_outstanding_claims" ||
			value.AttestationVersion != ReserveAttestationVersion ||
			value.EvidenceID == "" || value.IssuerID == "" || value.AttestorID == "" || value.IssuerID == value.AttestorID ||
			value.AssuranceStandard == "" || value.Jurisdiction == "" || value.Unit == "" ||
			!decimalString(value.ReserveAssets) || !decimalString(value.OutstandingClaims) ||
			value.ReportingPeriodEnd.IsZero() || value.PublishedAt.Before(value.ReportingPeriodEnd) ||
			!value.ExpiresAt.After(value.PublishedAt) || value.Conclusion != "unmodified" ||
			hashErr != nil || len(documentHash) != 32 || signatureErr != nil || len(attestationSignature) != 64 ||
			price.Scale != 1_000_000 {
			return errors.New("stablecoin reserve derivation is invalid")
		}
		assets, _ := new(big.Int).SetString(value.ReserveAssets, 10)
		claims, _ := new(big.Int).SetString(value.OutstandingClaims, 10)
		expected := new(big.Int).Mul(assets, big.NewInt(price.Scale))
		expected.Div(expected, claims)
		if !expected.IsInt64() || expected.Int64() != price.Value {
			return errors.New("stablecoin reserve ratio does not match evidence")
		}
	}
	return nil
}

func decimalString(value string) bool {
	if value == "" {
		return false
	}
	nonZero := false
	for _, character := range value {
		if character < '0' || character > '9' {
			return false
		}
		if character != '0' {
			nonZero = true
		}
	}
	return nonZero
}

type reserveAttestationPayload struct {
	AttestationVersion string    `json:"attestationVersion"`
	EvidenceID         string    `json:"evidenceId"`
	IssuerID           string    `json:"issuerId"`
	AttestorID         string    `json:"attestorId"`
	AssuranceStandard  string    `json:"assuranceStandard"`
	Jurisdiction       string    `json:"jurisdiction"`
	Unit               string    `json:"unit"`
	ReserveAssets      string    `json:"reserveAssets"`
	OutstandingClaims  string    `json:"outstandingClaims"`
	ReportingPeriodEnd time.Time `json:"reportingPeriodEnd"`
	PublishedAt        time.Time `json:"publishedAt"`
	ExpiresAt          time.Time `json:"expiresAt"`
	DocumentHash       string    `json:"documentHash"`
	Conclusion         string    `json:"conclusion"`
}

func (price Price) VerifyReserveAttestation(attestor Attestor) error {
	if price.Type != "stablecoin_reserve_ratio" || price.Derivation == nil {
		return errors.New("price is not an evidence-derived stablecoin reserve ratio")
	}
	value := price.Derivation
	if err := price.validateDerivation(); err != nil {
		return err
	}
	if attestor.Status != "active" || attestor.ID != value.AttestorID ||
		value.PublishedAt.Before(attestor.ValidFrom) || value.PublishedAt.After(attestor.ValidUntil) ||
		!containsExact(attestor.AssuranceStandards, value.AssuranceStandard) ||
		!containsExact(attestor.Jurisdictions, value.Jurisdiction) {
		return errors.New("reserve attestation is outside accepted attestor authority")
	}
	key, keyErr := hex.DecodeString(attestor.PublicKeyHex)
	signature, signatureErr := hex.DecodeString(value.AttestationSignatureHex)
	if keyErr != nil || len(key) != ed25519.PublicKeySize || signatureErr != nil || len(signature) != ed25519.SignatureSize {
		return errors.New("reserve attestation key or signature encoding is invalid")
	}
	payload, err := json.Marshal(reserveAttestationPayload{
		AttestationVersion: value.AttestationVersion,
		EvidenceID:         value.EvidenceID, IssuerID: value.IssuerID, AttestorID: value.AttestorID,
		AssuranceStandard: value.AssuranceStandard, Jurisdiction: value.Jurisdiction, Unit: value.Unit,
		ReserveAssets: value.ReserveAssets, OutstandingClaims: value.OutstandingClaims,
		ReportingPeriodEnd: value.ReportingPeriodEnd.UTC(), PublishedAt: value.PublishedAt.UTC(),
		ExpiresAt: value.ExpiresAt.UTC(), DocumentHash: value.DocumentHash, Conclusion: value.Conclusion,
	})
	if err != nil || !ed25519.Verify(ed25519.PublicKey(key), payload, signature) {
		return errors.New("reserve attestation signature rejected")
	}
	return nil
}

func containsExact(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

// ValidateFor binds intrinsic price quality to the exact consumer request and
// accepted aggregation policy. Consumers should prefer this method over
// Validate whenever the requested market/type are known.
func (price Price) ValidateFor(requestedMarket, requestedType, expectedVersion string, now time.Time, maximumAge time.Duration, minimumConfidencePPM, minimumCoveragePPM int64) error {
	if requestedMarket == "" || requestedType == "" || expectedVersion == "" ||
		price.Market != requestedMarket || price.Type != requestedType || price.Version != expectedVersion {
		return errors.New("oracle response does not match the consumer request or policy")
	}
	if minimumCoveragePPM < 0 || minimumCoveragePPM > 1_000_000 {
		return errors.New("oracle consumer coverage policy is invalid")
	}
	if err := price.Validate(now, maximumAge, minimumConfidencePPM); err != nil {
		return err
	}
	if price.Quality.CoveragePPM < minimumCoveragePPM {
		return errors.New("oracle coverage is below consumer policy")
	}
	return nil
}

type Client struct {
	baseURL *url.URL
	http    *http.Client
}

func New(baseURL string, client *http.Client) (*Client, error) {
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return nil, errors.New("invalid Oracle base URL")
	}
	if parsed.Scheme == "http" {
		host := parsed.Hostname()
		ip := net.ParseIP(host)
		if host != "localhost" && (ip == nil || !ip.IsLoopback()) {
			return nil, errors.New("plain HTTP is restricted to loopback")
		}
	}
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	if client.Timeout <= 0 {
		return nil, errors.New("Oracle HTTP client requires an overall timeout")
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	return &Client{baseURL: parsed, http: client}, nil
}

func (client *Client) Price(ctx context.Context, market, kind string) (Price, error) {
	endpoint := *client.baseURL
	endpoint.Path += "/prices"
	query := endpoint.Query()
	query.Set("market", market)
	query.Set("type", kind)
	endpoint.RawQuery = query.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return Price{}, err
	}
	request.Header.Set("Accept", "application/json")
	response, err := client.http.Do(request)
	if err != nil {
		return Price{}, err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return Price{}, err
	}
	if response.StatusCode != http.StatusOK {
		return Price{}, fmt.Errorf("Oracle unavailable: HTTP %d", response.StatusCode)
	}
	var price Price
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&price); err != nil {
		return Price{}, errors.New("invalid Oracle response schema")
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return Price{}, errors.New("invalid Oracle response framing")
	}
	return price, nil
}
