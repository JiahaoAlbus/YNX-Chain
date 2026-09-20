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
	submit       func(brokerage.SubmitOrderRequest) (brokerage.Order, error)
	cancel       func(string) error
	assets       brokerage.AssetResult
	assetsErr    error
	snapshot     brokerage.AccountSnapshot
	snapshotErr  error
	quote        brokerage.Quote
	quoteErr     error
	account      brokerage.Account
	accountErr   error
	positions    []brokerage.Position
	positionsErr error
}

func (d dispatchAdapter) Capabilities() map[string]string { return map[string]string{} }

func (d dispatchAdapter) Assets(context.Context) (brokerage.AssetResult, error) {
	if d.assetsErr != nil {
		return brokerage.AssetResult{}, d.assetsErr
	}
	if len(d.assets.Assets) > 0 {
		return d.assets, nil
	}
	return brokerage.AssetResult{Provider: FinanceOrderProvider, Environment: FinanceOrderTradingEnv, Assets: []brokerage.Asset{{ID: "11111111-2222-4333-8444-555555555555", Symbol: "ACME", Name: "ACME", Class: "us_equity", Status: "active", Tradable: true}}}, nil
}
func (d dispatchAdapter) Quote(_ context.Context, symbol string) (brokerage.Quote, error) {
	if d.quoteErr != nil {
		return brokerage.Quote{}, d.quoteErr
	}
	if d.quote.Symbol == symbol {
		return d.quote, nil
	}
	return brokerage.Quote{Symbol: symbol, BidPrice: "9.99", AskPrice: "10", Timestamp: "2026-09-19T09:01:59Z", Feed: "iex"}, nil
}
func (d dispatchAdapter) Account(context.Context, string, brokerage.AccountResolver) (brokerage.Account, error) {
	if d.accountErr != nil {
		return brokerage.Account{}, d.accountErr
	}
	if d.account.ID != "" {
		return d.account, nil
	}
	return brokerage.Account{ID: "01234567-89ab-4cde-8fab-0123456789ab", Status: "ACTIVE", Currency: "USD", Cash: "100", BuyingPower: "100"}, nil
}
func (d dispatchAdapter) Orders(context.Context, string, brokerage.AccountResolver) ([]brokerage.Order, string, error) {
	return nil, "", errors.New("unused")
}
func (d dispatchAdapter) Positions(context.Context, string, brokerage.AccountResolver) ([]brokerage.Position, string, error) {
	if d.positionsErr != nil {
		return nil, "", d.positionsErr
	}
	return d.positions, "positions-request", nil
}
func (d dispatchAdapter) Reconcile(context.Context, string, brokerage.AccountResolver) (brokerage.AccountSnapshot, error) {
	return d.snapshot, d.snapshotErr
}
func (d dispatchAdapter) SubmitOrder(_ context.Context, _ string, _ brokerage.AccountResolver, request brokerage.SubmitOrderRequest) (brokerage.Order, error) {
	return d.submit(request)
}
func (d dispatchAdapter) CancelOrder(_ context.Context, _ string, _ brokerage.AccountResolver, orderID string) (string, error) {
	if d.cancel == nil {
		return "", errors.New("unused")
	}
	return "fixture-cancel-request", d.cancel(orderID)
}

func consumedBrokerFixture(t *testing.T) (*Store, string, string, time.Time) {
	t.Helper()
	now := time.Date(2026, 9, 19, 9, 0, 0, 0, time.UTC)
	account := "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
	store, err := OpenStore(filepath.Join(t.TempDir(), "finance.json"))
	if err != nil {
		t.Fatal(err)
	}
	_, _ = store.PutBrokerSandboxMappingWithWalletKey(account, "01234567-89ab-4cde-8fab-0123456789ab", "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", now)
	challenge, err := store.CreateBrokerOrderChallenge(account, BrokerChallengeRequest{AccountPublicKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", FeeBoundEstablished: true, FeeEvidenceRef: "operator-policy:test", Order: FinanceOrderV1{AssetClass: "us_equity", AssetID: "11111111-2222-4333-8444-555555555555", Currency: "USD", FeeBoundSource: "operator_policy", LimitPrice: "10", MaxCost: "10", MaxFee: "0", OrderID: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", OrderType: "limit", Qty: "1", Side: "buy", Symbol: "ACME", TimeInForce: "day"}}, now)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.VerifyAndConsumeBrokerOrder(account, signFinanceApprovalForTest(t, challenge.Unsigned), now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if _, err := store.RequestBrokerExecution(account, challenge.Unsigned.Order.OrderID, "dispatch-test-request-0001", now.Add(90*time.Second)); err != nil {
		t.Fatal(err)
	}
	return store, account, challenge.Unsigned.Order.OrderID, now
}

