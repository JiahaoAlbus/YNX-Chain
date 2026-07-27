package publicprobe

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

func TestProbeDistinguishesPublicRouteFromUnavailableProvider(t *testing.T) {
	server := reserveServer(t, http.StatusServiceUnavailable, map[string]any{
		"failure": true, "failureCodes": []string{"YNX_STABLE_RESERVE_UNAVAILABLE"},
		"sourceCommit": strings.Repeat("a", 40), "adapterReleaseClass": "public_testnet",
		"release": map[string]any{"deployedPublic": true},
	})
	defer server.Close()
	monitor := newTestMonitor(t, server.URL+"/api/stable/reserve")
	result := monitor.ProbeOnce(context.Background())
	if !result.RouteAvailable || result.ProviderAvailable || result.HTTPStatus != http.StatusServiceUnavailable ||
		result.SourceCommit != strings.Repeat("a", 40) || result.ErrorCode != "" {
		t.Fatalf("unexpected unavailable-provider result: %+v", result)
	}

	response := httptest.NewRecorder()
	monitor.Handler(buildinfo.Info{Commit: strings.Repeat("b", 40), Release: "test"}).
		ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/health", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("route health should remain healthy when the provider fails closed: %d %s", response.Code, response.Body.String())
	}
}

func TestProbeAcceptsAvailableProviderAndExportsMetrics(t *testing.T) {
	server := reserveServer(t, http.StatusOK, map[string]any{
		"failure": true, "failureCodes": []string{"YNX_STABLE_RESERVE_SHORTFALL"},
		"sourceCommit": strings.Repeat("c", 40), "adapterReleaseClass": "public_testnet",
		"release": map[string]any{"deployedPublic": true}, "reserve": map[string]any{"solvent": false},
	})
	defer server.Close()
	monitor := newTestMonitor(t, server.URL+"/api/stable/reserve")
	result := monitor.ProbeOnce(context.Background())
	if !result.RouteAvailable || !result.ProviderAvailable || !result.ReserveFailure {
		t.Fatalf("verified shortfall must not be confused with provider or route absence: %+v", result)
	}
	response := httptest.NewRecorder()
	monitor.Handler(buildinfo.Info{Commit: strings.Repeat("d", 40), Release: "test"}).
		ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	for _, expected := range []string{
		"ynx_public_stable_reserve_probe_success 1",
		"ynx_public_stable_reserve_provider_available 1",
		"ynx_public_stable_reserve_http_status_code 200",
		`source_commit="` + strings.Repeat("c", 40) + `"`,
	} {
		if !strings.Contains(response.Body.String(), expected) {
			t.Fatalf("missing metric %q:\n%s", expected, response.Body.String())
		}
	}
	if strings.Contains(response.Body.String(), `\n`) {
		t.Fatalf("metrics contain escaped newlines instead of Prometheus line breaks:\n%s", response.Body.String())
	}
}

func TestProbeFailsClosedOnInvalidReleaseTruth(t *testing.T) {
	server := reserveServer(t, http.StatusServiceUnavailable, map[string]any{
		"failure": true, "failureCodes": []string{"YNX_STABLE_RESERVE_UNAVAILABLE"},
		"sourceCommit": strings.Repeat("e", 40), "adapterReleaseClass": "central_testnet",
		"release": map[string]any{"deployedPublic": false},
	})
	defer server.Close()
	monitor := newTestMonitor(t, server.URL+"/api/stable/reserve")
	result := monitor.ProbeOnce(context.Background())
	if result.RouteAvailable || result.ErrorCode != "release_truth_invalid" {
		t.Fatalf("invalid public release truth was accepted: %+v", result)
	}
	response := httptest.NewRecorder()
	monitor.Handler(buildinfo.Info{}).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/health", nil))
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("invalid public truth did not fail health closed: %d", response.Code)
	}
}

