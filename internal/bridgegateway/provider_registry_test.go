package bridgegateway

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestBridgeProviderRegistryIsRouteBoundAndFailClosed(t *testing.T) {
	b := newTestBridge(t)
	registry := b.service.ProviderRegistry()
	routes := b.service.RouteCatalog()
	if registry.SchemaVersion != 1 || registry.Source != "ynx-bridge-provider-registry" || registry.AsOf == "" || len(registry.Providers) != 1 || len(routes.Routes) != 1 {
		t.Fatalf("provider registry envelope is invalid: %+v", registry)
	}
	entry := registry.Providers[0]
	if entry.RouteID != routes.Routes[0].ID || entry.Provider != "local-test-provider" || entry.Product != "not-configured" || entry.Classification != "external-bridge-adapter" {
		t.Fatalf("provider identity is not bound to the route: %+v", entry)
	}
	wantAssets := []string{"ethereum-sepolia:sepolia-usdc", "ynx_6423-1:ynx-usdc"}
	if !reflect.DeepEqual(entry.SupportedAssets, wantAssets) || entry.SourceChain != "ethereum-sepolia" || entry.DestinationChain != "ynx_6423-1" {
		t.Fatalf("provider route coverage is invalid: %+v", entry)
	}
	if entry.SourceContract != nil || entry.DestinationContract != nil || entry.APIVersion != "not-configured" || entry.SDKVersion != "not-configured" || entry.Authentication != "not-applicable-route-unavailable" || entry.RateLimit != "unknown-route-unavailable" {
		t.Fatalf("provider integration metadata overclaims configuration: %+v", entry)
	}
	if entry.Fees.Status != "unavailable-no-executable-route" || entry.Fees.HiddenSpread || entry.Slippage.Status != "not-applicable-no-executable-route" || entry.EstimatedTime.Status != "unavailable-no-provider-route" || entry.RefundPolicy.Available {
		t.Fatalf("provider commercial or recovery metadata overclaims availability: %+v", entry)
	}
	if entry.Jurisdiction != "not-approved" || entry.License != "not-approved" || entry.Terms != "not-approved" || entry.DataRetention != "not-reviewed" || entry.DataRights != "not-reviewed" || entry.CustodyModel != "not-established" || entry.AuditStatus != "not-reviewed" {
		t.Fatalf("provider governance metadata overclaims approval: %+v", entry)
	}
	if entry.IncidentHistory == nil || len(entry.IncidentHistory) != 0 || entry.IncidentHistoryComplete || entry.Health != "not-connected" || entry.LastSuccess != nil || entry.LastFailure != nil || entry.Fallback != "none" {
		t.Fatalf("provider operations metadata overclaims history or health: %+v", entry)
	}
	if entry.TestnetStatus != "unavailable" || entry.ProductionStatus != "unavailable" || entry.CredentialsConfigured || entry.AgreementApproved || entry.ContractsConfigured || entry.RouteAvailable || entry.Executable || entry.FailureStatus == "" {
		t.Fatalf("provider registry exposed an unavailable route as usable: %+v", entry)
	}
}

func TestBridgeProviderRegistryEndpointIsPublicReadOnlyAndTruthful(t *testing.T) {
	b := newTestBridge(t)
	server := NewServer(b.service).Handler()
	request := httptest.NewRequest(http.MethodGet, "/bridge/providers", nil)
	request.RemoteAddr = "192.0.2.15:1015"
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("provider endpoint status: %d %s", response.Code, response.Body.String())
	}
	var registry ProviderRegistry
	if err := json.Unmarshal(response.Body.Bytes(), &registry); err != nil {
		t.Fatal(err)
	}
	if len(registry.Providers) != 1 || registry.Providers[0].Executable || registry.Providers[0].RouteAvailable || registry.Providers[0].Health != "not-connected" {
		t.Fatalf("provider endpoint overclaims route status: %+v", registry)
	}

	for _, endpoint := range []string{"/health", "/version", "/bridge/status"} {
		request = httptest.NewRequest(http.MethodGet, endpoint, nil)
		request.RemoteAddr = "192.0.2.16:1016"
		response = httptest.NewRecorder()
		server.ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("%s status: %d %s", endpoint, response.Code, response.Body.String())
		}
		var payload map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		if payload["providerCount"] != float64(1) || payload["availableProviderCount"] != float64(0) {
			t.Fatalf("%s provider counts imply availability: %+v", endpoint, payload)
		}
	}

	request = httptest.NewRequest(http.MethodGet, "/metrics", nil)
	request.RemoteAddr = "192.0.2.17:1017"
	response = httptest.NewRecorder()
	server.ServeHTTP(response, request)
	metrics := response.Body.String()
	if response.Code != http.StatusOK || !strings.Contains(metrics, "ynx_bridge_providers_configured") || !strings.Contains(metrics, "ynx_bridge_providers_available") || !strings.Contains(metrics, "ynx_bridge_providers_available{service=\"ynx-bridged\",native_symbol=\"YNXT\",live_bridge=\"false\"} 0") {
		t.Fatalf("provider metrics are missing or overclaim availability: %d %s", response.Code, metrics)
	}
}
