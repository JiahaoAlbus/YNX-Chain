package quantlab

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

type venueTransportStub struct {
	executeCalls   int
	reconcileCalls int
	execute        func(context.Context, ExecutionAdapterKind, OrderIntent) (ExecutionResult, error)
	reconcile      func(context.Context, ExecutionAdapterKind, ReconciliationRequest) (ReconciliationResult, error)
}

func (s *venueTransportStub) Execute(ctx context.Context, kind ExecutionAdapterKind, intent OrderIntent) (ExecutionResult, error) {
	s.executeCalls++
	return s.execute(ctx, kind, intent)
}

func (s *venueTransportStub) Reconcile(ctx context.Context, kind ExecutionAdapterKind, request ReconciliationRequest) (ReconciliationResult, error) {
	s.reconcileCalls++
	return s.reconcile(ctx, kind, request)
}

func TestExchangeVenueAdapterAcceptsBoundTerminalReceiptAndReplaysLocally(t *testing.T) {
	now := time.Date(2026, 7, 27, 9, 0, 0, 0, time.UTC)
	service, err := New(Config{StatePath: filepath.Join(t.TempDir(), "state.json"), Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	transport := &venueTransportStub{
		execute: func(_ context.Context, kind ExecutionAdapterKind, intent OrderIntent) (ExecutionResult, error) {
			return ExecutionResult{
				SchemaVersion: ExecutionSchemaVersion,
				Adapter:       kind,
				RequestID:     intent.RequestID,
				Sequence:      intent.ExpectedSequence,
				Status:        "filled",
				OrderID:       "exchange-order-001",
				Price:         1_000_000,
				Requested:     intent.Amount,
				Filled:        intent.Amount,
				Source:        "ynx-exchange-authoritative-fill",
				AsOf:          now,
				Version:       "ynx.exchange.execution.v1",
				Coverage:      "terminal order and fill receipt",
				Confidence:    "authoritative",
				AuditID:       "exchange-audit-001",
			}, nil
		},
		reconcile: func(context.Context, ExecutionAdapterKind, ReconciliationRequest) (ReconciliationResult, error) {
			return ReconciliationResult{}, ErrUnavailable
		},
	}
	adapter := NewExchangeExecutionAdapter(service, transport, func() time.Time { return now })
	intent := adapterIntent(now, "exchange-request-001", 1)
	result, err := adapter.Execute(context.Background(), intent)
	if err != nil || result.Adapter != AdapterExchange || result.Status != "filled" || result.Sequence != 1 {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	replayed, err := adapter.Execute(context.Background(), intent)
	if err != nil || replayed != result || transport.executeCalls != 1 {
		t.Fatalf("replay=%+v calls=%d err=%v", replayed, transport.executeCalls, err)
	}
}

func TestVenueAdapterRejectsUnboundOrNonterminalReceiptAndLeavesUnknownOutcome(t *testing.T) {
	now := time.Date(2026, 7, 27, 9, 0, 0, 0, time.UTC)
	service, _ := New(Config{StatePath: filepath.Join(t.TempDir(), "state.json"), Now: func() time.Time { return now }})
	transport := &venueTransportStub{
		execute: func(_ context.Context, kind ExecutionAdapterKind, intent OrderIntent) (ExecutionResult, error) {
			return ExecutionResult{
				SchemaVersion: ExecutionSchemaVersion,
				Adapter:       kind,
				RequestID:     intent.RequestID,
				Sequence:      intent.ExpectedSequence,
				Status:        "accepted",
				OrderID:       "not-terminal",
				Requested:     intent.Amount,
				Source:        "ynx-dex-router",
				AsOf:          now,
				Version:       "ynx.dex.execution.v1",
				Coverage:      "submission only",
				Confidence:    "authoritative",
				AuditID:       "dex-audit-001",
			}, nil
		},
		reconcile: func(context.Context, ExecutionAdapterKind, ReconciliationRequest) (ReconciliationResult, error) {
			return ReconciliationResult{}, ErrUnavailable
		},
	}
	adapter := NewDEXExecutionAdapter(service, transport, func() time.Time { return now })
	intent := adapterIntent(now, "dex-request-unknown-1", 1)
	if _, err := adapter.Execute(context.Background(), intent); err != ErrUnavailable {
		t.Fatalf("nonterminal receipt err=%v", err)
	}
	if _, err := adapter.Execute(context.Background(), intent); err != ErrUnavailable || transport.executeCalls != 1 {
		t.Fatalf("unknown outcome retry err=%v calls=%d", err, transport.executeCalls)
	}
}

func TestDEXVenueReconciliationRequiresAuthoritativeDeltaAndActivatesKillSwitch(t *testing.T) {
	now := time.Date(2026, 7, 27, 9, 0, 0, 0, time.UTC)
	service, _ := New(Config{StatePath: filepath.Join(t.TempDir(), "state.json"), Now: func() time.Time { return now }})
	transport := &venueTransportStub{
		execute: func(context.Context, ExecutionAdapterKind, OrderIntent) (ExecutionResult, error) {
			return ExecutionResult{}, ErrUnavailable
		},
		reconcile: func(_ context.Context, kind ExecutionAdapterKind, request ReconciliationRequest) (ReconciliationResult, error) {
			return ReconciliationResult{
				SchemaVersion:         ExecutionSchemaVersion,
				Adapter:               kind,
				AuthoritativeCash:     request.ExpectedCash - 5,
				AuthoritativePosition: request.ExpectedPosition + 2,
				Delta:                 7,
				KillSwitch:            true,
				Source:                "ynx-dex-authoritative-vault-snapshot",
				AsOf:                  now,
				Version:               "ynx.dex.reconciliation.v1",
			}, nil
		},
	}
	adapter := NewDEXExecutionAdapter(service, transport, func() time.Time { return now })
	result, err := adapter.Reconcile(context.Background(), ReconciliationRequest{ExpectedCash: 100, ExpectedPosition: 10})
	if err != nil || result.Delta != 7 || !result.KillSwitch {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	paper := service.Snapshot()["paper"].(PaperState)
	if !paper.KillSwitch {
		t.Fatal("authoritative venue mismatch did not activate persistent Quant kill switch")
	}
}

func TestVenueReconciliationRejectsStaleOrIncorrectDelta(t *testing.T) {
	now := time.Date(2026, 7, 27, 9, 0, 0, 0, time.UTC)
	for name, result := range map[string]ReconciliationResult{
		"stale": {
			SchemaVersion: ExecutionSchemaVersion, Adapter: AdapterExchange, AuthoritativeCash: 10, Delta: 0,
			Source: "exchange", AsOf: now.Add(-31 * time.Second), Version: "v1",
		},
		"wrong-delta": {
			SchemaVersion: ExecutionSchemaVersion, Adapter: AdapterExchange, AuthoritativeCash: 9, Delta: 0,
			KillSwitch: true, Source: "exchange", AsOf: now, Version: "v1",
		},
	} {
		t.Run(name, func(t *testing.T) {
			service, _ := New(Config{StatePath: filepath.Join(t.TempDir(), "state.json"), Now: func() time.Time { return now }})
			transport := &venueTransportStub{
				execute: func(context.Context, ExecutionAdapterKind, OrderIntent) (ExecutionResult, error) {
					return ExecutionResult{}, ErrUnavailable
				},
				reconcile: func(context.Context, ExecutionAdapterKind, ReconciliationRequest) (ReconciliationResult, error) {
					return result, nil
				},
			}
			adapter := NewExchangeExecutionAdapter(service, transport, func() time.Time { return now })
			if _, err := adapter.Reconcile(context.Background(), ReconciliationRequest{ExpectedCash: 10}); err != ErrUnavailable {
				t.Fatalf("err=%v", err)
			}
		})
	}
}
