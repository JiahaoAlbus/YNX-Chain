package bridgegateway

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	circleCCTPProviderResponseLimit                  = 64 << 10
	providerConnectivityProbeDefaultIntervalSeconds  = 60
	providerConnectivityProbeMinIntervalSeconds      = 30
	providerConnectivityProbeMaxIntervalSeconds      = 3600
	providerConnectivityProbeStaleIntervalMultiplier = 2
)

type providerRuntimeState struct {
	Health      string
	LastSuccess string
	LastFailure string
	Failure     string
}

type circleCCTPFee struct {
	FinalityThreshold uint32          `json:"finalityThreshold"`
	MinimumFee        uint64          `json:"minimumFee"`
	ForwardFee        json.RawMessage `json:"forwardFee,omitempty"`
}

func newProviderHTTPClient(configured *http.Client) *http.Client {
	if configured != nil {
		return configured
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = 5 * time.Second
	transport.TLSHandshakeTimeout = 5 * time.Second
	return &http.Client{
		Transport: transport,
		Timeout:   8 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return errors.New("provider redirects are not allowed")
		},
	}
}

func (s *Service) providerRouteEntry(key string, policy RoutePolicy) (RouteCatalogEntry, bool) {
	config, configured := s.providerRoutes[key]
	if !configured {
		return unavailableRouteCatalogEntry(key, policy), false
	}
	entry := unavailableRouteCatalogEntry(key, policy)
	entry.ProviderHealth = "configured-not-probed"
	entry.Source = providerEndpoint(config.SourceChain, config.SourceAsset, policy.SourceAssetClass, config.SourceSymbol, config.SourceDecimals, config.SourceTokenContract, config.SourceExplorerURL, config.ContractsVerified)
	entry.Destination = providerEndpoint(config.DestinationChain, config.DestinationAsset, policy.DestinationAssetClass, config.DestinationSymbol, config.DestinationDecimals, config.DestinationTokenContract, config.DestinationExplorerURL, config.ContractsVerified)
	if !config.RouteSupportVerified || !config.ContractsVerified || !config.AgreementApproved || !config.OperationalReviewApproved {
		if state := s.providerState(key); state.Health != "" {
			entry.ProviderHealth = state.Health
		}
		entry.FailureStatus = "provider-route-approval-incomplete"
		entry.Risk = []string{"provider route support, contracts, agreement, and operational review must all be verified", "external submission is disabled", "destination asset availability is not proven"}
		return entry, true
	}

	fees, err := s.circleCCTPFees(config)
	if err != nil {
		entry.ProviderHealth = "unavailable"
		entry.FailureStatus = "provider-fee-api-unavailable"
		entry.Risk = []string{"Circle CCTP fee API did not return a valid route response", "external submission is disabled", "destination asset availability is not proven"}
		s.recordProviderFailure(key, entry.FailureStatus)
		return entry, true
	}
	var selected *circleCCTPFee
	for i := range fees {
		if fees[i].FinalityThreshold == config.FinalityThreshold {
			selected = &fees[i]
			break
		}
	}
	if selected == nil {
		entry.ProviderHealth = "invalid-response"
		entry.FailureStatus = "provider-finality-tier-unavailable"
		entry.Risk = []string{"Circle CCTP response omitted the configured finality tier", "external submission is disabled", "destination asset availability is not proven"}
		s.recordProviderFailure(key, entry.FailureStatus)
		return entry, true
	}

	currency, providerFee := "basis-points", strconv.FormatUint(selected.MinimumFee, 10)
	destinationRule := "circle-cctp-v2-attestation-plus-destination-receive-message"
	minSeconds, maxSeconds := config.EstimatedMinSeconds, config.EstimatedMaxSeconds
	entry.Availability = "provider-terms-available"
	entry.FailureStatus = "source-intent-builder-and-testnet-execution-unavailable"
	entry.ProviderHealth = "connected-live-fee-api"
	entry.Fees = RouteFeeDisclosure{Status: "live-circle-cctp-v2-fee-bps", Currency: &currency, ProviderFee: &providerFee, HiddenSpread: false}
	entry.Slippage = RouteSlippageDisclosure{Status: "not-applicable-native-usdc-burn-mint"}
	entry.Timing = RouteTimingDisclosure{Status: "configured-reviewed-estimate", EstimatedMinSeconds: &minSeconds, EstimatedMaxSeconds: &maxSeconds}
	entry.Finality = RouteFinalityDisclosure{SourceConfirmations: policy.MinConfirmations, DestinationRule: &destinationRule, ProofVerification: "circle-attestation-provider-not-independent-ynx-light-client"}
	entry.Refund = RouteRefundDisclosure{Available: false, Mode: "provider-protocol-no-automatic-refund-after-source-burn"}
	entry.Risk = []string{"live provider fee terms do not prove source submission or destination asset availability", "Circle attestation is provider evidence, not an independent YNX light-client proof", "external submission is disabled until Wallet intent and Testnet execution are verified"}
	entry.Executable = false
	entry.ExternalSubmissionEnabled = false
	s.recordProviderSuccess(key)
	return entry, true
}

