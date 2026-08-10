package exchangeproduct

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const riskEngineVersion = "ynx-exchange-risk-v1"

type HTTPRiskOracle struct {
	BaseURL string
	Client  *http.Client
}

func (o HTTPRiskOracle) Snapshot(market string) (RiskOracleSnapshot, error) {
	client := o.Client
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	endpoint := strings.TrimRight(strings.TrimSpace(o.BaseURL), "/") + "/v1/markets/" + url.PathEscape(market)
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return RiskOracleSnapshot{}, ErrUnavailable
	}
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return RiskOracleSnapshot{}, ErrUnavailable
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return RiskOracleSnapshot{}, ErrUnavailable
	}
	var snapshot RiskOracleSnapshot
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&snapshot); err != nil {
		return RiskOracleSnapshot{}, ErrUnavailable
	}
	return snapshot, nil
}

func PerpetualPolicy() PerpetualMarketPolicy {
	return PerpetualMarketPolicy{
		Market:                      DefaultPerpetualMarket,
		SettlementAsset:             QuoteAsset,
		OracleRequired:              true,
		OracleMinConfidenceBPS:      9_500,
		OracleMaxAgeSeconds:         30,
		MaxFundingRateBPS:           100,
		PriceBandBPS:                1_000,
		CircuitBreakerBPS:           2_000,
		OpenInterestCapMicro:        1_000_000 * AmountScale,
		LiquidationFeeBPS:           50,
		PartialLiquidationTargetBPS: 12_500,
		InsuranceFundShareBPS:       8_000,
		Tiers: []RiskTier{
			{MaxNotionalMicro: 1_000 * AmountScale, MaxLeverage: 10, InitialMarginBPS: 1_000, MaintenanceMarginBPS: 500},
			{MaxNotionalMicro: 10_000 * AmountScale, MaxLeverage: 5, InitialMarginBPS: 2_000, MaintenanceMarginBPS: 1_000},
			{MaxNotionalMicro: 100_000 * AmountScale, MaxLeverage: 2, InitialMarginBPS: 5_000, MaintenanceMarginBPS: 2_500},
		},
	}
}

func RiskOracleDigest(snapshot RiskOracleSnapshot) string {
	return digest(struct {
		Market          string
		IndexPriceMicro int64
		MarkPriceMicro  int64
		FundingRateBPS  int64
		ConfidenceBPS   int64
		Source          string
		SourceVersion   string
		Sequence        int64
		ObservedAt      time.Time
		ExpiresAt       time.Time
	}{snapshot.Market, snapshot.IndexPriceMicro, snapshot.MarkPriceMicro, snapshot.FundingRateBPS, snapshot.ConfidenceBPS, snapshot.Source, snapshot.SourceVersion, snapshot.Sequence, snapshot.ObservedAt.UTC(), snapshot.ExpiresAt.UTC()})
}

func absolute64(value int64) int64 {
	if value < 0 {
		return -value
	}
	return value
}

func validateRiskOracle(snapshot RiskOracleSnapshot, now time.Time, policy PerpetualMarketPolicy) error {
	snapshot.Market = strings.ToUpper(strings.TrimSpace(snapshot.Market))
	snapshot.Source = strings.TrimSpace(snapshot.Source)
	snapshot.SourceVersion = strings.TrimSpace(snapshot.SourceVersion)
	digestBytes, digestErr := hex.DecodeString(strings.ToLower(strings.TrimSpace(snapshot.SourceDigest)))
	if snapshot.Market != policy.Market || snapshot.IndexPriceMicro <= 0 || snapshot.MarkPriceMicro <= 0 || snapshot.Sequence <= 0 || snapshot.Source == "" || snapshot.SourceVersion == "" || snapshot.FundingRateBPS < -10_000 || snapshot.FundingRateBPS > 10_000 || snapshot.ConfidenceBPS < 0 || snapshot.ConfidenceBPS > 10_000 || snapshot.ObservedAt.IsZero() || snapshot.ExpiresAt.IsZero() || !snapshot.ExpiresAt.After(snapshot.ObservedAt) || snapshot.ObservedAt.After(now.Add(5*time.Second)) || now.Sub(snapshot.ObservedAt) > time.Duration(policy.OracleMaxAgeSeconds)*time.Second || !now.Before(snapshot.ExpiresAt) || digestErr != nil || len(digestBytes) != 32 || RiskOracleDigest(snapshot) != strings.ToLower(snapshot.SourceDigest) {
		return ErrUnavailable
	}
	return nil
}

