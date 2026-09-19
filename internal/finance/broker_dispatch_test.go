package finance

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/finance/brokerage"
)

type dispatchAdapter struct {
	submit    func(brokerage.SubmitOrderRequest) (brokerage.Order, error)
	cancel    func(string) error
	snapshot  brokerage.AccountSnapshot
	quote     brokerage.Quote
	account   brokerage.Account
	positions []brokerage.Position
}

func (d dispatchAdapter) Capabilities() map[string]string { return map[string]string{} }
func (d dispatchAdapter) Assets(context.Context) (brokerage.AssetResult, error) {
	return brokerage.AssetResult{Provider: FinanceOrderProvider, Environment: FinanceOrderTradingEnv, Assets: []brokerage.Asset{{ID: "11111111-2222-4333-8444-555555555555", Symbol: "ACME", Name: "ACME", Class: "us_equity", Status: "active", Tradable: true}}}, nil
}
func (d dispatchAdapter) Quote(_ context.Context, symbol string) (brokerage.Quote, error) {
	if d.quote.Symbol == symbol {
		return d.quote, nil
	}
	return brokerage.Quote{Symbol: symbol, BidPrice: "9.99", AskPrice: "10", Timestamp: "2026-09-19T09:01:59Z", Feed: "iex"}, nil
}
func (d dispatchAdapter) Account(context.Context, string, brokerage.AccountResolver) (brokerage.Account, error) {
	if d.account.ID != "" {
		return d.account, nil
	}
	return brokerage.Account{ID: "01234567-89ab-4cde-8fab-0123456789ab", Status: "ACTIVE", Currency: "USD", Cash: "100", BuyingPower: "100"}, nil
}
func (d dispatchAdapter) Orders(context.Context, string, brokerage.AccountResolver) ([]brokerage.Order, string, error) {
	return nil, "", errors.New("unused")
}
func (d dispatchAdapter) Positions(context.Context, string, brokerage.AccountResolver) ([]brokerage.Position, string, error) {
	return d.positions, "positions-request", nil
}
func (d dispatchAdapter) Reconcile(context.Context, string, brokerage.AccountResolver) (brokerage.AccountSnapshot, error) {
	return d.snapshot, nil
}
func (d dispatchAdapter) SubmitOrder(_ context.Context, _ string, _ brokerage.AccountResolver, request brokerage.SubmitOrderRequest) (brokerage.Order, error) {
	return d.submit(request)
}
func (d dispatchAdapter) CancelOrder(_ context.Context, _ string, _ brokerage.AccountResolver, orderID string) error {
	if d.cancel == nil {
		return errors.New("unused")
	}
	return d.cancel(orderID)
}

func consumedBrokerFixture(t *testing.T) (*Store, string, string, time.Time) {
	t.Helper()
	now := time.Date(2026, 9, 19, 9, 0, 0, 0, time.UTC)
	account := "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
	store, err := OpenStore(filepath.Join(t.TempDir(), "finance.json"))
	if err != nil {
		t.Fatal(err)
	}
	_, _ = store.PutBrokerSandboxMapping(account, "01234567-89ab-4cde-8fab-0123456789ab", now)
	challenge, err := store.CreateBrokerOrderChallenge(account, BrokerChallengeRequest{AccountPublicKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", FeeBoundEstablished: true, FeeEvidenceRef: "operator-policy:test", Order: FinanceOrderV1{AssetClass: "us_equity", AssetID: "11111111-2222-4333-8444-555555555555", Currency: "USD", FeeBoundSource: "operator_policy", LimitPrice: "10", MaxCost: "10", MaxFee: "0", OrderID: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", OrderType: "limit", Qty: "1", Side: "buy", Symbol: "ACME", TimeInForce: "day"}}, now)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.VerifyAndConsumeBrokerOrder(account, signFinanceApprovalForTest(t, challenge.Unsigned), now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	return store, account, challenge.Unsigned.Order.OrderID, now
}

