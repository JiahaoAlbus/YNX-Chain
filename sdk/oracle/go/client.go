package oracleclient

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const SchemaVersion = "ynx.oracle.v1"

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
	Type            string    `json:"type"`
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

func (price Price) Validate(now time.Time, maximumAge time.Duration, minimumConfidencePPM int64) error {
	if price.Schema != SchemaVersion || price.Market == "" || price.Type == "" || price.Value <= 0 || price.Scale <= 0 ||
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
	return nil
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
