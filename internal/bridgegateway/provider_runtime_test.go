package bridgegateway

import (
	"context"
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

type providerRoundTripFunc func(*http.Request) (*http.Response, error)

func (fn providerRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

func providerTestConfig(t *testing.T, transport http.RoundTripper) Config {
	t.Helper()
	base := newTestBridge(t)
	sourceDomain, destinationDomain := uint32(0), uint32(6)
	decimals := uint8(6)
	base.cfg.StatePath = filepath.Join(t.TempDir(), "provider", "state.json")
	base.cfg.Policies = []RoutePolicy{{
		Provider: "circle-cctp-v2", Classification: "official-stablecoin-transfer-candidate",
		SourceChain: "ethereum-sepolia", DestinationChain: "base-sepolia",
		SourceAsset: "sepolia-usdc", DestinationAsset: "base-sepolia-usdc",
		SourceAssetClass: "testnet-stablecoin", DestinationAssetClass: "testnet-stablecoin",
		MinConfirmations: 12, MaxAmount: "1000000000", MaxOutstanding: "1000000000",
		DailyLimit: "1000000000", UserOutstandingLimit: "1000000000",
		LargeTransferThreshold: "500000000", LargeTransferDelaySeconds: 3600,
		AssetBoundary: "canonical-to-canonical", ExternalSubmission: false,
	}}
	base.cfg.ProviderRoutes = []ProviderRouteConfig{{
		Provider: "circle-cctp-v2", Adapter: "circle-cctp-v2", Environment: "testnet",
		BaseURL:     "https://iris-api-sandbox.circle.com",
		SourceChain: "ethereum-sepolia", DestinationChain: "base-sepolia",
		SourceAsset: "sepolia-usdc", DestinationAsset: "base-sepolia-usdc",
		SourceDomain: &sourceDomain, DestinationDomain: &destinationDomain,
		SourceSymbol: "USDC", DestinationSymbol: "USDC",
		SourceDecimals: &decimals, DestinationDecimals: &decimals,
		SourceTokenContract:      "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
		DestinationTokenContract: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
		SourceContract:           "0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa",
		DestinationContract:      "0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa",
		SourceExplorerURL:        "https://sepolia.etherscan.io/address/0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa",
		DestinationExplorerURL:   "https://sepolia.basescan.org/address/0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa",
		FinalityThreshold:        1000, EstimatedMinSeconds: 15, EstimatedMaxSeconds: 300,
		RouteSupportVerified: true, ContractsVerified: true, AgreementApproved: true, OperationalReviewApproved: true,
		RouteSupportEvidenceURL: "https://developers.circle.com/cctp/concepts/supported-chains-and-domains",
		AgreementEvidenceURL:    "https://www.circle.com/legal/developer-terms",
		OperationalReviewURL:    "https://developers.circle.com/cctp/references/technical-guide",
		License:                 "Circle Developer Terms",
		TermsURL:                "https://www.circle.com/legal/developer-terms",
		Jurisdiction:            "provider-contracting-entity-review-test-fixture",
		DataRetention:           "public-api-request-metadata-per-provider-policy",
		DataRights:              "public-fee-data-no-user-private-key",
		Fallback:                "fail-closed-no-provider-fallback",
		OutageMode:              "route-unavailable-no-cache-promotion",
	}}
	base.cfg.ProviderClient = &http.Client{Transport: transport, Timeout: time.Second}
	return base.cfg
}

func providerQuoteRequest() QuoteRequest {
	return QuoteRequest{
		SourceChain: "ethereum-sepolia", DestinationChain: "base-sepolia",
		SourceAsset: "sepolia-usdc", DestinationAsset: "base-sepolia-usdc",
		Amount: "1000000", Sender: "0x" + strings.Repeat("b", 40),
		Recipient: "0x" + strings.Repeat("c", 40),
	}
}

func providerResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func TestCircleCCTPV2ProviderTermsAreLiveButExecutionStaysDisabled(t *testing.T) {
	var calls atomic.Int32
	cfg := providerTestConfig(t, providerRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		calls.Add(1)
		if request.Method != http.MethodGet || request.URL.String() != "https://iris-api-sandbox.circle.com/v2/burn/USDC/fees/0/6" ||
			request.Header.Get("Accept") != "application/json" || request.Header.Get("Authorization") != "" {
			t.Fatalf("unexpected provider request: %s %s %#v", request.Method, request.URL, request.Header)
		}
		return providerResponse(http.StatusOK, `[{"finalityThreshold":1000,"minimumFee":1},{"finalityThreshold":2000,"minimumFee":0}]`), nil
	}))
	service, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	quote, err := service.Quote(providerQuoteRequest())
	if err != nil {
		t.Fatal(err)
	}
	if quote.Coverage != "official-circle-cctp-v2-fee-terms-with-external-submission-disabled" ||
		quote.Availability != "provider-terms-available" || quote.Provider != "circle-cctp-v2" ||
		quote.Fees.Status != "live-circle-cctp-v2-fee-bps" || quote.Fees.Currency == nil || *quote.Fees.Currency != "basis-points" ||
		quote.Fees.ProviderFee == nil || *quote.Fees.ProviderFee != "1" || quote.Executable ||
		quote.FailureStatus != "source-intent-builder-and-testnet-execution-unavailable" ||
		quote.SourceEndpoint.Contract == nil || quote.DestinationEndpoint.Contract == nil ||
		!quote.SourceEndpoint.ContractVerified || !quote.DestinationEndpoint.ContractVerified {
		t.Fatalf("live provider quote is not truthful: %+v", quote)
	}
	session := GatewaySessionContext{
		Product: "ynx-wallet", SessionID: "provider-session-001",
		Account:  "ynx1providerreview000000000000000000000000001",
		DeviceID: "provider-device-001", Scope: "bridge:review:create",
		ExpiresAt: cfg.Now().Add(time.Hour),
	}
	review, err := service.ReviewQuote(session, WalletReviewRequest{Quote: quote})
	if err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 || review.Status != "blocked" || review.ApprovalAllowed || review.WalletSignatureRequired ||
		review.SourceSubmissionAllowed || review.FailureStatus != "source-intent-builder-and-testnet-execution-unavailable" {
		t.Fatalf("Wallet review re-fetched or overclaimed provider execution: calls=%d review=%+v", calls.Load(), review)
	}
	registry := service.ProviderRegistry()
	assets := service.AssetCatalog()
	build := buildinfo.Info{Commit: strings.Repeat("a", 40), Release: "provider-test", BuildTime: "2026-07-26T00:00:00Z"}
	status := service.ProductStatus(build)
	health := service.Health(build)
	if registry.Coverage != "configured-provider-routes-and-cached-live-api-health-no-executable-route-or-independent-incident-history" ||
		registry.Providers[0].Health != "connected-live-fee-api" || registry.Providers[0].RouteAvailable || registry.Providers[0].Executable ||
		registry.Providers[0].LastSuccess == nil || status.AvailableProviderCount != 1 ||
		status.ProviderConnection != "connected-live-provider-api-route-execution-disabled" ||
		status.ExternalSubmissionEnabled || status.UserAssetMovementEnabled || status.OfficialStablecoinRouteAvailable ||
		health.AvailableProviderCount != 1 || health.LiveBridge || health.ExternalSubmissionEnabled ||
		health.ProviderStatus != "connected-live-provider-api-route-execution-disabled" {
		t.Fatalf("provider status conflates connectivity with route execution: registry=%+v status=%+v health=%+v", registry, status, health)
	}
	if len(assets.Assets) != 2 {
		t.Fatalf("provider asset metadata is missing: %+v", assets)
	}
	for _, asset := range assets.Assets {
		if asset.Canonicality != "canonical" || asset.Symbol == nil || *asset.Symbol != "USDC" || asset.Decimals == nil || *asset.Decimals != 6 ||
			asset.Contract == nil || !asset.ContractVerified || asset.ExplorerURL == nil || asset.Availability != "unavailable" || asset.ExternalExecutionEnabled {
			t.Fatalf("provider asset metadata overclaims or omits evidence: %+v", asset)
		}
	}
}

