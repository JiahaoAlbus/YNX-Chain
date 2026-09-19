package brokerage

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type resolverFunc func(context.Context, string, string, string) (string, error)

func (f resolverFunc) ResolveBrokerAccount(ctx context.Context, owner, provider, environment string) (string, error) {
	return f(ctx, owner, provider, environment)
}

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func config(values map[string]string) Config {
	return LoadConfig(func(k string) string { return values[k] })
}
func enabled(mode string) Config {
	return config(map[string]string{"FINANCE_TRADING_ENABLED": "true", "ALPACA_BROKER_AUTH_MODE": mode, "ALPACA_BROKER_CLIENT_ID": "fixture-id", "ALPACA_BROKER_CLIENT_SECRET": "fixture-secret", "ALPACA_BROKER_API_KEY": "fixture-key", "ALPACA_BROKER_API_SECRET": "fixture-secret"})
}
func writeEnabled(mode string) Config {
	return config(map[string]string{"FINANCE_TRADING_ENABLED": "true", "FINANCE_SANDBOX_WRITES_ENABLED": "true", "FINANCE_SANDBOX_WRITE_ACTIVATION_RECEIPT_SHA256": strings.Repeat("a", 64), "ALPACA_BROKER_AUTH_MODE": mode, "ALPACA_BROKER_CLIENT_ID": "fixture-id", "ALPACA_BROKER_CLIENT_SECRET": "fixture-secret", "ALPACA_BROKER_API_KEY": "fixture-key", "ALPACA_BROKER_API_SECRET": "fixture-secret"})
}
func response(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": {"application/json"}, "X-Request-Id": {"fixture-request-1"}}, Body: io.NopCloser(strings.NewReader(body))}
}

const asset = `[{"id":"00000000-0000-0000-0000-000000000001","symbol":"TEST","name":"Isolated test equity","class":"us_equity","status":"active","tradable":true}]`

func TestReadOnlyAccountOrdersPositionsAndReconcile(t *testing.T) {
	a := NewAlpaca(enabled("legacy_basic"))
	accountID := "01234567-89ab-4cde-8fab-0123456789ab"
	resolver := resolverFunc(func(_ context.Context, owner, provider, environment string) (string, error) {
		if owner != "ynx1owner" || provider != Provider || environment != "sandbox" {
			t.Fatal("wrong resolver binding")
		}
		return accountID, nil
	})
	responses := map[string]string{
		"/v1/trading/accounts/" + accountID + "/account":                                   `{"id":"01234567-89ab-4cde-8fab-0123456789ab","status":"ACTIVE","currency":"USD","cash":"100000.00","buying_power":"103556.8572572922","trading_blocked":false,"account_blocked":false,"trade_suspended_by_user":false}`,
		"/v1/trading/accounts/" + accountID + "/orders?status=all&limit=500&direction=asc": `[{"id":"11111111-2222-4333-8444-555555555555","client_order_id":"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee","asset_id":"99999999-8888-4777-8666-555555555555","symbol":"ACME","side":"buy","qty":"2","filled_qty":"1","type":"limit","limit_price":"125.34","time_in_force":"day","status":"partially_filled","submitted_at":"2026-09-19T09:00:00Z"}]`,
		"/v1/trading/accounts/" + accountID + "/positions":                                 `[{"asset_id":"99999999-8888-4777-8666-555555555555","symbol":"ACME","qty":"1","qty_available":"1","avg_entry_price":"125.34","market_value":"126.00"}]`,
	}
	var mu sync.Mutex
	calls := map[string]int{}
	a.client.Transport = roundTrip(func(request *http.Request) (*http.Response, error) {
		mu.Lock()
		calls[request.URL.RequestURI()]++
		mu.Unlock()
		body, ok := responses[request.URL.RequestURI()]
		if !ok {
			t.Fatalf("unexpected %s", request.URL.RequestURI())
		}
		return response(200, body), nil
	})
	snapshot, err := a.Reconcile(context.Background(), "ynx1owner", resolver)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Account.Cash != "100000.00" || snapshot.Account.BuyingPower != "103556.8572572922" || snapshot.Account.TradingBlocked || snapshot.Account.AccountBlocked || snapshot.Account.TradeSuspendedByUser || len(snapshot.Orders) != 1 || len(snapshot.Positions) != 1 || snapshot.Orders[0].Status != "partially_filled" || snapshot.Orders[0].RequestID != "fixture-request-1" {
		t.Fatalf("%+v", snapshot)
	}
	if len(calls) != 3 {
		t.Fatalf("calls=%v", calls)
	}
}

