package payproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

func TestObservedHandlerLivenessReadinessAndVersion(t *testing.T) {
	now := time.Date(2026, 7, 27, 15, 55, 0, 0, time.UTC)
	pay := &fakePay{now: func() time.Time { return now }}
	service, _ := testService(t, pay, func() time.Time { return now })
	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, nil))
	build := buildinfo.Info{Commit: "observability-source", Release: "1.5.0-local", BuildTime: "2026-07-27T15:55:00+01:00"}
	server := httptest.NewServer(NewServerWithLogger(service, build, logger).ObservedHandler())
	defer server.Close()

	response, err := http.Get(server.URL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("liveness status=%d", response.StatusCode)
	}
	var liveness map[string]any
	if err := json.NewDecoder(response.Body).Decode(&liveness); err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if liveness["ok"] != true || liveness["status"] != "live" {
		t.Fatalf("unexpected liveness: %+v", liveness)
	}

	response, err = http.Get(server.URL + "/ready")
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(response.Body)
		t.Fatalf("readiness status=%d body=%s", response.StatusCode, body)
	}
	_ = response.Body.Close()

	response, err = http.Get(server.URL + "/version")
	if err != nil {
		t.Fatal(err)
	}
	var version struct {
		Build buildinfo.Info `json:"build"`
	}
	if err := json.NewDecoder(response.Body).Decode(&version); err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if version.Build != build {
		t.Fatalf("build mismatch: got %+v want %+v", version.Build, build)
	}

	pay.mu.Lock()
	pay.healthErr = errors.New("central unavailable")
	pay.mu.Unlock()
	response, err = http.Get(server.URL + "/health/ready")
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusServiceUnavailable {
		body, _ := io.ReadAll(response.Body)
		t.Fatalf("degraded readiness status=%d body=%s", response.StatusCode, body)
	}
	_ = response.Body.Close()
	response, err = http.Get(server.URL + "/health/live")
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("liveness followed dependency failure: %d", response.StatusCode)
	}
	_ = response.Body.Close()
}

func TestObservedHandlerCorrelationMetricsAndRedaction(t *testing.T) {
	now := time.Date(2026, 7, 27, 16, 0, 0, 0, time.UTC)
	pay := &fakePay{now: func() time.Time { return now }}
	service, _ := testService(t, pay, func() time.Time { return now })
	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, nil))
	build := buildinfo.Info{Commit: "metrics-source", Release: "1.5.0-local", BuildTime: "2026-07-27T16:00:00+01:00"}
	server := httptest.NewServer(NewServerWithLogger(service, build, logger).ObservedHandler())
	defer server.Close()

	response, err := http.Get(server.URL + "/ready")
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("readiness status=%d", response.StatusCode)
	}

	requestID := "client-request-123456"
	traceID := strings.Repeat("a", 32)
	privatePayload := "do-not-log-payload"
	privateQuery := "do-not-log-query"
	req, err := http.NewRequest(http.MethodPost, server.URL+"/v1/merchants/onboard?q="+privateQuery, strings.NewReader(`{"private":"`+privatePayload+`"}`))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(requestIDHeader, requestID)
	req.Header.Set(traceIDHeader, traceID)
	response, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusUnauthorized {
		body, _ := io.ReadAll(response.Body)
		t.Fatalf("expected unauthorized, got %d body=%s", response.StatusCode, body)
	}
	var errorResponse map[string]any
	if err := json.NewDecoder(response.Body).Decode(&errorResponse); err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.Header.Get(requestIDHeader) != requestID || response.Header.Get(traceIDHeader) != traceID {
		t.Fatalf("correlation headers mismatch: request=%q trace=%q", response.Header.Get(requestIDHeader), response.Header.Get(traceIDHeader))
	}
	errorID := response.Header.Get(errorIDHeader)
	if len(errorID) != 32 || errorResponse["errorId"] != errorID || errorResponse["requestId"] != requestID || errorResponse["traceId"] != traceID {
		t.Fatalf("correlated error response incomplete: headers=%v body=%+v", response.Header, errorResponse)
	}

	response, err = http.Get(server.URL + "/v1/invoices/inv-sensitive-123?q=" + privateQuery)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()

	response, err = http.Get(server.URL + "/metrics")
	if err != nil {
		t.Fatal(err)
	}
	metrics, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	metricsText := string(metrics)
	for _, expected := range []string{
		`ynx_pay_http_requests_total{method="POST",route="/v1/merchants/onboard",status="401"} 1`,
		`route="/v1/invoices/{id}"`,
		`ynx_pay_dependency_ready{dependency="central_pay",required="true",configured="true",status="ready"} 1`,
		`ynx_pay_build_info{commit="metrics-source",release="1.5.0-local",build_time="2026-07-27T16:00:00+01:00"} 1`,
	} {
		if !strings.Contains(metricsText, expected) {
			t.Fatalf("metrics missing %q\n%s", expected, metricsText)
		}
	}

	logsText := logs.String()
	for _, forbidden := range []string{privatePayload, privateQuery, "inv-sensitive-123"} {
		if strings.Contains(logsText, forbidden) || strings.Contains(metricsText, forbidden) {
			t.Fatalf("private/high-cardinality value leaked: %q\nlogs=%s\nmetrics=%s", forbidden, logsText, metricsText)
		}
	}
	for _, expected := range []string{requestID, traceID, errorID, `"route":"/v1/merchants/onboard"`, `"status":401`} {
		if !strings.Contains(logsText, expected) {
			t.Fatalf("structured log missing %q: %s", expected, logsText)
		}
	}
}