func TestBrokerDispatcherSuccessAndReconcileCursor(t *testing.T) {
	store, account, orderID, now := consumedBrokerFixture(t)
	providerOrder := brokerage.Order{ID: "22222222-3333-4444-8555-666666666666", ClientOrderID: orderID, AssetID: "11111111-2222-4333-8444-555555555555", Symbol: "ACME", Side: "buy", Qty: "1", FilledQty: "0", Type: "limit", LimitPrice: "10", TimeInForce: "day", Status: "accepted"}
	adapter := dispatchAdapter{submit: func(request brokerage.SubmitOrderRequest) (brokerage.Order, error) {
		if request.ClientOrderID != orderID || request.ExtendedHours {
			t.Fatal("wrong signed request")
		}
		return providerOrder, nil
	}, cancel: func(value string) error {
		if value != providerOrder.ID {
			t.Fatal("wrong provider order")
		}
		return nil
	}}
	dispatcher := BrokerDispatcher{Store: store, Adapter: adapter, Now: func() time.Time { return now.Add(2 * time.Minute) }}
	record, err := dispatcher.Dispatch(context.Background(), account, orderID)
	if err != nil || record.State != "submitted" || record.ProviderOrderID != providerOrder.ID {
		t.Fatalf("record=%+v err=%v", record, err)
	}
	canceled, err := dispatcher.Cancel(context.Background(), account, orderID)
	if err != nil || canceled.State != "cancel_requested" {
		t.Fatalf("cancel=%+v err=%v", canceled, err)
	}
	adapter.snapshot = brokerage.AccountSnapshot{Provider: FinanceOrderProvider, Environment: FinanceOrderTradingEnv, RequestIDs: []string{"request-b", "request-a"}, Orders: []brokerage.Order{{ID: providerOrder.ID, ClientOrderID: orderID, AssetID: providerOrder.AssetID, Symbol: "ACME", Side: "buy", Qty: "1", FilledQty: "1", Type: "limit", LimitPrice: "10", TimeInForce: "day", Status: "filled"}}}
	dispatcher.Adapter = adapter
	if _, err := dispatcher.Reconcile(context.Background(), account); err != nil {
		t.Fatal(err)
	}
	workspace := store.BrokerWorkspace(account, now.Add(2*time.Minute))
	if workspace.Orders[0].State != "filled" || store.Account(account).Brokerage.EventCursor == "" {
		t.Fatalf("workspace=%+v", workspace)
	}
}

