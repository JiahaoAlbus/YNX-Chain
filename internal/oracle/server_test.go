package oracle

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testService(t *testing.T, now *time.Time, reporters ...testReporter) *Service {
	t.Helper()
	store, err := OpenStore(filepath.Join(t.TempDir(), "state.json"), []byte(strings.Repeat("k", 32)), "ynx-oracle-testnet-v1")
	if err != nil {
		t.Fatal(err)
	}
	providers := make([]Provider, len(reporters))
	for index, item := range reporters {
		providers[index] = item.provider
	}
	service, err := NewService(store, providers, DefaultPolicy(), func() time.Time { return *now })
	if err != nil {
		t.Fatal(err)
	}
	return service
}

func TestPriceAPIRequiresQualityAndReturnsLastGoodAsStale(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	reporters := []testReporter{reporter(t, "source-a", 1_000_000, now), reporter(t, "source-b", 1_000_000, now), reporter(t, "source-c", 1_000_000, now)}
	service := testService(t, &now, reporters...)
	for index, item := range reporters {
		if _, err := service.Ingest(item.observation(t, 1, 1_000_000+int64(index*100), now.Add(-time.Second))); err != nil {
			t.Fatal(err)
		}
	}
	server, _ := NewServer(service, slog.New(slog.NewTextHandler(io.Discard, nil)))
	request := httptest.NewRequest(http.MethodGet, "/prices?market=YNXT/YUSD_TEST&type=spot_price", nil)
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var price Price
	if err := json.Unmarshal(response.Body.Bytes(), &price); err != nil {
		t.Fatal(err)
	}
	if price.Source == "" || price.Version == "" || price.AsOf.IsZero() || price.Quality.ConfidencePPM <= 0 || price.Quality.CoveragePPM != 1_000_000 || price.Quality.Stale {
		t.Fatalf("missing consumer safety fields: %+v", price)
	}
	now = now.Add(time.Minute)
	response = httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("stale status=%d body=%s", response.Code, response.Body.String())
	}
	var failure struct {
		Price   Price  `json:"price"`
		Error   string `json:"error"`
		ErrorID string `json:"errorId"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &failure); err != nil {
		t.Fatal(err)
	}
	if !failure.Price.Quality.Stale || !failure.Price.Quality.CircuitBreaker || failure.Price.Quality.Status != "last_good_stale" || failure.Error == "" || failure.ErrorID == "" {
		t.Fatalf("last-good state not explicit: %+v", failure)
	}
}

func TestObservationAPIRejectsUnknownFieldsAndUnregisteredProvider(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	registered := reporter(t, "source-a", 1_000_000, now)
	service := testService(t, &now, registered)
	server, _ := NewServer(service, slog.New(slog.NewTextHandler(io.Discard, nil)))

	request := httptest.NewRequest(http.MethodPost, "/internal/v1/observations", bytes.NewBufferString(`{"unknown":true}`))
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("unknown field status=%d", response.Code)
	}

	unregistered := reporter(t, "source-b", 1_000_000, now).observation(t, 1, 1_000_000, now)
	unregistered.ReceivedAt = now.Add(24 * time.Hour)
	body, _ := json.Marshal(unregistered)
	request = httptest.NewRequest(http.MethodPost, "/internal/v1/observations", bytes.NewReader(body))
	response = httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized || strings.Contains(response.Body.String(), "source-b") {
		t.Fatalf("unregistered provider response=%d %s", response.Code, response.Body.String())
	}
}

func TestIngestionAssignsAuthoritativeReceiptTime(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	registered := reporter(t, "source-a", 1_000_000, now)
	service := testService(t, &now, registered)
	observation := registered.observation(t, 1, 1_000_000, now.Add(-time.Second))
	observation.ReceivedAt = now.Add(24 * time.Hour)
	if _, err := service.Ingest(observation); err != nil {
		t.Fatal(err)
	}
	stored := service.store.Snapshot().Observations
	if len(stored) != 1 || !stored[0].ReceivedAt.Equal(now) {
		t.Fatalf("provider receipt time trusted: %+v", stored)
	}
}

func TestProviderIngestionRateLimitFailsClosed(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	registered := reporter(t, "source-a", 1_000_000, now)
	service := testService(t, &now, registered)
	for sequence := uint64(1); sequence <= 201; sequence++ {
		observation := registered.observation(t, sequence, 1_000_000, now)
		observation.ID = fmt.Sprintf("source-a-%d", sequence)
		data, _ := observation.signingBytes()
		observation.SignatureHex = signHex(registered.private, data)
		observation.Hash, _ = observation.CalculatedHash()
		_, err := service.Ingest(observation)
		if sequence <= 200 && err != nil {
			t.Fatalf("sequence=%d err=%v", sequence, err)
		}
		if sequence == 201 && (err == nil || !strings.Contains(err.Error(), "rate limit")) {
			t.Fatalf("rate limit err=%v", err)
		}
	}
}

func TestHealthTruthfullyReportsSourceLimitation(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	service := testService(t, &now, reporter(t, "source-a", 1_000_000, now))
	server, _ := NewServer(service, slog.New(slog.NewTextHandler(io.Discard, nil)))
	response := httptest.NewRecorder()
	server.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/health", nil))
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("health status=%d body=%s", response.Code, response.Body.String())
	}
	var health Health
	if err := json.Unmarshal(response.Body.Bytes(), &health); err != nil {
		t.Fatal(err)
	}
	if health.Status != "degraded" || health.SourceLimitation == "" || health.ProviderCount != 1 || health.MinimumSources != 3 {
		t.Fatalf("false health: %+v", health)
	}
}
