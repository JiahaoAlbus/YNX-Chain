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
	submit   func(brokerage.SubmitOrderRequest) (brokerage.Order, error)
	cancel   func(string) error
	snapshot brokerage.AccountSnapshot
	quote    brokerage.Quote
}

func (d dispatchAdapter) Capabilities() map[string]string { return map[string]string{} }
func (d dispatchAdapter) Assets(context.Context) (brokerage.AssetResult, error) {
	return brokerage.AssetResult{}, errors.New("unused")
}
func (d dispatchAdapter) Quote(_ context.Context, symbol string) (brokerage.Quote, error) {
	if d.quote.Symbol == symbol {
		return d.quote, nil
	}
	return brokerage.Quote{}, errors.New("unused")
}
func (d dispatchAdapter) Account(context.Context, string, brokerage.AccountResolver) (brokerage.Account, error) {
	return brokerage.Account{}, errors.New("unused")
}
func (d dispatchAdapter) Orders(context.Context, string, brokerage.AccountResolver) ([]brokerage.Order, string, error) {
	return nil, "", errors.New("unused")
}
func (d dispatchAdapter) Positions(context.Context, string, brokerage.AccountResolver) ([]brokerage.Position, string, error) {
	return nil, "", errors.New("unused")
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