func riskMarketFromOracle(snapshot RiskOracleSnapshot, now time.Time, policy PerpetualMarketPolicy, previous RiskMarketState) RiskMarketState {
	state := previous
	state.Market = policy.Market
	state.Status = "active"
	state.ReduceOnly = false
	state.CircuitBreakerReason = ""
	deviation := mulDiv(absolute64(snapshot.MarkPriceMicro-snapshot.IndexPriceMicro), 10_000, snapshot.IndexPriceMicro)
	switch {
	case snapshot.ConfidenceBPS < policy.OracleMinConfidenceBPS:
		state.Status, state.ReduceOnly, state.CircuitBreakerReason = "paused", true, "oracle_confidence_below_policy"
	case deviation > policy.CircuitBreakerBPS:
		state.Status, state.ReduceOnly, state.CircuitBreakerReason = "paused", true, "mark_index_circuit_breaker"
	case deviation > policy.PriceBandBPS:
		state.Status, state.ReduceOnly, state.CircuitBreakerReason = "reduce_only", true, "mark_index_price_band"
	case absolute64(snapshot.FundingRateBPS) > policy.MaxFundingRateBPS:
		state.Status, state.ReduceOnly, state.CircuitBreakerReason = "reduce_only", true, "funding_rate_outside_policy"
	}
	state.LastOracleDigest = snapshot.SourceDigest
	state.UpdatedAt = now
	return state
}

func (s *Service) RefreshRiskOracle() (RiskPublicSnapshot, error) {
	if s.cfg.Oracle == nil || s.cfg.OracleURL == "" {
		return s.RiskSnapshot(), ErrUnavailable
	}
	policy := PerpetualPolicy()
	snapshot, err := s.cfg.Oracle.Snapshot(policy.Market)
	if err != nil {
		return s.RiskSnapshot(), ErrUnavailable
	}
	snapshot.Market = strings.ToUpper(strings.TrimSpace(snapshot.Market))
	snapshot.SourceDigest = strings.ToLower(strings.TrimSpace(snapshot.SourceDigest))
	snapshot.ObservedAt = snapshot.ObservedAt.UTC()
	snapshot.ExpiresAt = snapshot.ExpiresAt.UTC()
	now := s.cfg.Now().UTC()
	if err := validateRiskOracle(snapshot, now, policy); err != nil {
		return s.RiskSnapshot(), err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if previous, ok := s.state.RiskOracle[policy.Market]; ok && (snapshot.Sequence <= previous.Sequence || !snapshot.ObservedAt.After(previous.ObservedAt)) {
		if snapshot.Sequence == previous.Sequence && snapshot.SourceDigest == previous.SourceDigest {
			result := s.riskSnapshotLocked(now)
			return result, nil
		}
		return s.riskSnapshotLocked(now), ErrConflict
	}
	before := cloneState(s.state)
	s.state.RiskOracle[policy.Market] = snapshot
	s.state.RiskMarkets[policy.Market] = riskMarketFromOracle(snapshot, now, policy, s.state.RiskMarkets[policy.Market])
	s.auditLocked("system", "risk_oracle_refreshed", "risk_oracle", policy.Market, snapshot.SourceDigest)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return RiskPublicSnapshot{}, err
	}
	return s.riskSnapshotLocked(now), nil
}

func (s *Service) riskSnapshotLocked(now time.Time) RiskPublicSnapshot {
	policy := PerpetualPolicy()
	state, ok := s.state.RiskMarkets[policy.Market]
	if !ok {
		state = RiskMarketState{Market: policy.Market, Status: "paused", ReduceOnly: true, CircuitBreakerReason: "oracle_unavailable"}
	}
	result := RiskPublicSnapshot{Version: riskEngineVersion, Policy: policy, Market: state, InsuranceFund: s.state.InsuranceFund, Status: state.Status, AsOf: now}
	if oracle, exists := s.state.RiskOracle[policy.Market]; exists {
		copy := oracle
		result.Oracle = &copy
		if !now.Before(oracle.ExpiresAt) || now.Sub(oracle.ObservedAt) > time.Duration(policy.OracleMaxAgeSeconds)*time.Second {
			result.Status, result.Market.Status, result.Market.ReduceOnly, result.Market.CircuitBreakerReason = "paused", "paused", true, "oracle_stale"
			result.UnavailableReason = "The latest accepted Oracle observation is stale or expired"
		}
	} else {
		result.Status = "paused"
		result.UnavailableReason = "No authoritative Oracle observation has been accepted"
	}
	return result
}

func (s *Service) RiskSnapshot() RiskPublicSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.riskSnapshotLocked(s.cfg.Now().UTC())
}

func riskTierForNotional(notional int64, policy PerpetualMarketPolicy) (RiskTier, error) {
	for _, tier := range policy.Tiers {
		if notional > 0 && notional <= tier.MaxNotionalMicro {
			return tier, nil
		}
	}
	return RiskTier{}, fmt.Errorf("%w: perpetual notional exceeds the maximum risk tier", ErrForbidden)
}
