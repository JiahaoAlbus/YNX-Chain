package exchangeproduct

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

// Isolated test-only authority. No current Web read proof receives trade scope.
type orderReplayHTTPGateway map[string]WalletSession

func (g orderReplayHTTPGateway) Authorize(proof, scope, clientID, bundleID string) (WalletSession, error) {
	if clientID != "ynx-exchange-v1" || bundleID != "com.ynxweb4.exchange" {
		return WalletSession{}, ErrForbidden
	}
	session, ok := g[proof]
	if !ok {
		return WalletSession{}, ErrUnauthorized
	}
	for _, allowed := range session.Scopes {
		if allowed == scope {
			return session, nil
		}
	}
	return WalletSession{}, ErrForbidden
}

func TestTwoHTTPInstancesOrderReplayMatchAndRestartRemainOwnerBound(t *testing.T) {
	testTwoHTTPInstancesOrderReplayMatchAndRestartRemainOwnerBound(t, "")
}

func TestPostgreSQLTwoHTTPInstancesOrderReplayMatchAndRestartRemainOwnerBound(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("YNX_EXCHANGE_POSTGRES_TEST_URL"))
	if databaseURL == "" {
		t.Skip("YNX_EXCHANGE_POSTGRES_TEST_URL is not configured")
	}
	for _, layout := range []string{"integrity", "revision"} {
		t.Run(layout, func(t *testing.T) {
			isolatedURL := isolatedExchangePostgresURL(t, databaseURL)
			if layout == "revision" {
				db, err := sql.Open("postgres", isolatedURL)
				if err != nil {
					t.Fatal(err)
				}
				_, err = db.Exec(`CREATE TABLE ynx_exchange_state (id TEXT PRIMARY KEY, revision BIGINT NOT NULL, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
				db.Close()
				if err != nil {
					t.Fatal(err)
				}
			}
			testTwoHTTPInstancesOrderReplayMatchAndRestartRemainOwnerBound(t, isolatedURL)
		})
	}
}

func testTwoHTTPInstancesOrderReplayMatchAndRestartRemainOwnerBound(t *testing.T, databaseURL string) {
	t.Helper()
	seed, chain, _ := newTestService(t)
	seller := accountSession(t, seed, alice, "replay-seller", "exchange:read", "exchange:trade")
	buyer := accountSession(t, seed, bob, "replay-buyer", "exchange:read", "exchange:trade")
	confirmDeposit(t, seed, chain, seller, "abababababababab", 2*AmountScale)
	if _, err := seed.CreditTestQuote(adminKey, bob, 10*AmountScale, "http-replay-quote-credit"); err != nil {
		t.Fatal(err)
	}
	cfg := seed.cfg
	cfg.StateDatabaseURL = databaseURL
	cfg.Gateway = orderReplayHTTPGateway{seller.token: seller.session, buyer.token: buyer.session}
	cfg.GatewayClientID, cfg.GatewayBundleID = "ynx-exchange-v1", "com.ynxweb4.exchange"
	open := func() *httptest.Server {
		s, err := New(cfg)
		if err != nil {
			t.Fatal(err)
		}
		if databaseURL != "" {
			backend, multi := s.StorageStatus()
			if backend != "postgresql" || !multi {
				t.Fatal("real PostgreSQL repository not selected")
			}
		}
		t.Cleanup(func() { _ = s.Close() })
		server := httptest.NewServer(NewServer(s))
		t.Cleanup(server.Close)
		return server
	}
	one, two := open(), open()
	client := &http.Client{Timeout: 5 * time.Second}
	type result struct {
		status int
		body   []byte
		err    error
	}
	request := func(base, method, path, proof string, body []byte) result {
		r, err := http.NewRequest(method, base+path, bytes.NewReader(body))
		if err != nil {
			return result{err: err}
		}
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-YNX-Product-Session-Proof", proof)
		response, err := client.Do(r)
		if err != nil {
			return result{err: err}
		}
		defer response.Body.Close()
		raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
		return result{response.StatusCode, raw, err}
	}
	orderBody := func(owner testAccount, side, key string) []byte {
		q := PlaceOrderRequest{Market: DefaultMarket, Side: side, Type: "limit", TimeInForce: "gtc", PriceMicro: 2 * AmountScale, AmountMicro: AmountScale, IdempotencyKey: key}
		q.WalletSignature = signAction(owner.private, OrderAuthorizationPayload(owner.account, q))
		raw, err := json.Marshal(q)
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	ask := orderBody(seller, "sell", "http-replay-sell")
	if r := request(one.URL, "POST", "/v1/orders", seller.token, ask); r.err != nil || r.status != 201 {
		t.Fatalf("seller placement status=%d err=%v body=%s", r.status, r.err, r.body)
	}
	bid := orderBody(buyer, "buy", "http-replay-buy")
	start, results := make(chan struct{}), make(chan result, 2)
	for _, base := range []string{one.URL, two.URL} {
		go func(base string) { <-start; results <- request(base, "POST", "/v1/orders", buyer.token, bid) }(base)
	}
	close(start)
	var matched Order
	for i := 0; i < 2; i++ {
		r := <-results
		if r.err != nil || r.status != 201 && r.status != 409 {
			if databaseURL != "" {
				repository, err := openStateRepository("", databaseURL)
				if err != nil {
					t.Fatal(err)
				}
				_, _, loadErr := repository.Load()
				repository.(*postgresStateRepository).db.Close()
				t.Logf("PostgreSQL authoritative read failure: %v", loadErr)
			}
			t.Fatalf("concurrent bid status=%d err=%v body=%s", r.status, r.err, r.body)
		}
		if r.status == 201 {
			var order Order
			if json.Unmarshal(r.body, &order) != nil || order.Status != "filled" || order.Account != bob {
				t.Fatalf("invalid matched order=%s", r.body)
			}
			if matched.ID != "" && digest(order) != digest(matched) {
				t.Fatal("same signed intent produced distinct orders")
			}
			matched = order
		}
	}
	if matched.ID == "" {
		t.Fatal("neither request committed")
	}
	one.Close()
	two.Close()
	restarted := open()
	loaded, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer loaded.Close()
	before := digest(loaded.state)
	for _, base := range []string{restarted.URL, open().URL} {
		r := request(base, "POST", "/v1/orders", buyer.token, bid)
		var replay Order
		if r.err != nil || r.status != 201 || json.Unmarshal(r.body, &replay) != nil || digest(replay) != digest(matched) {
			t.Fatal("explicit retry lost exact committed order after reopen")
		}
		foreign := request(base, "POST", "/v1/orders", seller.token, bid)
		if foreign.err != nil || foreign.status != 401 || bytes.Contains(foreign.body, []byte(matched.ID)) {
			t.Fatalf("cross-owner signed request status=%d", foreign.status)
		}
		for _, owner := range []testAccount{seller, buyer} {
			r := request(base, "GET", "/v1/account", owner.token, nil)
			var snapshot AccountSnapshot
			if r.err != nil || r.status != 200 || json.Unmarshal(r.body, &snapshot) != nil || len(snapshot.Orders) != 1 || len(snapshot.Trades) != 1 || snapshot.Orders[0].Account != owner.account {
				t.Fatalf("owner restart read status=%d body=%s", r.status, r.body)
			}
			assertLedgerBalances(t, snapshot)
		}
		public := request(base, "GET", "/v1/market-data/snapshot", "", nil)
		var market MarketDataSnapshot
		if public.err != nil || public.status != 200 || json.Unmarshal(public.body, &market) != nil || len(market.Trades) != 1 || market.Trades[0].PriceMicro != 2*AmountScale || market.Trades[0].AmountMicro != AmountScale || len(market.OrderBook.Bids) != 0 || len(market.OrderBook.Asks) != 0 {
			t.Fatal("guest market no longer projects the single persisted match after retry/reopen")
		}
		if bytes.Contains(public.body, []byte(alice)) || bytes.Contains(public.body, []byte(bob)) || bytes.Contains(public.body, []byte(matched.ID)) {
			t.Fatal("public match projection leaked owner or private order identity")
		}
	}
	if err := loaded.refreshState(); err != nil {
		t.Fatal(err)
	}
	if digest(loaded.state) != before || len(loaded.state.Trades) != 1 || len(loaded.state.Orders) != 2 {
		t.Fatal("retry/foreign requests duplicated match, fees, audit or durable state")
	}
}
