package aigateway

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Retain only allowlisted classifications, never provider error messages,
// account identifiers, credentials, or arbitrary upstream response headers.
func classifyProviderHTTPError(response *http.Response) *ProviderHTTPError {
	failure := &ProviderHTTPError{StatusCode: response.StatusCode}
	if response.StatusCode != http.StatusTooManyRequests {
		return failure
	}
	var body struct {
		Error struct {
			Code string `json:"code"`
			Type string `json:"type"`
		} `json:"error"`
	}
	failure.Category = "unclassified"
	if json.NewDecoder(io.LimitReader(response.Body, 16<<10)).Decode(&body) != nil {
		return failure
	}
	quota := func(value string) bool {
		switch value {
		case "insufficient_quota", "credit_balance_exhausted", "organization_usage_limit_exceeded", "organization_spend_limit_exceeded", "project_spend_limit_exceeded":
			return true
		default:
			return false
		}
	}
	if quota(body.Error.Code) || quota(body.Error.Type) {
		failure.Category = "quota_exhausted"
		return failure
	}
	if body.Error.Code != "rate_limit_exceeded" && body.Error.Type != "rate_limit_exceeded" {
		return failure
	}
	failure.Category = "rate_limited"
	raw := strings.TrimSpace(response.Header.Get("Retry-After"))
	if seconds, err := strconv.ParseUint(raw, 10, 32); err == nil {
		failure.RetryAfter = strconv.FormatUint(seconds, 10)
	} else if deadline, err := http.ParseTime(raw); err == nil && deadline.After(time.Now()) {
		failure.RetryAfter = deadline.UTC().Format(http.TimeFormat)
	}
	return failure
}