func TestCircleCCTPV2ProviderFailuresStayFailClosed(t *testing.T) {
	tests := map[string]providerRoundTripFunc{
		"transport": func(*http.Request) (*http.Response, error) { return nil, errors.New("provider timeout") },
		"rate-limit": func(*http.Request) (*http.Response, error) {
			return providerResponse(http.StatusTooManyRequests, `{"error":"rate limited"}`), nil
		},
		"unknown-field": func(*http.Request) (*http.Response, error) {
			return providerResponse(http.StatusOK, `[{"finalityThreshold":1000,"minimumFee":1,"unexpected":true}]`), nil
		},
		"duplicate-tier": func(*http.Request) (*http.Response, error) {
			return providerResponse(http.StatusOK, `[{"finalityThreshold":1000,"minimumFee":1},{"finalityThreshold":1000,"minimumFee":2}]`), nil
		},
		"missing-tier": func(*http.Request) (*http.Response, error) {
			return providerResponse(http.StatusOK, `[{"finalityThreshold":2000,"minimumFee":0}]`), nil
		},
		"oversized": func(*http.Request) (*http.Response, error) {
			return providerResponse(http.StatusOK, strings.Repeat(" ", circleCCTPProviderResponseLimit+1)), nil
		},
	}
	for name, transport := range tests {
		t.Run(name, func(t *testing.T) {
			service, err := New(providerTestConfig(t, transport))
			if err != nil {
				t.Fatal(err)
			}
			quote, err := service.Quote(providerQuoteRequest())
			if err != nil {
				t.Fatal(err)
			}
			if quote.Executable || quote.Availability != "unavailable" || quote.Fees.ProviderFee != nil ||
				(quote.FailureStatus != "provider-fee-api-unavailable" && quote.FailureStatus != "provider-finality-tier-unavailable") {
				t.Fatalf("provider failure did not stay fail closed: %+v", quote)
			}
			if service.Health(buildinfo.Info{}).AvailableProviderCount != 0 {
				t.Fatal("failed provider was counted as available")
			}
		})
	}
}

