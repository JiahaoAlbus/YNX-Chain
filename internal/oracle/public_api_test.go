package oracle

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestOperationalPublicEndpointsExposeTruthfulRuntimeState(t *testing.T) {
	now := time.Date(2026, 7, 25, 8, 0, 0, 0, time.UTC)
	reporters := []testReporter{
		reporter(t, "source-a", 1_000_000, now),
		reporter(t, "source-b", 1_000_000, now),
		reporter(t, "source-c", 1_000_000, now),
	}
	service := testService(t, &now, reporters...)
	for index, item := range reporters {
		if _, err := service.Ingest(item.observation(t, 1, 1_000_000+int64(index*100), now.Add(-time.Second))); err != nil {
			t.Fatal(err)
		}
	}
	server, err := NewServer(service, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	previousCommit := BuildCommit
	BuildCommit = "test-commit"
	defer func() { BuildCommit = previousCommit }()

	marketsResponse := requestPublicEndpoint(t, server, "/markets")
	var markets struct {
		Items []MarketStatus `json:"items"`
	}
	if err := json.Unmarshal(marketsResponse.Body.Bytes(), &markets); err != nil {
		t.Fatal(err)
	}
	if len(markets.Items) != 1 || markets.Items[0].Market != "YNXT/YUSD_TEST" || markets.Items[0].AggregateCount != 3 || markets.Items[0].LastQualityStatus != "good" {
		t.Fatalf("markets=%+v", markets.Items)
	}

	historyResponse := requestPublicEndpoint(t, server, "/history?market=YNXT/YUSD_TEST&type=spot_price&limit=10")
	var history struct {
		Items []AggregateEvent `json:"items"`
	}
	if err := json.Unmarshal(historyResponse.Body.Bytes(), &history); err != nil {
		t.Fatal(err)
	}
	if len(history.Items) != 3 || history.Items[len(history.Items)-1].Price.Quality.Status != "good" {
		t.Fatalf("history=%+v", history.Items)
	}

	correctionsResponse := requestPublicEndpoint(t, server, "/corrections?market=YNXT/YUSD_TEST&type=spot_price&limit=10")
	var corrections struct {
		Items []Correction `json:"items"`
	}
	if err := json.Unmarshal(correctionsResponse.Body.Bytes(), &corrections); err != nil {
		t.Fatal(err)
	}
	if len(corrections.Items) != 0 {
		t.Fatalf("unexpected corrections=%+v", corrections.Items)
	}

	statusResponse := requestPublicEndpoint(t, server, "/status")
	var status struct {
		Health    Health         `json:"health"`
		Providers []Provider     `json:"providers"`
		Markets   []MarketStatus `json:"markets"`
	}
	if err := json.Unmarshal(statusResponse.Body.Bytes(), &status); err != nil {
		t.Fatal(err)
	}
	if status.Health.Status != "ok" || status.Health.Degraded || status.Health.Commit != "test-commit" || status.Health.StorageStatus != "ready" || status.Health.LastSuccessfulAggregation.IsZero() || len(status.Providers) != 3 || len(status.Markets) != 1 {
		t.Fatalf("status=%+v", status)
	}

	versionResponse := requestPublicEndpoint(t, server, "/version")
	var version struct {
		Commit                    string            `json:"commit"`
		StartedAt                 time.Time         `json:"startedAt"`
		Dependencies              map[string]string `json:"dependencies"`
		StorageStatus             string            `json:"storageStatus"`
		LastSuccessfulAggregation time.Time         `json:"lastSuccessfulAggregation"`
		Degraded                  bool              `json:"degraded"`
	}
	if err := json.Unmarshal(versionResponse.Body.Bytes(), &version); err != nil {
		t.Fatal(err)
	}
	if version.Commit != "test-commit" || version.StartedAt.IsZero() || version.Dependencies["storage"] != "ready" || version.StorageStatus != "ready" || version.LastSuccessfulAggregation.IsZero() || version.Degraded {
		t.Fatalf("version=%+v", version)
	}

	providersResponse := requestPublicEndpoint(t, server, "/providers")
	if providersResponse.Code != http.StatusOK {
		t.Fatalf("providers status=%d", providersResponse.Code)
	}

	invalid := httptest.NewRecorder()
	server.ServeHTTP(invalid, httptest.NewRequest(http.MethodGet, "/history?market=YNXT/YUSD_TEST&type=spot_price&limit=0", nil))
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("invalid history status=%d body=%s", invalid.Code, invalid.Body.String())
	}
}

func requestPublicEndpoint(t *testing.T, server *Server, path string) *httptest.ResponseRecorder {
	t.Helper()
	response := httptest.NewRecorder()
	server.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
	if response.Code != http.StatusOK {
		t.Fatalf("path=%s status=%d body=%s", path, response.Code, response.Body.String())
	}
	return response
}
