package exchangeproduct

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeRiskOracle struct {
	mu       sync.Mutex
	snapshot RiskOracleSnapshot
	err      error
}

func (f *fakeRiskOracle) Snapshot(market string) (RiskOracleSnapshot, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return RiskOracleSnapshot{}, f.err
	}
	value := f.snapshot
	if value.Market == "" {
		value.Market = market
	}
	return value, nil
}

func signedRiskSnapshot(now time.Time, sequence, index, mark, funding, confidence int64) RiskOracleSnapshot {
	snapshot := RiskOracleSnapshot{Market: DefaultPerpetualMarket, IndexPriceMicro: index, MarkPriceMicro: mark, FundingRateBPS: funding, ConfidenceBPS: confidence, Source: "ynx-oracle-test", SourceVersion: "consensus-index-v1", Sequence: sequence, ObservedAt: now.Add(-time.Second), ExpiresAt: now.Add(20 * time.Second)}
	snapshot.SourceDigest = RiskOracleDigest(snapshot)
	return snapshot
}

func TestRiskOracleStartsPausedAcceptsAuthoritativeSnapshotAndSurvivesRestart(t *testing.T) {
	now := time.Date(2026, 8, 10, 6, 0, 0, 0, time.UTC)
	s, _, path := newTestService(t)
	s.cfg.Now = func() time.Time { return now }
	initial := s.RiskSnapshot()
	if initial.Status != "paused" || initial.Market.CircuitBreakerReason != "oracle_unavailable" || initial.Oracle != nil {
		t.Fatalf("initial=%+v", initial)
	}
	oracle := &fakeRiskOracle{snapshot: signedRiskSnapshot(now, 1, 2*AmountScale, 2_010_000, 10, 9_900)}
	s.cfg.Oracle, s.cfg.OracleURL = oracle, "https://oracle.test.invalid"
	accepted, err := s.RefreshRiskOracle()
	if err != nil || accepted.Status != "active" || accepted.Oracle == nil || accepted.Oracle.SourceDigest == "" || accepted.Market.LastOracleDigest != accepted.Oracle.SourceDigest {
		t.Fatalf("accepted=%+v err=%v", accepted, err)
	}
	restarted, err := New(s.cfg)
	if err != nil || restarted.cfg.StatePath != path {
		t.Fatal(err)
	}
	after := restarted.RiskSnapshot()
	if after.Status != "active" || after.Oracle == nil || after.Oracle.Sequence != 1 || after.Market.LastOracleDigest != accepted.Market.LastOracleDigest {
		t.Fatalf("after=%+v", after)
	}
}

func TestRiskOracleRejectsTamperStaleReplayAndRollbackWithoutMutatingAcceptedState(t *testing.T) {
	now := time.Date(2026, 8, 10, 7, 0, 0, 0, time.UTC)
	s, _, _ := newTestService(t)
	s.cfg.Now = func() time.Time { return now }
	oracle := &fakeRiskOracle{snapshot: signedRiskSnapshot(now, 7, 3*AmountScale, 3*AmountScale, 0, 10_000)}
	s.cfg.Oracle, s.cfg.OracleURL = oracle, "https://oracle.test.invalid"
	accepted, err := s.RefreshRiskOracle()
	if err != nil {
		t.Fatal(err)
	}
	oracle.snapshot.MarkPriceMicro++
	if _, err := s.RefreshRiskOracle(); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("tampered digest err=%v", err)
	}
	oracle.snapshot = signedRiskSnapshot(now.Add(-time.Minute), 8, 3*AmountScale, 3*AmountScale, 0, 10_000)
	if _, err := s.RefreshRiskOracle(); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("stale err=%v", err)
	}
	oracle.snapshot = signedRiskSnapshot(now, 6, 3*AmountScale, 3*AmountScale, 0, 10_000)
	if _, err := s.RefreshRiskOracle(); !errors.Is(err, ErrConflict) {
		t.Fatalf("rollback err=%v", err)
	}
	current := s.RiskSnapshot()
	if current.Oracle == nil || current.Oracle.Sequence != 7 || current.Oracle.SourceDigest != accepted.Oracle.SourceDigest {
		t.Fatalf("accepted state mutated=%+v", current)
	}
}

