package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/finance"
)

func TestCentralBrowserSSOExplicitConfiguration(t *testing.T) {
	for _, input := range []string{"", "false", "true", "TRUE", "1", " true", "false "} {
		value, err := centralBrowserSSOEnabled(input)
		valid := input == "" || input == "false" || input == "true"
		if (err == nil) != valid || value != (input == "true") {
			t.Fatalf("unexpected configuration result for %q", input)
		}
	}
}

func TestV2CentralSSOGatewayWiringPreservesLegacyIsolation(t *testing.T) {
	legacy := "https://legacy.example"
	if walletGatewayForMode("legacy-v1", true, legacy) != legacy || walletGatewayForMode("legacy-v1", false, legacy) != legacy {
		t.Fatal("central configuration replaced legacy authority")
	}
	for _, enabled := range []bool{false, true} {
		gateway := walletGatewayForMode("product-session-v2", enabled, legacy)
		if enabled && gateway != finance.BrowserWalletAuthority || !enabled && gateway != "" {
			t.Fatal("v2 gateway did not use explicit central opt-in and fixed authority")
		}
		store, err := finance.OpenStore(filepath.Join(t.TempDir(), "finance.json"))
		if err != nil {
			t.Fatal(err)
		}
		upstreams, err := finance.NewUpstreams("https://explorer.example", "", "", "https://support.example/disputes")
		if err != nil {
			t.Fatal(err)
		}
		auth, err := finance.NewBrowserV2Authenticator()
		if err != nil {
			t.Fatal(err)
		}
		server, err := finance.NewServer(&finance.Service{Store: store, Upstreams: upstreams, AI: &finance.HTTPAIProvider{}, Support: finance.SupportLinks{HelpURL: "https://support.example/help", PrivacyURL: "https://support.example/privacy", DisputeURL: "https://support.example/disputes"}}, auth, finance.ServerConfig{CentralBrowserSSO: enabled, WalletGatewayURL: gateway, CursorSigningKey: strings.Repeat("c", 32), OperationsKey: strings.Repeat("o", 32)})
		if err != nil {
			t.Fatal(err)
		}
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, httptest.NewRequest("GET", "/api/sso/config", nil))
		var config struct {
			Enabled bool `json:"enabled"`
		}
		if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &config) != nil || config.Enabled != enabled {
			t.Fatal("CLI-derived config did not activate the real SSO route")
		}
		for _, route := range []string{"complete", "revoke"} {
			response = httptest.NewRecorder()
			server.Handler().ServeHTTP(response, httptest.NewRequest("POST", "/wallet-gateway/v1/wallet/sessions/"+route, strings.NewReader("{}")))
			if response.Code != http.StatusGone || !strings.Contains(response.Body.String(), "legacy_authority_isolated") {
				t.Fatal("central opt-in opened a legacy session proxy")
			}
		}
	}
}

func TestFiniteCentralIdentityExplicitConfigKeepsLegacyOptOut(t *testing.T) {
	values := map[string]string{"YNX_FINANCE_CENTRAL_FINITE_IDENTITY": "true", "YNX_FINANCE_CENTRAL_FAMILY_KEY_ID": "finance-test-key", "YNX_FINANCE_CENTRAL_FAMILY_PRIVATE_KEY_FILE": "/protected/client-key.pem", "YNX_FINANCE_CENTRAL_FAMILY_SEAL_KEY_FILE": "/protected/seal.bin", "YNX_FINANCE_CENTRAL_FAMILY_STATE_PATH": "/protected/families/state.db"}
	get := func(k string) string { return values[k] }
	cfg, err := centralBrowserFamilyConfig("product-session-v2", true, get)
	if err != nil || cfg.ClientID != "ynx-finance-v1-sso-v1" || cfg.Audience != "ynx:finance:identity" || cfg.Origin != finance.BrowserFinanceOrigin || cfg.RedirectURI != finance.BrowserFinanceOrigin+"/sso/callback" || cfg.Issuer != finance.BrowserWalletAuthority {
		t.Fatal("finite tuple config changed", err)
	}
	for _, raw := range []string{"", "false"} {
		values["YNX_FINANCE_CENTRAL_FINITE_IDENTITY"] = raw
		cfg, err = centralBrowserFamilyConfig("legacy-v1", false, get)
		if err != nil || cfg != nil {
			t.Fatal("opt out changed legacy behavior")
		}
	}
	for _, raw := range []string{"TRUE", " true", "1"} {
		values["YNX_FINANCE_CENTRAL_FINITE_IDENTITY"] = raw
		if _, err = centralBrowserFamilyConfig("product-session-v2", true, get); err == nil {
			t.Fatal("loose opt in")
		}
	}
	values["YNX_FINANCE_CENTRAL_FINITE_IDENTITY"] = "true"
	for _, input := range []struct {
		mode    string
		central bool
	}{{"legacy-v1", true}, {"product-session-v2", false}} {
		if _, err = centralBrowserFamilyConfig(input.mode, input.central, get); err == nil {
			t.Fatal("incompatible finite configuration")
		}
	}
	values["YNX_FINANCE_CENTRAL_FAMILY_STATE_PATH"] = "relative.db"
	if _, err = centralBrowserFamilyConfig("product-session-v2", true, get); err == nil {
		t.Fatal("relative durable store accepted")
	}
}