func TestProbeVerifiesPublicYUSDSandboxTruthAndMetrics(t *testing.T) {
	now := time.Now().UTC()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/api/stable/reserve":
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"failure": true, "failureCodes": []string{"YNX_STABLE_RESERVE_UNAVAILABLE"},
				"sourceCommit": strings.Repeat("a", 40), "adapterReleaseClass": "public_testnet",
				"release": map[string]any{"deployedPublic": true},
			})
		case "/api/stable/yusd-sandbox":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"failure": false, "failureCodes": []string{},
				"sourceCommit": strings.Repeat("b", 40), "adapterReleaseClass": "public_testnet",
				"release":      map[string]any{"deployedPublic": true},
				"sandboxBuild": buildinfo.Info{Commit: strings.Repeat("c", 40), Release: "ynx-yusd-sandbox-cccccccccccc"},
				"sandbox": map[string]any{
					"schemaVersion": 1, "product": "YUSD Sandbox", "network": "YNX Testnet",
					"symbol": "YUSD", "decimals": 6, "source": "ynx-yusd-sandbox-persistent-ledger",
					"asOf": now, "version": 1, "reserveUnits": 4_600_000, "supplyUnits": 600_000,
					"pendingRedemptionUnits": 0, "requiredBackingUnits": 600_000,
					"excessReserveUnits": 4_000_000, "solvent": true, "reconciled": true,
					"providerStatus": "available", "realityValue": false,
					"externalReserveAttested": false, "guaranteedPeg": false, "failure": false,
				},
			})
		default:
			http.NotFound(w, request)
		}
	}))
	defer server.Close()
	monitor, err := New(Config{
		StableReserveURL: server.URL + "/api/stable/reserve",
		YUSDSandboxURL:   server.URL + "/api/stable/yusd-sandbox",
		Interval:         15 * time.Second, Timeout: 5 * time.Second, AllowHTTP: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	result := monitor.ProbeOnce(context.Background())
	if !result.RouteAvailable || !result.YUSDSandbox.RouteAvailable || !result.YUSDSandbox.Solvent ||
		!result.YUSDSandbox.Reconciled || result.YUSDSandbox.ReserveUnits != 4_600_000 ||
		result.YUSDSandbox.SandboxSourceCommit != strings.Repeat("c", 40) {
		t.Fatalf("unexpected YUSD probe result: %+v", result)
	}
	response := httptest.NewRecorder()
	monitor.Handler(buildinfo.Info{}).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	for _, expected := range []string{
		"ynx_public_yusd_sandbox_probe_success 1",
		"ynx_public_yusd_sandbox_solvent 1",
		"ynx_public_yusd_sandbox_reconciled 1",
		"ynx_public_yusd_sandbox_reserve_units 4600000",
		"ynx_public_yusd_sandbox_supply_units 600000",
		"ynx_public_yusd_sandbox_pending_redemption_units 0",
		`ynx_public_yusd_sandbox_source_commit_info{source_commit="` + strings.Repeat("c", 40) + `"} 1`,
	} {
		if !strings.Contains(response.Body.String(), expected) {
			t.Fatalf("missing metric %q:\n%s", expected, response.Body.String())
		}
	}
}

func TestProbeFailsHealthClosedOnInvalidYUSDSandboxTruth(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if request.URL.Path == "/api/stable/reserve" {
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"failure": true, "failureCodes": []string{"YNX_STABLE_RESERVE_UNAVAILABLE"},
				"sourceCommit": strings.Repeat("d", 40), "adapterReleaseClass": "public_testnet",
				"release": map[string]any{"deployedPublic": true},
			})
			return
		}
		if request.URL.Path == "/api/stable/yusd-sandbox" {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"failure": false, "sourceCommit": strings.Repeat("e", 40),
				"adapterReleaseClass": "public_testnet", "release": map[string]any{"deployedPublic": true},
				"sandboxBuild": map[string]any{"commit": strings.Repeat("f", 40), "release": "ynx-yusd-sandbox-ffffffffffff"},
				"sandbox": map[string]any{
					"schemaVersion": 1, "product": "YUSD Sandbox", "network": "YNX Testnet",
					"symbol": "YUSD", "decimals": 6, "realityValue": true,
				},
			})
			return
		}
		http.NotFound(w, request)
	}))
	defer server.Close()
	monitor, err := New(Config{
		StableReserveURL: server.URL + "/api/stable/reserve",
		YUSDSandboxURL:   server.URL + "/api/stable/yusd-sandbox",
		Interval:         15 * time.Second, Timeout: 5 * time.Second, AllowHTTP: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	result := monitor.ProbeOnce(context.Background())
	if !result.RouteAvailable || result.YUSDSandbox.RouteAvailable || result.YUSDSandbox.ErrorCode != "sandbox_truth_invalid" {
		t.Fatalf("invalid YUSD truth was accepted: %+v", result)
	}
	response := httptest.NewRecorder()
	monitor.Handler(buildinfo.Info{}).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/health", nil))
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("invalid YUSD truth did not fail monitor health closed: %d %s", response.Code, response.Body.String())
	}
}

func TestValidateConfigRequiresBoundedHTTPSReservePath(t *testing.T) {
	base := Config{StableReserveURL: "https://explorer.test/api/stable/reserve", Interval: 15 * time.Second, Timeout: 5 * time.Second}
	if err := ValidateConfig(base); err != nil {
		t.Fatal(err)
	}
	withYUSD := base
	withYUSD.YUSDSandboxURL = "https://explorer.test/api/stable/yusd-sandbox"
	if err := ValidateConfig(withYUSD); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []Config{
		{StableReserveURL: "http://explorer.test/api/stable/reserve", Interval: 15 * time.Second, Timeout: 5 * time.Second},
		{StableReserveURL: "https://user@example.test/api/stable/reserve", Interval: 15 * time.Second, Timeout: 5 * time.Second},
		{StableReserveURL: "https://explorer.test/api/stable/reserve?x=1", Interval: 15 * time.Second, Timeout: 5 * time.Second},
		{StableReserveURL: "https://explorer.test/health", Interval: 15 * time.Second, Timeout: 5 * time.Second},
		{StableReserveURL: "https://explorer.test/api/stable/reserve", Interval: time.Millisecond, Timeout: 5 * time.Second},
		{StableReserveURL: "https://explorer.test/api/stable/reserve", YUSDSandboxURL: "https://other.test/api/stable/yusd-sandbox", Interval: 15 * time.Second, Timeout: 5 * time.Second},
		{StableReserveURL: "https://explorer.test/api/stable/reserve", YUSDSandboxURL: "https://explorer.test/yusd/snapshot", Interval: 15 * time.Second, Timeout: 5 * time.Second},
	} {
		if err := ValidateConfig(invalid); err == nil {
			t.Fatalf("invalid config was accepted: %+v", invalid)
		}
	}
}

func newTestMonitor(t *testing.T, target string) *Monitor {
	t.Helper()
	monitor, err := New(Config{StableReserveURL: target, Interval: 15 * time.Second, Timeout: 5 * time.Second, AllowHTTP: true})
	if err != nil {
		t.Fatal(err)
	}
	return monitor
}

func reserveServer(t *testing.T, status int, body map[string]any) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/stable/reserve" {
			http.NotFound(w, request)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		if err := json.NewEncoder(w).Encode(body); err != nil {
			t.Error(err)
		}
	}))
}
