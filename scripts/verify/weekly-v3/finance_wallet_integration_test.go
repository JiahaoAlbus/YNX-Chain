package finance

// Loaded with Go -overlay into the exact Finance checkpoint. The owner worktree
// stays untouched. Product-session authority is an explicit scope fixture; the
// Finance HTTP routes, browser assets, Wallet signing controller and durable
// store are real checkpoint implementations. Provider execution below is fake.
import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/finance/brokerage"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

type weeklyScopeAuthority struct{}

func (weeklyScopeAuthority) Authorize(_ context.Context, r *http.Request, scopes []string) (productsessionv2.Session, error) {
	if len(scopes) != 1 || r.Header.Get(productsessionv2.ProofHeader) != scopes[0] {
		return productsessionv2.Session{}, &productsessionv2.Error{Code: "INTEGRATION_SCOPE_MISMATCH", Status: 403}
	}
	return productsessionv2.Session{Account: "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80", Scopes: scopes, ExpiresAt: time.Now().Add(time.Minute).Format(time.RFC3339Nano)}, nil
}
func weeklyBridge(t *testing.T, input any) map[string]json.RawMessage {
	t.Helper()
	raw, _ := json.Marshal(input)
	cmd := exec.Command(filepath.Join(os.Getenv("WEEKLY_WALLET_ROOT"), "apps/wallet/node_modules/.bin/tsx"), os.Getenv("WEEKLY_BRIDGE"))
	cmd.Stdin = bytes.NewReader(raw)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	result, err := cmd.Output()
	if err != nil {
		t.Fatalf("bridge: %v %s", err, stderr.String())
	}
	var output map[string]json.RawMessage
	if err := json.Unmarshal(result, &output); err != nil {
		t.Fatalf("bridge JSON: %v %s", err, result)
	}
	return output
}
func weeklyServer(t *testing.T) (*Server, *httptest.Server, string, time.Time) {
	t.Helper()
	now := time.Date(2026, 9, 19, 9, 0, 30, 0, time.UTC)
	statePath := filepath.Join(t.TempDir(), "state.json")
	store, err := OpenStore(statePath)
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.PutBrokerSandboxMapping("ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80", "01234567-89ab-4cde-8fab-0123456789ab", now)
	if err != nil {
		t.Fatal(err)
	}
	explorer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "isolated unavailable legacy upstream", 503)
	}))
	t.Cleanup(explorer.Close)
	upstreams, err := NewUpstreams(explorer.URL, "", "", "https://support.invalid/disputes")
	if err != nil {
		t.Fatal(err)
	}
	server, err := NewServer(&Service{Store: store, Upstreams: upstreams, AI: fakeAI{}, Support: SupportLinks{HelpURL: "https://support.invalid/help", PrivacyURL: "https://support.invalid/privacy", DisputeURL: "https://support.invalid/disputes"}}, &Authenticator{v2: weeklyScopeAuthority{}}, ServerConfig{AllowedOrigins: []string{BrowserFinanceOrigin}, CursorSigningKey: testCursorKey, OperationsKey: testOperationsKey, BrokerMaxFeeUSD: "1.25", BrokerFeeBoundSource: "operator_policy", BrokerFeeEvidenceRef: "local-integration:fee-bound", Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	local := httptest.NewServer(server.Handler())
	t.Cleanup(local.Close)
	return server, local, statePath, now
}
func weeklyInput() map[string]any {
	return map[string]any{"accountPublicKey": "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", "draft": map[string]string{"assetId": "11111111-2222-4333-8444-555555555555", "symbol": "ACME", "side": "buy", "qty": "2", "limitPrice": "125.34"}}
}
func weeklyHTTP(t *testing.T, server *Server, path string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest("POST", path, bytes.NewReader(body))
	r.Header.Set("Origin", BrowserFinanceOrigin)
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set(productsessionv2.ProofHeader, "finance.profile.write")
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, r)
	return w
}
func weeklyChallenge(t *testing.T, server *Server) BrokerApprovalChallenge {
	t.Helper()
	body, _ := json.Marshal(weeklyInput())
	w := weeklyHTTP(t, server, "/api/broker/challenges", body)
	if w.Code != 201 {
		t.Fatalf("challenge %d %s", w.Code, w.Body.String())
	}
	var response struct {
		Challenge BrokerApprovalChallenge `json:"challenge"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	return response.Challenge
}
func TestWeeklyV3BrowserRequestsWriteScope(t *testing.T) {
	_, local, _, _ := weeklyServer(t)
	for _, path := range []string{"/api/broker/challenges", "/api/broker/callback"} {
		t.Run(path, func(t *testing.T) {
			result := weeklyBridge(t, map[string]any{"mode": "api", "base": local.URL, "path": path, "body": weeklyInput()})
			if string(result["requested"]) != `["finance.profile.write"]` {
				t.Fatalf("real Finance browser requested %s; server result=%s status=%s", result["requested"], result["error"], result["status"])
			}
		})
	}
}
func TestWeeklyV3WalletBrowserDecisionsAndDurableCAS(t *testing.T) {
	for _, mode := range []string{"approve", "reject", "revoke"} {
		t.Run(mode, func(t *testing.T) {
			server, _, statePath, now := weeklyServer(t)
			challenge := weeklyChallenge(t, server)
			// An explicit Date adapter isolates downstream behavior from the known
			// browser string-time defect; this is NOT an unmodified full E2E pass.
			result := weeklyBridge(t, map[string]any{"mode": mode, "challenge": challenge, "authorityDateAdapter": os.Getenv("WEEKLY_DATE_ADAPTER") == "true"})
			if string(result["parseError"]) != "null" {
				t.Fatalf("real Finance browser cannot parse actual Wallet callback: %s", result["parseError"])
			}
			var raw string
			if err := json.Unmarshal(result["raw"], &raw); err != nil {
				t.Fatal(err)
			}
			callback := weeklyHTTP(t, server, "/api/broker/callback", []byte(raw))
			if callback.Code != 200 {
				t.Fatalf("callback %d %s", callback.Code, callback.Body.String())
			}
			reopened, err := OpenStore(statePath)
			if err != nil {
				t.Fatal(err)
			}
			workspace := reopened.BrokerWorkspace(challenge.Unsigned.Account, now)
			if len(workspace.Orders) != 1 {
				t.Fatal("durable order missing")
			}
			expected := "consumed"
			if mode == "reject" {
				expected = "rejected"
			}
			if mode == "revoke" {
				expected = "revoked"
			}
			if workspace.Orders[0].ApprovalState != expected {
				t.Fatalf("state=%+v", workspace)
			}
			if mode != "approve" {
				if len(workspace.Outbox) != 0 {
					t.Fatal("non-approval queued provider write")
				}
				return
			}
			// Deliberately backend continuation, not proof of successful browser auth.
			for i := 0; i < 2; i++ {
				w := weeklyHTTP(t, server, "/api/broker/callback", []byte(raw))
				if w.Code != 200 {
					t.Fatalf("exact callback replay %d", w.Code)
				}
			}
			if len(server.service.Store.BrokerWorkspace(challenge.Unsigned.Account, now).Outbox) != 1 {
				t.Fatal("duplicate outbox")
			}
		})
	}
}
func TestWeeklyV3BrowserUsesServerTimeWireType(t *testing.T) {
	server, _, _, _ := weeklyServer(t)
	result := weeklyBridge(t, map[string]any{"mode": "approve", "challenge": weeklyChallenge(t, server)})
	if len(result["beginError"]) != 0 {
		t.Fatalf("Finance passes its server JSON timestamp directly to Wallet SDK: %s (%s)", result["beginError"], result["code"])
	}
}
func TestWeeklyV3ManualAndAIDraftBrowserLaunch(t *testing.T) {
	for _, source := range []string{"manual", "ai"} {
		t.Run(source, func(t *testing.T) {
			_, local, _, _ := weeklyServer(t)
			result := weeklyBridge(t, map[string]any{"mode": "draft", "source": source, "base": local.URL, "body": weeklyInput()})
			if string(result["url"]) == "null" {
				t.Fatalf("%s actual browser cannot launch approval: %s; scopes=%s", source, result["notice"], result["requested"])
			}
		})
	}
}
func TestWeeklyV3DelayedEventCannotRegressFilled(t *testing.T) {
	store, account, orderID, now := consumedBrokerFixture(t)
	order := brokerage.Order{ID: "22222222-3333-4444-8555-666666666666", ClientOrderID: orderID, AssetID: "11111111-2222-4333-8444-555555555555", Symbol: "ACME", Side: "buy", Qty: "1", FilledQty: "1", Type: "limit", LimitPrice: "10", TimeInForce: "day", Status: "filled"}
	filled := brokerage.TradeEvent{Cursor: "event-2", ProviderAccountID: "01234567-89ab-4cde-8fab-0123456789ab", Event: "fill", Timestamp: now.Add(time.Minute), Order: order}
	if err := store.ApplyBrokerTradeEvents(account, []brokerage.TradeEvent{filled}, filled.Cursor, now.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	old := filled
	old.Cursor = "event-1"
	old.Timestamp = now
	old.Event = "new"
	old.Order.Status = "accepted"
	old.Order.FilledQty = "0"
	_ = store.ApplyBrokerTradeEvents(account, []brokerage.TradeEvent{old}, old.Cursor, now.Add(3*time.Minute))
	workspace := store.BrokerWorkspace(account, now)
	if workspace.Orders[0].State != "filled" {
		t.Fatalf("delayed event regressed filled -> %s; cursor=%s", workspace.Orders[0].State, store.Account(account).Brokerage.EventCursor)
	}
}
func TestWeeklyV3ReconciliationRejectsMismatchedOrder(t *testing.T) {
	store, account, orderID, now := consumedBrokerFixture(t)
	err := store.ApplyBrokerReconciliation(account, brokerage.AccountSnapshot{Provider: FinanceOrderProvider, Environment: FinanceOrderTradingEnv, Orders: []brokerage.Order{{ID: "22222222-3333-4444-8555-666666666666", ClientOrderID: orderID, AssetID: "66666666-2222-4333-8444-555555555555", Symbol: "WRONG", Side: "sell", Qty: "99", Status: "filled"}}}, now)
	if err == nil {
		t.Fatalf("reconciliation accepted mismatched symbol/asset/side/qty: %+v", store.BrokerWorkspace(account, now).Orders[0])
	}
}

// This local TLS fixture pins every socket to its loopback listener. The actual
// Alpaca adapter still constructs/validates its fixed sandbox origin. Its TLS
// client trusts only the httptest certificate, with that certificate's DNS name;
// TLS verification is never disabled and no public DNS lookup is performed.
type weeklyProvider struct {
	mu             sync.Mutex
	order          map[string]any
	posts, deletes int
	ambiguous      bool
	requests       []string
}

func weeklyAlpaca(t *testing.T, ambiguous bool) (*brokerage.Alpaca, *weeklyProvider) {
	t.Helper()
	p := &weeklyProvider{ambiguous: ambiguous}
	local := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p.mu.Lock()
		defer p.mu.Unlock()
		p.requests = append(p.requests, r.Method+" "+r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Request-ID", "isolated-provider-request")
		if r.Host != "broker-api.sandbox.alpaca.markets" {
			http.Error(w, "fixture rejected host", 400)
			return
		}
		switch {
		case r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/orders"):
			p.posts++
			var body map[string]any
			if json.NewDecoder(r.Body).Decode(&body) != nil {
				http.Error(w, "invalid", 400)
				return
			}
			body["id"] = "22222222-3333-4444-8555-666666666666"
			body["status"] = "accepted"
			body["filled_qty"] = "0"
			body["submitted_at"] = "2026-09-19T09:00:30Z"
			p.order = body
			if p.ambiguous {
				connection, _, err := w.(http.Hijacker).Hijack()
				if err == nil {
					_ = connection.Close()
				}
				return
			}
			w.WriteHeader(201)
			_ = json.NewEncoder(w).Encode(body)
		case r.Method == "DELETE":
			p.deletes++
			if p.order != nil {
				p.order["status"] = "canceled"
			}
			w.WriteHeader(204)
		case strings.HasSuffix(r.URL.Path, "/positions"):
			_ = json.NewEncoder(w).Encode([]any{})
		case strings.HasSuffix(r.URL.Path, "/orders"):
			orders := []any{}
			if p.order != nil {
				orders = append(orders, p.order)
			}
			_ = json.NewEncoder(w).Encode(orders)
		case strings.HasPrefix(r.URL.Path, "/v1/accounts/"):
			_ = json.NewEncoder(w).Encode(map[string]string{"id": "01234567-89ab-4cde-8fab-0123456789ab", "status": "ACTIVE", "currency": "USD", "cash": "100000", "buying_power": "100000"})
		default:
			http.Error(w, "unexpected local fixture request", 404)
		}
	}))
	t.Cleanup(local.Close)
	transport := local.Client().Transport.(*http.Transport).Clone()
	transport.TLSClientConfig = transport.TLSClientConfig.Clone()
	transport.TLSClientConfig.ServerName = "example.com"
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		if address != "broker-api.sandbox.alpaca.markets:443" {
			return nil, errors.New("integration forbids any non-fixture destination")
		}
		return (&net.Dialer{}).DialContext(ctx, "tcp", local.Listener.Addr().String())
	}
	original := http.DefaultTransport
	http.DefaultTransport = transport
	cfg := brokerage.LoadConfig(func(k string) string {
		return map[string]string{"FINANCE_TRADING_ENABLED": "true", "FINANCE_SANDBOX_WRITES_ENABLED": "true", "FINANCE_SANDBOX_WRITE_ACTIVATION_RECEIPT_SHA256": strings.Repeat("a", 64), "ALPACA_BROKER_AUTH_MODE": "legacy_basic", "ALPACA_BROKER_API_KEY": "public-isolated-fixture", "ALPACA_BROKER_API_SECRET": "not-a-credential"}[k]
	})
	adapter := brokerage.NewAlpaca(cfg)
	http.DefaultTransport = original
	t.Cleanup(transport.CloseIdleConnections)
	return adapter, p
}
func weeklyApproved(t *testing.T, server *Server) BrokerApprovalChallenge {
	t.Helper()
	challenge := weeklyChallenge(t, server)
	result := weeklyBridge(t, map[string]any{"mode": "approve", "challenge": challenge, "authorityDateAdapter": os.Getenv("WEEKLY_DATE_ADAPTER") == "true"})
	var raw string
	if err := json.Unmarshal(result["raw"], &raw); err != nil {
		t.Fatalf("approval bridge %v %+v", err, result)
	}
	w := weeklyHTTP(t, server, "/api/broker/callback", []byte(raw))
	if w.Code != 200 {
		t.Fatalf("approval consume %d %s", w.Code, w.Body.String())
	}
	return challenge
}
func TestWeeklyV3ActualAdapterSubmitUnknownQueryCancelRestart(t *testing.T) {
	for _, mode := range []string{"submitted", "lost_ack", "restart_during_dispatch"} {
		t.Run(mode, func(t *testing.T) {
			server, _, statePath, now := weeklyServer(t)
			challenge := weeklyApproved(t, server)
			account, orderID := challenge.Unsigned.Account, challenge.Unsigned.Order.OrderID
			adapter, provider := weeklyAlpaca(t, mode == "lost_ack")
			dispatcher := BrokerDispatcher{Store: server.service.Store, Adapter: adapter, Now: func() time.Time { return now.Add(time.Minute) }}
			if mode == "restart_during_dispatch" {
				if _, err := dispatcher.Store.ClaimBrokerDispatch(account, orderID, now); err != nil {
					t.Fatal(err)
				}
				reopened, err := OpenStore(statePath)
				if err != nil {
					t.Fatal(err)
				}
				dispatcher.Store = reopened
				if err := reopened.RecoverInterruptedBrokerDispatches(account, now.Add(time.Minute)); err != nil {
					t.Fatal(err)
				}
				if _, err := dispatcher.Dispatch(context.Background(), account, orderID); err == nil {
					t.Fatal("restart uncertain claim was dispatched again")
				}
				if provider.posts != 0 {
					t.Fatal("restart triggered provider POST")
				}
				return
			}
			record, err := dispatcher.Dispatch(context.Background(), account, orderID)
			if mode == "lost_ack" {
				if brokerage.ErrorCode(err) != "PROVIDER_UNAVAILABLE" || record.State != "submitted_unknown" {
					t.Fatalf("unknown: %+v %v", record, err)
				}
			} else if err != nil || record.State != "submitted" {
				t.Fatalf("submit: %+v %v", record, err)
			}
			if _, err := dispatcher.Dispatch(context.Background(), account, orderID); err == nil {
				t.Fatal("duplicate dispatch allowed")
			}
			reopened, err := OpenStore(statePath)
			if err != nil {
				t.Fatal(err)
			}
			dispatcher.Store = reopened
			if _, err := dispatcher.Reconcile(context.Background(), account); err != nil {
				t.Fatal(err)
			}
			if reopened.BrokerWorkspace(account, now).Orders[0].State != "submitted" {
				t.Fatal("query did not resolve exact client order after restart")
			}
			if _, err := dispatcher.Cancel(context.Background(), account, orderID); err != nil {
				t.Fatal(err)
			}
			if reopened.BrokerWorkspace(account, now).Orders[0].State != "cancel_requested" {
				t.Fatal("cancel ACK incorrectly implied final cancellation")
			}
			if _, err := dispatcher.Reconcile(context.Background(), account); err != nil {
				t.Fatal(err)
			}
			if reopened.BrokerWorkspace(account, now).Orders[0].State != "canceled" {
				t.Fatal("query did not reconcile cancellation")
			}
			provider.mu.Lock()
			defer provider.mu.Unlock()
			if provider.posts != 1 || provider.deletes != 1 {
				t.Fatalf("provider calls posts=%d deletes=%d", provider.posts, provider.deletes)
			}
			t.Logf("actual adapter to loopback TLS: exactly %d POST, %d DELETE; unknown/query/restart preserved logical order", provider.posts, provider.deletes)
		})
	}
}
func TestWeeklyV3ExpiredOutboxDoesNotExecute(t *testing.T) {
	server, _, _, now := weeklyServer(t)
	challenge := weeklyApproved(t, server)
	adapter, provider := weeklyAlpaca(t, false)
	dispatcher := BrokerDispatcher{Store: server.service.Store, Adapter: adapter, Now: func() time.Time { return now.Add(time.Hour) }}
	_, _ = dispatcher.Dispatch(context.Background(), challenge.Unsigned.Account, challenge.Unsigned.Order.OrderID)
	provider.mu.Lock()
	defer provider.mu.Unlock()
	if provider.posts != 0 {
		t.Fatalf("approval expired at %s but submitted at %s without current execution evidence; calls=%v", challenge.Unsigned.ExpiresAt, now.Add(time.Hour), provider.requests)
	}
}
func TestWeeklyV3ProviderEventsAcceptProviderWire(t *testing.T) {
	// The adapter normalizes HTTP provider snake_case. The event parser must also
	// accept provider wire fields, not require its own already-normalized DTO.
	wire := `{"account_id":"01234567-89ab-4cde-8fab-0123456789ab","event":"fill","timestamp":"2026-09-19T09:01:00Z","order":{"id":"22222222-3333-4444-8555-666666666666","client_order_id":"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee","asset_id":"11111111-2222-4333-8444-555555555555","symbol":"ACME","side":"buy","qty":"1","filled_qty":"1","type":"limit","limit_price":"10","time_in_force":"day","status":"filled","submitted_at":"2026-09-19T09:00:00Z"}}`
	_, _, err := brokerage.ParseTradeEventStream(strings.NewReader(fmt.Sprintf("id: event-wire-1\nevent: trade_updates\ndata: %s\n\n", wire)), "01234567-89ab-4cde-8fab-0123456789ab", 10)
	if err != nil {
		t.Fatalf("provider-shaped order rejected by SSE parser: %v", err)
	}
}