func TestCircleCCTPV2ProviderConfigRejectsUnownedOrUnofficialRoutes(t *testing.T) {
	cfg := providerTestConfig(t, providerRoundTripFunc(func(*http.Request) (*http.Response, error) {
		return providerResponse(http.StatusOK, `[]`), nil
	}))
	cfg.ProviderRoutes[0].BaseURL = "https://provider.invalid"
	if _, err := New(cfg); err == nil || !strings.Contains(err.Error(), "official Circle CCTP V2 testnet API") {
		t.Fatalf("unofficial provider host expected rejection, got %v", err)
	}
	cfg = providerTestConfig(t, http.DefaultTransport)
	cfg.ProviderRoutes[0].Provider = "different-provider"
	if _, err := New(cfg); err == nil || !strings.Contains(err.Error(), "owned route policy") {
		t.Fatalf("unowned provider route expected rejection, got %v", err)
	}
	cfg = providerTestConfig(t, http.DefaultTransport)
	cfg.Policies[0].DestinationChain = "ynx_6423-1"
	cfg.ProviderRoutes[0].DestinationChain = "ynx_6423-1"
	if _, err := New(cfg); err == nil || !strings.Contains(err.Error(), "official CCTP testnet domain table") {
		t.Fatalf("unsupported YNX CCTP domain expected rejection, got %v", err)
	}
	cfg = providerTestConfig(t, http.DefaultTransport)
	cfg.ProviderRoutes[0].OperationalReviewURL = ""
	if _, err := New(cfg); err == nil || !strings.Contains(err.Error(), "complete evidence and policy") {
		t.Fatalf("approved review without evidence expected rejection, got %v", err)
	}
}