func TestRiskOracleEnforcesConfidenceBandsFundingAndStaleness(t *testing.T) {
	now := time.Date(2026, 8, 10, 8, 0, 0, 0, time.UTC)
	cases := []struct {
		name     string
		snapshot RiskOracleSnapshot
		status   string
		reason   string
	}{
		{"confidence", signedRiskSnapshot(now, 1, AmountScale, AmountScale, 0, 9_000), "paused", "oracle_confidence_below_policy"},
		{"price-band", signedRiskSnapshot(now, 1, AmountScale, 1_150_000, 0, 10_000), "reduce_only", "mark_index_price_band"},
		{"breaker", signedRiskSnapshot(now, 1, AmountScale, 1_250_000, 0, 10_000), "paused", "mark_index_circuit_breaker"},
		{"funding", signedRiskSnapshot(now, 1, AmountScale, AmountScale, 101, 10_000), "reduce_only", "funding_rate_outside_policy"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, _, _ := newTestService(t)
			s.cfg.Now = func() time.Time { return now }
			s.cfg.Oracle, s.cfg.OracleURL = &fakeRiskOracle{snapshot: tc.snapshot}, "https://oracle.test.invalid"
			got, err := s.RefreshRiskOracle()
			if err != nil || got.Status != tc.status || got.Market.CircuitBreakerReason != tc.reason || (tc.status != "active" && !got.Market.ReduceOnly) {
				t.Fatalf("got=%+v err=%v", got, err)
			}
		})
	}
	s, _, _ := newTestService(t)
	s.cfg.Now = func() time.Time { return now }
	s.cfg.Oracle, s.cfg.OracleURL = &fakeRiskOracle{snapshot: signedRiskSnapshot(now, 1, AmountScale, AmountScale, 0, 10_000)}, "https://oracle.test.invalid"
	if _, err := s.RefreshRiskOracle(); err != nil {
		t.Fatal(err)
	}
	s.cfg.Now = func() time.Time { return now.Add(31 * time.Second) }
	stale := s.RiskSnapshot()
	if stale.Status != "paused" || stale.Market.CircuitBreakerReason != "oracle_stale" {
		t.Fatalf("stale=%+v", stale)
	}
}

func TestHTTPRiskOracleAndAdminRefreshContract(t *testing.T) {
	now := time.Date(2026, 8, 10, 9, 0, 0, 0, time.UTC)
	expected := signedRiskSnapshot(now, 4, 4*AmountScale, 4*AmountScale, -4, 9_999)
	var gotPath string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		writeJSON(w, http.StatusOK, expected)
	}))
	defer upstream.Close()
	httpOracle := HTTPRiskOracle{BaseURL: upstream.URL, Client: upstream.Client()}
	read, err := httpOracle.Snapshot(DefaultPerpetualMarket)
	if err != nil || gotPath != "/v1/markets/YNXT-YUSD_TEST-PERP" || read.SourceDigest != expected.SourceDigest {
		t.Fatalf("read=%+v path=%s err=%v", read, gotPath, err)
	}
	s, _, _ := newTestService(t)
	s.cfg.Now = func() time.Time { return now }
	s.cfg.Oracle, s.cfg.OracleURL = httpOracle, upstream.URL
	server := httptest.NewServer(NewServer(s))
	defer server.Close()
	resp, err := http.Post(server.URL+"/v1/admin/risk/oracle/refresh", "application/json", nil)
	if err != nil || resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthorized err=%v status=%v", err, resp.StatusCode)
	}
	resp.Body.Close()
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/admin/risk/oracle/refresh", nil)
	req.Header.Set("Authorization", "Bearer "+adminKey)
	resp, err = http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("refresh err=%v status=%v", err, resp.StatusCode)
	}
	var snapshot RiskPublicSnapshot
	if err := json.NewDecoder(resp.Body).Decode(&snapshot); err != nil || snapshot.Status != "active" || snapshot.Oracle == nil || snapshot.Oracle.Sequence != 4 {
		t.Fatalf("snapshot=%+v err=%v", snapshot, err)
	}
	resp.Body.Close()
}

func TestPerpetualRiskTiersAreDeterministicAndBounded(t *testing.T) {
	policy := PerpetualPolicy()
	if len(policy.Tiers) != 3 || policy.Tiers[0].MaintenanceMarginBPS >= policy.Tiers[0].InitialMarginBPS || policy.OpenInterestCapMicro <= policy.Tiers[len(policy.Tiers)-1].MaxNotionalMicro {
		t.Fatalf("policy=%+v", policy)
	}
	for _, tc := range []struct{ notional, leverage int64 }{{AmountScale, 10}, {5_000 * AmountScale, 5}, {50_000 * AmountScale, 2}} {
		tier, err := riskTierForNotional(tc.notional, policy)
		if err != nil || tier.MaxLeverage != tc.leverage {
			t.Fatalf("notional=%d tier=%+v err=%v", tc.notional, tier, err)
		}
	}
	if _, err := riskTierForNotional(100_001*AmountScale, policy); !errors.Is(err, ErrForbidden) || !strings.Contains(err.Error(), "maximum risk tier") {
		t.Fatalf("over-cap err=%v", err)
	}
}