func TestApplyBrokerTradeEventsUsesOwnedMappingAndPersistentCursor(t *testing.T) {
	store, account, orderID, now := consumedBrokerFixture(t)
	providerOrder := brokerage.Order{ID: "22222222-3333-4444-8555-666666666666", ClientOrderID: orderID, AssetID: "11111111-2222-4333-8444-555555555555", Symbol: "ACME", Side: "buy", Qty: "1", FilledQty: "1", Type: "limit", LimitPrice: "10", TimeInForce: "day", Status: "filled"}
	event := brokerage.TradeEvent{Cursor: "event-1", ProviderAccountID: "01234567-89ab-4cde-8fab-0123456789ab", Event: "fill", Timestamp: now, Order: providerOrder}
	if err := store.ApplyBrokerTradeEvents(account, []brokerage.TradeEvent{event}, "event-1", now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	workspace := store.BrokerWorkspace(account, now.Add(time.Minute))
	if workspace.Orders[0].State != "filled" || store.Account(account).Brokerage.EventCursor != "event-1" {
		t.Fatalf("workspace=%+v", workspace)
	}
	event.ProviderAccountID = "11234567-89ab-4cde-8fab-0123456789ab"
	if err := store.ApplyBrokerTradeEvents(account, []brokerage.TradeEvent{event}, "event-1", now.Add(2*time.Minute)); err == nil {
		t.Fatal("cross-tenant event must fail closed")
	}
}

func TestBrokerTradeEventsRejectStateAndCursorRegressionAcrossRestart(t *testing.T) {
	store, account, orderID, now := consumedBrokerFixture(t)
	path := store.path
	filled := brokerage.Order{ID: "22222222-3333-4444-8555-666666666666", ClientOrderID: orderID, AssetID: "11111111-2222-4333-8444-555555555555", Symbol: "ACME", Side: "buy", Qty: "1", FilledQty: "1", Type: "limit", LimitPrice: "10", TimeInForce: "day", Status: "filled"}
	if err := store.ApplyBrokerTradeEvents(account, []brokerage.TradeEvent{{Cursor: "event-2", ProviderAccountID: "01234567-89ab-4cde-8fab-0123456789ab", Event: "fill", Timestamp: now.Add(2 * time.Minute), Order: filled}}, "event-2", now.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	older := filled
	older.Status, older.FilledQty = "new", "0"
	err = reopened.ApplyBrokerTradeEvents(account, []brokerage.TradeEvent{{Cursor: "event-1", ProviderAccountID: "01234567-89ab-4cde-8fab-0123456789ab", Event: "new", Timestamp: now.Add(time.Minute), Order: older}}, "event-1", now.Add(3*time.Minute))
	if err == nil {
		t.Fatal("stale event regressed a terminal order")
	}
	state := reopened.Account(account).Brokerage
	if state.EventCursor != "event-2" || state.Orders[orderID].State != "filled" || state.Orders[orderID].ProviderEventCursor != "event-2" {
		t.Fatalf("stale event mutated state: %+v", state.Orders[orderID])
	}
}

func TestBrokerReconciliationBindsFullSignedOrderIdentity(t *testing.T) {
	base := brokerage.Order{ID: "22222222-3333-4444-8555-666666666666", AssetID: "11111111-2222-4333-8444-555555555555", Symbol: "ACME", Side: "buy", Qty: "1", FilledQty: "1", Type: "limit", LimitPrice: "10", TimeInForce: "day", Status: "filled"}
	mutations := map[string]func(*brokerage.Order){
		"asset":  func(o *brokerage.Order) { o.AssetID = "99999999-2222-4333-8444-555555555555" },
		"symbol": func(o *brokerage.Order) { o.Symbol = "EVIL" },
		"side":   func(o *brokerage.Order) { o.Side = "sell" },
		"qty":    func(o *brokerage.Order) { o.Qty = "2" },
		"type":   func(o *brokerage.Order) { o.Type = "market" },
		"price":  func(o *brokerage.Order) { o.LimitPrice = "11" },
		"tif":    func(o *brokerage.Order) { o.TimeInForce = "gtc" },
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			store, account, orderID, now := consumedBrokerFixture(t)
			candidate := base
			candidate.ClientOrderID = orderID
			mutate(&candidate)
			err := store.ApplyBrokerReconciliation(account, brokerage.AccountSnapshot{Orders: []brokerage.Order{candidate}}, now.Add(time.Minute))
			if err == nil {
				t.Fatal("mismatched provider order was accepted")
			}
			order := store.Account(account).Brokerage.Orders[orderID]
			if order.State == "filled" || order.ProviderOrderID != "" {
				t.Fatalf("mismatch mutated order: %+v", order)
			}
		})
	}
}

func TestBrokerDispatchBlocksExpiredApprovalAndStalePreflightBeforeSubmit(t *testing.T) {
	store, account, orderID, now := consumedBrokerFixture(t)
	posts := 0
	adapter := dispatchAdapter{submit: func(brokerage.SubmitOrderRequest) (brokerage.Order, error) { posts++; return brokerage.Order{}, nil }}
	dispatcher := BrokerDispatcher{Store: store, Adapter: adapter, Now: func() time.Time { return now.Add(time.Hour) }}
	if _, err := dispatcher.Dispatch(context.Background(), account, orderID); brokerage.ErrorCode(err) != "ORDER_APPROVAL_EXPIRED" {
		t.Fatalf("expected expiry fence, got %v", err)
	}
	if posts != 0 || store.BrokerWorkspace(account, now).Orders[0].State != "provider_rejected" {
		t.Fatal("expired approval reached provider or was not fenced")
	}

	store, account, orderID, now = consumedBrokerFixture(t)
	posts = 0
	adapter = dispatchAdapter{quote: brokerage.Quote{Symbol: "ACME", Timestamp: now.Add(-time.Hour).Format(time.RFC3339Nano)}, submit: func(brokerage.SubmitOrderRequest) (brokerage.Order, error) { posts++; return brokerage.Order{}, nil }}
	dispatcher = BrokerDispatcher{Store: store, Adapter: adapter, Now: func() time.Time { return now.Add(2 * time.Minute) }}
	if _, err := dispatcher.Dispatch(context.Background(), account, orderID); err == nil {
		t.Fatal("stale preflight quote was accepted")
	}
	if posts != 0 {
		t.Fatal("stale preflight reached provider POST")
	}

	store, account, orderID, now = consumedBrokerFixture(t)
	posts = 0
	adapter = dispatchAdapter{account: brokerage.Account{ID: "01234567-89ab-4cde-8fab-0123456789ab", Status: "ACTIVE", Currency: "USD", Cash: "0", BuyingPower: "1000"}, submit: func(brokerage.SubmitOrderRequest) (brokerage.Order, error) { posts++; return brokerage.Order{}, nil }}
	dispatcher = BrokerDispatcher{Store: store, Adapter: adapter, Now: func() time.Time { return now.Add(2 * time.Minute) }}
	if _, err := dispatcher.Dispatch(context.Background(), account, orderID); err == nil {
		t.Fatal("leveraged buying power bypassed the cash-only weekly boundary")
	}
	if posts != 0 {
		t.Fatal("cash-short order reached provider POST")
	}
}

