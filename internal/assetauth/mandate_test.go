package assetauth

import (
	"crypto/sha256"
	"encoding/hex"
	"testing"
	"time"
)

func TestStrategyMandateAllowsBoundedActionAndConsumesNonce(t *testing.T) {
	mandate := testMandate(t)
	action := validAction(mandate)
	next, err := mandate.Authorize(action, mandate.ValidAfter.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if next.NextNonce != mandate.NextNonce+1 || next.AuditHash == mandate.AuditHash {
		t.Fatalf("authorized action did not advance audit-bound nonce: %+v", next)
	}
	if _, err := next.Authorize(action, mandate.ValidAfter.Add(2*time.Minute)); err == nil {
		t.Fatal("replayed strategy action accepted")
	}
}

func TestStrategyMandateRejectsEveryPrivilegeEscalation(t *testing.T) {
	mandate := testMandate(t)
	at := mandate.ValidAfter.Add(time.Minute)
	tests := map[string]func(*StrategyAction){
		"wrong engine":       func(action *StrategyAction) { action.Actor = "engine-other" },
		"wrong nonce domain": func(action *StrategyAction) { action.NonceDomain = "other" },
		"wrong nonce":        func(action *StrategyAction) { action.Nonce++ },
		"owner change":       func(action *StrategyAction) { action.RequestedNewOwner = "attacker" },
		"withdrawal":         func(action *StrategyAction) { action.WithdrawalYNXT = 1 },
		"venue widening":     func(action *StrategyAction) { action.Venue = "venue-other" },
		"asset widening":     func(action *StrategyAction) { action.Asset = "other" },
		"market widening":    func(action *StrategyAction) { action.Market = "other/usd" },
		"method widening":    func(action *StrategyAction) { action.Method = "withdraw" },
		"capital breach":     func(action *StrategyAction) { action.CapitalAfterYNXT = mandate.CapitalLimitYNXT + 1 },
		"position breach":    func(action *StrategyAction) { action.PositionAfterYNXT = mandate.PositionLimitYNXT + 1 },
		"leverage breach":    func(action *StrategyAction) { action.LeverageBPS = mandate.MaxLeverageBPS + 1 },
		"slippage breach":    func(action *StrategyAction) { action.SlippageBPS = mandate.MaxSlippageBPS + 1 },
		"daily loss breach":  func(action *StrategyAction) { action.DailyRealizedLoss = mandate.DailyLossLimitYNXT + 1 },
		"drawdown breach":    func(action *StrategyAction) { action.DrawdownBPS = mandate.DrawdownLimitBPS + 1 },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			action := validAction(mandate)
			mutate(&action)
			if _, err := mandate.Authorize(action, at); err == nil {
				t.Fatalf("privilege escalation %s was accepted", name)
			}
		})
	}
}

func TestStrategyMandateExpiryRevokeAndKillAreImmediate(t *testing.T) {
	mandate := testMandate(t)
	action := validAction(mandate)
	if _, err := mandate.Authorize(action, mandate.ExpiresAt); err == nil {
		t.Fatal("action at expiry was accepted")
	}
	revoked, err := mandate.Revoke(mandate.Owner, mandate.ValidAfter)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := revoked.Authorize(action, mandate.ValidAfter.Add(time.Second)); err == nil {
		t.Fatal("revoked mandate authorized an action")
	}
	killed, err := mandate.Kill(mandate.Owner, mandate.ValidAfter)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := killed.Authorize(action, mandate.ValidAfter.Add(time.Second)); err == nil {
		t.Fatal("kill switch did not stop action authorization")
	}
	if _, err := mandate.Revoke("engine-1", mandate.ValidAfter); err == nil {
		t.Fatal("engine revoked owner mandate")
	}
}