func consumedSellBrokerFixture(t *testing.T) (*Store, string, string, time.Time) {
	t.Helper()
	now := time.Date(2026, 9, 19, 9, 0, 0, 0, time.UTC)
	account := "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
	store, err := OpenStore(filepath.Join(t.TempDir(), "finance.json"))
	if err != nil {
		t.Fatal(err)
	}
	_, _ = store.PutBrokerSandboxMappingWithWalletKey(account, "01234567-89ab-4cde-8fab-0123456789ab", "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", now)
	challenge, err := store.CreateBrokerOrderChallenge(account, BrokerChallengeRequest{AccountPublicKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", FeeBoundEstablished: true, FeeEvidenceRef: "operator-policy:test", Order: FinanceOrderV1{AssetClass: "us_equity", AssetID: "11111111-2222-4333-8444-555555555555", Currency: "USD", FeeBoundSource: "operator_policy", LimitPrice: "10", MaxCost: "0", MaxFee: "0", OrderID: "cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee", OrderType: "limit", Qty: "2", Side: "sell", Symbol: "ACME", TimeInForce: "day"}}, now)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.VerifyAndConsumeBrokerOrder(account, signFinanceApprovalForTest(t, challenge.Unsigned), now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if _, err := store.RequestBrokerExecution(account, challenge.Unsigned.Order.OrderID, "dispatch-test-request-0002", now.Add(90*time.Second)); err != nil {
		t.Fatal(err)
	}
	return store, account, challenge.Unsigned.Order.OrderID, now
}

func TestBrokerDispatcherSuccessAndReconcileCursor(t *testing.T) {
	store, account, orderID, now := consumedBrokerFixture(t)
	providerOrder := brokerage.Order{ID: "22222222-3333-4444-8555-666666666666", ClientOrderID: orderID, AssetID: "11111111-2222-4333-8444-555555555555", Symbol: "ACME", Side: "buy", Qty: "1", FilledQty: "0", Type: "limit", LimitPrice: "10", TimeInForce: "day", Status: "accepted", RequestID: "http-poll-0001"}
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
	if err != nil || canceled.State != "cancel_requested" || canceled.ProviderHTTPRequestID != "fixture-cancel-request" {
		t.Fatalf("cancel=%+v err=%v", canceled, err)
	}
	adapter.snapshot = brokerage.AccountSnapshot{Provider: FinanceOrderProvider, Environment: FinanceOrderTradingEnv, RequestIDs: []string{"request-b", "request-a"}, Account: brokerage.Account{ID: "01234567-89ab-4cde-8fab-0123456789ab"}, Orders: []brokerage.Order{{ID: providerOrder.ID, ClientOrderID: orderID, AssetID: providerOrder.AssetID, Symbol: "ACME", Side: "buy", Qty: "1", FilledQty: "1", Type: "limit", LimitPrice: "10", TimeInForce: "day", Status: "filled"}}}
	dispatcher.Adapter = adapter
	if _, err := dispatcher.Reconcile(context.Background(), account); err != nil {
		t.Fatal(err)
	}
	workspace := store.BrokerWorkspace(account, now.Add(2*time.Minute))
	brokerState := store.Account(account).Brokerage
	if workspace.Orders[0].State != "filled" || brokerState.ReconcileCheckpoint == "" || brokerState.EventCursor != "" {
		t.Fatalf("workspace=%+v", workspace)
	}
}

func TestBrokerExecutionIdempotencyKeyCannotCrossOrdersAfterRestart(t *testing.T) {
	store, account, firstOrderID, now := consumedBrokerFixture(t)
	second, err := store.CreateBrokerOrderChallenge(account, BrokerChallengeRequest{
		AccountPublicKey:    "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
		FeeBoundEstablished: true, FeeEvidenceRef: "operator-policy:test",
		Order: FinanceOrderV1{AssetClass: "us_equity", AssetID: "33333333-2222-4333-8444-555555555555", Currency: "USD", FeeBoundSource: "operator_policy", LimitPrice: "20", MaxCost: "20", MaxFee: "0", OrderID: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff", OrderType: "limit", Qty: "1", Side: "buy", Symbol: "BETA", TimeInForce: "day"},
	}, now.Add(2*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.VerifyAndConsumeBrokerOrder(account, signFinanceApprovalForTest(t, second.Unsigned), now.Add(3*time.Minute)); err != nil {
		t.Fatal(err)
	}
	corrupted := store.Account(account).Brokerage
	corrupted.Outbox = map[string]BrokerOrderOutbox{}
	for id, outbox := range store.Account(account).Brokerage.Outbox {
		corrupted.Outbox[id] = outbox
	}
	secondOutbox := corrupted.Outbox[second.Unsigned.Order.OrderID]
	secondOutbox.Status, secondOutbox.ExecutionRequestKey, secondOutbox.ExecutionRequestedAt = "execution_requested", "dispatch-test-request-0001", now.Add(3*time.Minute)
	corrupted.Outbox[second.Unsigned.Order.OrderID] = secondOutbox
	if err := validateBrokeragePersistence(account, corrupted); err == nil {
		t.Fatal("persisted duplicate execution idempotency keys passed state validation")
	}

	reopened, err := OpenStore(store.path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := reopened.RequestBrokerExecution(account, second.Unsigned.Order.OrderID, "dispatch-test-request-0001", now.Add(4*time.Minute)); err == nil {
		t.Fatal("one execution idempotency key was accepted for two different orders after restart")
	}
	workspace := reopened.BrokerWorkspace(account, now.Add(4*time.Minute))
	byID := map[string]BrokerOrderOutbox{}
	for _, outbox := range workspace.Outbox {
		byID[outbox.OrderID] = outbox
	}
	if byID[firstOrderID].ExecutionRequestKey != "dispatch-test-request-0001" || byID[second.Unsigned.Order.OrderID].ExecutionRequestKey != "" || byID[second.Unsigned.Order.OrderID].Status != "pending_unwired" {
		t.Fatalf("cross-order replay mutated an outbox: %+v", byID)
	}
	if _, err := reopened.RequestBrokerExecution(account, firstOrderID, "dispatch-test-request-0001", now.Add(5*time.Minute)); err != nil {
		t.Fatalf("exact same-order replay stopped being idempotent: %v", err)
	}
}

func TestBrokerReconciliationRejectsDuplicateClientOrderAndCrossTenantSnapshot(t *testing.T) {
	store, account, orderID, now := consumedBrokerFixture(t)
	providerOrder := brokerage.Order{ID: "22222222-3333-4444-8555-666666666666", ClientOrderID: orderID, AssetID: "11111111-2222-4333-8444-555555555555", Symbol: "ACME", Side: "buy", Qty: "1", FilledQty: "0", Type: "limit", LimitPrice: "10", TimeInForce: "day", Status: "accepted"}
	duplicate := providerOrder
	duplicate.ID = "33333333-4444-4555-8666-777777777777"
	duplicate.Status = "filled"

	before := store.Account(account).Brokerage
	if err := store.ApplyBrokerReconciliation(account, brokerage.AccountSnapshot{Orders: []brokerage.Order{providerOrder, duplicate}}, now.Add(time.Minute)); err == nil {
		t.Fatal("duplicate provider orders sharing one client order id were accepted")
	}
	after := store.Account(account).Brokerage
	if after.ReconcileCheckpoint != before.ReconcileCheckpoint || after.Orders[orderID].ProviderOrderID != before.Orders[orderID].ProviderOrderID || after.Orders[orderID].State != before.Orders[orderID].State {
		t.Fatalf("rejected duplicate snapshot mutated durable state: before=%+v after=%+v", before, after)
	}

	validSnapshot := brokerage.AccountSnapshot{
		Provider: FinanceOrderProvider, Environment: FinanceOrderTradingEnv,
		Account: brokerage.Account{ID: "01234567-89ab-4cde-8fab-0123456789ab"},
		Orders:  []brokerage.Order{providerOrder},
	}
	invalidSnapshots := map[string]brokerage.AccountSnapshot{}
	wrongProvider := validSnapshot
	wrongProvider.Provider = "attacker_broker"
	invalidSnapshots["wrong provider"] = wrongProvider
	wrongEnvironment := validSnapshot
	wrongEnvironment.Environment = "live"
	invalidSnapshots["wrong environment"] = wrongEnvironment
	wrongAccount := validSnapshot
	wrongAccount.Account.ID = "99999999-8888-4777-8666-555555555555"
	invalidSnapshots["wrong account"] = wrongAccount
	for name, snapshot := range invalidSnapshots {
		t.Run(name, func(t *testing.T) {
			dispatcher := BrokerDispatcher{Store: store, Adapter: dispatchAdapter{snapshot: snapshot}, Now: func() time.Time { return now.Add(2 * time.Minute) }}
			if _, err := dispatcher.Reconcile(context.Background(), account); err == nil {
				t.Fatal("wrong-authority provider snapshot was accepted")
			}
			after = store.Account(account).Brokerage
			if after.ReconcileCheckpoint != before.ReconcileCheckpoint || after.Orders[orderID].ProviderOrderID != before.Orders[orderID].ProviderOrderID || after.Orders[orderID].State != before.Orders[orderID].State {
				t.Fatalf("rejected wrong-authority snapshot mutated durable state: before=%+v after=%+v", before, after)
			}
		})
	}
}

func TestProviderRejectedErrorPersistsBoundedHTTPRequestCorrelation(t *testing.T) {
	store, account, orderID, now := consumedBrokerFixture(t)
	dispatcher := BrokerDispatcher{Store: store, Adapter: dispatchAdapter{submit: func(brokerage.SubmitOrderRequest) (brokerage.Order, error) {
		return brokerage.Order{}, &brokerage.Error{Code: "PROVIDER_REJECTED", RequestID: "http-reject-0001", HTTPStatus: 422}
	}}, Now: func() time.Time { return now.Add(2 * time.Minute) }}
	if _, err := dispatcher.Dispatch(context.Background(), account, orderID); brokerage.ErrorCode(err) != "PROVIDER_REJECTED" {
		t.Fatal(err)
	}
	reopened, err := OpenStore(store.path)
	if err != nil {
		t.Fatal(err)
	}
	state := reopened.Account(account).Brokerage
	order, outbox := state.Orders[orderID], state.Outbox[orderID]
	last := state.Journal[len(state.Journal)-1]
	if order.State != "provider_rejected" || order.ProviderHTTPRequestID != "http-reject-0001" || outbox.Status != "provider_rejected" || outbox.ProviderHTTPRequestID != "http-reject-0001" || last.ProviderHTTPRequestID != "http-reject-0001" {
		t.Fatalf("order=%+v outbox=%+v journal=%+v", order, outbox, last)
	}
}

func TestBrokerReconciliationPreservesProviderEventCursor(t *testing.T) {
	store, account, orderID, now := consumedBrokerFixture(t)
	providerOrder := brokerage.Order{ID: "22222222-3333-4444-8555-666666666666", ClientOrderID: orderID, AssetID: "11111111-2222-4333-8444-555555555555", Symbol: "ACME", Side: "buy", Qty: "1", FilledQty: "0", Type: "limit", LimitPrice: "10", TimeInForce: "day", Status: "accepted"}
	event := brokerage.TradeEvent{Cursor: "provider-event-17", ProviderAccountID: "01234567-89ab-4cde-8fab-0123456789ab", Event: "new", Timestamp: now.Add(time.Minute), Order: providerOrder}
	if err := store.ApplyBrokerTradeEvents(account, []brokerage.TradeEvent{event}, event.Cursor, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	pollOrder := providerOrder
	pollOrder.RequestID = "http-poll-0001"
	if err := store.ApplyBrokerReconciliation(account, brokerage.AccountSnapshot{RequestIDs: []string{"poll-2", "poll-1"}, Orders: []brokerage.Order{pollOrder}}, now.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	state := store.Account(account).Brokerage
	if state.EventCursor != event.Cursor || state.ReconcileCheckpoint == "" || state.Orders[orderID].ProviderHTTPRequestID != "http-poll-0001" || state.Orders[orderID].ProviderRawStatus != "accepted" {
		t.Fatalf("polling overwrote event recovery state: %+v", state)
	}
}

func TestOperatorCancelAcceptsExistingBrowserCancellationIntent(t *testing.T) {
	store, account, orderID, now := consumedBrokerFixture(t)
	claim, err := store.ClaimBrokerDispatch(account, orderID, now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	providerOrder := brokerage.Order{ID: "22222222-3333-4444-8555-666666666666", ClientOrderID: orderID, AssetID: claim.Order.Order.AssetID, Symbol: claim.Order.Order.Symbol, Side: claim.Order.Order.Side, Qty: claim.Order.Order.Qty, FilledQty: "0", Type: claim.Order.Order.OrderType, LimitPrice: claim.Order.Order.LimitPrice, TimeInForce: claim.Order.Order.TimeInForce, ExtendedHours: claim.Order.Order.ExtendedHours, Status: "accepted", SubmittedAt: now.Format(time.RFC3339Nano)}
	if _, err := store.CompleteBrokerDispatch(account, orderID, &providerOrder, nil, now.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if _, err := store.RequestBrokerCancel(account, orderID, now.Add(3*time.Minute)); err != nil {
		t.Fatal(err)
	}
	calls := 0
	dispatcher := BrokerDispatcher{Store: store, Adapter: dispatchAdapter{cancel: func(providerID string) error {
		calls++
		if providerID != providerOrder.ID {
			t.Fatalf("providerID=%s", providerID)
		}
		return nil
	}}, Now: func() time.Time { return now.Add(4 * time.Minute) }}
	record, err := dispatcher.Cancel(context.Background(), account, orderID)
	if err != nil || calls != 1 || record.State != "cancel_requested" {
		t.Fatalf("record=%+v calls=%d err=%v", record, calls, err)
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

func TestProviderRejectedIsTerminalAcrossPollingEventsRestartAndDispatch(t *testing.T) {
	for _, source := range []string{"poll", "event"} {
		t.Run(source, func(t *testing.T) {
			store, account, orderID, now := consumedBrokerFixture(t)
			path := store.path
			rejected := brokerage.Order{ID: "22222222-3333-4444-8555-666666666666", ClientOrderID: orderID, AssetID: "11111111-2222-4333-8444-555555555555", Symbol: "ACME", Side: "buy", Qty: "1", FilledQty: "0", Type: "limit", LimitPrice: "10", TimeInForce: "day", Status: "rejected"}
			if source == "poll" {
				if err := store.ApplyBrokerReconciliation(account, brokerage.AccountSnapshot{RequestIDs: []string{"reject-poll"}, Orders: []brokerage.Order{rejected}}, now.Add(2*time.Minute)); err != nil {
					t.Fatal(err)
				}
			} else {
				event := brokerage.TradeEvent{Cursor: "reject-event", ProviderAccountID: "01234567-89ab-4cde-8fab-0123456789ab", Event: "rejected", Timestamp: now.Add(2 * time.Minute), Order: rejected}
				if err := store.ApplyBrokerTradeEvents(account, []brokerage.TradeEvent{event}, event.Cursor, now.Add(2*time.Minute)); err != nil {
					t.Fatal(err)
				}
			}
			state := store.Account(account).Brokerage
			if state.Orders[orderID].State != "provider_rejected" || state.Outbox[orderID].Status != "provider_rejected" || state.Outbox[orderID].LastErrorCode != "PROVIDER_REJECTED" {
				t.Fatalf("rejection was not persisted as terminal: order=%+v outbox=%+v", state.Orders[orderID], state.Outbox[orderID])
			}
			reopened, err := OpenStore(path)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := reopened.ClaimBrokerDispatch(account, orderID, now.Add(3*time.Minute)); err == nil {
				t.Fatal("provider-rejected order was dispatchable after restart")
			}
			accepted := rejected
			accepted.Status = "accepted"
			if err := reopened.ApplyBrokerReconciliation(account, brokerage.AccountSnapshot{RequestIDs: []string{"stale-accepted"}, Orders: []brokerage.Order{accepted}}, now.Add(4*time.Minute)); err == nil {
				t.Fatal("provider-rejected order regressed through polling")
			}
			final := reopened.Account(account).Brokerage
			if final.Orders[orderID].State != "provider_rejected" || final.Outbox[orderID].Status != "provider_rejected" {
				t.Fatalf("terminal rejection changed: %+v", final.Orders[orderID])
			}
		})
	}
}

func TestProviderAuditMetadataPersistsAndSeparatesHTTPFromEventCursor(t *testing.T) {
	store, account, orderID, now := consumedBrokerFixture(t)
	claim, err := store.ClaimBrokerDispatch(account, orderID, now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	provider := brokerage.Order{ID: "22222222-3333-4444-8555-666666666666", ClientOrderID: orderID, AssetID: claim.Order.Order.AssetID, Symbol: "ACME", Side: "buy", Qty: "1", FilledQty: "0", Type: "limit", LimitPrice: "10", TimeInForce: "day", Status: "accepted", RequestID: "http-submit-0001", SubmittedAt: now.Format(time.RFC3339Nano)}
	if _, err := store.CompleteBrokerDispatch(account, orderID, &provider, nil, now.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	provider.Status, provider.FilledQty, provider.RequestID = "filled", "1", ""
	event := brokerage.TradeEvent{Cursor: "sse-event-0001", ProviderAccountID: claim.Order.BrokerAccountID, Event: "fill", Timestamp: now.Add(3 * time.Minute), Order: provider}
	if err := store.ApplyBrokerTradeEvents(account, []brokerage.TradeEvent{event}, event.Cursor, now.Add(3*time.Minute)); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenStore(store.path)
	if err != nil {
		t.Fatal(err)
	}
	state := reopened.Account(account).Brokerage
	order, outbox := state.Orders[orderID], state.Outbox[orderID]
	if order.ProviderRawStatus != "filled" || order.ProviderHTTPRequestID != "http-submit-0001" || order.ProviderEventCursor != "sse-event-0001" || outbox.ProviderRawStatus != "filled" || outbox.ProviderHTTPRequestID != "http-submit-0001" {
		t.Fatalf("order=%+v outbox=%+v", order, outbox)
	}
	last := state.Journal[len(state.Journal)-1]
	if last.ProviderRawStatus != "filled" || last.ProviderHTTPRequestID != "" || last.ProviderEventCursor != "sse-event-0001" {
		t.Fatalf("event audit correlation was conflated: %+v", last)
	}
}

func TestBrokerTradeEventsAllowSameTimestampAcrossDifferentOwnedOrders(t *testing.T) {
	store, account, firstOrderID, now := consumedBrokerFixture(t)
	// A second order is created through the same production challenge/consume
	// boundary, preserving tenant and Wallet ownership.
	challenge, err := store.CreateBrokerOrderChallenge(account, BrokerChallengeRequest{AccountPublicKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", FeeBoundEstablished: true, FeeEvidenceRef: "operator-policy:test", Order: FinanceOrderV1{AssetClass: "us_equity", AssetID: "33333333-2222-4333-8444-555555555555", Currency: "USD", FeeBoundSource: "operator_policy", LimitPrice: "20", MaxCost: "20", MaxFee: "0", OrderID: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff", OrderType: "limit", Qty: "1", Side: "buy", Symbol: "BETA", TimeInForce: "day"}}, now)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.VerifyAndConsumeBrokerOrder(account, signFinanceApprovalForTest(t, challenge.Unsigned), now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	stamp := now.Add(2 * time.Minute)
	events := []brokerage.TradeEvent{
		{Cursor: "same-time-1", ProviderAccountID: "01234567-89ab-4cde-8fab-0123456789ab", Event: "fill", Timestamp: stamp, Order: brokerage.Order{ID: "22222222-3333-4444-8555-666666666666", ClientOrderID: firstOrderID, AssetID: "11111111-2222-4333-8444-555555555555", Symbol: "ACME", Side: "buy", Qty: "1", FilledQty: "1", Type: "limit", LimitPrice: "10", TimeInForce: "day", Status: "filled"}},
		{Cursor: "same-time-2", ProviderAccountID: "01234567-89ab-4cde-8fab-0123456789ab", Event: "fill", Timestamp: stamp, Order: brokerage.Order{ID: "33333333-4444-4555-8666-777777777777", ClientOrderID: challenge.Unsigned.Order.OrderID, AssetID: challenge.Unsigned.Order.AssetID, Symbol: "BETA", Side: "buy", Qty: "1", FilledQty: "1", Type: "limit", LimitPrice: "20", TimeInForce: "day", Status: "filled"}},
	}
	if err := store.ApplyBrokerTradeEvents(account, events, "same-time-2", stamp); err != nil {
		t.Fatal(err)
	}
	state := store.Account(account).Brokerage
	if state.EventCursor != "same-time-2" || state.Orders[firstOrderID].State != "filled" || state.Orders[challenge.Unsigned.Order.OrderID].State != "filled" {
		t.Fatalf("same-time cross-order events not applied: %+v", state)
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

func TestBrokerDispatchCompletionBindsFullSignedOrderIdentity(t *testing.T) {
	base := brokerage.Order{ID: "22222222-3333-4444-8555-666666666666", AssetID: "11111111-2222-4333-8444-555555555555", Symbol: "ACME", Side: "buy", Qty: "1", FilledQty: "0", Type: "limit", LimitPrice: "10", TimeInForce: "day", Status: "accepted"}
	mutations := map[string]func(*brokerage.Order){
		"type":           func(o *brokerage.Order) { o.Type = "market" },
		"price":          func(o *brokerage.Order) { o.LimitPrice = "11" },
		"time in force":  func(o *brokerage.Order) { o.TimeInForce = "gtc" },
		"extended hours": func(o *brokerage.Order) { o.ExtendedHours = true },
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			store, account, orderID, now := consumedBrokerFixture(t)
			if _, err := store.ClaimBrokerDispatch(account, orderID, now.Add(time.Minute)); err != nil {
				t.Fatal(err)
			}
			candidate := base
			candidate.ClientOrderID = orderID
			mutate(&candidate)
			if _, err := store.CompleteBrokerDispatch(account, orderID, &candidate, nil, now.Add(2*time.Minute)); err == nil {
				t.Fatal("provider submission response diverging from the signed order was accepted")
			}
			workspace := store.BrokerWorkspace(account, now.Add(2*time.Minute))
			if workspace.Orders[0].ProviderOrderID != "" || workspace.Orders[0].State != "submitting" || workspace.Outbox[0].Status != "dispatching" {
				t.Fatalf("rejected provider response mutated durable state: %+v", workspace)
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
	workspace := store.BrokerWorkspace(account, now)
	if posts != 0 || workspace.Orders[0].State != "execution_blocked" || workspace.Outbox[0].Status != "execution_blocked" || workspace.Outbox[0].LastErrorCode != "ORDER_APPROVAL_EXPIRED" || workspace.Journal[len(workspace.Journal)-1].Action != "product.execution_blocked" {
		t.Fatal("expired approval reached provider or was not fenced")
	}
	reopened, err := OpenStore(store.path)
	if err != nil {
		t.Fatal(err)
	}
	workspace = reopened.BrokerWorkspace(account, now)
	if workspace.Orders[0].State != "execution_blocked" || workspace.Outbox[0].Status != "execution_blocked" {
		t.Fatal("local execution block did not survive restart")
	}
	if _, err := reopened.ClaimBrokerDispatch(account, orderID, now.Add(time.Hour+time.Minute)); err == nil {
		t.Fatal("local execution block became dispatchable after restart")
	}

	store, account, orderID, now = consumedBrokerFixture(t)
	posts = 0
	if _, err := store.PutBrokerSandboxMapping(account, "99999999-89ab-4cde-8fab-0123456789ab", now.Add(100*time.Second)); err != nil {
		t.Fatal(err)
	}
	adapter = dispatchAdapter{submit: func(brokerage.SubmitOrderRequest) (brokerage.Order, error) { posts++; return brokerage.Order{}, nil }}
	dispatcher = BrokerDispatcher{Store: store, Adapter: adapter, Now: func() time.Time { return now.Add(2 * time.Minute) }}
	if _, err := dispatcher.Dispatch(context.Background(), account, orderID); brokerage.ErrorCode(err) != "ACCOUNT_MAPPING_CHANGED" {
		t.Fatalf("expected account mapping fence, got %v", err)
	}
	workspace = store.BrokerWorkspace(account, now)
	if posts != 0 || workspace.Orders[0].State != "execution_blocked" || workspace.Outbox[0].Status != "execution_blocked" || workspace.Outbox[0].LastErrorCode != "ACCOUNT_MAPPING_CHANGED" {
		t.Fatal("changed account mapping reached provider or was not fenced")
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

func TestBrokerPreflightReadFailuresPreserveApprovedOrderForBoundedRetry(t *testing.T) {
	readFailure := errors.New("provider preflight read failed")
	cases := []struct {
		name string
		fail func(*dispatchAdapter)
	}{
		{name: "account", fail: func(adapter *dispatchAdapter) { adapter.accountErr = readFailure }},
		{name: "assets", fail: func(adapter *dispatchAdapter) { adapter.assetsErr = readFailure }},
		{name: "quote", fail: func(adapter *dispatchAdapter) { adapter.quoteErr = readFailure }},
		{name: "positions", fail: func(adapter *dispatchAdapter) { adapter.positionsErr = readFailure }},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			store, account, orderID, now := consumedBrokerFixture(t)
			posts := 0
			providerOrder := brokerage.Order{ID: "22222222-3333-4444-8555-666666666666", ClientOrderID: orderID, AssetID: "11111111-2222-4333-8444-555555555555", Symbol: "ACME", Side: "buy", Qty: "1", FilledQty: "0", Type: "limit", LimitPrice: "10", TimeInForce: "day", Status: "accepted", RequestID: "http-submit-0001"}
			submit := func(request brokerage.SubmitOrderRequest) (brokerage.Order, error) {
				posts++
				expected := brokerage.SubmitOrderRequest{ClientOrderID: orderID, AssetID: providerOrder.AssetID, Symbol: providerOrder.Symbol, Side: providerOrder.Side, Qty: providerOrder.Qty, Type: providerOrder.Type, LimitPrice: providerOrder.LimitPrice, TimeInForce: providerOrder.TimeInForce}
				if request != expected {
					t.Fatalf("approved order content changed on retry: got=%+v want=%+v", request, expected)
				}
				return providerOrder, nil
			}
			failedAdapter := dispatchAdapter{submit: submit}
			test.fail(&failedAdapter)
			dispatcher := BrokerDispatcher{Store: store, Adapter: failedAdapter, Now: func() time.Time { return now.Add(2 * time.Minute) }}
			if _, err := dispatcher.Dispatch(context.Background(), account, orderID); err == nil {
				t.Fatal("preflight read failure was accepted")
			}
			state := store.Account(account).Brokerage
			order, outbox := state.Orders[orderID], state.Outbox[orderID]
			if posts != 0 || order.ApprovalState != "consumed" || order.State != "submitting" || outbox.Status != "execution_requested" || outbox.LastErrorCode != "ORDER_PREFLIGHT_FAILED" || outbox.Attempts != 1 {
				t.Fatalf("preflight failure consumed the approved order: posts=%d order=%+v outbox=%+v", posts, order, outbox)
			}

			dispatcher.Adapter = dispatchAdapter{submit: submit}
			retried, err := dispatcher.Dispatch(context.Background(), account, orderID)
			if err != nil || posts != 1 || retried.State != "submitted" || retried.ProviderOrderID != providerOrder.ID {
				t.Fatalf("bounded retry did not submit the same order once: record=%+v posts=%d err=%v", retried, posts, err)
			}
			if _, err := dispatcher.Dispatch(context.Background(), account, orderID); err == nil || posts != 1 {
				t.Fatalf("provider-correlated order was submitted again: posts=%d err=%v", posts, err)
			}
		})
	}
}

func TestBrokerDispatchBlocksEveryExplicitTradingAccountFenceBeforeSubmit(t *testing.T) {
	for name, blockedAccount := range map[string]brokerage.Account{
		"trading blocked": {ID: "01234567-89ab-4cde-8fab-0123456789ab", Status: "ACTIVE", Currency: "USD", Cash: "100", BuyingPower: "100", TradingBlocked: true},
		"account blocked": {ID: "01234567-89ab-4cde-8fab-0123456789ab", Status: "ACTIVE", Currency: "USD", Cash: "100", BuyingPower: "100", AccountBlocked: true},
		"user suspended":  {ID: "01234567-89ab-4cde-8fab-0123456789ab", Status: "ACTIVE", Currency: "USD", Cash: "100", BuyingPower: "100", TradeSuspendedByUser: true},
	} {
		t.Run(name, func(t *testing.T) {
			store, account, orderID, now := consumedBrokerFixture(t)
			posts := 0
			adapter := dispatchAdapter{account: blockedAccount, submit: func(brokerage.SubmitOrderRequest) (brokerage.Order, error) {
				posts++
				return brokerage.Order{}, nil
			}}
			dispatcher := BrokerDispatcher{Store: store, Adapter: adapter, Now: func() time.Time { return now.Add(2 * time.Minute) }}
			if _, err := dispatcher.Dispatch(context.Background(), account, orderID); err == nil {
				t.Fatal("blocked trading account was accepted")
			}
			if posts != 0 {
				t.Fatalf("blocked account reached provider POST: %d", posts)
			}
		})
	}
}

func TestBrokerSellRequiresHoldingsAndCanReachFilled(t *testing.T) {
	for name, available := range map[string]string{"filled": "2", "insufficient": "1"} {
		t.Run(name, func(t *testing.T) {
			store, account, orderID, now := consumedSellBrokerFixture(t)
			posts := 0
			provider := brokerage.Order{ID: "22222222-3333-4444-8555-666666666666", ClientOrderID: orderID, AssetID: "11111111-2222-4333-8444-555555555555", Symbol: "ACME", Side: "sell", Qty: "2", FilledQty: "2", Type: "limit", LimitPrice: "10", TimeInForce: "day", Status: "filled", SubmittedAt: now.Format(time.RFC3339Nano)}
			adapter := dispatchAdapter{positions: []brokerage.Position{{AssetID: provider.AssetID, Symbol: "ACME", Qty: "2", AvailableQty: available}}, submit: func(brokerage.SubmitOrderRequest) (brokerage.Order, error) { posts++; return provider, nil }}
			dispatcher := BrokerDispatcher{Store: store, Adapter: adapter, Now: func() time.Time { return now.Add(2 * time.Minute) }}
			record, err := dispatcher.Dispatch(context.Background(), account, orderID)
			if name == "insufficient" {
				if err == nil || posts != 0 {
					t.Fatalf("insufficient sell reached provider: posts=%d err=%v", posts, err)
				}
				return
			}
			if err != nil || posts != 1 || record.State != "filled" {
				t.Fatalf("record=%+v posts=%d err=%v", record, posts, err)
			}
		})
	}
}

func TestPartialFillWinsCancelRaceWithoutRegression(t *testing.T) {
	store, account, orderID, now := consumedBrokerFixture(t)
	claim, _ := store.ClaimBrokerDispatch(account, orderID, now.Add(time.Minute))
	partial := brokerage.Order{ID: "22222222-3333-4444-8555-666666666666", ClientOrderID: orderID, AssetID: claim.Order.Order.AssetID, Symbol: "ACME", Side: "buy", Qty: "1", FilledQty: "0.5", Type: "limit", LimitPrice: "10", TimeInForce: "day", Status: "partially_filled", SubmittedAt: now.Format(time.RFC3339Nano)}
	if _, err := store.CompleteBrokerDispatch(account, orderID, &partial, nil, now.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if _, err := store.RequestBrokerCancel(account, orderID, now.Add(3*time.Minute)); err != nil {
		t.Fatal(err)
	}
	filled := partial
	filled.FilledQty, filled.Status = "1", "filled"
	event := brokerage.TradeEvent{Cursor: "cancel-race-fill", ProviderAccountID: claim.Order.BrokerAccountID, Event: "fill", Timestamp: now.Add(4 * time.Minute), Order: filled}
	if err := store.ApplyBrokerTradeEvents(account, []brokerage.TradeEvent{event}, event.Cursor, now.Add(4*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if state := store.Account(account).Brokerage.Orders[orderID].State; state != "filled" {
		t.Fatalf("cancel race regressed fill: %s", state)
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
		return brokerage.Order{}, &brokerage.Error{Code: "PROVIDER_UNAVAILABLE", RequestID: "http-submit-5xx", HTTPStatus: 503}
	}}
	dispatcher := BrokerDispatcher{Store: store, Adapter: adapter, Now: func() time.Time { return now.Add(2 * time.Minute) }}
	if _, err := dispatcher.Dispatch(context.Background(), account, orderID); brokerage.ErrorCode(err) != "PROVIDER_UNAVAILABLE" {
		t.Fatal(err)
	}
	workspace := store.BrokerWorkspace(account, now.Add(2*time.Minute))
	journal := store.Account(account).Brokerage.Journal
	if workspace.Orders[0].State != "submitted_unknown" || workspace.Orders[0].ProviderHTTPRequestID != "http-submit-5xx" || workspace.Outbox[0].Status != "submitted_unknown" || workspace.Outbox[0].LastErrorCode != "PROVIDER_UNAVAILABLE" || workspace.Outbox[0].ProviderHTTPRequestID != "http-submit-5xx" || journal[len(journal)-1].Action != "provider.submission_unknown" {
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
