package oracle

import (
	"bytes"
	"encoding/json"
	"errors"
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

func TestPublicCORSIsExactAndNeverCoversIngestion(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	item := reporter(t, "source-a", 1_000_000, now)
	server, err := NewServer(testService(t, &now, item), slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	if err := server.SetPublicOrigin("https://oracle.ynx.network/path"); err == nil {
		t.Fatal("origin with path accepted")
	}
	if err := server.SetPublicOrigin("https://oracle.ynx.network"); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	request.Header.Set("Origin", "https://oracle.ynx.network")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if value := response.Header().Get("Access-Control-Allow-Origin"); value != "https://oracle.ynx.network" {
		t.Fatalf("public CORS=%q", value)
	}
	request = httptest.NewRequest(http.MethodPost, "/internal/v1/observations", strings.NewReader("{}"))
	request.Header.Set("Origin", "https://oracle.ynx.network")
	response = httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if value := response.Header().Get("Access-Control-Allow-Origin"); value != "" {
		t.Fatalf("ingestion CORS=%q", value)
	}
}

func TestInactiveProviderCannotIngest(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	item := reporter(t, "source-a", 1_000_000, now)
	item.provider.Status = "legal_approval_required"
	service := testService(t, &now, item)
	if _, err := service.Ingest(item.observation(t, 1, 1_000_000, now)); !errors.Is(err, ErrProviderInactive) {
		t.Fatalf("inactive provider err=%v", err)
	}
}

func TestAggregatesAreDurableAndLastGoodSurvivesServiceRestart(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	reporters := []testReporter{reporter(t, "source-a", 1_000_000, now), reporter(t, "source-b", 1_000_000, now), reporter(t, "source-c", 1_000_000, now)}
	service := testService(t, &now, reporters...)
	for index, item := range reporters {
		if _, err := service.Ingest(item.observation(t, 1, 1_000_000+int64(index*100), now.Add(-time.Second))); err != nil {
			t.Fatal(err)
		}
	}
	state := service.store.Snapshot()
	if len(state.NormalizedEvents) != 3 || len(state.AggregateEvents) != 3 || state.AggregateEvents[2].Price.Quality.Status != "good" {
		t.Fatalf("durable pipeline incomplete: normalized=%d aggregates=%+v", len(state.NormalizedEvents), state.AggregateEvents)
	}
	restarted, err := NewService(service.store, []Provider{reporters[0].provider, reporters[1].provider, reporters[2].provider}, DefaultPolicy(), func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(time.Minute)
	price, err := restarted.Price("YNXT/YUSD_TEST", SpotPrice)
	if err == nil || price.Quality.Status != "last_good_stale" || !price.Quality.Stale || !price.Quality.CircuitBreaker {
		t.Fatalf("restart lost last-good fallback: price=%+v err=%v", price, err)
	}
}

func TestEmergencyPauseBlocksPublicationButNotIngestion(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	reporters := []testReporter{reporter(t, "source-a", 1_000_000, now), reporter(t, "source-b", 1_000_000, now), reporter(t, "source-c", 1_000_000, now)}
	service := testService(t, &now, reporters...)
	for index, item := range reporters {
		if _, err := service.Ingest(item.observation(t, 1, 1_000_000+int64(index*100), now.Add(-time.Second))); err != nil {
			t.Fatal(err)
		}
	}
	pause := ControlEvent{Schema: SchemaVersion, ID: "control-pause-1", Action: "pause", Reason: "provider collusion investigation", Actor: "oracle-governance", AuditID: "audit-pause-1", EffectiveAt: now, CreatedAt: now}
	pause.Hash = pause.calculatedHash()
	if err := service.ApplyControl(pause); err != nil {
		t.Fatal(err)
	}
	price, err := service.Price("YNXT/YUSD_TEST", SpotPrice)
	if !errors.Is(err, ErrEmergencyPause) || price.Quality.Status != "emergency_pause" || !price.Quality.Stale || !price.Quality.CircuitBreaker {
		t.Fatalf("paused price=%+v err=%v", price, err)
	}
	health := service.Health()
	if health.Status != "paused" || !health.EmergencyPaused || health.PauseAuditID != pause.AuditID {
		t.Fatalf("paused health=%+v", health)
	}
	observation := reporters[0].observation(t, 2, 1_000_050, now)
	observation.ID = "source-a-during-pause"
	data, _ := observation.signingBytes()
	observation.SignatureHex = signHex(reporters[0].private, data)
	observation.Hash, _ = observation.CalculatedHash()
	if created, err := service.Ingest(observation); err != nil || !created {
		t.Fatalf("diagnostic ingestion blocked: created=%v err=%v", created, err)
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

func TestIngestionRateLimitUses429AndInternalErrorsAreRedacted(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	registered := reporter(t, "source-a", 1_000_000, now)
	service := testService(t, &now, registered)
	service.rate[registered.provider.ID] = rateBucket{tokens: 0, updated: now}
	server, _ := NewServer(service, slog.New(slog.NewTextHandler(io.Discard, nil)))
	observation := registered.observation(t, 1, 1_000_000, now)
	body, _ := json.Marshal(observation)
	response := httptest.NewRecorder()
	server.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/internal/v1/observations", bytes.NewReader(body)))
	if response.Code != http.StatusTooManyRequests || !strings.Contains(response.Body.String(), "provider rate limit exceeded") {
		t.Fatalf("rate response=%d %s", response.Code, response.Body.String())
	}
	redacted := publicError(fmt.Errorf("%w: write /private/operator/state", ErrPersistence))
	if redacted != "internal persistence failure" || strings.Contains(redacted, "/private/") {
		t.Fatalf("persistence leak: %q", redacted)
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

func TestTraceCorrelationAndInternalMetricsAreSeparated(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	service := testService(t, &now, reporter(t, "source-a", 1_000_000, now))
	server, _ := NewServer(service, slog.New(slog.NewTextHandler(io.Discard, nil)))
	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	request.Header.Set("traceparent", "00-11111111111111111111111111111111-2222222222222222-01")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	traceParent := response.Header().Get("traceparent")
	if !strings.HasPrefix(traceParent, "00-11111111111111111111111111111111-") || len(traceParent) != 55 {
		t.Fatalf("trace correlation missing: %q", traceParent)
	}
	publicMetrics := httptest.NewRecorder()
	server.ServeHTTP(publicMetrics, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	if publicMetrics.Code != http.StatusNotFound {
		t.Fatalf("metrics exposed on public mux: %d", publicMetrics.Code)
	}
	metrics := httptest.NewRecorder()
	server.MetricsHandler().ServeHTTP(metrics, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	if metrics.Code != http.StatusOK || !strings.Contains(metrics.Body.String(), "ynx_oracle_http_requests_total 2") || !strings.Contains(metrics.Body.String(), "ynx_oracle_http_request_errors_total 2") {
		t.Fatalf("metrics=%d %s", metrics.Code, metrics.Body.String())
	}
}

func TestStructuredLiveFeedIsNormalizedAndExplicitlyStale(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	source := reporter(t, "source-a", 1_000_000, now)
	service := testService(t, &now, source)
	observation := structuredBase(source, 1, CLOBOrderBook, now.Add(-time.Second))
	observation.OrderBook = &OrderBookSnapshot{Sequence: 10, Bids: []DepthLevel{{Price: 100, Amount: 5}}, Asks: []DepthLevel{{Price: 101, Amount: 6}}}
	observation = source.signed(t, observation)
	if created, err := service.Ingest(observation); err != nil || !created {
		t.Fatalf("created=%v err=%v", created, err)
	}
	state := service.store.Snapshot()
	if len(state.NormalizedEvents) != 1 || len(state.AggregateEvents) != 0 {
		t.Fatalf("structured pipeline state=%+v", state)
	}
	server, _ := NewServer(service, slog.New(slog.NewTextHandler(io.Discard, nil)))
	request := httptest.NewRequest(http.MethodGet, "/v1/market-data?market=BTC/USD&type=clob_order_book&limit=10", nil)
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var feed MarketDataFeed
	if err := json.Unmarshal(response.Body.Bytes(), &feed); err != nil {
		t.Fatal(err)
	}
	if feed.Source == "" || feed.Version != NormalizerVersion || feed.AsOf.IsZero() || feed.CoveragePPM != 1_000_000 || feed.Stale || len(feed.Items) != 1 || feed.Items[0].OrderBook == nil {
		t.Fatalf("feed=%+v", feed)
	}
	now = now.Add(time.Minute)
	response = httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), `"stale":true`) {
		t.Fatalf("stale=%d %s", response.Code, response.Body.String())
	}
}
