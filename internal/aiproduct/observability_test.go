package aiproduct

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestObservabilityAddsBoundedRequestIDAndStructuredRouteLog(t *testing.T) {
	gateway := newGatewayFixture(t, true)
	defer gateway.Close()
	store, err := NewStore(t.TempDir()+"/state.json", bytes.Repeat([]byte{7}, 32))
	if err != nil {
		t.Fatal(err)
	}
	var logs bytes.Buffer
	server, err := NewServer(Config{
		GatewayURL: gateway.URL, GatewayKey: testGatewayKey, ExactWalletCallback: FormalCallback,
		ProviderName: "fixture", GenerationTimeout: time.Second,
		Logger: slog.New(slog.NewJSONHandler(&logs, nil)),
	}, store, nil)
	if err != nil {
		t.Fatal(err)
	}
	product := httptest.NewServer(server.Handler())
	defer product.Close()

	request, _ := http.NewRequest(http.MethodGet, product.URL+"/healthz?secret=must-not-log", nil)
	request.Header.Set(requestIDHeader, "client-request-123")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if got := response.Header.Get(requestIDHeader); got != "client-request-123" {
		t.Fatalf("request ID=%q", got)
	}
	if !strings.Contains(logs.String(), `"route":"GET /healthz"`) || !strings.Contains(logs.String(), `"requestId":"client-request-123"`) {
		t.Fatalf("missing structured route/request ID log: %s", logs.String())
	}
	if strings.Contains(logs.String(), "must-not-log") {
		t.Fatalf("query content leaked to logs: %s", logs.String())
	}
}

func TestObservabilityRejectsUnsafeRequestIDAndExportsLowCardinalityMetrics(t *testing.T) {
	gateway := newGatewayFixture(t, true)
	defer gateway.Close()
	_, product := testProduct(t, gateway.URL)
	defer product.Close()

	request, _ := http.NewRequest(http.MethodGet, product.URL+"/healthz", nil)
	request.Header.Set(requestIDHeader, "bad")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	requestID := response.Header.Get(requestIDHeader)
	if requestID == "" || requestID == "bad" || !safeRequestID.MatchString(requestID) {
		t.Fatalf("unsafe request ID was not replaced: %q", requestID)
	}

	metrics, err := http.Get(product.URL + "/metrics")
	if err != nil {
		t.Fatal(err)
	}
	defer metrics.Body.Close()
	var body bytes.Buffer
	_, _ = body.ReadFrom(metrics.Body)
	text := body.String()
	for _, metric := range []string{"ynx_ai_http_requests_total", "ynx_ai_http_requests_active", "ynx_ai_http_responses_total", "ynx_ai_http_request_duration_seconds_total"} {
		if !strings.Contains(text, metric) {
			t.Fatalf("metrics missing %s: %s", metric, text)
		}
	}
	if strings.Contains(text, "/healthz") || strings.Contains(text, requestID) {
		t.Fatalf("metrics contain high-cardinality request data: %s", text)
	}
}

func TestReadinessReportsGatewayTruthWithoutClaimingCentralIntegration(t *testing.T) {
	for _, available := range []bool{true, false} {
		name := "unavailable"
		if available {
			name = "available"
		}
		t.Run(name, func(t *testing.T) {
			gateway := newGatewayFixture(t, available)
			defer gateway.Close()
			_, product := testProduct(t, gateway.URL)
			defer product.Close()

			response, err := http.Get(product.URL + "/readyz")
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			wantStatus := http.StatusOK
			if !available {
				wantStatus = http.StatusServiceUnavailable
			}
			if response.StatusCode != wantStatus {
				t.Fatalf("status=%d want=%d", response.StatusCode, wantStatus)
			}
			var payload struct {
				OK                bool   `json:"ok"`
				GatewayReachable  bool   `json:"gatewayReachable"`
				IntegratedCentral bool   `json:"integratedCentral"`
				GenerationLive    bool   `json:"generationLive"`
				RequestID         string `json:"requestId"`
			}
			if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
				t.Fatal(err)
			}
			if payload.OK != available || payload.GatewayReachable != available || payload.IntegratedCentral || payload.GenerationLive || payload.RequestID == "" {
				t.Fatalf("untruthful readiness payload: %+v", payload)
			}
		})
	}
}