func TestCircleCCTPV2IncompleteApprovalDoesNotCallProvider(t *testing.T) {
	var calls atomic.Int32
	cfg := providerTestConfig(t, providerRoundTripFunc(func(*http.Request) (*http.Response, error) {
		calls.Add(1)
		return providerResponse(http.StatusOK, `[]`), nil
	}))
	cfg.ProviderRoutes[0].AgreementApproved = false
	service, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	quote, err := service.Quote(providerQuoteRequest())
	if err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 0 || quote.FailureStatus != "provider-route-approval-incomplete" || quote.Executable {
		t.Fatalf("incomplete approval contacted provider or enabled route: calls=%d quote=%+v", calls.Load(), quote)
	}
}

func TestCircleCCTPV2ConnectivityProbeDoesNotApproveOrExecuteRoute(t *testing.T) {
	var calls atomic.Int32
	cfg := providerTestConfig(t, providerRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		calls.Add(1)
		if request.Method != http.MethodGet || request.URL.String() != "https://iris-api-sandbox.circle.com/v2/burn/USDC/fees/0/6" {
			t.Fatalf("unexpected provider probe request: %s %s", request.Method, request.URL)
		}
		return providerResponse(http.StatusOK, `[{"finalityThreshold":1000,"minimumFee":1},{"finalityThreshold":2000,"minimumFee":0}]`), nil
	}))
	cfg.ProviderRoutes[0].ConnectivityProbeEnabled = true
	cfg.ProviderRoutes[0].AgreementApproved = false
	cfg.ProviderRoutes[0].AgreementEvidenceURL = ""
	service, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Fatalf("startup connectivity probe calls=%d, want 1", calls.Load())
	}
	quote, err := service.Quote(providerQuoteRequest())
	if err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 || quote.Availability != "unavailable" ||
		quote.FailureStatus != "provider-route-approval-incomplete" || quote.Executable {
		t.Fatalf("probe approved, executed, or re-fetched route: calls=%d quote=%+v", calls.Load(), quote)
	}
	registry := service.ProviderRegistry()
	routes := service.RouteCatalog()
	status := service.ProductStatus(buildinfo.Info{})
	if len(registry.Providers) != 1 || registry.Providers[0].Health != "connected-live-fee-api" ||
		registry.Providers[0].AgreementApproved || registry.Providers[0].RouteAvailable || registry.Providers[0].Executable ||
		registry.Providers[0].TestnetStatus != "official-fee-api-connected-route-approval-incomplete" ||
		registry.Providers[0].FailureStatus != "provider-route-approval-incomplete" ||
		status.ProviderConnection != "connected-live-provider-api-route-execution-disabled" ||
		status.OfficialStablecoinRouteAvailable || status.ExternalSubmissionEnabled || status.UserAssetMovementEnabled {
		t.Fatalf("probe boundary overclaims route: registry=%+v status=%+v", registry, status)
	}
	if len(routes.Routes) != 1 || routes.Routes[0].ProviderHealth != "connected-live-fee-api" ||
		routes.Routes[0].Availability != "unavailable" ||
		routes.Routes[0].FailureStatus != "provider-route-approval-incomplete" ||
		routes.Routes[0].Executable || routes.Routes[0].ExternalSubmissionEnabled {
		t.Fatalf("public route catalog conflates connectivity with approval: %+v", routes)
	}
}

func TestCircleCCTPV2ConnectivityProbeFailureStartsFailClosed(t *testing.T) {
	cfg := providerTestConfig(t, providerRoundTripFunc(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("provider unavailable")
	}))
	cfg.ProviderRoutes[0].ConnectivityProbeEnabled = true
	service, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	registry := service.ProviderRegistry()
	if len(registry.Providers) != 1 || registry.Providers[0].Health != "unavailable" ||
		registry.Providers[0].FailureStatus != "provider-connectivity-probe-unavailable" ||
		registry.Providers[0].RouteAvailable || registry.Providers[0].Executable {
		t.Fatalf("failed connectivity probe did not stay fail closed: %+v", registry)
	}
}

