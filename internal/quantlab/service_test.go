package quantlab

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type allowMandate struct{}

func (allowMandate) VerifyMandate(m Mandate) error {
	if m.WalletSignature != "wallet-proof" {
		return ErrForbidden
	}
	return nil
}

type testBroker struct{}

func (testBroker) SubmitTestnet(o TestnetOrder) (string, error) {
	return "committed-ynx-testnet-proof", nil
}

func bars() []Bar {
	r := make([]Bar, 48)
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	for i := range r {
		p := int64(1_000_000 + i*1000)
		r[i] = Bar{Time: start.Add(time.Duration(i) * time.Minute), Open: p, High: p + 1000, Low: p - 1000, Close: p, Volume: 20_000_000}
	}
	return r
}
func request() BacktestRequest {
	return BacktestRequest{Strategy: StrategySpec{ID: "ma-1", Name: "Transparent moving average", Family: "transparent", Source: "strategies/ma.yaml", SourceCommit: "abc", License: "Apache-2.0", Seed: 7, Params: map[string]int64{"fast": 3, "slow": 8}, Limitations: "single synthetic series for invariant test"}, Bars: bars(), Assumptions: Assumptions{FeeBPS: 10, SlippageBPS: 5, LatencyBars: 1, ParticipationBPS: 1000, Seed: 7, TrainEnd: 24, WalkForwardWindows: 3}}
}
func TestBacktestIsDeterministicOOSAndPersistent(t *testing.T) {
	p := filepath.Join(t.TempDir(), "state.json")
	s, e := New(Config{StatePath: p})
	if e != nil {
		t.Fatal(e)
	}
	a, e := s.RunBacktest(request())
	if e != nil {
		t.Fatal(e)
	}
	b, e := New(Config{StatePath: p})
	if e != nil {
		t.Fatal(e)
	}
	snap := b.Snapshot()
	if a.Status != "completed_oos" || a.Strategy.DataHash == "" || !a.LeakageChecksPassed || len(a.WalkForward) != 3 || len(a.Sensitivity) != 4 || len(a.Regimes) != 2 || a.NoTradeReturnBPS != 0 || len(snap["experiments"].(map[string]Experiment)) != 1 {
		t.Fatalf("bad result %#v", a)
	}
}
func TestLookAheadAndUnknownJSONFailClosed(t *testing.T) {
	s, _ := New(Config{StatePath: filepath.Join(t.TempDir(), "s.json")})
	r := request()
	r.Assumptions.TrainEnd = len(r.Bars)
	if _, e := s.RunBacktest(r); e == nil {
		t.Fatal("expected split rejection")
	}
}
func TestPaperPartialReconcileAndKill(t *testing.T) {
	s, _ := New(Config{StatePath: filepath.Join(t.TempDir(), "s.json")})
	strategyHash := strings.Repeat("a", 64)
	o, e := s.ApplyPaperSignal(strategyHash, "buy", 1_000_000, 2_000_000, 5_000_000)
	if e != nil || o.Status != "partially_filled" {
		t.Fatalf("%#v %v", o, e)
	}
	snap := s.Snapshot()["paper"].(PaperState)
	if snap.ReconciliationDelta != 0 {
		t.Fatal("initial delta")
	}
	after, e := s.Reconcile(snap.Cash+1, snap.Position)
	if e != nil || !after.KillSwitch {
		t.Fatal("mismatch must kill")
	}
	if _, e = s.ApplyPaperSignal(strategyHash, "buy", 1_000_000, 1, 100); e == nil {
		t.Fatal("kill switch must reject")
	}
}
func TestTamperAndRestartReject(t *testing.T) {
	p := filepath.Join(t.TempDir(), "state.json")
	s, _ := New(Config{StatePath: p})
	_, _ = s.RunBacktest(request())
	b, _ := os.ReadFile(p)
	b[len(b)/2] ^= 1
	_ = os.WriteFile(p, b, 0600)
	if _, e := New(Config{StatePath: p}); e == nil {
		t.Fatal("tamper accepted")
	}
}