func TestVaultWithdrawalAndEmergencyExitAreOwnerOnly(t *testing.T) {
	created := time.Unix(100, 0).UTC()
	vault, err := NewStrategyVault("vault-1", "owner-1", "mandate-1", created)
	if err != nil {
		t.Fatal(err)
	}
	vault, _, err = vault.Deposit("owner-1", 100, created.Add(time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := vault.Withdraw("engine-1", 1, created.Add(2*time.Second)); err == nil {
		t.Fatal("strategy engine withdrew from owner vault")
	}
	if _, _, err := vault.EmergencyExit("engine-1", created.Add(2*time.Second)); err == nil {
		t.Fatal("strategy engine executed emergency exit")
	}
	vault, event, err := vault.Withdraw("owner-1", 40, created.Add(2*time.Second))
	if err != nil || vault.BalanceYNXT != 60 || event.Type != "withdrawal" || event.AuditHash == "" {
		t.Fatalf("owner withdrawal failed: vault=%+v event=%+v err=%v", vault, event, err)
	}
	vault, event, err = vault.EmergencyExit("owner-1", created.Add(3*time.Second))
	if err != nil || vault.BalanceYNXT != 0 || vault.ClosedAt == nil || event.AmountYNXT != 60 {
		t.Fatalf("owner emergency exit failed: vault=%+v event=%+v err=%v", vault, event, err)
	}
}

func TestPerformanceFeeUsesRealizedNetProfitAbovePersistentHighWaterMark(t *testing.T) {
	policy := FeePolicy{ManagementFeeBPSAnnual: 200, PerformanceFeeBPS: 2_000}
	assessment, err := AssessFees(policy, FeePeriod{AverageNAVYNXT: 10_000, DurationSeconds: 365 * 24 * 60 * 60, RealizedGrossPnLYNXT: 1_000, TradingCostsYNXT: 100, FundingCostsYNXT: 50, ProviderCostsYNXT: 50, PriorCumulativeRealizedNet: 2_000, PriorHighWaterMarkYNXT: 2_500})
	if err != nil {
		t.Fatal(err)
	}
	// Realized net is 800, cumulative is 2,800, but only 300 is above HWM.
	if assessment.RealizedNetPnLYNXT != 800 || assessment.EligiblePerformanceBase != 300 || assessment.PerformanceFeeYNXT != 60 || assessment.ManagementFeeYNXT != 200 || assessment.NewHighWaterMarkYNXT != 2_800 {
		t.Fatalf("wrong fee assessment: %+v", assessment)
	}
	loss, err := AssessFees(policy, FeePeriod{RealizedGrossPnLYNXT: -100, TradingCostsYNXT: 20, PriorCumulativeRealizedNet: 2_800, PriorHighWaterMarkYNXT: 2_800})
	if err != nil {
		t.Fatal(err)
	}
	if loss.PerformanceFeeYNXT != 0 || loss.CumulativeRealizedNetYNXT != 2_680 || loss.NewHighWaterMarkYNXT != 2_800 {
		t.Fatalf("loss incorrectly reset high water mark or charged a fee: %+v", loss)
	}
	recovery, err := AssessFees(policy, FeePeriod{RealizedGrossPnLYNXT: 100, PriorCumulativeRealizedNet: 2_680, PriorHighWaterMarkYNXT: 2_800})
	if err != nil || recovery.PerformanceFeeYNXT != 0 || recovery.NewHighWaterMarkYNXT != 2_800 {
		t.Fatalf("recovery below high water mark charged a fee: %+v %v", recovery, err)
	}
}

func testMandate(t *testing.T) StrategyMandate {
	t.Helper()
	created := time.Unix(100, 0).UTC()
	sum := sha256.Sum256([]byte("strategy-v1"))
	mandate, err := NewStrategyMandate(StrategyMandate{
		ID: "mandate-1", Owner: "owner-1", EngineIdentity: "engine-1", StrategyHash: hex.EncodeToString(sum[:]), StrategyVersion: 1,
		Venues: []string{"venue-1"}, Assets: []string{"YNXT"}, Markets: []string{"YNXT/USD"}, Methods: []string{MethodCancelOrder, MethodPlaceOrder, MethodReducePosition},
		CapitalLimitYNXT: 1_000, PositionLimitYNXT: 500, MaxLeverageBPS: 20_000, MaxSlippageBPS: 100, DailyLossLimitYNXT: 100, DrawdownLimitBPS: 1_000,
		ValidAfter: created.Add(time.Second), ExpiresAt: created.Add(time.Hour), NonceDomain: "quant/mandate-1", NextNonce: 1, CreatedAt: created,
	})
	if err != nil {
		t.Fatal(err)
	}
	return mandate
}

func validAction(mandate StrategyMandate) StrategyAction {
	return StrategyAction{Actor: mandate.EngineIdentity, NonceDomain: mandate.NonceDomain, Nonce: mandate.NextNonce, Method: MethodPlaceOrder, Venue: "venue-1", Asset: "ynxt", Market: "ynxt/usd", CapitalAfterYNXT: 500, PositionAfterYNXT: 200, LeverageBPS: 15_000, SlippageBPS: 50, DailyRealizedLoss: 10, DrawdownBPS: 100}
}
