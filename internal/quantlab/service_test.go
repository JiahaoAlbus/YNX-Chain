package quantlab

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type allowMandate struct{}

func (allowMandate) VerifyMandate(_ context.Context, m Mandate, _ string) error {
	if m.WalletSignature != "wallet-proof" {
		return ErrForbidden
	}
	return nil
}

type testBroker struct{}

func (testBroker) SubmitTestnet(_ context.Context, _ Mandate, o TestnetOrder, _ string) (TestnetExecutionReceipt, error) {
	return TestnetExecutionReceipt{BrokerProof: "committed-ynx-testnet-proof", VenueOrderID: "exchange-order-1", VenueStatus: "open", AuthorizationDigest: strings.Repeat("a", 64)}, nil
}

func validMandate(now time.Time, strategyHash string) Mandate {
	return Mandate{Account: "ynx1test", StrategyHash: strategyHash, Market: "YNXT-YUSD_TEST", ProductID: ProductID, BundleID: "com.ynx.quantlab.test", DeviceID: "device-test-001", NonceDomain: "quant:" + strategyHash, Scope: "quant:testnet-execute", Nonce: 1, MaxNotional: 2_000_000, MaxPosition: 2_000_000, MaxDailyLoss: 500_000, MaxSlippageBPS: 50, MaxGas: 10_000, MaxOrdersPerMinute: 10, MaxLeverageBPS: 20_000, MaxDrawdown: 500_000, MinLiquidity: 2_000_000, MaxVaR: 300_000, MaxExpectedShortfall: 400_000, MaxDepegBPS: 100, MaxConcentrationBPS: 5000, MaxCancelRateBPS: 5000, MaxConsecutiveAPIFailures: 3, ExpiresAt: now.Add(time.Hour), WalletSignature: "wallet-proof", TestnetOnly: true}
}

func validRisk(now time.Time) TestnetRiskObservation {
	return TestnetRiskObservation{ReferencePrice: 1_000_000, EstimatedGas: 100, Equity: 10_000_000, GrossExposure: 1_000_000, PeakEquity: 10_000_000, CurrentEquity: 9_900_000, AvailableLiquidity: 10_000_000, DepegBPS: 5, ConcentrationBPS: 2000, OrdersObserved: 10, CancelsObserved: 1, VaR: 100_000, ExpectedShortfall: 150_000, OracleAsOf: now, VenueHealthy: true}
}

