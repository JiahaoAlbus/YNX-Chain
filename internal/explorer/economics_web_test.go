package explorer

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

func TestEconomicsPagesExposeCanonicalAccessibleLocalizedBoundaries(t *testing.T) {
	server := NewServerWithBuild(nil, buildinfo.Info{Commit: strings.Repeat("a", 40), Release: "test", BuildTime: "2026-07-22T00:00:00Z"}).Handler()
	for _, tc := range []struct {
		path, page, canonical, heading string
	}{{"/ynxt", "ynxt", "/ynxt", "YNXT economics, with every boundary visible."}, {"/economics", "economics", "/economics", "Model the policy before governing it."}} {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, tc.path, nil)
		request.Host = "localhost"
		server.ServeHTTP(response, request)
		if response.Code != http.StatusOK || response.Header().Get("Content-Type") != "text/html; charset=utf-8" {
			t.Fatalf("%s status=%d type=%s", tc.path, response.Code, response.Header().Get("Content-Type"))
		}
		body := response.Body.String()
		for _, required := range []string{"data-page=\"" + tc.page + "\"", "rel=\"canonical\" href=\"" + tc.canonical + "\"", "property=\"og:image\" content=\"http://localhost/assets/economics-og.png\"", tc.heading, "prefers-reduced-motion:reduce", ":focus-visible", "@media(max-width:520px)", "locale==='ar'?'rtl':'ltr'", "aria-live=\"polite\"", "fetch('/api/economics/disclosure')", "fetch('/api/summary')", "guaranteed", "未启用", "غير نشط", "Tidak aktif"} {
			if !strings.Contains(body, required) {
				t.Fatalf("%s missing %q", tc.path, required)
			}
		}
		for _, locale := range []string{"en", "zh-CN", "zh-TW", "ja", "ko", "es", "fr", "de", "pt", "ru", "ar", "id"} {
			if !strings.Contains(body, "value=\""+locale+"\"") {
				t.Fatalf("%s missing locale %s", tc.path, locale)
			}
		}
	}
	imageResponse := httptest.NewRecorder()
	server.ServeHTTP(imageResponse, httptest.NewRequest(http.MethodGet, "/assets/economics-og.png", nil))
	if imageResponse.Code != http.StatusOK || imageResponse.Header().Get("Content-Type") != "image/png" || imageResponse.Body.Len() < 10_000 {
		t.Fatalf("economics social image unavailable: status=%d type=%s bytes=%d", imageResponse.Code, imageResponse.Header().Get("Content-Type"), imageResponse.Body.Len())
	}
}

func TestEconomicsDisclosureKeepsCandidateAndReleaseClaimsFalse(t *testing.T) {
	commit := strings.Repeat("b", 40)
	server := NewServerWithBuild(nil, buildinfo.Info{Commit: commit, Release: "test", BuildTime: "2026-07-22T00:00:00Z"}).Handler()
	response := httptest.NewRecorder()
	server.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/economics/disclosure", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var body struct {
		Source       string                `json:"source"`
		SourceCommit string                `json:"sourceCommit"`
		Failure      bool                  `json:"failure"`
		Current      map[string]any        `json:"current"`
		Release      map[string]bool       `json:"release"`
		Risk         map[string]bool       `json:"risk"`
		Scenarios    []publicMacroScenario `json:"macroScenarios"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Failure || body.Source != "ynx-chain-source-and-reference-model" || body.SourceCommit != commit || len(body.Scenarios) != 3 {
		t.Fatalf("disclosure identity mismatch: %+v", body)
	}
	if body.Current["burnActive"] != false || body.Current["dynamicIssuanceActive"] != false || body.Current["stakingRewardsActive"] != false || body.Current["slashingActive"] != false || body.Current["treasuryTransferExecution"] != false {
		t.Fatalf("current policy overclaimed: %+v", body.Current)
	}
	for _, key := range []string{"installedLocal", "integratedCentral", "deployedStaging", "deployedPublic", "downloadHosted", "productionSigned", "storeReleased"} {
		if body.Release[key] {
			t.Fatalf("release flag %s overclaimed", key)
		}
	}
	for key, value := range body.Risk {
		if value {
			t.Fatalf("risk guarantee %s overclaimed", key)
		}
	}
	for _, scenario := range body.Scenarios {
		if scenario.Iterations != 1_000 || scenario.GatePassBPS < 0 || scenario.GatePassBPS > 10_000 {
			t.Fatalf("invalid scenario disclosure: %+v", scenario)
		}
	}
}

func TestEconomicsDisclosureRequestIDHealthAndMetrics(t *testing.T) {
	commit := strings.Repeat("c", 40)
	server := NewServerWithBuild(nil, buildinfo.Info{Commit: commit, Release: "test", BuildTime: "2026-07-22T00:00:00Z"})
	handler := server.Handler()

	disclosure := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/economics/disclosure", nil)
	request.Header.Set("X-Request-ID", "economics-test-request-0001")
	handler.ServeHTTP(disclosure, request)
	if disclosure.Code != http.StatusOK || disclosure.Header().Get("X-Request-ID") != "economics-test-request-0001" {
		t.Fatalf("request ID was not propagated: status=%d id=%q", disclosure.Code, disclosure.Header().Get("X-Request-ID"))
	}
	var body struct {
		RequestID string `json:"requestId"`
	}
	if err := json.NewDecoder(disclosure.Body).Decode(&body); err != nil || body.RequestID != "economics-test-request-0001" {
		t.Fatalf("response request ID mismatch: body=%+v err=%v", body, err)
	}

	health := httptest.NewRecorder()
	invalidIDRequest := httptest.NewRequest(http.MethodGet, "/api/economics/health", nil)
	invalidIDRequest.Header.Set("X-Request-ID", "bad id")
	handler.ServeHTTP(health, invalidIDRequest)
	if health.Code != http.StatusOK || !economicsRequestIDPattern.MatchString(health.Header().Get("X-Request-ID")) {
		t.Fatalf("health boundary or generated request ID invalid: status=%d id=%q", health.Code, health.Header().Get("X-Request-ID"))
	}
	var healthBody struct {
		OK      bool           `json:"ok"`
		Failure bool           `json:"failure"`
		Build   buildinfo.Info `json:"build"`
	}
	if err := json.NewDecoder(health.Body).Decode(&healthBody); err != nil || !healthBody.OK || healthBody.Failure || healthBody.Build.Commit != commit {
		t.Fatalf("health response mismatch: body=%+v err=%v", healthBody, err)
	}

	metrics := server.economicsMetricsPrometheus()
	for _, expected := range []string{
		"ynx_explorer_economics_disclosure_requests_total 1",
		"ynx_explorer_economics_disclosure_errors_total 0",
		"ynx_explorer_economics_disclosure_latency_seconds_count 1",
		"ynx_explorer_economics_disclosure_latency_seconds_bucket{le=\"+Inf\"} 1",
	} {
		if !strings.Contains(metrics, expected) {
			t.Fatalf("metrics missing %q:\n%s", expected, metrics)
		}
	}
}
