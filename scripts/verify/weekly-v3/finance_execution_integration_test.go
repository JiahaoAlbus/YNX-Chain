//go:build weekly_v3_integration

package finance

// Prepared against the owner's observed B3 HTTP interface. Deliberately not
// loaded by the runner until the owner freezes a clean published contract.
// No private provider key or public write authority is used by these fixtures.
import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/finance/brokerage"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

func weeklyExecutionConfig(overrides map[string]string) brokerage.Config {
	values := map[string]string{
		"FINANCE_TRADING_ENABLED": "true", "FINANCE_SANDBOX_WRITES_ENABLED": "true",
		"FINANCE_SANDBOX_WRITE_ACTIVATION_RECEIPT_SHA256": strings.Repeat("a", 64),
		"ALPACA_BROKER_AUTH_MODE":                         "legacy_basic", "ALPACA_BROKER_API_KEY": "public-isolated-fixture",
		"ALPACA_BROKER_API_SECRET": "not-a-credential",
	}
	for key, value := range overrides {
		values[key] = value
	}
	return brokerage.LoadConfig(func(key string) string { return values[key] })
}

func weeklyExecutionRequest(t *testing.T, server *Server, orderID, key string) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(map[string]string{"idempotencyKey": key})
	if err != nil {
		t.Fatal(err)
	}
	return weeklyHTTP(t, server, "/api/broker/orders/"+orderID+"/execution-request", body)
}

type weeklyOtherOwnerAuthority struct{}

func (weeklyOtherOwnerAuthority) Authorize(ctx context.Context, r *http.Request, scopes []string) (productsessionv2.Session, error) {
	session, err := (weeklyScopeAuthority{}).Authorize(ctx, r, scopes)
	if err == nil {
		session.Account = "ynx1z5y9l6c6mp7eduxhn7d7p0tytpawsp5dfpjzsd"
	}
	return session, err
}

func TestWeeklyV3ExecutionHTTPGatesPreserveApprovalWithoutProviderWrite(t *testing.T) {
	for _, scenario := range []string{"default_closed", "missing_receipt", "wrong_chain", "live", "missing_credentials", "unapproved", "wrong_owner", "missing_proof", "missing_idempotency_key", "extra_fields"} {
		t.Run(scenario, func(t *testing.T) {
			server, _, statePath, _ := weeklyServer(t)
			var challenge BrokerApprovalChallenge
			if scenario == "unapproved" {
				challenge = weeklyChallenge(t, server)
			} else {
				challenge = weeklyApproved(t, server)
			}
			orderID := challenge.Unsigned.Order.OrderID
			server.cfg.BrokerConfig = weeklyExecutionConfig(nil)
			want := http.StatusConflict
			switch scenario {
			case "default_closed":
				server.cfg.BrokerConfig = brokerage.LoadConfig(func(string) string { return "" })
				want = http.StatusServiceUnavailable
			case "missing_receipt":
				server.cfg.BrokerConfig = weeklyExecutionConfig(map[string]string{"FINANCE_SANDBOX_WRITE_ACTIVATION_RECEIPT_SHA256": ""})
				want = http.StatusServiceUnavailable
			case "wrong_chain":
				server.cfg.BrokerConfig = weeklyExecutionConfig(map[string]string{"YNX_EVM_CHAIN_ID": "1"})
				want = http.StatusServiceUnavailable
			case "live":
				server.cfg.BrokerConfig = weeklyExecutionConfig(map[string]string{"FINANCE_TRADING_ENV": "live", "FINANCE_LIVE_ENABLED": "true"})
				want = http.StatusServiceUnavailable
			case "missing_credentials":
				server.cfg.BrokerConfig = weeklyExecutionConfig(map[string]string{"ALPACA_BROKER_API_KEY": "", "ALPACA_BROKER_API_SECRET": ""})
				want = http.StatusServiceUnavailable
			case "wrong_owner":
				server.auth.v2 = weeklyOtherOwnerAuthority{}
			case "missing_proof":
				want = http.StatusForbidden
			case "extra_fields":
				want = http.StatusBadRequest
			}
			adapter, provider := weeklyAlpaca(t, false)
			server.broker = adapter
			body := `{"idempotencyKey":"weekly-execution-request-0001"}`
			if scenario == "missing_idempotency_key" {
				body = `{}`
			}
			if scenario == "extra_fields" {
				body = `{"idempotencyKey":"weekly-execution-request-0001","brokerAccountId":"11234567-89ab-4cde-8fab-0123456789ab"}`
			}
			request := httptest.NewRequest("POST", "/api/broker/orders/"+orderID+"/execution-request", strings.NewReader(body))
			request.Header.Set("Origin", BrowserFinanceOrigin)
			request.Header.Set("Content-Type", "application/json")
			if scenario != "missing_proof" {
				request.Header.Set(productsessionv2.ProofHeader, "finance.profile.write")
			}
			before, _ := os.ReadFile(statePath)
			response := httptest.NewRecorder()
			server.Handler().ServeHTTP(response, request)
			if response.Code != want {
				t.Fatalf("execution gate %s: %d %s", scenario, response.Code, response.Body.String())
			}
			after, _ := os.ReadFile(statePath)
			if !bytes.Equal(before, after) {
				t.Fatal("rejected execution request changed durable approval/outbox state")
			}
			provider.mu.Lock()
			defer provider.mu.Unlock()
			if len(provider.requests) != 0 || provider.posts != 0 || provider.deletes != 0 {
				t.Fatalf("rejected execution request contacted provider: %+v", provider.requests)
			}
		})
	}
}

