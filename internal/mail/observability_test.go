package mail

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMailObservabilityCorrelatesAndRedacts(t *testing.T) {
	service, _ := newTestService(t, "")
	handler := NewHandler(service)
	var logs bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&logs)
	t.Cleanup(func() { log.SetOutput(previous) })

	request := httptest.NewRequest(http.MethodGet, "/v1/health?token=secret-account", nil)
	request.Header.Set("X-Request-ID", "mail-client-request-0001")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Header().Get("X-Request-ID") != "mail-client-request-0001" {
		t.Fatalf("request correlation failed: status=%d headers=%v", response.Code, response.Header())
	}

	invalid := httptest.NewRequest(http.MethodGet, "/missing", nil)
	invalid.Header.Set("X-Request-ID", "bad")
	notFound := httptest.NewRecorder()
	handler.ServeHTTP(notFound, invalid)
	if notFound.Code != http.StatusNotFound ||
		!strings.HasPrefix(notFound.Header().Get("X-Request-ID"), "mail_") ||
		notFound.Header().Get("X-Error-ID") != "YNX-MAIL-NOT-FOUND" {
		t.Fatalf("safe request ID fallback failed: status=%d headers=%v", notFound.Code, notFound.Header())
	}

	metrics := httptest.NewRecorder()
	handler.ServeHTTP(metrics, httptest.NewRequest(http.MethodGet, "/v1/metrics", nil))
	var payload map[string]any
	if err := json.Unmarshal(metrics.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if metrics.Code != http.StatusOK || payload["schemaVersion"] != "mail-metrics-v1" || payload["observabilityVersion"] != mailObservabilityVersion {
		t.Fatalf("metrics contract is invalid: status=%d payload=%v", metrics.Code, payload)
	}
	if payload["requests"].(float64) < 2 || payload["errors"].(float64) < 1 || payload["privacyBoundary"] == "" {
		t.Fatalf("metrics omitted bounded evidence: %v", payload)
	}

	logText := logs.String()
	for _, forbidden := range []string{"secret-account", "token=", "Authorization"} {
		if strings.Contains(logText, forbidden) {
			t.Fatalf("structured logs leaked %q: %s", forbidden, logText)
		}
	}
	if !strings.Contains(logText, `"requestId":"mail-client-request-0001"`) || !strings.Contains(logText, `"privacyClass":"no-body-no-query-no-account"`) {
		t.Fatalf("structured logs lack correlation/privacy contract: %s", logText)
	}
}