func validDataset(now time.Time) DatasetRecord {
	return DatasetRecord{ID: "ynx-exchange-matches", Version: "2026-07-22-v1", ContentSHA256: strings.Repeat("d", 64), SchemaVersion: "trades-v1", Provider: "YNX Exchange", OfficialURL: "https://exchange.ynxweb4.com", License: "YNX-testnet-data-terms", TermsVersion: "2026-07-22", Jurisdiction: "operator-review-required", Authentication: "canonical-gateway-session", RateLimit: "100 requests/minute candidate", Retention: "30 days candidate", DataRights: "research-backtest-paper-testnet-only", PermittedUses: []string{"research", "backtest", "paper"}, DataTypes: []string{"trades"}, Timezone: "UTC", Precision: "integer micro-units", CorrectionPolicy: "append correction with superseded hash", BiasControls: []string{"missing-data", "survivorship", "look-ahead", "delisting", "depeg"}, Lineage: []string{"ynx-exchange-match-ledger", "quant-ingestion-v1"}, Source: "ynx-owned-exchange-match-ledger", AsOf: now.Add(-time.Minute), Coverage: "YNXT-YUSD_TEST matched trades", Confidence: "authoritative-for-YNX-Exchange-matches", FailureStatus: "none"}
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
	if a.Status != "completed_oos" || a.Strategy.DataHash == "" || !a.LeakageChecksPassed || len(a.WalkForward) != 3 || len(a.Sensitivity) != 4 || len(a.Regimes) != 2 || a.NoTradeReturnBPS != 0 || !a.Attribution.Reconciled || a.Attribution.UserRealizedPnL+a.Attribution.UserUnrealizedPnL != a.Attribution.UserNetPnL || len(a.Attribution.UnsupportedComponents) != 7 || len(snap["experiments"].(map[string]Experiment)) != 1 {
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
	var document map[string]any
	if json.Unmarshal(b, &document) != nil {
		t.Fatal("decode state")
	}
	document["sequence"] = document["sequence"].(float64) + 1
	b, _ = json.Marshal(document)
	_ = os.WriteFile(p, b, 0600)
	if _, e := New(Config{StatePath: p}); e == nil {
		t.Fatal("tamper accepted")
	}
}

func TestLegacySchemaOneIntegrityLoadsAndInitializesExecutionLedger(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.json")
	legacy := state{Schema: StateSchema, Experiments: map[string]Experiment{}, Strategies: map[string]StrategySpec{}, Datasets: map[string]DatasetRecord{}, Paper: PaperState{Cash: 100_000_000_000}, Mandates: map[string]Mandate{}, TestnetOrders: map[string]TestnetOrder{}, Idempotency: map[string]string{}}
	legacy.Integrity = legacyIntegrityHash(legacy)
	encoded, _ := json.Marshal(legacy)
	var document map[string]any
	_ = json.Unmarshal(encoded, &document)
	delete(document, "executionLedger")
	delete(document, "adapterSequences")
	encoded, _ = json.Marshal(document)
	var roundTrip state
	_ = json.Unmarshal(encoded, &roundTrip)
	if roundTrip.Integrity != legacyIntegrityHash(roundTrip) {
		t.Fatalf("legacy fixture hash mismatch got=%s want=%s", roundTrip.Integrity, legacyIntegrityHash(roundTrip))
	}
	if err := os.WriteFile(path, encoded, 0600); err != nil {
		t.Fatal(err)
	}
	service, err := New(Config{StatePath: path})
	if err != nil {
		t.Fatal(err)
	}
	snapshot := service.Snapshot()
	if snapshot["executionLedger"] == nil || snapshot["adapterSequences"] == nil {
		t.Fatal("legacy execution maps not initialized")
	}
}

func TestBoundedWalletMandateReplayExpiryLimitAndBrokerProof(t *testing.T) {
	now := time.Date(2026, 7, 18, 0, 0, 0, 0, time.UTC)
	s, e := New(Config{StatePath: filepath.Join(t.TempDir(), "s.json"), Now: func() time.Time { return now }, MandateVerifier: allowMandate{}, TestnetBroker: testBroker{}})
	if e != nil {
		t.Fatal(e)
	}
	m := validMandate(now, strings.Repeat("a", 64))
	m, e = s.RegisterMandate(m)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.RegisterMandate(m); e != ErrConflict {
		t.Fatalf("replay=%v", e)
	}
	o, e := s.SubmitTestnet(m.Digest, "buy", 1_000_000, 1_000_000, "bounded-order-1", validRisk(now))
	if e != nil || o.Status != "submitted_testnet" || o.BrokerProof == "" || o.VenueOrderID != "exchange-order-1" || o.VenueStatus != "open" || len(o.AuthorizationDigest) != 64 {
		t.Fatalf("%+v %v", o, e)
	}
	again, e := s.SubmitTestnet(m.Digest, "buy", 1_000_000, 1_000_000, "bounded-order-1", validRisk(now))
	if e != nil || again.ID != o.ID {
		t.Fatal("idempotent replay changed result")
	}
	if _, e = s.SubmitTestnet(m.Digest, "buy", 1_000_000, 3_000_000, "bounded-order-2", validRisk(now)); e != ErrForbidden {
		t.Fatalf("limit=%v", e)
	}
	if _, e = s.SubmitTestnet(m.Digest, "buy", 1_000_000, 1_500_000, "bounded-order-aggregate", validRisk(now)); e != ErrForbidden {
		t.Fatalf("aggregate position=%v", e)
	}
	now = now.Add(2 * time.Hour)
	if _, e = s.SubmitTestnet(m.Digest, "buy", 1_000_000, 1, "bounded-order-3", validRisk(now)); e != ErrForbidden {
		t.Fatalf("expiry=%v", e)
	}
}

func TestTestnetRiskObservationRejectsStaleOracleVenueLossGasSlippageAndFrequency(t *testing.T) {
	now := time.Date(2026, 7, 22, 0, 0, 0, 0, time.UTC)
	s, _ := New(Config{StatePath: filepath.Join(t.TempDir(), "s.json"), Now: func() time.Time { return now }, MandateVerifier: allowMandate{}, TestnetBroker: testBroker{}})
	m := validMandate(now, strings.Repeat("a", 64))
	m.MaxOrdersPerMinute = 1
	m, err := s.RegisterMandate(m)
	if err != nil {
		t.Fatal(err)
	}
	cases := []TestnetRiskObservation{
		{ReferencePrice: 1_000_000, EstimatedGas: 100, OracleAsOf: now.Add(-31 * time.Second), VenueHealthy: true},
		{ReferencePrice: 1_000_000, EstimatedGas: 100, OracleAsOf: now, VenueHealthy: false},
		{ReferencePrice: 1_000_000, EstimatedGas: 100, ObservedDailyLoss: m.MaxDailyLoss, OracleAsOf: now, VenueHealthy: true},
		{ReferencePrice: 1_000_000, EstimatedGas: m.MaxGas + 1, OracleAsOf: now, VenueHealthy: true},
		{ReferencePrice: 900_000, EstimatedGas: 100, OracleAsOf: now, VenueHealthy: true},
	}
	for i, risk := range cases {
		if _, err = s.SubmitTestnet(m.Digest, "buy", 1_000_000, 1, fmt.Sprintf("risk-reject-%02d", i), risk); err != ErrForbidden {
			t.Fatalf("risk case %d=%v", i, err)
		}
	}
	if _, err = s.SubmitTestnet(m.Digest, "buy", 1_000_000, 1, "risk-accepted", validRisk(now)); err != nil {
		t.Fatal(err)
	}
	if _, err = s.SubmitTestnet(m.Digest, "buy", 1_000_000, 1, "risk-frequency", validRisk(now)); err != ErrForbidden {
		t.Fatalf("frequency=%v", err)
	}
}

func TestTestnetRiskRejectsLeverageDrawdownLiquidityDepegConcentrationReliabilityAndTailLoss(t *testing.T) {
	now := time.Date(2026, 7, 22, 0, 0, 0, 0, time.UTC)
	service, _ := New(Config{StatePath: filepath.Join(t.TempDir(), "s.json"), Now: func() time.Time { return now }, MandateVerifier: allowMandate{}, TestnetBroker: testBroker{}})
	mandate, err := service.RegisterMandate(validMandate(now, strings.Repeat("a", 64)))
	if err != nil {
		t.Fatal(err)
	}
	cases := []func(*TestnetRiskObservation){
		func(r *TestnetRiskObservation) { r.Equity = 0 },
		func(r *TestnetRiskObservation) { r.GrossExposure = 20_000_000 },
		func(r *TestnetRiskObservation) { r.CurrentEquity = r.PeakEquity - mandate.MaxDrawdown },
		func(r *TestnetRiskObservation) { r.AvailableLiquidity = mandate.MinLiquidity - 1 },
		func(r *TestnetRiskObservation) { r.DepegBPS = mandate.MaxDepegBPS + 1 },
		func(r *TestnetRiskObservation) { r.ConcentrationBPS = mandate.MaxConcentrationBPS + 1 },
		func(r *TestnetRiskObservation) { r.OrdersObserved, r.CancelsObserved = 10, 6 },
		func(r *TestnetRiskObservation) { r.ConsecutiveAPIFailures = mandate.MaxConsecutiveAPIFailures },
		func(r *TestnetRiskObservation) { r.VaR = mandate.MaxVaR + 1 },
		func(r *TestnetRiskObservation) { r.ExpectedShortfall = mandate.MaxExpectedShortfall + 1 },
	}
	for index, mutate := range cases {
		risk := validRisk(now)
		mutate(&risk)
		if _, err = service.SubmitTestnet(mandate.Digest, "buy", 1_000_000, 1_000_000, fmt.Sprintf("broad-risk-%02d", index), risk); err != ErrForbidden {
			t.Fatalf("risk case %d=%v", index, err)
		}
	}
	overflowRisk := validRisk(now)
	overflowRisk.ReferencePrice = math.MaxInt64
	if _, err = service.SubmitTestnet(mandate.Digest, "buy", math.MaxInt64, 2, "overflow-order", overflowRisk); err != ErrInvalid {
		t.Fatalf("overflow=%v", err)
	}
}

func TestMandateRejectsWrongProductBundleDeviceScopeAndNonce(t *testing.T) {
	now := time.Date(2026, 7, 22, 0, 0, 0, 0, time.UTC)
	s, _ := New(Config{StatePath: filepath.Join(t.TempDir(), "s.json"), Now: func() time.Time { return now }, MandateVerifier: allowMandate{}})
	base := validMandate(now, strings.Repeat("a", 64))
	cases := []func(*Mandate){
		func(m *Mandate) { m.ProductID = "wrong-product" },
		func(m *Mandate) { m.BundleID = "" },
		func(m *Mandate) { m.DeviceID = "" },
		func(m *Mandate) { m.Scope = "quant:*" },
		func(m *Mandate) { m.NonceDomain = "wallet-global" },
		func(m *Mandate) { m.Nonce = 0 },
	}
	for index, mutate := range cases {
		candidate := base
		mutate(&candidate)
		if _, err := s.RegisterMandate(candidate); err != ErrInvalid {
			t.Fatalf("case %d=%v", index, err)
		}
	}
}

func TestMandateAndBrokerUnavailableFailClosed(t *testing.T) {
	now := time.Now().UTC()
	s, _ := New(Config{StatePath: filepath.Join(t.TempDir(), "s.json")})
	m := validMandate(now, strings.Repeat("a", 64))
	m.MaxNotional, m.MaxPosition, m.MaxDailyLoss, m.WalletSignature = 1, 1, 1, "proof"
	if _, e := s.RegisterMandate(m); e != ErrUnavailable {
		t.Fatalf("verifier=%v", e)
	}
	if _, e := s.SubmitTestnet(strings.Repeat("b", 64), "buy", 1, 1, "unavailable-1", validRisk(now)); e != ErrUnavailable {
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
	m, err := s.RegisterMandate(validMandate(now, experiment.Strategy.StrategyHash))
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
	m, err := s.RegisterMandate(validMandate(now, strings.Repeat("a", 64)))
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
	if _, err = s.SubmitTestnet(m.Digest, "buy", 1_000_000, 1, "revoked-order", validRisk(now)); err != ErrForbidden {
		t.Fatalf("revoked submit=%v", err)
	}
	restarted, err := New(Config{StatePath: path, Now: func() time.Time { return now }, MandateVerifier: allowMandate{}, TestnetBroker: testBroker{}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = restarted.SubmitTestnet(m.Digest, "buy", 1_000_000, 1, "restart-order", validRisk(now)); err != ErrForbidden {
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

func TestBackupRestoreDrillRejectsTamperAndRestoresState(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "state.json")
	backupPath := filepath.Join(root, "backup", "state.backup.json")
	service, _ := New(Config{StatePath: statePath})
	if _, err := service.RunBacktest(request()); err != nil {
		t.Fatal(err)
	}
	record, err := service.Backup(backupPath)
	if err != nil || record.SHA256 == "" || record.Bytes <= 0 || record.Schema != StateSchema {
		t.Fatalf("backup=%+v err=%v", record, err)
	}
	if _, err := service.Kill("restore drill mutation"); err != nil {
		t.Fatal(err)
	}
	if !service.Snapshot()["paper"].(PaperState).KillSwitch {
		t.Fatal("mutation missing")
	}
	if _, err := service.Restore(backupPath); err != nil {
		t.Fatal(err)
	}
	snapshot := service.Snapshot()
	if snapshot["paper"].(PaperState).KillSwitch {
		t.Fatal("backup state was not restored")
	}
	if len(snapshot["experiments"].(map[string]Experiment)) != 1 {
		t.Fatal("experiment missing after restore")
	}

	tampered := filepath.Join(root, "tampered.json")
	data, _ := os.ReadFile(backupPath)
	var document map[string]any
	if json.Unmarshal(data, &document) != nil {
		t.Fatal("decode backup")
	}
	document["sequence"] = document["sequence"].(float64) + 1
	data, _ = json.Marshal(document)
	_ = os.WriteFile(tampered, data, 0600)
	if _, err := service.Restore(tampered); err != ErrForbidden {
		t.Fatalf("tampered restore=%v", err)
	}
}

func TestDeleteAllLocalDataRequiresExactConfirmationAndLeavesTombstone(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	service, _ := New(Config{StatePath: path})
	if _, err := service.RunBacktest(request()); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Kill("deletion fixture"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.DeleteAllLocalData("delete"); err != ErrForbidden {
		t.Fatalf("weak confirmation=%v", err)
	}
	record, err := service.DeleteAllLocalData("DELETE ALL LOCAL QUANT DATA")
	if err != nil || record.PreviousDigest == "" {
		t.Fatalf("record=%+v err=%v", record, err)
	}
	snapshot := service.Snapshot()
	if len(snapshot["experiments"].(map[string]Experiment)) != 0 || len(snapshot["strategies"].(map[string]StrategySpec)) != 0 || len(snapshot["testnetOrders"].(map[string]TestnetOrder)) != 0 {
		t.Fatal("user records remain")
	}
	if len(snapshot["executionLedger"].(map[string]ExecutionLedgerRecord)) != 0 || len(snapshot["adapterSequences"].(map[string]int64)) != 0 {
		t.Fatal("execution records remain")
	}
	if snapshot["paper"].(PaperState).KillSwitch {
		t.Fatal("paper state remains")
	}
	audit := snapshot["audit"].([]AuditEvent)
	if len(audit) != 1 || audit[0].Action != "all_local_user_data_deleted" {
		t.Fatalf("audit=%+v", audit)
	}
}

func TestDatasetCatalogRequiresRightsLineageBiasAndPrivateConsent(t *testing.T) {
	now := time.Date(2026, 7, 22, 0, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "state.json")
	service, _ := New(Config{StatePath: path, Now: func() time.Time { return now }})
	record := validDataset(now)
	registered, err := service.RegisterDataset(record)
	if err != nil || registered.IngestedAt != now {
		t.Fatalf("registered=%+v err=%v", registered, err)
	}
	if _, err := service.RegisterDataset(record); err != ErrConflict {
		t.Fatalf("duplicate=%v", err)
	}
	restarted, err := New(Config{StatePath: path, Now: func() time.Time { return now }})
	if err != nil || len(restarted.Snapshot()["datasets"].(map[string]DatasetRecord)) != 1 {
		t.Fatalf("restart=%v", err)
	}

	invalid := validDataset(now)
	invalid.ID = "unknown-type"
	invalid.DataTypes = []string{"prices"}
	if _, err := service.RegisterDataset(invalid); err != ErrInvalid {
		t.Fatalf("type=%v", err)
	}
	private := validDataset(now)
	private.ID, private.Private = "private-user-data", true
	if _, err := service.RegisterDataset(private); err != ErrForbidden {
		t.Fatalf("missing consent=%v", err)
	}
	private.CloudConsentID, private.ConsentExpiresAt = "consent-12345", now.Add(24*time.Hour)
	if _, err := service.RegisterDataset(private); err != nil {
		t.Fatalf("private consent=%v", err)
	}
}