func (s *Service) providerCatalogEntry(key string, policy RoutePolicy) RouteCatalogEntry {
	config, configured := s.providerRoutes[key]
	if !configured {
		return unavailableRouteCatalogEntry(key, policy)
	}
	entry := unavailableRouteCatalogEntry(key, policy)
	entry.Source = providerEndpoint(config.SourceChain, config.SourceAsset, policy.SourceAssetClass, config.SourceSymbol, config.SourceDecimals, config.SourceTokenContract, config.SourceExplorerURL, config.ContractsVerified)
	entry.Destination = providerEndpoint(config.DestinationChain, config.DestinationAsset, policy.DestinationAssetClass, config.DestinationSymbol, config.DestinationDecimals, config.DestinationTokenContract, config.DestinationExplorerURL, config.ContractsVerified)
	entry.ProviderHealth = "configured-not-probed"
	entry.FailureStatus = "provider-route-approval-incomplete"
	state := s.providerState(key)
	if state.Health != "" {
		entry.ProviderHealth = state.Health
		entry.FailureStatus = state.Failure
	}
	if state.Health == "connected-live-fee-api" {
		if config.AgreementApproved && config.OperationalReviewApproved {
			entry.Availability = "live-provider-terms-on-authenticated-quote-request"
			entry.FailureStatus = "source-intent-builder-and-testnet-execution-unavailable"
			entry.Risk = []string{"provider connectivity does not prove YNX route execution", "live fee terms require a protected quote request", "external submission and destination availability remain disabled"}
		} else {
			entry.Availability = "unavailable"
			entry.FailureStatus = "provider-route-approval-incomplete"
			entry.Risk = []string{"Provider API connectivity does not approve the route", "agreement and operational review are incomplete", "external submission and destination availability remain disabled"}
		}
	}
	return entry
}

func providerEndpoint(chain, asset, assetClass, symbol string, decimals *uint8, contract, explorer string, verified bool) RouteAssetEndpoint {
	return RouteAssetEndpoint{
		Chain: chain, Asset: asset, AssetClass: assetClass,
		Symbol: stringPointer(symbol), Decimals: decimals, Contract: stringPointer(contract),
		ContractVerified: verified, ExplorerURL: stringPointer(explorer),
	}
}

func stringPointer(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func (s *Service) circleCCTPFees(config ProviderRouteConfig) ([]circleCCTPFee, error) {
	return s.circleCCTPFeesContext(context.Background(), config)
}

func (s *Service) circleCCTPFeesContext(parent context.Context, config ProviderRouteConfig) ([]circleCCTPFee, error) {
	if config.SourceDomain == nil || config.DestinationDomain == nil {
		return nil, errors.New("CCTP domains are not configured")
	}
	endpoint := fmt.Sprintf("%s/v2/burn/USDC/fees/%d/%d", config.BaseURL, *config.SourceDomain, *config.DestinationDomain)
	ctx, cancel := context.WithTimeout(parent, 8*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "ynx-bridged/circle-cctp-v2")
	response, err := s.providerClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, circleCCTPProviderResponseLimit+1))
	if err != nil {
		return nil, fmt.Errorf("read Circle CCTP fee response: %w", err)
	}
	if len(body) > circleCCTPProviderResponseLimit {
		return nil, errors.New("Circle CCTP fee response exceeds the response limit")
	}
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Circle CCTP fee API returned HTTP %d", response.StatusCode)
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	var fees []circleCCTPFee
	if err := decoder.Decode(&fees); err != nil {
		return nil, fmt.Errorf("decode Circle CCTP fee response: %w", err)
	}
	if err := ensureJSONEOF(decoder); err != nil {
		return nil, err
	}
	if len(fees) == 0 || len(fees) > 4 {
		return nil, errors.New("Circle CCTP fee response has invalid tier count")
	}
	seen := map[uint32]struct{}{}
	for _, fee := range fees {
		if (fee.FinalityThreshold != 1000 && fee.FinalityThreshold != 2000) || fee.MinimumFee > 10_000 {
			return nil, errors.New("Circle CCTP fee response has invalid values")
		}
		if _, exists := seen[fee.FinalityThreshold]; exists {
			return nil, errors.New("Circle CCTP fee response duplicates a finality tier")
		}
		seen[fee.FinalityThreshold] = struct{}{}
	}
	return fees, nil
}

