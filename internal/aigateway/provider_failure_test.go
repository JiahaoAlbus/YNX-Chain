package aigateway

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestProviderFailureClassificationDoesNotRetryQuota(t *testing.T) {
	for _, code := range []string{"insufficient_quota", "credit_balance_exhausted", "organization_usage_limit_exceeded", "organization_spend_limit_exceeded", "project_spend_limit_exceeded"} {
		t.Run(code, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			recorder.Header().Set("Retry-After", "3")
			recorder.WriteHeader(http.StatusTooManyRequests)
			_, _ = recorder.WriteString(`{"error":{"code":"` + code + `","message":"secret-upstream-detail"}}`)
			response := recorder.Result()
			defer response.Body.Close()
			failure := classifyProviderHTTPError(response)
			if failure.Category != "quota_exhausted" || failure.RetryAfter != "" || strings.Contains(failure.Error(), "secret") {
				t.Fatalf("unsafe quota classification: %#v", failure)
			}
		})
	}
}

func TestProviderFailureClassificationBoundsAndRetryHeader(t *testing.T) {
	cases := []struct {
		name, body, retry, category, wantRetry string
	}{
		{"rate", `{"error":{"code":"rate_limit_exceeded"}}`, "12", "rate_limited", "12"},
		{"rateType", `{"error":{"type":"rate_limit_exceeded"}}`, "9", "rate_limited", "9"},
		{"quotaType", `{"error":{"type":"insufficient_quota"}}`, "12", "quota_exhausted", ""},
		{"quotaWins", `{"error":{"code":"rate_limit_exceeded","type":"insufficient_quota"}}`, "12", "quota_exhausted", ""},
		{"unknown", `{"error":{"code":"unknown"}}`, "12", "unclassified", ""},
		{"invalidJSON", `{`, "12", "unclassified", ""},
		{"boundedBody", strings.Repeat(" ", 16<<10) + `{"error":{"code":"rate_limit_exceeded"}}`, "12", "unclassified", ""},
		{"invalidHeader", `{"error":{"code":"rate_limit_exceeded"}}`, "secret-upstream-detail", "rate_limited", ""},
		{"negativeHeader", `{"error":{"code":"rate_limit_exceeded"}}`, "-1", "rate_limited", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			recorder.Header().Set("Retry-After", tc.retry)
			recorder.WriteHeader(http.StatusTooManyRequests)
			_, _ = recorder.WriteString(tc.body)
			response := recorder.Result()
			defer response.Body.Close()
			failure := classifyProviderHTTPError(response)
			if failure.StatusCode != 429 || failure.Category != tc.category || failure.RetryAfter != tc.wantRetry {
				t.Fatalf("unexpected classification: %#v", failure)
			}
		})
	}
}