func TestReadOnlySandboxLatestQuoteUsesPinnedMarketDataOrigin(t *testing.T) {
	a := NewAlpaca(enabled("legacy_basic"))
	a.client.Transport = roundTrip(func(request *http.Request) (*http.Response, error) {
		if request.Method != http.MethodGet || request.URL.String() != MarketDataOrigin+"/v2/stocks/ACME/quotes/latest?feed=iex&currency=USD" {
			t.Fatalf("unexpected quote request %s %s", request.Method, request.URL.String())
		}
		return response(http.StatusOK, `{"symbol":"ACME","quote":{"ap":125.35,"as":7,"bp":125.34,"bs":5,"t":"2026-09-19T09:00:00.123456Z"}}`), nil
	})
	quote, err := a.Quote(context.Background(), "ACME")
	if err != nil || quote.AskPrice != "125.35" || quote.BidPrice != "125.34" || quote.Feed != "iex" {
		t.Fatalf("quote=%+v err=%v", quote, err)
	}
}

func TestConfiguredProviderRateLimitsAreEnforcedConcurrently(t *testing.T) {
	cfg := config(map[string]string{
		"FINANCE_TRADING_ENABLED": "true", "ALPACA_BROKER_AUTH_MODE": "legacy_basic",
		"ALPACA_BROKER_API_KEY": "fixture-key", "ALPACA_BROKER_API_SECRET": "fixture-secret",
		"FINANCE_BROKER_READ_RATE_PER_MINUTE": "3", "FINANCE_BROKER_WRITE_RATE_PER_MINUTE": "2", "FINANCE_MARKET_DATA_RATE_PER_MINUTE": "1",
	})
	a := NewAlpaca(cfg)
	fixed := time.Date(2026, 9, 19, 9, 0, 0, 0, time.UTC)
	a.now = func() time.Time { return fixed }
	var calls atomic.Int32
	a.client.Transport = roundTrip(func(request *http.Request) (*http.Response, error) {
		calls.Add(1)
		return response(http.StatusOK, asset), nil
	})
	results := make(chan string, 12)
	var group sync.WaitGroup
	for i := 0; i < 12; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			_, err := a.Assets(context.Background())
			results <- ErrorCode(err)
		}()
	}
	group.Wait()
	close(results)
	limited, successful := 0, 0
	for code := range results {
		if code == "RATE_LIMITED_LOCAL" {
			limited++
		} else if code == "BROKER_CHECK_FAILED" {
			successful++
		} else {
			t.Fatalf("unexpected result code %s", code)
		}
	}
	if calls.Load() != 3 || successful != 3 || limited != 9 {
		t.Fatalf("provider calls=%d successful=%d limited=%d", calls.Load(), successful, limited)
	}

	quoteCalls := 0
	a.client.Transport = roundTrip(func(*http.Request) (*http.Response, error) {
		quoteCalls++
		return response(http.StatusOK, `{"symbol":"ACME","quote":{"ap":10,"as":1,"bp":9,"bs":1,"t":"2026-09-19T09:00:00Z"}}`), nil
	})
	if _, err := a.Quote(context.Background(), "ACME"); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Quote(context.Background(), "ACME"); ErrorCode(err) != "RATE_LIMITED_LOCAL" || quoteCalls != 1 {
		t.Fatalf("market rate gate err=%v calls=%d", err, quoteCalls)
	}
}