func TestCentralHealthPropagatesCorrelation(t *testing.T) {
	var capturedRequestID, capturedTraceID, capturedParent string
	central := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedRequestID = r.Header.Get(requestIDHeader)
		capturedTraceID = r.Header.Get(traceIDHeader)
		capturedParent = r.Header.Get("Traceparent")
		w.WriteHeader(http.StatusNoContent)
	}))
	defer central.Close()

	requestID := "ready-request-123456"
	traceID := strings.Repeat("c", 32)
	ctx := context.WithValue(context.Background(), requestIDContextKey, requestID)
	ctx = context.WithValue(ctx, traceIDContextKey, traceID)
	pay := &HTTPPayAPI{BaseURL: central.URL, Client: central.Client()}
	if err := pay.Health(ctx); err != nil {
		t.Fatal(err)
	}
	if capturedRequestID != requestID || capturedTraceID != traceID {
		t.Fatalf("central correlation mismatch: request=%q trace=%q", capturedRequestID, capturedTraceID)
	}
	if !strings.HasPrefix(capturedParent, "00-"+traceID+"-") || !strings.HasSuffix(capturedParent, "-01") {
		t.Fatalf("invalid propagated traceparent: %q", capturedParent)
	}
}

func TestObservedHandlerRecoversPanicWithoutExposingPanicValue(t *testing.T) {
	var logs bytes.Buffer
	state := &observabilityState{
		build:     buildinfo.Normalize(buildinfo.Info{}),
		logger:    slog.New(slog.NewJSONHandler(&logs, nil)),
		metrics:   newServerMetrics(),
		startedAt: time.Now().UTC(),
	}
	handler := state.observe(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("private panic value")
	}))
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/panic", nil)
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("panic status=%d", recorder.Code)
	}
	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["error"] != "internal service error" || payload["errorId"] == "" || payload["requestId"] == "" || payload["traceId"] == "" {
		t.Fatalf("panic response incomplete: %+v", payload)
	}
	if strings.Contains(logs.String(), "private panic value") || strings.Contains(recorder.Body.String(), "private panic value") {
		t.Fatalf("panic value leaked: logs=%s body=%s", logs.String(), recorder.Body.String())
	}
}
