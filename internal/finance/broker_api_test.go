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
	if _, err := store.PutBrokerSandboxMapping(account, "01234567-89ab-4cde-8fab-0123456789ab", now); err != nil {
		t.Fatal(err)
	}
	server := &Server{service: &Service{Store: store}, cfg: ServerConfig{BrokerMaxFeeUSD: "1.25", BrokerFeeBoundSource: "operator_policy", BrokerFeeEvidenceRef: "operator-policy:test:v1"}, now: func() time.Time { return now }}
	input := brokerChallengeInput{AccountPublicKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", Draft: BrokerOrderDraftInput{AssetID: "11111111-2222-4333-8444-555555555555", Symbol: "ACME", Side: "buy", Qty: "2", LimitPrice: "125.34"}}
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