func TestCircleCCTPV2ConnectivityProbeRequiresVerifiedRouteAndContracts(t *testing.T) {
	cfg := providerTestConfig(t, http.DefaultTransport)
	cfg.ProviderRoutes[0].ConnectivityProbeEnabled = true
	cfg.ProviderRoutes[0].ContractsVerified = false
	if _, err := New(cfg); err == nil || !strings.Contains(err.Error(), "connectivity probe requires verified route support and contracts") {
		t.Fatalf("unverified connectivity probe expected rejection, got %v", err)
	}
	cfg = providerTestConfig(t, http.DefaultTransport)
	cfg.ProviderRoutes[0].ConnectivityProbeEnabled = true
	cfg.ProviderRoutes[0].ConnectivityProbeInterval = providerConnectivityProbeMinIntervalSeconds - 1
	if _, err := New(cfg); err == nil || !strings.Contains(err.Error(), "connectivity probe interval must be between") {
		t.Fatalf("unsafe connectivity probe interval expected rejection, got %v", err)
	}
	cfg = providerTestConfig(t, http.DefaultTransport)
	cfg.ProviderRoutes[0].ConnectivityProbeInterval = providerConnectivityProbeDefaultIntervalSeconds
	if _, err := New(cfg); err == nil || !strings.Contains(err.Error(), "connectivity probe interval requires the probe to be enabled") {
		t.Fatalf("orphan connectivity probe interval expected rejection, got %v", err)
	}
}

func TestCircleCCTPV2ConnectivityProbeExpiresStaleSuccess(t *testing.T) {
	now := time.Date(2026, 7, 27, 1, 2, 3, 0, time.UTC)
	cfg := providerTestConfig(t, providerRoundTripFunc(func(*http.Request) (*http.Response, error) {
		return providerResponse(http.StatusOK, `[{"finalityThreshold":1000,"minimumFee":1},{"finalityThreshold":2000,"minimumFee":0}]`), nil
	}))
	cfg.Now = func() time.Time { return now }
	cfg.ProviderRoutes[0].ConnectivityProbeEnabled = true
	cfg.ProviderRoutes[0].ConnectivityProbeInterval = providerConnectivityProbeMinIntervalSeconds
	service, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(time.Duration(providerConnectivityProbeMinIntervalSeconds*providerConnectivityProbeStaleIntervalMultiplier)*time.Second + time.Nanosecond)
	registry := service.ProviderRegistry()
	routes := service.RouteCatalog()
	status := service.ProductStatus(buildinfo.Info{})
	if len(registry.Providers) != 1 || registry.Providers[0].Health != "stale" ||
		registry.Providers[0].FailureStatus != "provider-connectivity-observation-stale" ||
		registry.Providers[0].TestnetStatus != "provider-api-stale-route-unavailable" ||
		registry.Providers[0].LastSuccess == nil || registry.Providers[0].RouteAvailable || registry.Providers[0].Executable {
		t.Fatalf("stale Provider success remained connected: %+v", registry)
	}
	if len(routes.Routes) != 1 || routes.Routes[0].ProviderHealth != "stale" ||
		routes.Routes[0].Availability != "unavailable" ||
		routes.Routes[0].FailureStatus != "provider-connectivity-observation-stale" ||
		routes.Routes[0].Executable || routes.Routes[0].ExternalSubmissionEnabled {
		t.Fatalf("stale Provider route remained available: %+v", routes)
	}
	if status.AvailableProviderCount != 0 || status.ProviderConnection != "configured-provider-api-stale" ||
		status.FailureStatus != "provider-connectivity-observation-stale" ||
		status.OfficialStablecoinRouteAvailable || status.ExternalSubmissionEnabled || status.UserAssetMovementEnabled {
		t.Fatalf("stale Provider status remained connected: %+v", status)
	}
	health := service.Health(buildinfo.Info{Commit: strings.Repeat("a", 40)})
	if health.ProviderStatus != "configured-provider-api-stale" ||
		health.Dependencies["provider"] != "configured-provider-api-stale" ||
		health.AvailableProviderCount != 0 || health.LiveBridge || health.ExternalSubmissionEnabled {
		t.Fatalf("stale Provider health remained connected: %+v", health)
	}
}