func TestBoundedWalletMandateReplayExpiryLimitAndBrokerProof(t *testing.T) {
	now := time.Date(2026, 7, 18, 0, 0, 0, 0, time.UTC)
	s, e := New(Config{StatePath: filepath.Join(t.TempDir(), "s.json"), Now: func() time.Time { return now }, MandateVerifier: allowMandate{}, TestnetBroker: testBroker{}})
	if e != nil {
		t.Fatal(e)
	}
	m := Mandate{Account: "ynx1test", StrategyHash: strings.Repeat("a", 64), Market: "YNXT-YUSD_TEST", MaxNotional: 2_000_000, MaxPosition: 2_000_000, MaxDailyLoss: 500_000, ExpiresAt: now.Add(time.Hour), WalletSignature: "wallet-proof", TestnetOnly: true}
	m, e = s.RegisterMandate(m)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.RegisterMandate(m); e != ErrConflict {
		t.Fatalf("replay=%v", e)
	}
	o, e := s.SubmitTestnet(m.Digest, "buy", 1_000_000, 1_000_000, "bounded-order-1")
	if e != nil || o.Status != "submitted_testnet" || o.BrokerProof == "" {
		t.Fatalf("%+v %v", o, e)
	}
	again, e := s.SubmitTestnet(m.Digest, "buy", 1_000_000, 1_000_000, "bounded-order-1")
	if e != nil || again.ID != o.ID {
		t.Fatal("idempotent replay changed result")
	}
	if _, e = s.SubmitTestnet(m.Digest, "buy", 1_000_000, 3_000_000, "bounded-order-2"); e != ErrForbidden {
		t.Fatalf("limit=%v", e)
	}
	now = now.Add(2 * time.Hour)
	if _, e = s.SubmitTestnet(m.Digest, "buy", 1_000_000, 1, "bounded-order-3"); e != ErrForbidden {
		t.Fatalf("expiry=%v", e)
	}
}

func TestMandateAndBrokerUnavailableFailClosed(t *testing.T) {
	now := time.Now().UTC()
	s, _ := New(Config{StatePath: filepath.Join(t.TempDir(), "s.json")})
	m := Mandate{Account: "ynx1test", StrategyHash: strings.Repeat("a", 64), Market: "YNXT-YUSD_TEST", MaxNotional: 1, MaxPosition: 1, MaxDailyLoss: 1, ExpiresAt: now.Add(time.Hour), WalletSignature: "proof", TestnetOnly: true}
	if _, e := s.RegisterMandate(m); e != ErrUnavailable {
		t.Fatalf("verifier=%v", e)
	}
	if _, e := s.SubmitTestnet(strings.Repeat("b", 64), "buy", 1, 1, "unavailable-1"); e != ErrUnavailable {
		t.Fatalf("broker=%v", e)
	}
}