func (s *Service) probeConfiguredProviderConnectivity() {
	for key, config := range s.providerRoutes {
		if !config.ConnectivityProbeEnabled {
			continue
		}
		s.probeProviderConnectivity(context.Background(), key, config)
	}
}

func (s *Service) probeProviderConnectivity(ctx context.Context, key string, config ProviderRouteConfig) {
	fees, err := s.circleCCTPFeesContext(ctx, config)
	if err != nil {
		s.recordProviderFailure(key, "provider-connectivity-probe-unavailable")
		return
	}
	for _, fee := range fees {
		if fee.FinalityThreshold == config.FinalityThreshold {
			s.recordProviderSuccess(key)
			return
		}
	}
	s.recordProviderFailure(key, "provider-finality-tier-unavailable")
}

func (s *Service) StartProviderProbes(ctx context.Context) {
	s.providerProbeStart.Do(func() {
		for key, config := range s.providerRoutes {
			if config.ConnectivityProbeEnabled {
				s.startProviderProbe(ctx, key, config, time.Duration(config.ConnectivityProbeInterval)*time.Second)
			}
		}
	})
}

func (s *Service) startProviderProbe(ctx context.Context, key string, config ProviderRouteConfig, interval time.Duration) <-chan struct{} {
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				s.probeProviderConnectivity(ctx, key, config)
			case <-ctx.Done():
				return
			}
		}
	}()
	return done
}

func ensureJSONEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("provider response contains multiple JSON values")
		}
		return err
	}
	return nil
}

func (s *Service) recordProviderSuccess(key string) {
	now := s.cfg.Now().UTC().Format(timeFormat)
	s.providerMu.Lock()
	s.providerStates[key] = providerRuntimeState{Health: "connected-live-fee-api", LastSuccess: now}
	s.providerMu.Unlock()
}

func (s *Service) recordProviderFailure(key, failure string) {
	now := s.cfg.Now().UTC().Format(timeFormat)
	s.providerMu.Lock()
	previous := s.providerStates[key]
	previous.Health = "unavailable"
	previous.LastFailure = now
	previous.Failure = failure
	s.providerStates[key] = previous
	s.providerMu.Unlock()
}

func (s *Service) providerState(key string) providerRuntimeState {
	s.providerMu.Lock()
	state := s.providerStates[key]
	s.providerMu.Unlock()
	if state.Health != "connected-live-fee-api" {
		return state
	}
	config, configured := s.providerRoutes[key]
	if !configured {
		return state
	}
	intervalSeconds := config.ConnectivityProbeInterval
	if intervalSeconds == 0 {
		intervalSeconds = providerConnectivityProbeDefaultIntervalSeconds
	}
	lastSuccess, err := time.Parse(timeFormat, state.LastSuccess)
	staleAfter := time.Duration(intervalSeconds*providerConnectivityProbeStaleIntervalMultiplier) * time.Second
	if err != nil || !s.cfg.Now().UTC().Before(lastSuccess.Add(staleAfter)) {
		state.Health = "stale"
		state.Failure = "provider-connectivity-observation-stale"
	}
	return state
}

func (s *Service) providerConnectionSnapshot() (int, string) {
	connected := map[string]struct{}{}
	stale := false
	unavailable := false
	for key, route := range s.providerRoutes {
		state := s.providerState(key)
		switch state.Health {
		case "connected-live-fee-api":
			connected[route.Provider] = struct{}{}
		case "stale":
			stale = true
		case "unavailable":
			unavailable = true
		}
	}
	if len(connected) > 0 {
		return len(connected), "connected-live-provider-api-route-execution-disabled"
	}
	if stale {
		return 0, "configured-provider-api-stale"
	}
	if unavailable {
		return 0, "configured-provider-api-unavailable"
	}
	if len(s.providerRoutes) > 0 {
		return 0, "configured-not-connected"
	}
	return 0, "not-connected"
}
