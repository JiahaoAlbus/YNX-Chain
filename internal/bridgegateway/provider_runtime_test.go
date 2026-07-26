package bridgegateway

import (
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
