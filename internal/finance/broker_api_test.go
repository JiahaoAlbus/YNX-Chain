package finance

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
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
		OfficialSandboxVerified bool            `json:"officialSandboxVerified"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.OfficialSandboxVerified || response.Quote.AskPrice != "10.02" || response.Quote.RequestID != "request-quote-1" {
		t.Fatalf("response=%+v", response)
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