func TestWeeklyV3ExplicitExecutionHTTPToDurableConsumerExactlyOnce(t *testing.T) {
	server, _, statePath, now := weeklyServer(t)
	challenge := weeklyApproved(t, server)
	orderID := challenge.Unsigned.Order.OrderID
	server.cfg.BrokerConfig = weeklyExecutionConfig(nil)
	adapter, provider := weeklyAlpaca(t, false)
	server.broker = adapter
	dispatcher := BrokerDispatcher{Store: server.service.Store, Adapter: adapter, Now: func() time.Time { return now }}
	// A consumed Wallet approval alone is not an explicit product execution.
	if _, err := dispatcher.Dispatch(context.Background(), testAccount, orderID); err == nil {
		t.Fatal("Wallet approval dispatched without an execution request")
	}
	key := "finance-execution-" + orderID
	for attempt := 0; attempt < 3; attempt++ {
		response := weeklyExecutionRequest(t, server, orderID, key)
		if response.Code != http.StatusAccepted || !strings.Contains(response.Body.String(), `"providerWriteAttempted":false`) {
			t.Fatalf("explicit execution request %d %s", response.Code, response.Body.String())
		}
	}
	if response := weeklyExecutionRequest(t, server, orderID, key+"-different"); response.Code != http.StatusConflict {
		t.Fatalf("replacement idempotency key accepted: %d %s", response.Code, response.Body.String())
	}
	reopened, err := OpenStore(statePath)
	if err != nil {
		t.Fatal(err)
	}
	state := reopened.Account(testAccount).Brokerage
	requests := 0
	for _, event := range state.Journal {
		if event.Action == "product.execution_requested" {
			requests++
		}
	}
	if requests != 1 || state.Outbox[orderID].Status != "execution_requested" || state.Outbox[orderID].Attempts != 0 {
		t.Fatalf("execution queue is not durable/exactly once: %+v", state.Outbox[orderID])
	}
	dispatcher.Store = reopened
	record, err := dispatcher.Dispatch(context.Background(), testAccount, orderID)
	if err != nil || record.State != "submitted" {
		t.Fatalf("explicit requested order did not reach actual adapter: %+v %v", record, err)
	}
	if _, err := dispatcher.Dispatch(context.Background(), testAccount, orderID); err == nil {
		t.Fatal("consumed execution request dispatched twice")
	}
	server.service.Store = reopened
	if response := weeklyExecutionRequest(t, server, orderID, key); response.Code != http.StatusAccepted {
		t.Fatalf("exact product retry lost idempotence after dispatch: %d %s", response.Code, response.Body.String())
	}
	provider.mu.Lock()
	defer provider.mu.Unlock()
	if provider.posts != 1 || provider.deletes != 0 {
		t.Fatalf("execution retry caused duplicate provider write: POST=%d DELETE=%d", provider.posts, provider.deletes)
	}
}
