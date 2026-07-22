package payproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestRequestErrorIDsAndStructuredLogsAreCorrelatedAndRedacted(t *testing.T) {
	now := time.Date(2026, 7, 22, 7, 0, 0, 0, time.UTC)
	service, _ := testService(t, &fakePay{}, func() time.Time { return now })
	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, nil))
	handler := NewServerWithLogger(service, logger).Handler()

	health := httptest.NewRequest(http.MethodGet, "https://merchant.invalid/health", nil)
	health.Header.Set("X-Request-ID", "client_request_123")
	healthResponse := httptest.NewRecorder()
	handler.ServeHTTP(healthResponse, health)
	if healthResponse.Code != http.StatusOK || healthResponse.Header().Get("X-Request-ID") != "client_request_123" {
		t.Fatalf("valid request ID was not preserved: status=%d headers=%v", healthResponse.Code, healthResponse.Header())
	}
	if len(healthResponse.Header().Get("X-Trace-ID")) != 32 {
		t.Fatalf("trace ID is missing: %v", healthResponse.Header())
	}
	var healthLog map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(logs.Bytes()), &healthLog); err != nil {
		t.Fatal(err)
	}
	if healthLog["event"] != "http.request" || healthLog["request_id"] != "client_request_123" || healthLog["trace_id"] != healthResponse.Header().Get("X-Trace-ID") || healthLog["route"] != "GET /health" || healthLog["status"] != float64(http.StatusOK) {
		t.Fatalf("structured request log is incomplete: %+v", healthLog)
	}

	logs.Reset()
	request := httptest.NewRequest(http.MethodGet, "https://merchant.invalid/v1/merchant/state", nil)
	request.Header.Set("X-Request-ID", "invalid request id")
	request.Header.Set("Authorization", "Bearer secret-that-must-not-be-logged")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	requestID, errorID := response.Header().Get("X-Request-ID"), response.Header().Get("X-Error-ID")
	if response.Code != http.StatusUnauthorized || !strings.HasPrefix(requestID, "req_") || !strings.HasPrefix(errorID, "err_") {
		t.Fatalf("correlation headers missing: status=%d request=%q error=%q", response.Code, requestID, errorID)
	}
	var body map[string]string
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["requestId"] != requestID || body["errorId"] != errorID || body["code"] != "unauthorized" {
		t.Fatalf("error response is not correlated: %+v", body)
	}
	if strings.Contains(logs.String(), "secret-that-must-not-be-logged") || strings.Contains(logs.String(), "Authorization") {
		t.Fatalf("structured log leaked authorization material: %s", logs.String())
	}
	var errorLog map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(logs.Bytes()), &errorLog); err != nil {
		t.Fatal(err)
	}
	if errorLog["request_id"] != requestID || errorLog["error_id"] != errorID || errorLog["status"] != float64(http.StatusUnauthorized) {
		t.Fatalf("error log correlation is incomplete: %+v", errorLog)
	}
	for _, header := range []string{"Content-Security-Policy", "Permissions-Policy", "Cross-Origin-Resource-Policy", "X-Content-Type-Options"} {
		if response.Header().Get(header) == "" {
			t.Fatalf("security header %s is missing", header)
		}
	}
}

func TestOutboundPayRequestsPropagateRequestAndTraceCorrelation(t *testing.T) {
	var requestID, traceparent string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID = r.Header.Get("X-Request-ID")
		traceparent = r.Header.Get("traceparent")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}))
	defer upstream.Close()
	client, err := NewHTTPPayAPI(upstream.URL, "server-side-test-key")
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.WithValue(context.Background(), requestIDContextKey, "request_trace_123")
	ctx = context.WithValue(ctx, traceIDContextKey, strings.Repeat("a", 32))
	if _, err := client.Invoice(ctx, "invoice_trace_123"); err != nil {
		t.Fatal(err)
	}
	if requestID != "request_trace_123" || !traceparentRE.MatchString(traceparent) || !strings.Contains(traceparent, strings.Repeat("a", 32)) {
		t.Fatalf("outbound correlation was not propagated: request=%q traceparent=%q", requestID, traceparent)
	}
}

