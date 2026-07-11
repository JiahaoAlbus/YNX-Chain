package resourcegateway

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/api"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

const (
	testAPIKey      = "local-resource-api-key"
	testUpstreamKey = "local-resource-upstream-key"
)

func TestGatewayRequiresDedicatedKeys(t *testing.T) {
	_, err := New(Config{ChainURL: "http://127.0.0.1:6420"})
	if err == nil || !strings.Contains(err.Error(), "YNX_RESOURCE_API_KEY") {
		t.Fatalf("expected API key error, got %v", err)
	}
	_, err = New(Config{ChainURL: "http://127.0.0.1:6420", APIKey: testAPIKey})
	if err == nil || !strings.Contains(err.Error(), "YNX_RESOURCE_GATEWAY_UPSTREAM_KEY") {
		t.Fatalf("expected upstream key error, got %v", err)
	}
	if _, err := New(Config{ChainURL: "http://ynx-chaind:6420", APIKey: testAPIKey, UpstreamKey: testUpstreamKey}); err != nil {
		t.Fatalf("expected private service URL to work: %v", err)
	}
}

func TestGatewayResourceMarketFlowAndRedactedAudit(t *testing.T) {
	chainServer := newChainServer(t)
	auditPath := t.TempDir() + "/audit.jsonl"
	service := newTestService(t, chainServer.URL, auditPath, 40)
	server := httptest.NewServer(NewServerWithBuild(service, buildinfo.Info{Commit: "abc123", Release: "ynx-chain-abc123", BuildTime: "2026-07-11T00:00:00Z"}).Handler())
	defer server.Close()

	resp, err := http.Get(server.URL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	var health Health
	if err := json.NewDecoder(resp.Body).Decode(&health); err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !health.OK || health.Service != "ynx-resourced" || health.ChainID != 6423 || health.NativeSymbol != "YNXT" || health.Build.Commit != "abc123" || health.BodyLimitBytes != MaxBodyBytes || health.ResponseLimitBytes != MaxResponseBytes || health.TruthfulStatus != "authenticated-chain-backed-resource-market-gateway" {
		t.Fatalf("unexpected health: %+v", health)
	}

	resp, err = http.Get(server.URL + "/resource-market/policy")
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusUnauthorized || resp.Header.Get("X-Request-ID") == "" {
		t.Fatalf("expected unauthorized response with request ID, got %d", resp.StatusCode)
	}
	_ = resp.Body.Close()

	var policy map[string]any
	doResourceJSON(t, http.MethodGet, server.URL+"/resource-market/policy", nil, http.StatusOK, &policy)
	if policy["currency"] != "YNXT" || policy["policyHash"] == "" {
		t.Fatalf("bad resource policy: %v", policy)
	}
	var quote map[string]any
	doResourceJSON(t, http.MethodGet, server.URL+"/resource-market/quote?address=ynx_resource_renter&bandwidth=100&compute=5&aiCredits=2&trustCredits=1", nil, http.StatusOK, &quote)
	if quote["priceYnxt"] != float64(7) || quote["policyHash"] != policy["policyHash"] {
		t.Fatalf("bad resource quote: %v", quote)
	}

	var delegation map[string]any
	doResourceJSON(t, http.MethodPost, server.URL+"/resource-market/delegations", map[string]any{"provider": "ynx_resource_provider", "beneficiary": "ynx_body_only_beneficiary", "amount": 500}, http.StatusCreated, &delegation)
	delegationRecord := delegation["delegation"].(map[string]any)
	if delegationRecord["status"] != "active" || delegationRecord["policyHash"] != policy["policyHash"] {
		t.Fatalf("bad resource delegation: %v", delegation)
	}
	var rental map[string]any
	doResourceJSON(t, http.MethodPost, server.URL+"/resource-market/rent", map[string]any{"address": "ynx_resource_renter", "provider": "ynx_resource_provider", "bandwidth": 100, "compute": 5, "aiCredits": 2, "trustCredits": 1}, http.StatusCreated, &rental)
	rentalRecord := rental["rental"].(map[string]any)
	if rentalRecord["priceYnxt"] != float64(7) || rentalRecord["providerIncomeYnxt"] != float64(5) || rentalRecord["protocolFeeYnxt"] != float64(2) {
		t.Fatalf("bad resource rental: %v", rental)
	}
	var income map[string]any
	doResourceJSON(t, http.MethodGet, server.URL+"/resource-market/income/ynx_resource_provider", nil, http.StatusOK, &income)
	if len(income["income"].([]any)) != 1 {
		t.Fatalf("missing provider income: %v", income)
	}
	var analytics map[string]any
	doResourceJSON(t, http.MethodGet, server.URL+"/resource-market/analytics", nil, http.StatusOK, &analytics)
	if analytics["activeDelegationCount"].(float64) < 1 || analytics["resourceRentalCount"].(float64) < 1 || analytics["policyHash"] != policy["policyHash"] {
		t.Fatalf("bad resource analytics: %v", analytics)
	}

	metrics, err := http.Get(server.URL + "/metrics")
	if err != nil {
		t.Fatal(err)
	}
	metricsBody, _ := io.ReadAll(metrics.Body)
	_ = metrics.Body.Close()
	if !bytes.Contains(metricsBody, []byte("ynx_resource_gateway_requests_total")) || !bytes.Contains(metricsBody, []byte(`native_symbol="YNXT"`)) {
		t.Fatalf("missing metrics: %s", metricsBody)
	}
	audit, err := os.ReadFile(auditPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(audit, []byte(`"outcome":"unauthorized"`)) || !bytes.Contains(audit, []byte(`"outcome":"accepted"`)) || !bytes.Contains(audit, []byte(`"outcome":"proxied"`)) {
		t.Fatalf("missing audit outcomes: %s", audit)
	}
	for _, secret := range []string{testAPIKey, testUpstreamKey, "ynx_body_only_beneficiary", "ynx_resource_renter"} {
		if bytes.Contains(audit, []byte(secret)) {
			t.Fatalf("audit leaked request data or secret %q: %s", secret, audit)
		}
	}
}

func TestGatewayLimitsAndJSONValidation(t *testing.T) {
	chainServer := newChainServer(t)
	service := newTestService(t, chainServer.URL, t.TempDir()+"/audit.jsonl", 1)
	server := httptest.NewServer(NewServer(service).Handler())
	defer server.Close()
	doResourceJSON(t, http.MethodGet, server.URL+"/resource-market/policy", nil, http.StatusOK, nil)
	doResourceJSON(t, http.MethodGet, server.URL+"/resource-market/policy", nil, http.StatusTooManyRequests, nil)

	service = newTestService(t, chainServer.URL, t.TempDir()+"/audit.jsonl", 10)
	server2 := httptest.NewServer(NewServer(service).Handler())
	defer server2.Close()
	req, _ := http.NewRequest(http.MethodPost, server2.URL+"/resource-market/rent", strings.NewReader("{"))
	req.Header.Set("X-YNX-Resource-Key", testAPIKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected invalid JSON rejection, got %d", resp.StatusCode)
	}

	large := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(bytes.Repeat([]byte("x"), MaxResponseBytes+1))
	}))
	defer large.Close()
	largeService, err := New(Config{ChainURL: large.URL, APIKey: testAPIKey, UpstreamKey: testUpstreamKey, AuditLog: t.TempDir() + "/audit.jsonl"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := largeService.Proxy(context.Background(), http.MethodGet, "/resource-market/policy", "", nil, "resource-limit"); err == nil || !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("expected bounded response error, got %v", err)
	}
}