func TestOrdersPaginatesBeyondFiveHundredWithoutSilentTruncation(t *testing.T) {
	a := NewAlpaca(enabled("legacy_basic"))
	accountID := "01234567-89ab-4cde-8fab-0123456789ab"
	resolve := resolverFunc(func(context.Context, string, string, string) (string, error) { return accountID, nil })
	makePage := func(start, count int) string {
		values := make([]providerOrder, 0, count)
		for i := start; i < start+count; i++ {
			id := fmt.Sprintf("%08x-2222-4333-8444-%012x", i+1, i+1)
			assetID := fmt.Sprintf("%08x-8888-4777-8666-%012x", i+1, i+1)
			limit := "10"
			values = append(values, providerOrder{ID: id, ClientOrderID: fmt.Sprintf("order-%d", i), AssetID: assetID, Symbol: "ACME", Side: "buy", Qty: "1", FilledQty: "0", Type: "limit", LimitPrice: &limit, TimeInForce: "day", Status: "accepted", SubmittedAt: time.Date(2026, 9, 19, 9, 0, i, 0, time.UTC).Format(time.RFC3339Nano)})
		}
		raw, _ := json.Marshal(values)
		return string(raw)
	}
	first := makePage(0, 500)
	second := makePage(500, 2)
	calls := 0
	a.client.Transport = roundTrip(func(request *http.Request) (*http.Response, error) {
		calls++
		if calls == 1 {
			if request.URL.Query().Get("after") != "" {
				t.Fatal("first page unexpectedly had a cursor")
			}
			return response(http.StatusOK, first), nil
		}
		if request.URL.Query().Get("after") != time.Date(2026, 9, 19, 9, 0, 499, 0, time.UTC).Format(time.RFC3339Nano) {
			t.Fatalf("wrong pagination cursor: %s", request.URL.RawQuery)
		}
		return response(http.StatusOK, second), nil
	})
	orders, requestIDs, err := a.Orders(context.Background(), "owner", resolve)
	if err != nil || len(orders) != 502 || calls != 2 || requestIDs != "fixture-request-1,fixture-request-1" {
		t.Fatalf("orders=%d calls=%d ids=%q err=%v", len(orders), calls, requestIDs, err)
	}
}

func TestQuoteRejectsInvalidSymbolExponentAndCrossOriginConfig(t *testing.T) {
	a := NewAlpaca(enabled("legacy_basic"))
	called := false
	a.client.Transport = roundTrip(func(*http.Request) (*http.Response, error) { called = true; return response(http.StatusOK, `{}`), nil })
	if _, err := a.Quote(context.Background(), "../ACME"); ErrorCode(err) != "MARKET_DATA_REQUEST_INVALID" || called {
		t.Fatal(err)
	}
	a.client.Transport = roundTrip(func(*http.Request) (*http.Response, error) {
		return response(http.StatusOK, `{"symbol":"ACME","quote":{"ap":1e2,"as":7,"bp":99,"bs":5,"t":"2026-09-19T09:00:00Z"}}`), nil
	})
	if _, err := a.Quote(context.Background(), "ACME"); ErrorCode(err) != "PROVIDER_PROTOCOL_ERROR" {
		t.Fatal(err)
	}
	unsafe := config(map[string]string{"FINANCE_TRADING_ENABLED": "true", "ALPACA_BROKER_CLIENT_ID": "id", "ALPACA_BROKER_CLIENT_SECRET": "secret", "ALPACA_MARKET_DATA_SANDBOX_BASE_URL": "https://attacker.invalid"})
	if unsafe.ready() {
		t.Fatal("cross-origin market data config accepted")
	}
}

func TestWriteMethodsRemainFailClosedWithoutProviderPost(t *testing.T) {
	a := NewAlpaca(enabled("legacy_basic"))
	called := false
	a.client.Transport = roundTrip(func(*http.Request) (*http.Response, error) { called = true; return response(500, `{}`), nil })
	if _, err := a.SubmitOrder(context.Background(), "owner", nil, SubmitOrderRequest{}); ErrorCode(err) != "ORDER_SUBMISSION_DISABLED" {
		t.Fatal(err)
	}
	if _, err := a.CancelOrder(context.Background(), "owner", nil, "id"); ErrorCode(err) != "ORDER_CANCELLATION_DISABLED" {
		t.Fatal(err)
	}
	if called {
		t.Fatal("write methods contacted provider")
	}
}

