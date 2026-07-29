package cloud

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

func TestDocsRuntimeObservabilityEndpointsAndCorrelationIDs(t *testing.T) {
	service := testService(t, nil)
	handler := NewServerWithBuild(service, buildinfo.Info{
		Commit:    "abc123def456",
		Release:   "ynx-docs-test",
		BuildTime: "2026-07-29T08:00:00Z",
	}).Handler()

	healthReq := httptest.NewRequest(http.MethodGet, "/health", nil)
	healthReq.Header.Set("X-Request-ID", "request-123")
	healthReq.Header.Set("X-Trace-ID", "trace-456")
	health := httptest.NewRecorder()
	handler.ServeHTTP(health, healthReq)
	if health.Code != http.StatusOK {
		t.Fatalf("health status=%d body=%s", health.Code, health.Body.String())
	}
	if health.Header().Get("X-Request-ID") != "request-123" || health.Header().Get("X-Trace-ID") != "trace-456" {
		t.Fatalf("correlation headers not preserved: request=%q trace=%q", health.Header().Get("X-Request-ID"), health.Header().Get("X-Trace-ID"))
	}
	var healthBody map[string]any
	if err := json.NewDecoder(health.Body).Decode(&healthBody); err != nil {
		t.Fatal(err)
	}
	build, ok := healthBody["build"].(map[string]any)
	if !ok || build["commit"] != "abc123def456" || build["release"] != "ynx-docs-test" {
		t.Fatalf("health missing build identity: %+v", healthBody)
	}
	if healthBody["truthfulStatus"] != "local-bounded-docs-runtime-not-publicly-deployed" {
		t.Fatalf("health overclaims deployment: %+v", healthBody)
	}

	for _, path := range []string{"/ready", "/version"} {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		if recorder.Code != http.StatusOK {
			t.Fatalf("%s status=%d body=%s", path, recorder.Code, recorder.Body.String())
		}
		if recorder.Header().Get("X-Request-ID") == "" || recorder.Header().Get("X-Trace-ID") == "" {
			t.Fatalf("%s missing generated correlation headers", path)
		}
	}

	unauthorized := httptest.NewRecorder()
	unsafeIDReq := httptest.NewRequest(http.MethodGet, "/api/v1/objects", nil)
	unsafeIDReq.Header.Set("X-Request-ID", "bad\nheader")
	handler.ServeHTTP(unauthorized, unsafeIDReq)
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized status=%d body=%s", unauthorized.Code, unauthorized.Body.String())
	}
	if unauthorized.Header().Get("X-Error-ID") == "" {
		t.Fatal("error response missing X-Error-ID")
	}
	if got := unauthorized.Header().Get("X-Request-ID"); got == "" || got == "bad\nheader" {
		t.Fatalf("unsafe request ID was not replaced: %q", got)
	}

	metrics := httptest.NewRecorder()
	handler.ServeHTTP(metrics, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	if metrics.Code != http.StatusOK {
		t.Fatalf("metrics status=%d body=%s", metrics.Code, metrics.Body.String())
	}
	if contentType := metrics.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "text/plain") {
		t.Fatalf("metrics content type=%q", contentType)
	}
	for _, expected := range []string{
		"ynx_docs_http_requests_total 4",
		"ynx_docs_http_errors_total 1",
		"ynx_docs_http_request_duration_seconds_count 4",
		"ynx_docs_info{commit=\"abc123def456\",release=\"ynx-docs-test\",schema_version=\"2\"} 1",
	} {
		if !strings.Contains(metrics.Body.String(), expected) {
			t.Fatalf("metrics missing %q:\n%s", expected, metrics.Body.String())
		}
	}
}