func TestBrokerClaimNeverRegressesProviderCorrelatedOrderAfterExpiry(t *testing.T) {
	store, account, orderID, now := consumedBrokerFixture(t)
	provider := brokerage.Order{ID: "22222222-3333-4444-8555-666666666666", ClientOrderID: orderID, AssetID: "11111111-2222-4333-8444-555555555555", Symbol: "ACME", Side: "buy", Qty: "1", FilledQty: "0", Type: "limit", LimitPrice: "10", TimeInForce: "day", Status: "accepted"}
	dispatcher := BrokerDispatcher{Store: store, Adapter: dispatchAdapter{submit: func(brokerage.SubmitOrderRequest) (brokerage.Order, error) { return provider, nil }}, Now: func() time.Time { return now.Add(2 * time.Minute) }}
	if _, err := dispatcher.Dispatch(context.Background(), account, orderID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ClaimBrokerDispatch(account, orderID, now.Add(time.Hour)); err == nil {
		t.Fatal("provider-correlated order was reclaimed")
	}
	workspace := store.BrokerWorkspace(account, now.Add(time.Hour))
	if workspace.Orders[0].State != "submitted" || workspace.Outbox[0].Status != "submitted" || workspace.Orders[0].ProviderOrderID != provider.ID {
		t.Fatalf("provider-correlated order regressed: %+v", workspace)
	}
}

func TestBrokerDispatcherTimeoutAndRestartRemainUnknownWithoutDuplicateSubmit(t *testing.T) {
	store, account, orderID, now := consumedBrokerFixture(t)
	adapter := dispatchAdapter{submit: func(brokerage.SubmitOrderRequest) (brokerage.Order, error) {
		return brokerage.Order{}, &brokerage.Error{Code: "PROVIDER_UNAVAILABLE"}
	}}
	dispatcher := BrokerDispatcher{Store: store, Adapter: adapter, Now: func() time.Time { return now.Add(2 * time.Minute) }}
	if _, err := dispatcher.Dispatch(context.Background(), account, orderID); brokerage.ErrorCode(err) != "PROVIDER_UNAVAILABLE" {
		t.Fatal(err)
	}
	workspace := store.BrokerWorkspace(account, now.Add(2*time.Minute))
	if workspace.Orders[0].State != "submitted_unknown" || workspace.Outbox[0].Status != "submitted_unknown" {
		t.Fatalf("workspace=%+v", workspace)
	}
	if _, err := dispatcher.Dispatch(context.Background(), account, orderID); err == nil {
		t.Fatal("unknown submission retried")
	}

	second, account2, orderID2, now2 := consumedBrokerFixture(t)
	if _, err := second.ClaimBrokerDispatch(account2, orderID2, now2.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := second.RecoverInterruptedBrokerDispatches(account2, now2.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if second.BrokerWorkspace(account2, now2).Orders[0].State != "submitted_unknown" {
		t.Fatal("restart did not fence duplicate submission")
	}
}