func TestActivationGatedSubmitAndCancelExactFixture(t *testing.T) {
	a := NewAlpaca(writeEnabled("legacy_basic"))
	accountID := "01234567-89ab-4cde-8fab-0123456789ab"
	orderID := "11111111-2222-4333-8444-555555555555"
	assetID := "99999999-8888-4777-8666-555555555555"
	clientID := "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
	resolve := resolverFunc(func(context.Context, string, string, string) (string, error) { return accountID, nil })
	var calls []string
	a.client.Transport = roundTrip(func(request *http.Request) (*http.Response, error) {
		calls = append(calls, request.Method+" "+request.URL.RequestURI())
		if request.Method == http.MethodPost {
			body, _ := io.ReadAll(request.Body)
			var submitted SubmitOrderRequest
			if json.Unmarshal(body, &submitted) != nil || submitted.ClientOrderID != clientID || submitted.ExtendedHours {
				t.Fatal("wrong submit payload")
			}
			return response(http.StatusCreated, `{"id":"11111111-2222-4333-8444-555555555555","client_order_id":"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee","asset_id":"99999999-8888-4777-8666-555555555555","symbol":"ACME","side":"buy","qty":"2","filled_qty":"0","type":"limit","limit_price":"125.34","time_in_force":"day","status":"accepted","submitted_at":"2026-09-19T09:00:00Z"}`), nil
		}
		if request.Method == http.MethodDelete && request.URL.RequestURI() == "/v1/trading/accounts/"+accountID+"/orders/"+orderID {
			return &http.Response{StatusCode: http.StatusNoContent, Header: http.Header{"X-Request-Id": {"fixture-request-2"}}, Body: io.NopCloser(strings.NewReader(""))}, nil
		}
		t.Fatalf("unexpected request %s %s", request.Method, request.URL.RequestURI())
		return nil, nil
	})
	request := SubmitOrderRequest{ClientOrderID: clientID, AssetID: assetID, Symbol: "ACME", Side: "buy", Qty: "2", Type: "limit", LimitPrice: "125.34", TimeInForce: "day"}
	result, err := a.SubmitOrder(context.Background(), "owner", resolve, request)
	if err != nil || result.ID != orderID || result.Status != "accepted" || result.RequestID != "fixture-request-1" {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	if requestID, err := a.CancelOrder(context.Background(), "owner", resolve, orderID); err != nil || requestID != "fixture-request-2" {
		t.Fatalf("requestID=%q err=%v", requestID, err)
	}
	if len(calls) != 2 {
		t.Fatalf("calls=%v", calls)
	}
}

func TestOrderWriteRequiresBoundedProviderRequestID(t *testing.T) {
	accountID := "01234567-89ab-4cde-8fab-0123456789ab"
	resolve := resolverFunc(func(context.Context, string, string, string) (string, error) { return accountID, nil })
	request := SubmitOrderRequest{ClientOrderID: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", AssetID: "99999999-8888-4777-8666-555555555555", Symbol: "ACME", Side: "buy", Qty: "2", Type: "limit", LimitPrice: "125.34", TimeInForce: "day"}
	body := `{"id":"11111111-2222-4333-8444-555555555555","client_order_id":"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee","asset_id":"99999999-8888-4777-8666-555555555555","symbol":"ACME","side":"buy","qty":"2","filled_qty":"0","type":"limit","limit_price":"125.34","time_in_force":"day","status":"accepted","submitted_at":"2026-09-19T09:00:00Z"}`
	for _, requestID := range []string{"", "contains spaces", strings.Repeat("x", 129)} {
		t.Run(fmt.Sprintf("len-%d", len(requestID)), func(t *testing.T) {
			a := NewAlpaca(writeEnabled("legacy_basic"))
			a.client.Transport = roundTrip(func(*http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: http.StatusCreated, Header: http.Header{"Content-Type": {"application/json"}, "X-Request-Id": {requestID}}, Body: io.NopCloser(strings.NewReader(body))}, nil
			})
			if _, err := a.SubmitOrder(context.Background(), "owner", resolve, request); ErrorCode(err) != "PROVIDER_PROTOCOL_ERROR" {
				t.Fatalf("requestID=%q err=%v", requestID, err)
			}
		})
	}
}

func TestWriteActivationAndProviderResultsFailClosed(t *testing.T) {
	missingReceipt := config(map[string]string{"FINANCE_TRADING_ENABLED": "true", "FINANCE_SANDBOX_WRITES_ENABLED": "true", "ALPACA_BROKER_CLIENT_ID": "id", "ALPACA_BROKER_CLIENT_SECRET": "secret"})
	if missingReceipt.Status().SubmissionEnabled || missingReceipt.ready() {
		t.Fatal("missing activation receipt enabled writes")
	}
	a := NewAlpaca(writeEnabled("legacy_basic"))
	accountID := "01234567-89ab-4cde-8fab-0123456789ab"
	resolve := resolverFunc(func(context.Context, string, string, string) (string, error) { return accountID, nil })
	a.client.Transport = roundTrip(func(*http.Request) (*http.Response, error) {
		return response(http.StatusCreated, `{"id":"11111111-2222-4333-8444-555555555555","client_order_id":"ffffffff-ffff-4fff-8fff-ffffffffffff","asset_id":"99999999-8888-4777-8666-555555555555","symbol":"OTHER","side":"buy","qty":"2","filled_qty":"0","type":"limit","limit_price":"125.34","time_in_force":"day","status":"accepted","submitted_at":"2026-09-19T09:00:00Z"}`), nil
	})
	request := SubmitOrderRequest{ClientOrderID: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", AssetID: "99999999-8888-4777-8666-555555555555", Symbol: "ACME", Side: "buy", Qty: "2", Type: "limit", LimitPrice: "125.34", TimeInForce: "day"}
	if _, err := a.SubmitOrder(context.Background(), "owner", resolve, request); ErrorCode(err) != "PROVIDER_PROTOCOL_ERROR" {
		t.Fatal(err)
	}
}

func TestDefaultAndInvalidConfigurationNeverCallsProvider(t *testing.T) {
	cases := []map[string]string{{}, {"FINANCE_TRADING_ENABLED": "true"}, {"FINANCE_TRADING_ENV": "live"}, {"YNX_CHAIN_ENV": "mainnet"}, {"YNX_EVM_CHAIN_ID": "1"}, {"FINANCE_LIVE_ENABLED": "true"}, {"ALPACA_BROKER_SANDBOX_BASE_URL": "https://paper-api.alpaca.markets"}, {"ALPACA_BROKER_SANDBOX_BASE_URL": BrokerOrigin + "/"}, {"ALPACA_BROKER_TOKEN_URL": "https://attacker.invalid"}, {"ALPACA_BROKER_AUTH_MODE": "private_key_jwt"}, {"ALPACA_BROKER_ACCOUNT_ID": "shared"}, {"FINANCE_SANDBOX_WRITES_ENABLED": "true"}, {"FINANCE_TRADING_ENABLED": "TRUE"}, {"FINANCE_BROKER_READ_RATE_PER_MINUTE": "0"}, {"FINANCE_BROKER_WRITE_RATE_PER_MINUTE": "10001"}, {"FINANCE_MARKET_DATA_RATE_PER_MINUTE": "unbounded"}}
	for i, values := range cases {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			// Unsafe environment/domain/mode checks must fail even with otherwise
			// complete credentials, not accidentally pass due to missing keys.
			if i >= 2 {
				if _, exists := values["FINANCE_TRADING_ENABLED"]; !exists {
					values["FINANCE_TRADING_ENABLED"] = "true"
				}
				values["ALPACA_BROKER_CLIENT_ID"] = "fixture-id"
				values["ALPACA_BROKER_CLIENT_SECRET"] = "fixture-secret"
			}
			c := config(values)
			a := NewAlpaca(c)
			a.client.Transport = roundTrip(func(*http.Request) (*http.Response, error) { t.Fatal("network must not run"); return nil, nil })
			if _, err := a.Assets(context.Background()); ErrorCode(err) != "BROKER_NOT_CONFIGURED" {
				t.Fatal(err)
			}
			if c.Status().SubmissionEnabled || c.Status().OfficialSandboxVerified {
				t.Fatal("truth promotion")
			}
		})
	}
}
func TestConfigSerializationCannotExposeSecrets(t *testing.T) {
	c := enabled("client_credentials")
	b, _ := json.Marshal(c)
	s, _ := json.Marshal(c.Status())
	for _, out := range []string{string(b), string(s), fmt.Sprint(c), fmt.Sprintf("%+v %#v", c, c)} {
		if strings.Contains(out, "fixture-secret") || strings.Contains(out, "fixture-id") {
			t.Fatal("credential exposed")
		}
	}
}
func TestOAuthUsesSandboxBodyCredentialsAndCachesAcrossConcurrentReads(t *testing.T) {
	a := NewAlpaca(enabled("client_credentials"))
	var tokens, reads atomic.Int32
	a.client.Transport = roundTrip(func(r *http.Request) (*http.Response, error) {
		if r.URL.String() == TokenURL {
			tokens.Add(1)
			if r.Method != "POST" || r.Header.Get("Authorization") != "" {
				t.Error("token auth contract")
			}
			_ = r.ParseForm()
			if r.Form.Get("grant_type") != "client_credentials" || r.Form.Get("client_id") != "fixture-id" || r.Form.Get("client_secret") != "fixture-secret" {
				t.Error("token form")
			}
			return response(200, `{"access_token":"fixture-token","token_type":"Bearer","expires_in":899}`), nil
		}
		reads.Add(1)
		if r.URL.String() != BrokerOrigin+"/v1/assets?status=active&asset_class=us_equity" || r.Method != "GET" || r.Header.Get("Authorization") != "Bearer fixture-token" {
			t.Error("broker endpoint/auth")
		}
		return response(200, asset), nil
	})
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			result, err := a.Assets(context.Background())
			if err != nil || len(result.Assets) != 1 || result.RequestID != "fixture-request-1" {
				t.Errorf("read %v", err)
			}
		}()
	}
	wg.Wait()
	if tokens.Load() != 1 || reads.Load() != 12 {
		t.Fatal(tokens.Load(), reads.Load())
	}
}
func TestLegacyBrokerBasicNotPersonalTradingAPI(t *testing.T) {
	a := NewAlpaca(enabled("legacy_basic"))
	a.client.Transport = roundTrip(func(r *http.Request) (*http.Response, error) {
		user, pass, ok := r.BasicAuth()
		if !ok || user != "fixture-key" || pass != "fixture-secret" || r.URL.Host != "broker-api.sandbox.alpaca.markets" || r.Header.Get("APCA-API-KEY-ID") != "" {
			t.Fatal("wrong Broker authentication")
		}
		return response(200, asset), nil
	})
	if _, err := a.Assets(context.Background()); err != nil {
		t.Fatal(err)
	}
}
func TestProviderErrorsRedactedAndNoRetries(t *testing.T) {
	for _, status := range []int{301, 401, 403, 429, 500} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			a := NewAlpaca(enabled("legacy_basic"))
			calls := 0
			a.client.Transport = roundTrip(func(*http.Request) (*http.Response, error) {
				calls++
				return response(status, `{"message":"fixture-secret identity material"}`), nil
			})
			_, err := a.Assets(context.Background())
			if err == nil || strings.Contains(err.Error(), "secret") || calls != 1 {
				t.Fatal(err, calls)
			}
		})
	}
}
func TestResponseValidation(t *testing.T) {
	for _, body := range []string{`null`, `{}`, asset + asset, strings.Replace(asset, "us_equity", "crypto", 1), strings.Replace(asset, "00000000-0000-0000-0000-000000000001", "../accounts", 1), strings.Repeat("x", (4<<20)+1)} {
		a := NewAlpaca(enabled("legacy_basic"))
		a.client.Transport = roundTrip(func(*http.Request) (*http.Response, error) { return response(200, body), nil })
		if _, err := a.Assets(context.Background()); err == nil {
			t.Fatal("invalid response accepted")
		}
	}
}