func newChainServer(t *testing.T) *httptest.Server {
	t.Helper()
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	for _, address := range []string{"ynx_resource_provider", "ynx_resource_renter"} {
		if _, err := devnet.Faucet(address, 1000); err != nil {
			t.Fatal(err)
		}
	}
	server := httptest.NewServer(api.NewServerWithConfig(devnet, api.ServerConfig{ResourceGatewayUpstreamKey: testUpstreamKey}))
	resp, err := http.Get(server.URL + "/resource-market/policy")
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("configured chain allowed direct Resource Market bypass: %d", resp.StatusCode)
	}
	t.Cleanup(server.Close)
	return server
}

func newTestService(t *testing.T, chainURL, auditPath string, maxRequests int) *Service {
	t.Helper()
	service, err := New(Config{ChainURL: chainURL, APIKey: testAPIKey, UpstreamKey: testUpstreamKey, AuditLog: auditPath, Window: time.Minute, MaxRequests: maxRequests})
	if err != nil {
		t.Fatal(err)
	}
	return service
}

func doResourceJSON(t *testing.T, method, target string, body any, expected int, out any) {
	t.Helper()
	var reader io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(payload)
	}
	req, err := http.NewRequestWithContext(context.Background(), method, target, reader)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-YNX-Resource-Key", testAPIKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != expected {
		responseBody, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected %d got %d: %s", expected, resp.StatusCode, responseBody)
	}
	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			t.Fatal(err)
		}
	}
}