func TestCircleCCTPV2QuoteObservationExpiresWithoutBackgroundProbe(t *testing.T) {
	now := time.Date(2026, 7, 27, 1, 2, 3, 0, time.UTC)
	cfg := providerTestConfig(t, providerRoundTripFunc(func(*http.Request) (*http.Response, error) {
		return providerResponse(http.StatusOK, `[{"finalityThreshold":1000,"minimumFee":1},{"finalityThreshold":2000,"minimumFee":0}]`), nil
	}))
	cfg.Now = func() time.Time { return now }
	service, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Quote(providerQuoteRequest()); err != nil {
		t.Fatal(err)
	}
	now = now.Add(time.Duration(providerConnectivityProbeDefaultIntervalSeconds*providerConnectivityProbeStaleIntervalMultiplier)*time.Second + time.Nanosecond)
	registry := service.ProviderRegistry()
	status := service.ProductStatus(buildinfo.Info{})
	if len(registry.Providers) != 1 || registry.Providers[0].Health != "stale" ||
		registry.Providers[0].FailureStatus != "provider-connectivity-observation-stale" ||
		status.AvailableProviderCount != 0 || status.ProviderConnection != "configured-provider-api-stale" {
		t.Fatalf("quote-only Provider observation remained connected: registry=%+v status=%+v", registry, status)
	}
}

func TestCircleCCTPV2PeriodicProbeFailsClosedRecoversAndStops(t *testing.T) {
	var calls atomic.Int32
	var unavailable atomic.Bool
	cfg := providerTestConfig(t, providerRoundTripFunc(func(*http.Request) (*http.Response, error) {
		calls.Add(1)
		if unavailable.Load() {
			return nil, errors.New("provider unavailable")
		}
		return providerResponse(http.StatusOK, `[{"finalityThreshold":1000,"minimumFee":1},{"finalityThreshold":2000,"minimumFee":0}]`), nil
	}))
	cfg.ProviderRoutes[0].ConnectivityProbeEnabled = true
	service, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	key := routeKey(cfg.ProviderRoutes[0].SourceChain, cfg.ProviderRoutes[0].DestinationChain, cfg.ProviderRoutes[0].SourceAsset, cfg.ProviderRoutes[0].DestinationAsset)
	config := service.providerRoutes[key]
	ctx, cancel := context.WithCancel(context.Background())
	done := service.startProviderProbe(ctx, key, config, 5*time.Millisecond)
	unavailable.Store(true)
	waitForProviderHealth(t, service, "unavailable")
	if status := service.ProductStatus(buildinfo.Info{}); status.AvailableProviderCount != 0 || status.ProviderConnection != "configured-provider-api-unavailable" || status.FailureStatus != "provider-connectivity-probe-unavailable" {
		t.Fatalf("periodic Provider failure did not degrade status: %+v", status)
	}
	failedRegistry := service.ProviderRegistry()
	if failedRegistry.Providers[0].TestnetStatus != "provider-api-unavailable-route-unavailable" ||
		failedRegistry.Providers[0].FailureStatus != "provider-connectivity-probe-unavailable" {
		t.Fatalf("periodic Provider failure did not degrade registry: %+v", failedRegistry)
	}
	unavailable.Store(false)
	waitForProviderHealth(t, service, "connected-live-fee-api")
	if status := service.ProductStatus(buildinfo.Info{}); status.AvailableProviderCount != 1 || status.ProviderConnection != "connected-live-provider-api-route-execution-disabled" {
		t.Fatalf("periodic Provider recovery did not restore connectivity: %+v", status)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("periodic Provider probe did not stop after context cancellation")
	}
	if calls.Load() < 3 {
		t.Fatalf("periodic Provider probe calls=%d, want startup, failure, and recovery", calls.Load())
	}
}

func waitForProviderHealth(t *testing.T, service *Service, expected string) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		registry := service.ProviderRegistry()
		if len(registry.Providers) == 1 && registry.Providers[0].Health == expected {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("Provider health did not become %q: %+v", expected, service.ProviderRegistry())
}