func TestLifecycleCannotSkipRiskEvidenceOrWalletMandate(t *testing.T) {
	now := time.Date(2026, 7, 22, 0, 0, 0, 0, time.UTC)
	s, _ := New(Config{StatePath: filepath.Join(t.TempDir(), "s.json"), Now: func() time.Time { return now }, MandateVerifier: allowMandate{}, TestnetBroker: testBroker{}})
	experiment, err := s.RunBacktest(request())
	if err != nil || experiment.Strategy.Stage != StageBacktest {
		t.Fatalf("backtest stage=%q err=%v", experiment.Strategy.Stage, err)
	}
	digest := strings.Repeat("e", 64)
	if _, err = s.AdvanceStrategy(experiment.Strategy.ID, LifecycleApproval{TargetStage: StagePaper, RiskApproved: true, EvidenceDigest: digest, Actor: "risk-operator"}); err != ErrForbidden {
		t.Fatalf("stage skip=%v", err)
	}
	for _, target := range []string{StageWalkForward, StagePaper, StageShadow, StageCandidate} {
		if _, err = s.AdvanceStrategy(experiment.Strategy.ID, LifecycleApproval{TargetStage: target, RiskApproved: true, EvidenceDigest: digest, Actor: "risk-operator"}); err != nil {
			t.Fatalf("advance to %s: %v", target, err)
		}
	}
	if _, err = s.AdvanceStrategy(experiment.Strategy.ID, LifecycleApproval{TargetStage: StageBoundedTestnet, RiskApproved: true, EvidenceDigest: digest, Actor: "risk-operator"}); err != ErrForbidden {
		t.Fatalf("missing mandate=%v", err)
	}
	m, err := s.RegisterMandate(Mandate{Account: "ynx1test", StrategyHash: experiment.Strategy.StrategyHash, Market: "YNXT-YUSD_TEST", MaxNotional: 2_000_000, MaxPosition: 2_000_000, MaxDailyLoss: 500_000, ExpiresAt: now.Add(time.Hour), WalletSignature: "wallet-proof", TestnetOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.AdvanceStrategy(experiment.Strategy.ID, LifecycleApproval{TargetStage: StageBoundedTestnet, RiskApproved: true, EvidenceDigest: digest, MandateDigest: m.Digest, Actor: "risk-operator"}); err != nil {
		t.Fatalf("bounded testnet=%v", err)
	}
}

func TestMandateRevocationIsImmediatePersistentAndIdempotent(t *testing.T) {
	now := time.Date(2026, 7, 22, 0, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "s.json")
	s, _ := New(Config{StatePath: path, Now: func() time.Time { return now }, MandateVerifier: allowMandate{}, TestnetBroker: testBroker{}})
	m, err := s.RegisterMandate(Mandate{Account: "ynx1test", StrategyHash: strings.Repeat("a", 64), Market: "YNXT-YUSD_TEST", MaxNotional: 2_000_000, MaxPosition: 2_000_000, MaxDailyLoss: 500_000, ExpiresAt: now.Add(time.Hour), WalletSignature: "wallet-proof", TestnetOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	revoked, err := s.RevokeMandate(m.Digest, "wallet-owner")
	if err != nil || !revoked.Revoked || revoked.RevokedAt.IsZero() {
		t.Fatalf("revoked=%+v err=%v", revoked, err)
	}
	if _, err = s.RevokeMandate(m.Digest, "wallet-owner"); err != nil {
		t.Fatalf("idempotent revoke=%v", err)
	}
	if _, err = s.SubmitTestnet(m.Digest, "buy", 1_000_000, 1, "revoked-order"); err != ErrForbidden {
		t.Fatalf("revoked submit=%v", err)
	}
	restarted, err := New(Config{StatePath: path, Now: func() time.Time { return now }, MandateVerifier: allowMandate{}, TestnetBroker: testBroker{}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = restarted.SubmitTestnet(m.Digest, "buy", 1_000_000, 1, "restart-order"); err != ErrForbidden {
		t.Fatalf("restart submit=%v", err)
	}
}

func TestIndependentServicesDoNotOverwriteSharedState(t *testing.T) {
	path := filepath.Join(t.TempDir(), "shared.json")
	research, _ := New(Config{StatePath: path})
	risk, _ := New(Config{StatePath: path})
	if _, err := research.RunBacktest(request()); err != nil {
		t.Fatal(err)
	}
	if _, err := risk.Kill("cross-process risk test"); err != nil {
		t.Fatal(err)
	}
	researchSnapshot := research.Snapshot()
	if !researchSnapshot["paper"].(PaperState).KillSwitch {
		t.Fatal("research service did not refresh risk state")
	}
	if len(researchSnapshot["experiments"].(map[string]Experiment)) != 1 {
		t.Fatal("risk service overwrote research state")
	}
}