type resolver func(context.Context, string, string, string) (string, error)

func (r resolver) ResolveBrokerAccount(c context.Context, o, p, e string) (string, error) {
	return r(c, o, p, e)
}
func TestOwnerBindingPrecedesAccountHTTPAndRejectsCrossAccountResponse(t *testing.T) {
	a := NewAlpaca(enabled("legacy_basic"))
	calls := 0
	a.client.Transport = roundTrip(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.Path != "/v1/trading/accounts/00000000-0000-0000-0000-000000000001/account" {
			t.Fatal(r.URL.Path)
		}
		return response(200, `{"id":"00000000-0000-0000-0000-000000000002","status":"ACTIVE","currency":"USD"}`), nil
	})
	resolve := resolver(func(_ context.Context, owner, provider, env string) (string, error) {
		if provider != Provider || env != "sandbox" {
			t.Fatal("mapping domain")
		}
		if owner != "alice" {
			return "", fmt.Errorf("no mapping")
		}
		return "00000000-0000-0000-0000-000000000001", nil
	})
	if _, err := a.Account(context.Background(), "bob", resolve); ErrorCode(err) != "ACCOUNT_NOT_LINKED" || calls != 0 {
		t.Fatal(err)
	}
	if _, err := a.Account(context.Background(), "alice", resolve); ErrorCode(err) != "PROVIDER_PROTOCOL_ERROR" || calls != 1 {
		t.Fatal(err)
	}
}

