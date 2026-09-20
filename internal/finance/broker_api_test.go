package finance

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/finance/brokerage"
)

func TestBrokerChallengeCallbackAndWorkspaceNeverPostsProvider(t *testing.T) {
	now := time.Date(2026, 9, 19, 9, 0, 0, 0, time.UTC)
	account := "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
	store, err := OpenStore(filepath.Join(t.TempDir(), "finance.json"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.PutBrokerSandboxMappingWithWalletKey(account, "01234567-89ab-4cde-8fab-0123456789ab", "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", now); err != nil {
		t.Fatal(err)
	}
	server := &Server{service: &Service{Store: store}, cfg: ServerConfig{BrokerMaxFeeUSD: "1.25", BrokerFeeBoundSource: "operator_policy", BrokerFeeEvidenceRef: "operator-policy:test:v1"}, now: func() time.Time { return now }}
	input := brokerChallengeInput{Draft: BrokerOrderDraftInput{AssetID: "11111111-2222-4333-8444-555555555555", Symbol: "ACME", Side: "buy", Qty: "2", LimitPrice: "125.34"}}
	body, _ := json.Marshal(input)
	request := httptest.NewRequest(http.MethodPost, "/api/broker/challenges", bytes.NewReader(body))
	recorder := httptest.NewRecorder()
	server.brokerChallenge(recorder, request, Session{Account: account})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("challenge status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var created struct {
		Challenge              BrokerApprovalChallenge `json:"challenge"`
		ProviderWriteAttempted bool                    `json:"providerWriteAttempted"`
	}
	if json.Unmarshal(recorder.Body.Bytes(), &created) != nil || created.ProviderWriteAttempted || created.Challenge.Unsigned.Order.MaxCost != "251.93" {
		t.Fatalf("created=%+v", created)
	}
	approval := signFinanceApprovalForTest(t, created.Challenge.Unsigned)
	callback := mustFinanceCanonical(map[string]any{"approval": approval, "callbackStateHash": approval.CallbackStateHash, "kind": "finance_order_approval_result", "requestId": approval.RequestID, "status": "approved", "version": "1"})
	request = httptest.NewRequest(http.MethodPost, "/api/broker/callback", bytes.NewReader(callback))
	recorder = httptest.NewRecorder()
	server.now = func() time.Time { return now.Add(time.Minute) }
	server.brokerCallback(recorder, request, Session{Account: account})
	if recorder.Code != http.StatusOK || !bytes.Contains(recorder.Body.Bytes(), []byte(`"providerWriteAttempted":false`)) {
		t.Fatalf("callback status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	workspace := store.BrokerWorkspace(account, now.Add(time.Minute))
	if !workspace.MappingActive || len(workspace.Orders) != 1 || len(workspace.Outbox) != 1 || workspace.Outbox[0].Status != "pending_unwired" {
		t.Fatalf("workspace=%+v", workspace)
	}
	// Exact replay returns the existing outbox and never creates a second event.
	request = httptest.NewRequest(http.MethodPost, "/api/broker/callback", bytes.NewReader(callback))
	recorder = httptest.NewRecorder()
	server.brokerCallback(recorder, request, Session{Account: account})
	if recorder.Code != http.StatusOK || len(store.BrokerWorkspace(account, now.Add(time.Minute)).Outbox) != 1 {
		t.Fatalf("replay status=%d", recorder.Code)
	}
}

func TestBrokerWorkspaceArchivesExpiredApprovalBeforeCallbackWithoutProviderWrite(t *testing.T) {
	now := time.Date(2026, 9, 20, 13, 0, 0, 0, time.UTC)
	account := "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
	walletKey := "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
	path := filepath.Join(t.TempDir(), "finance.json")
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.PutBrokerSandboxMappingWithWalletKey(account, "01234567-89ab-4cde-8fab-0123456789ab", walletKey, now); err != nil {
		t.Fatal(err)
	}
	challenge, err := store.CreateBrokerOrderChallenge(account, BrokerChallengeRequest{AccountPublicKey: walletKey, FeeBoundEstablished: true, FeeEvidenceRef: "operator-policy:test-expiry-api", Order: FinanceOrderV1{AssetClass: "us_equity", AssetID: "11111111-2222-4333-8444-555555555555", Currency: "USD", FeeBoundSource: "operator_policy", LimitPrice: "10", MaxCost: "10", MaxFee: "0", OrderID: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", OrderType: "limit", Qty: "1", Side: "buy", Symbol: "ACME", TimeInForce: "day"}}, now)
	if err != nil {
		t.Fatal(err)
	}
	approval := signFinanceApprovalForTest(t, challenge.Unsigned)
	if _, err := store.ApproveBrokerOrder(account, approval, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	server := &Server{service: &Service{Store: store}, now: func() time.Time { return now.Add(5 * time.Minute) }}
	recorder := httptest.NewRecorder()
	server.brokerOrders(recorder, httptest.NewRequest(http.MethodGet, "/api/broker/orders", nil), Session{Account: account})
	if recorder.Code != http.StatusOK || !bytes.Contains(recorder.Body.Bytes(), []byte(`"approvalState":"expired"`)) || !bytes.Contains(recorder.Body.Bytes(), []byte(`"providerWriteAttempted":false`)) {
		t.Fatalf("expired workspace status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	callback := mustFinanceCanonical(map[string]any{"approval": approval, "callbackStateHash": approval.CallbackStateHash, "kind": "finance_order_approval_result", "requestId": approval.RequestID, "status": "approved", "version": "1"})
	recorder = httptest.NewRecorder()
	server.brokerCallback(recorder, httptest.NewRequest(http.MethodPost, "/api/broker/callback", bytes.NewReader(callback)), Session{Account: account})
	if recorder.Code != http.StatusConflict {
		t.Fatalf("expired callback status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	reopened, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	state := reopened.Account(account).Brokerage
	if len(state.Outbox) != 0 || state.Challenges[challenge.Unsigned.RequestID].ApprovalState != "expired" || state.Orders[challenge.Unsigned.Order.OrderID].State != "draft" {
		t.Fatalf("expired callback created provider work or lost durable state: %+v", state)
	}
}

func TestCredentialIndependentBrokerFlowEndToEnd(t *testing.T) {
	now := time.Date(2026, 9, 20, 1, 0, 0, 0, time.UTC)
	account := "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
	brokerAccount := "01234567-89ab-4cde-8fab-0123456789ab"
	walletKey := "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
	path := filepath.Join(t.TempDir(), "finance.json")
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.PutBrokerSandboxMappingWithWalletKey(account, brokerAccount, walletKey, now); err != nil {
		t.Fatal(err)
	}
	values := map[string]string{
		"FINANCE_TRADING_ENABLED":                         "true",
		"FINANCE_SANDBOX_WRITES_ENABLED":                  "true",
		"FINANCE_SANDBOX_WRITE_ACTIVATION_RECEIPT_SHA256": strings.Repeat("a", 64),
		"ALPACA_BROKER_CLIENT_ID":                         "isolated-fixture-id",
		"ALPACA_BROKER_CLIENT_SECRET":                     "isolated-fixture-secret",
	}
	server := &Server{service: &Service{Store: store}, cfg: ServerConfig{
		BrokerConfig:    brokerage.LoadConfig(func(key string) string { return values[key] }),
		BrokerMaxFeeUSD: "1", BrokerFeeBoundSource: "operator_policy", BrokerFeeEvidenceRef: "isolated-fixture:weekly-v3",
	}, now: func() time.Time { return now }}

	draftBody, _ := json.Marshal(brokerChallengeInput{Draft: BrokerOrderDraftInput{AssetID: "11111111-2222-4333-8444-555555555555", Symbol: "ACME", Side: "buy", Qty: "2", LimitPrice: "10"}})
	recorder := httptest.NewRecorder()
	server.brokerChallenge(recorder, httptest.NewRequest(http.MethodPost, "/api/broker/challenges", bytes.NewReader(draftBody)), Session{Account: account})
	var created struct {
		Challenge BrokerApprovalChallenge `json:"challenge"`
	}
	if recorder.Code != http.StatusCreated || json.Unmarshal(recorder.Body.Bytes(), &created) != nil {
		t.Fatalf("challenge status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	approval := signFinanceApprovalForTest(t, created.Challenge.Unsigned)
	callback := mustFinanceCanonical(map[string]any{"approval": approval, "callbackStateHash": approval.CallbackStateHash, "kind": "finance_order_approval_result", "requestId": approval.RequestID, "status": "approved", "version": "1"})
	server.now = func() time.Time { return now.Add(time.Minute) }
	recorder = httptest.NewRecorder()
	server.brokerCallback(recorder, httptest.NewRequest(http.MethodPost, "/api/broker/callback", bytes.NewReader(callback)), Session{Account: account})
	if recorder.Code != http.StatusOK {
		t.Fatalf("approval status=%d body=%s", recorder.Code, recorder.Body.String())
	}

	orderID := approval.Order.OrderID
	executionBody := []byte(`{"idempotencyKey":"isolated-e2e-execution-0001"}`)
	executionRequest := httptest.NewRequest(http.MethodPost, "/api/broker/orders/"+orderID+"/execution-request", bytes.NewReader(executionBody))
	executionRequest.SetPathValue("id", orderID)
	recorder = httptest.NewRecorder()
	server.brokerExecutionRequest(recorder, executionRequest, Session{Account: account})
	if recorder.Code != http.StatusAccepted || !bytes.Contains(recorder.Body.Bytes(), []byte(`"providerWriteAttempted":false`)) {
		t.Fatalf("execution request status=%d body=%s", recorder.Code, recorder.Body.String())
	}

	providerOrder := brokerage.Order{ID: "22222222-3333-4444-8555-666666666666", ClientOrderID: orderID, AssetID: approval.Order.AssetID, Symbol: approval.Order.Symbol, Side: approval.Order.Side, Qty: approval.Order.Qty, FilledQty: "0", Type: approval.Order.OrderType, LimitPrice: approval.Order.LimitPrice, TimeInForce: approval.Order.TimeInForce, Status: "accepted", RequestID: "isolated-submit-0001", SubmittedAt: now.Add(2 * time.Minute).Format(time.RFC3339Nano)}
	adapter := dispatchAdapter{quote: brokerage.Quote{Symbol: "ACME", BidPrice: "9.99", AskPrice: "10", Timestamp: now.Add(2 * time.Minute).Format(time.RFC3339Nano), Feed: "iex"}, submit: func(request brokerage.SubmitOrderRequest) (brokerage.Order, error) {
		if request.ClientOrderID != orderID || request.AssetID != approval.Order.AssetID || request.Qty != "2" || request.LimitPrice != "10" {
			t.Fatalf("provider request no longer matches approved order: %+v", request)
		}
		return providerOrder, nil
	}}
	dispatcher := BrokerDispatcher{Store: store, Adapter: adapter, Now: func() time.Time { return now.Add(2 * time.Minute) }}
	if record, err := dispatcher.Dispatch(t.Context(), account, orderID); err != nil || record.State != "submitted" || record.ProviderOrderID != providerOrder.ID {
		t.Fatalf("dispatch record=%+v err=%v", record, err)
	}
	filled := providerOrder
	filled.FilledQty, filled.Status, filled.RequestID = "2", "filled", "isolated-reconcile-order-0001"
	adapter.snapshot = brokerage.AccountSnapshot{
		Provider: FinanceOrderProvider, Environment: FinanceOrderTradingEnv,
		RequestIDs: []string{"isolated-account-0001", "isolated-orders-0001", "isolated-positions-0001"},
		Account:    brokerage.Account{ID: brokerAccount, Status: "ACTIVE", Currency: "USD", Cash: "979", BuyingPower: "979", RequestID: "isolated-account-0001"},
		Orders:     []brokerage.Order{filled},
		Positions:  []brokerage.Position{{AssetID: approval.Order.AssetID, Symbol: approval.Order.Symbol, Qty: "2", AvailableQty: "2", AveragePrice: "10", MarketValue: "20"}},
	}
	dispatcher.Adapter = adapter
	if _, err := dispatcher.Reconcile(t.Context(), account); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	workspace := reopened.BrokerWorkspace(account, now.Add(3*time.Minute))
	if len(workspace.Orders) != 1 || workspace.Orders[0].State != "filled" || workspace.Orders[0].ApprovalState != "consumed" || len(workspace.Outbox) != 1 || workspace.Outbox[0].Status != "submitted" || workspace.Outbox[0].ProviderRawStatus != "filled" {
		t.Fatalf("final workspace=%+v", workspace)
	}
	if got, err := reopened.ResolveBrokerAccount(t.Context(), account, FinanceOrderProvider, FinanceOrderTradingEnv); err != nil || got != brokerAccount {
		t.Fatalf("mapping=%q err=%v", got, err)
	}
}

func TestBrokerChallengeFailsClosedWithoutTrustedFeeOrMapping(t *testing.T) {
	now := time.Date(2026, 9, 19, 9, 0, 0, 0, time.UTC)
	store, _ := OpenStore(filepath.Join(t.TempDir(), "finance.json"))
	server := &Server{service: &Service{Store: store}, cfg: ServerConfig{}, now: func() time.Time { return now }}
	input := brokerChallengeInput{AccountPublicKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", Draft: BrokerOrderDraftInput{AssetID: "11111111-2222-4333-8444-555555555555", Symbol: "ACME", Side: "buy", Qty: "1", LimitPrice: "10"}}
	body, _ := json.Marshal(input)
	recorder := httptest.NewRecorder()
	server.brokerChallenge(recorder, httptest.NewRequest(http.MethodPost, "/api/broker/challenges", bytes.NewReader(body)), Session{Account: "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"})
	if recorder.Code != http.StatusServiceUnavailable || len(store.BrokerWorkspace("ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80", now).Orders) != 0 {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestBrokerChallengeSeparatesUnsafeFeePolicyFromInvalidOrderDraft(t *testing.T) {
	now := time.Date(2026, 9, 19, 9, 0, 0, 0, time.UTC)
	account := "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
	store, err := OpenStore(filepath.Join(t.TempDir(), "finance.json"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.PutBrokerSandboxMappingWithWalletKey(account, "01234567-89ab-4cde-8fab-0123456789ab", "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", now); err != nil {
		t.Fatal(err)
	}
	requestBody, _ := json.Marshal(brokerChallengeInput{Draft: BrokerOrderDraftInput{AssetID: "11111111-2222-4333-8444-555555555555", Symbol: "ACME", Side: "hold", Qty: "1", LimitPrice: "10"}})

	server := &Server{service: &Service{Store: store}, cfg: ServerConfig{BrokerMaxFeeUSD: "1", BrokerFeeBoundSource: "operator_policy", BrokerFeeEvidenceRef: "unsafe evidence"}, now: func() time.Time { return now }}
	recorder := httptest.NewRecorder()
	server.brokerChallenge(recorder, httptest.NewRequest(http.MethodPost, "/api/broker/challenges", bytes.NewReader(requestBody)), Session{Account: account})
	if recorder.Code != http.StatusServiceUnavailable || !bytes.Contains(recorder.Body.Bytes(), []byte(`"code":"fee_bound_unavailable"`)) {
		t.Fatalf("unsafe fee status=%d body=%s", recorder.Code, recorder.Body.String())
	}

	server.cfg.BrokerFeeEvidenceRef = "operator-policy:test:v1"
	recorder = httptest.NewRecorder()
	server.brokerChallenge(recorder, httptest.NewRequest(http.MethodPost, "/api/broker/challenges", bytes.NewReader(requestBody)), Session{Account: account})
	if recorder.Code != http.StatusBadRequest || !bytes.Contains(recorder.Body.Bytes(), []byte(`"code":"invalid_order_draft"`)) {
		t.Fatalf("invalid draft status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if workspace := store.BrokerWorkspace(account, now); len(workspace.Orders) != 0 || len(workspace.Outbox) != 0 {
		t.Fatalf("rejected challenge mutated order state: %+v", workspace)
	}
}

func TestBrokerExecutionRequestIsConfiguredOwnerScopedAndIdempotent(t *testing.T) {
	store, account, orderID, now := consumedBrokerFixture(t)
	values := map[string]string{
		"FINANCE_TRADING_ENABLED":                         "true",
		"FINANCE_SANDBOX_WRITES_ENABLED":                  "true",
		"FINANCE_SANDBOX_WRITE_ACTIVATION_RECEIPT_SHA256": strings.Repeat("a", 64),
		"ALPACA_BROKER_CLIENT_ID":                         "test-client",
		"ALPACA_BROKER_CLIENT_SECRET":                     "test-secret",
	}
	server := &Server{service: &Service{Store: store}, cfg: ServerConfig{BrokerConfig: brokerage.LoadConfig(func(key string) string { return values[key] })}, now: func() time.Time { return now.Add(2 * time.Minute) }}
	body := []byte(`{"idempotencyKey":"dispatch-test-request-0001"}`)
	request := httptest.NewRequest(http.MethodPost, "/api/broker/orders/"+orderID+"/execution-request", bytes.NewReader(body))
	request.SetPathValue("id", orderID)
	recorder := httptest.NewRecorder()
	server.brokerExecutionRequest(recorder, request, Session{Account: account})
	if recorder.Code != http.StatusAccepted || !bytes.Contains(recorder.Body.Bytes(), []byte(`"providerWriteAttempted":false`)) {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	workspace := store.BrokerWorkspace(account, now.Add(2*time.Minute))
	requested := 0
	for _, event := range workspace.Journal {
		if event.Action == "product.execution_requested" {
			requested++
		}
	}
	if len(workspace.Outbox) != 1 || workspace.Outbox[0].Status != "execution_requested" || requested != 1 {
		t.Fatalf("workspace=%+v requested=%d", workspace, requested)
	}
	request = httptest.NewRequest(http.MethodPost, "/api/broker/orders/"+orderID+"/execution-request", bytes.NewReader([]byte(`{"idempotencyKey":"different-request-0002"}`)))
	request.SetPathValue("id", orderID)
	recorder = httptest.NewRecorder()
	server.brokerExecutionRequest(recorder, request, Session{Account: account})
	if recorder.Code != http.StatusConflict || len(store.BrokerWorkspace(account, now).Journal) != len(workspace.Journal) {
		t.Fatalf("different-key status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	request = httptest.NewRequest(http.MethodGet, "/api/broker/orders/"+orderID+"/execution-status", nil)
	request.SetPathValue("id", orderID)
	recorder = httptest.NewRecorder()
	server.brokerExecutionStatus(recorder, request, Session{Account: account})
	if recorder.Code != http.StatusOK || !bytes.Contains(recorder.Body.Bytes(), []byte(`"status":"execution_requested"`)) {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	recorder = httptest.NewRecorder()
	server.brokerExecutionStatus(recorder, request, Session{Account: "ynx1z5y9l6c6mp7eduxhn7d7p0tytpawsp5dfpjzsd"})
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("cross-owner status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	disabled := &Server{service: &Service{Store: store}, cfg: ServerConfig{}, now: server.now}
	request = httptest.NewRequest(http.MethodPost, "/api/broker/orders/"+orderID+"/execution-request", bytes.NewReader(body))
	request.SetPathValue("id", orderID)
	recorder = httptest.NewRecorder()
	disabled.brokerExecutionRequest(recorder, request, Session{Account: account})
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("disabled status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestBrokerQuoteReturnsExactProviderDataWithoutImplyingVerification(t *testing.T) {
	now := time.Date(2026, 9, 19, 9, 0, 0, 0, time.UTC)
	server := &Server{
		broker: dispatchAdapter{quote: brokerage.Quote{
			Symbol: "ACME", BidPrice: "10.01", BidSize: "8", AskPrice: "10.02", AskSize: "9",
			Timestamp: now.Format(time.RFC3339Nano), Feed: "iex", RequestID: "request-quote-1",
		}},
		now: func() time.Time { return now },
	}
	recorder := httptest.NewRecorder()
	server.brokerQuote(recorder, httptest.NewRequest(http.MethodGet, "/api/broker/quote?symbol=ACME", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		Quote                   brokerage.Quote `json:"quote"`
		QuoteState              string          `json:"quoteState"`
		OfficialSandboxVerified bool            `json:"officialSandboxVerified"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.OfficialSandboxVerified || response.Quote.AskPrice != "10.02" || response.Quote.RequestID != "request-quote-1" || response.QuoteState != "real_time" {
		t.Fatalf("response=%+v", response)
	}
}

func TestBrokerQuoteStateDistinguishesRealtimeDelayedSampleAndStale(t *testing.T) {
	now := time.Date(2026, 9, 19, 9, 0, 0, 0, time.UTC)
	cases := map[string]brokerage.Quote{
		"real_time": {Feed: "iex", Timestamp: now.Add(-10 * time.Second).Format(time.RFC3339Nano)},
		"delayed":   {Feed: "iex", Timestamp: now.Add(-2 * time.Minute).Format(time.RFC3339Nano)},
		"sample":    {Feed: "sample", Timestamp: now.Format(time.RFC3339Nano)},
		"stale":     {Feed: "iex", Timestamp: now.Add(-time.Hour).Format(time.RFC3339Nano)},
	}
	for want, quote := range cases {
		if got := classifyBrokerQuote(quote, now); got != want {
			t.Fatalf("want=%s got=%s", want, got)
		}
	}
}

func TestBrokerAssetSearchAndWatchlistUseOnlyProviderVerifiedAssets(t *testing.T) {
	now := time.Date(2026, 9, 19, 9, 0, 0, 0, time.UTC)
	account := "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
	statePath := filepath.Join(t.TempDir(), "finance.json")
	store, err := OpenStore(statePath)
	if err != nil {
		t.Fatal(err)
	}
	adapter := dispatchAdapter{assets: brokerage.AssetResult{Provider: FinanceOrderProvider, Environment: FinanceOrderTradingEnv, Assets: []brokerage.Asset{
		{ID: "11111111-2222-4333-8444-555555555555", Symbol: "ACME", Name: "Acme Test Equity", Class: "us_equity", Status: "active", Tradable: true},
		{ID: "21111111-2222-4333-8444-555555555555", Symbol: "HALT", Name: "Halted Equity", Class: "us_equity", Status: "inactive", Tradable: false},
	}}}
	server := &Server{service: &Service{Store: store}, broker: adapter, now: func() time.Time { return now }}
	recorder := httptest.NewRecorder()
	server.brokerAssets(recorder, httptest.NewRequest(http.MethodGet, "/api/broker/assets?query=acme", nil))
	if recorder.Code != http.StatusOK || !bytes.Contains(recorder.Body.Bytes(), []byte(`"symbol":"ACME"`)) || bytes.Contains(recorder.Body.Bytes(), []byte(`"symbol":"HALT"`)) {
		t.Fatalf("asset search status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	body := []byte(`{"assetId":"11111111-2222-4333-8444-555555555555","selected":true}`)
	recorder = httptest.NewRecorder()
	server.brokerWatchlist(recorder, httptest.NewRequest(http.MethodPut, "/api/broker/watchlist", bytes.NewReader(body)), Session{Account: account})
	if recorder.Code != http.StatusOK || !bytes.Contains(recorder.Body.Bytes(), []byte(`"providerWriteAttempted":false`)) {
		t.Fatalf("watchlist status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	reopened, err := OpenStore(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if items := reopened.BrokerWorkspace(account, now).Watchlist; len(items) != 1 || items[0].Symbol != "ACME" {
		t.Fatalf("watchlist=%+v", items)
	}
	if items := reopened.BrokerWorkspace("ynx1z5y9l6c6mp7eduxhn7d7p0tytpawsp5dfpjzsd", now).Watchlist; len(items) != 0 {
		t.Fatalf("cross-owner watchlist=%+v", items)
	}
	server.broker = dispatchAdapter{assetsErr: &brokerage.Error{Code: "BROKER_NOT_CONFIGURED"}}
	recorder = httptest.NewRecorder()
	server.brokerAssets(recorder, httptest.NewRequest(http.MethodGet, "/api/broker/assets?query=ACME", nil))
	if recorder.Code != http.StatusServiceUnavailable || bytes.Contains(recorder.Body.Bytes(), []byte(`"assets"`)) {
		t.Fatalf("unconfigured search status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestBrokerReconcileAndCancelRequestAreOwnerScopedAndDoNotWriteProvider(t *testing.T) {
	store, account, orderID, now := consumedBrokerFixture(t)
	claim, err := store.ClaimBrokerDispatch(account, orderID, now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	providerOrder := brokerage.Order{ID: "22222222-3333-4444-8555-666666666666", ClientOrderID: claim.Order.Order.OrderID, AssetID: claim.Order.Order.AssetID, Symbol: claim.Order.Order.Symbol, Side: claim.Order.Order.Side, Qty: claim.Order.Order.Qty, FilledQty: "0", Type: claim.Order.Order.OrderType, LimitPrice: claim.Order.Order.LimitPrice, TimeInForce: claim.Order.Order.TimeInForce, ExtendedHours: claim.Order.Order.ExtendedHours, Status: "accepted", SubmittedAt: now.Format(time.RFC3339Nano)}
	if _, err := store.CompleteBrokerDispatch(account, orderID, &providerOrder, nil, now.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	server := &Server{service: &Service{Store: store}, broker: dispatchAdapter{snapshot: brokerage.AccountSnapshot{Provider: FinanceOrderProvider, Environment: FinanceOrderTradingEnv, RequestIDs: []string{"reconcile-request-1"}, Account: brokerage.Account{ID: "01234567-89ab-4cde-8fab-0123456789ab", Status: "ACTIVE", Currency: "USD", Cash: "100", BuyingPower: "100"}, Orders: []brokerage.Order{providerOrder}}}, now: func() time.Time { return now.Add(3 * time.Minute) }}
	recorder := httptest.NewRecorder()
	server.brokerReconcile(recorder, httptest.NewRequest(http.MethodPost, "/api/broker/reconcile", bytes.NewReader([]byte(`{}`))), Session{Account: account})
	if recorder.Code != http.StatusOK || !bytes.Contains(recorder.Body.Bytes(), []byte(`"providerWriteAttempted":false`)) {
		t.Fatalf("reconcile status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	recorder = httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/broker/orders/"+orderID+"/cancel-request", bytes.NewReader([]byte(`{}`)))
	request.SetPathValue("id", orderID)
	server.brokerCancelRequest(recorder, request, Session{Account: account})
	if recorder.Code != http.StatusAccepted || !bytes.Contains(recorder.Body.Bytes(), []byte(`"providerWriteAttempted":false`)) || !bytes.Contains(recorder.Body.Bytes(), []byte(`"state":"cancel_requested"`)) {
		t.Fatalf("cancel status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPost, "/api/broker/orders/"+orderID+"/cancel-request", bytes.NewReader([]byte(`{}`)))
	request.SetPathValue("id", orderID)
	server.brokerCancelRequest(recorder, request, Session{Account: "ynx1z5y9l6c6mp7eduxhn7d7p0tytpawsp5dfpjzsd"})
	if recorder.Code != http.StatusConflict {
		t.Fatalf("cross-owner cancel status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestBrokerChallengeUsesPersistedWalletKeyAndRejectsCallerOverride(t *testing.T) {
	now := time.Date(2026, 9, 19, 9, 0, 0, 0, time.UTC)
	account := "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
	store, _ := OpenStore(filepath.Join(t.TempDir(), "finance.json"))
	key := "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
	_, _ = store.PutBrokerSandboxMappingWithWalletKey(account, "01234567-89ab-4cde-8fab-0123456789ab", key, now)
	server := &Server{service: &Service{Store: store}, cfg: ServerConfig{BrokerMaxFeeUSD: "1", BrokerFeeBoundSource: "operator_policy", BrokerFeeEvidenceRef: "operator-policy:test:v1"}, now: func() time.Time { return now }}
	draft := BrokerOrderDraftInput{AssetID: "11111111-2222-4333-8444-555555555555", Symbol: "ACME", Side: "buy", Qty: "1", LimitPrice: "10"}
	for name, input := range map[string]brokerChallengeInput{
		"omitted caller key":  {Draft: draft},
		"matching legacy key": {AccountPublicKey: key, Draft: draft},
	} {
		t.Run(name, func(t *testing.T) {
			body, _ := json.Marshal(input)
			recorder := httptest.NewRecorder()
			server.brokerChallenge(recorder, httptest.NewRequest(http.MethodPost, "/api/broker/challenges", bytes.NewReader(body)), Session{Account: account})
			if recorder.Code != http.StatusCreated {
				t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
			}
		})
	}
	body, _ := json.Marshal(brokerChallengeInput{AccountPublicKey: "0379be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", Draft: draft})
	recorder := httptest.NewRecorder()
	server.brokerChallenge(recorder, httptest.NewRequest(http.MethodPost, "/api/broker/challenges", bytes.NewReader(body)), Session{Account: account})
	if recorder.Code != http.StatusConflict {
		t.Fatalf("override status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestBrokerRecoveryStateIsOwnerScopedPersistentAndSeparatesEventFromPoll(t *testing.T) {
	store, account, orderID, now := consumedBrokerFixture(t)
	statePath := store.path
	providerOrder := brokerage.Order{ID: "22222222-3333-4444-8555-666666666666", ClientOrderID: orderID, AssetID: "11111111-2222-4333-8444-555555555555", Symbol: "ACME", Side: "buy", Qty: "1", FilledQty: "0", Type: "limit", LimitPrice: "10", TimeInForce: "day", Status: "accepted"}
	event := brokerage.TradeEvent{Cursor: "recovery-event-1", ProviderAccountID: "01234567-89ab-4cde-8fab-0123456789ab", Event: "new", Timestamp: now.Add(time.Minute), Order: providerOrder}
	if err := store.ApplyBrokerTradeEvents(account, []brokerage.TradeEvent{event}, event.Cursor, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err := store.ApplyBrokerReconciliation(account, brokerage.AccountSnapshot{RequestIDs: []string{"poll-request"}, Orders: []brokerage.Order{providerOrder}}, now.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenStore(statePath)
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{service: &Service{Store: reopened}}
	recorder := httptest.NewRecorder()
	server.brokerRecovery(recorder, httptest.NewRequest(http.MethodGet, "/api/broker/recovery", nil), Session{Account: account})
	if recorder.Code != http.StatusOK || !bytes.Contains(recorder.Body.Bytes(), []byte(`"cursor":"recovery-event-1"`)) || !bytes.Contains(recorder.Body.Bytes(), []byte(`"checkpoint":"reconcile_`)) {
		t.Fatalf("recovery status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	recorder = httptest.NewRecorder()
	server.brokerRecovery(recorder, httptest.NewRequest(http.MethodGet, "/api/broker/recovery", nil), Session{Account: "ynx1z5y9l6c6mp7eduxhn7d7p0tytpawsp5dfpjzsd"})
	if bytes.Contains(recorder.Body.Bytes(), []byte("recovery-event-1")) || bytes.Contains(recorder.Body.Bytes(), []byte(`"mappingActive":true`)) {
		t.Fatalf("cross-owner recovery state leaked: %s", recorder.Body.String())
	}
}