func TestPublicErrorsDoNotExposeProviderBodiesOrServerPaths(t *testing.T) {
	for _, internal := range []string{
		"central Pay API rejected request (500): stack /srv/private token=secret",
		"read pay product store: open /private/state.json: permission denied",
		"unexpected stack trace at /srv/merchant/service.go",
	} {
		response := httptest.NewRecorder()
		respond(response, http.StatusOK, nil, errors.New(internal))
		if strings.Contains(response.Body.String(), "/srv/") || strings.Contains(response.Body.String(), "/private/") || strings.Contains(response.Body.String(), "token=secret") || strings.Contains(response.Body.String(), "service.go") {
			t.Fatalf("public error leaked internal detail: %s", response.Body.String())
		}
		var body map[string]string
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || body["errorId"] == "" || body["error"] == "" {
			t.Fatalf("sanitized error is not supportable: %+v %v", body, err)
		}
	}
}

func TestDomainAuditEntriesHaveStableAuditIDs(t *testing.T) {
	service, _ := testService(t, &fakePay{}, time.Now)
	merchant, _ := onboard(t, service)
	state, err := service.SnapshotForMerchant(merchant.ID)
	if err != nil || len(state.Audit) == 0 {
		t.Fatalf("domain audit trail is missing: %+v %v", state.Audit, err)
	}
	for _, entry := range state.Audit {
		if !strings.HasPrefix(entry.ID, "aud_") || entry.Action == "" || entry.Outcome == "" || entry.At.IsZero() {
			t.Fatalf("audit entry is not supportable: %+v", entry)
		}
	}
}

func TestRuntimeMetricsFailClosedAndExposeOnlyBoundedDirectObservations(t *testing.T) {
	now := time.Date(2026, 7, 22, 8, 0, 0, 0, time.UTC)
	service, _ := testService(t, &fakePay{}, func() time.Time { return now })
	server := NewServer(service)
	handler := server.Handler()

	unconfigured := httptest.NewRequest(http.MethodGet, "https://merchant.invalid/internal/metrics", nil)
	unconfigured.Header.Set("X-YNX-Monitor-Key", strings.Repeat("x", 32))
	unconfiguredResponse := httptest.NewRecorder()
	handler.ServeHTTP(unconfiguredResponse, unconfigured)
	if unconfiguredResponse.Code != http.StatusUnauthorized {
		t.Fatalf("unconfigured metrics endpoint did not fail closed: %d", unconfiguredResponse.Code)
	}

	service.monitorKey = "monitor-key-that-is-long-enough"
	for range 2 {
		request := httptest.NewRequest(http.MethodGet, "https://merchant.invalid/health?credential=must-not-appear", nil)
		request.Header.Set("Authorization", "Bearer must-not-appear")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("health request failed: %d", response.Code)
		}
	}

	denied := httptest.NewRequest(http.MethodGet, "https://merchant.invalid/internal/metrics", nil)
	denied.Header.Set("X-YNX-Monitor-Key", "wrong-key-that-is-long-enough")
	deniedResponse := httptest.NewRecorder()
	handler.ServeHTTP(deniedResponse, denied)
	if deniedResponse.Code != http.StatusUnauthorized {
		t.Fatalf("invalid monitor key was accepted: %d", deniedResponse.Code)
	}

	request := httptest.NewRequest(http.MethodGet, "https://merchant.invalid/internal/metrics", nil)
	request.Header.Set("X-YNX-Monitor-Key", service.monitorKey)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("metrics request failed: %d %s", response.Code, response.Body.String())
	}
	var snapshot RuntimeMetricsSnapshot
	if err := json.Unmarshal(response.Body.Bytes(), &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.SchemaVersion != 1 || snapshot.Source != "direct-process-observation" || !snapshot.AsOf.Equal(now) {
		t.Fatalf("metrics provenance is incomplete: %+v", snapshot)
	}
	counts := map[string]uint64{}
	for _, metric := range snapshot.Requests {
		counts[metric.Method+" "+metric.Route+" "+http.StatusText(metric.Status)] = metric.Count
		if metric.Route != "GET /health" && metric.Route != "GET /internal/metrics" {
			t.Fatalf("unexpected unbounded route label: %+v", metric)
		}
	}
	if counts["GET GET /health OK"] != 2 || counts["GET GET /internal/metrics Unauthorized"] != 2 {
		t.Fatalf("direct request counts are incorrect: %+v", counts)
	}
	encoded := response.Body.String()
	for _, secret := range []string{"must-not-appear", service.monitorKey, "credential="} {
		if strings.Contains(encoded, secret) {
			t.Fatalf("metrics leaked sensitive or high-cardinality data %q: %s", secret, encoded)
		}
	}
}