func TestTradingAccountRequiresExplicitBooleanSafetyFences(t *testing.T) {
	accountID := "00000000-0000-0000-0000-000000000001"
	resolve := resolver(func(context.Context, string, string, string) (string, error) { return accountID, nil })
	base := `{"id":"00000000-0000-0000-0000-000000000001","status":"ACTIVE","currency":"USD","cash":"100","buying_power":"103556.8572572922","trading_blocked":false,"account_blocked":false,"trade_suspended_by_user":false}`
	invalid := map[string]string{
		"missing trading_blocked":    strings.Replace(base, `,"trading_blocked":false`, "", 1),
		"missing account_blocked":    strings.Replace(base, `,"account_blocked":false`, "", 1),
		"missing suspended":          strings.Replace(base, `,"trade_suspended_by_user":false`, "", 1),
		"null trading_blocked":       strings.Replace(base, `"trading_blocked":false`, `"trading_blocked":null`, 1),
		"null account_blocked":       strings.Replace(base, `"account_blocked":false`, `"account_blocked":null`, 1),
		"null suspended":             strings.Replace(base, `"trade_suspended_by_user":false`, `"trade_suspended_by_user":null`, 1),
		"wrong type trading_blocked": strings.Replace(base, `"trading_blocked":false`, `"trading_blocked":"false"`, 1),
		"wrong type account_blocked": strings.Replace(base, `"account_blocked":false`, `"account_blocked":0`, 1),
		"wrong type suspended":       strings.Replace(base, `"trade_suspended_by_user":false`, `"trade_suspended_by_user":{}`, 1),
	}
	for name, body := range invalid {
		t.Run(name, func(t *testing.T) {
			a := NewAlpaca(enabled("legacy_basic"))
			a.client.Transport = roundTrip(func(*http.Request) (*http.Response, error) { return response(http.StatusOK, body), nil })
			if _, err := a.Account(context.Background(), "alice", resolve); ErrorCode(err) != "PROVIDER_PROTOCOL_ERROR" {
				t.Fatalf("err=%v", err)
			}
		})
	}
	a := NewAlpaca(enabled("legacy_basic"))
	a.client.Transport = roundTrip(func(*http.Request) (*http.Response, error) {
		return response(http.StatusOK, strings.Replace(base, `"account_blocked":false`, `"account_blocked":true`, 1)), nil
	})
	account, err := a.Account(context.Background(), "alice", resolve)
	if err != nil || !account.AccountBlocked || account.BuyingPower != "103556.8572572922" {
		t.Fatalf("account=%+v err=%v", account, err)
	}
}
func TestNoRedirectOrEnvironmentProxy(t *testing.T) {
	a := NewAlpaca(enabled("legacy_basic"))
	if a.client.Transport.(*http.Transport).Proxy != nil || a.client.CheckRedirect(nil, nil) != http.ErrUseLastResponse {
		t.Fatal("credential routing fence")
	}
}
