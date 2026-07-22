package quantlab

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type adapterMarket struct {
	tick MarketTick
	err  error
}

func (m adapterMarket) History(string, int) ([]Bar, string, error) { return nil, "", ErrUnavailable }
func (m adapterMarket) Latest(string) (MarketTick, error)          { return m.tick, m.err }

func adapterIntent(now time.Time, requestID string, sequence int64) OrderIntent {
	return OrderIntent{SchemaVersion: ExecutionSchemaVersion, RequestID: requestID, StrategyHash: strings.Repeat("a", 64), Market: "YNXT-YUSD_TEST", Side: "buy", Amount: 2_000_000, LimitPrice: 1_010_000, ExpectedSequence: sequence, CreatedAt: now}
}

func TestPaperAdapterTranslatesIntentPartialFillAndIdempotency(t *testing.T) {
	now := time.Date(2026, 7, 22, 1, 0, 0, 0, time.UTC)
	service, _ := New(Config{StatePath: filepath.Join(t.TempDir(), "state.json"), Now: func() time.Time { return now }})
	market := adapterMarket{tick: MarketTick{Price: 1_000_000, Volume: 5_000_000, Source: "ynx-exchange-authoritative-match-tape", At: now}}
	adapter := &PaperExecutionAdapter{Service: service, Market: market, Now: func() time.Time { return now }}
	intent := adapterIntent(now, "paper-request-001", 1)
	result, err := adapter.Execute(context.Background(), intent)
	if err != nil || result.Adapter != AdapterPaper || result.Status != "partially_filled_simulated" || result.Filled != 500_000 || result.Sequence != 1 || result.Source != market.tick.Source || result.AuditID == "" {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	replayed, err := adapter.Execute(context.Background(), intent)
	if err != nil || replayed != result || len(service.Snapshot()["paper"].(PaperState).Orders) != 1 {
		t.Fatalf("replay=%+v err=%v", replayed, err)
	}
	tampered := intent
	tampered.Amount++
	if _, err = adapter.Execute(context.Background(), tampered); err != ErrConflict {
		t.Fatalf("tampered replay=%v", err)
	}
	wrongSequence := adapterIntent(now, "paper-request-002", 3)
	if _, err = adapter.Execute(context.Background(), wrongSequence); err != ErrConflict {
		t.Fatalf("sequence=%v", err)
	}
}

func TestPaperAdapterLimitStaleFeedAndReconciliationFailClosed(t *testing.T) {
	now := time.Date(2026, 7, 22, 1, 0, 0, 0, time.UTC)
	service, _ := New(Config{StatePath: filepath.Join(t.TempDir(), "state.json"), Now: func() time.Time { return now }})
	intent := adapterIntent(now, "paper-request-003", 1)
	overLimit := &PaperExecutionAdapter{Service: service, Market: adapterMarket{tick: MarketTick{Price: 1_020_000, Volume: 1_000_000, Source: "authoritative", At: now}}, Now: func() time.Time { return now }}
	if _, err := overLimit.Execute(context.Background(), intent); err != ErrForbidden {
		t.Fatalf("limit=%v", err)
	}
	stale := &PaperExecutionAdapter{Service: service, Market: adapterMarket{tick: MarketTick{Price: 1_000_000, Volume: 1_000_000, Source: "authoritative", At: now.Add(-31 * time.Second)}}, Now: func() time.Time { return now }}
	if _, err := stale.Execute(context.Background(), intent); err != ErrUnavailable {
		t.Fatalf("stale=%v", err)
	}
	reconciled, err := stale.Reconcile(context.Background(), ReconciliationRequest{ExpectedCash: 1, ExpectedPosition: 0})
	if err != nil || !reconciled.KillSwitch || reconciled.Delta == 0 {
		t.Fatalf("reconcile=%+v err=%v", reconciled, err)
	}
}

func TestShadowAdapterNeverSubmitsOrFills(t *testing.T) {
	now := time.Date(2026, 7, 22, 1, 0, 0, 0, time.UTC)
	market := adapterMarket{tick: MarketTick{Price: 1_000_000, Volume: 5_000_000, Source: "ynx-exchange-authoritative-match-tape", At: now}}
	adapter := &ShadowExecutionAdapter{Market: market, Now: func() time.Time { return now }}
	result, err := adapter.Execute(context.Background(), adapterIntent(now, "shadow-request-1", 1))
	if err != nil || result.Status != "observed_no_submit" || result.Filled != 0 || result.OrderID != "" || result.Coverage != "market observation only; no order submitted" {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	reconciliation, err := adapter.Reconcile(context.Background(), ReconciliationRequest{})
	if err != nil || reconciliation.FailureCode != "no_custody_or_position" || reconciliation.AuthoritativePosition != 0 {
		t.Fatalf("reconciliation=%+v err=%v", reconciliation, err)
	}
}
