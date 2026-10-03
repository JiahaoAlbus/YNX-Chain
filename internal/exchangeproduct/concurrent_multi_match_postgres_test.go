package exchangeproduct

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

// Real PostgreSQL and independent OS processes; all identities, signatures and
// funding are isolated fixtures, not public Wallet or native settlement proof.
func TestPostgreSQLConcurrentMultiMatchReplayConservesBalancesAfterRestart(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("YNX_EXCHANGE_POSTGRES_TEST_URL"))
	if databaseURL == "" {
		t.Skip("YNX_EXCHANGE_POSTGRES_TEST_URL is not configured")
	}
	const matches = 12
	seed, chain, _ := newTestService(t)
	seller := accountSession(t, seed, alice, "multi-seller", "exchange:read", "exchange:trade")
	buyer := accountSession(t, seed, bob, "multi-buyer", "exchange:read", "exchange:trade")
	confirmDeposit(t, seed, chain, seller, "cdcdcdcdcdcdcdcd", matches*AmountScale)
	const quoteFunding = 100 * AmountScale
	if _, err := seed.CreditTestQuote(adminKey, bob, quoteFunding, "multi-match-quote-credit"); err != nil {
		t.Fatal(err)
	}
	cfg := seed.cfg
	cfg.StateDatabaseURL = isolatedExchangePostgresURL(t, databaseURL)
	cfg.Gateway = orderReplayHTTPGateway{seller.token: seller.session, buyer.token: buyer.session}
	cfg.GatewayClientID, cfg.GatewayBundleID = "ynx-exchange-v1", "com.ynxweb4.exchange"
	one, two := startOrderReplayProcess(t, cfg), startOrderReplayProcess(t, cfg)
	client := &http.Client{Timeout: 5 * time.Second}
	type result struct {
		status int
		body   []byte
		err    error
	}
	request := func(base, method, path, token string, body []byte) result {
		r, err := http.NewRequest(method, base+path, bytes.NewReader(body))
		if err != nil {
			return result{err: err}
		}
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-YNX-Product-Session-Proof", token)
		response, err := client.Do(r)
		if err != nil {
			return result{err: err}
		}
		defer response.Body.Close()
		raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
		return result{response.StatusCode, raw, err}
	}
	orderBody := func(owner testAccount, side string, index int) []byte {
		q := PlaceOrderRequest{Market: DefaultMarket, Side: side, Type: "limit", TimeInForce: "gtc", PriceMicro: 2 * AmountScale, AmountMicro: AmountScale, IdempotencyKey: fmt.Sprintf("multi-%s-%02d", side, index)}
		q.WalletSignature = signAction(owner.private, OrderAuthorizationPayload(owner.account, q))
		raw, err := json.Marshal(q)
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	for i := 0; i < matches; i++ {
		r := request(one.URL, "POST", "/v1/orders", seller.token, orderBody(seller, "sell", i))
		if r.err != nil || r.status != 201 {
			t.Fatalf("maker placement status=%d err=%v", r.status, r.err)
		}
	}
	intents := make([][]byte, matches)
	results := make(chan result, 2*matches)
	start := make(chan struct{})
	for i := range intents {
		intents[i] = orderBody(buyer, "buy", i)
		for _, endpoint := range []string{one.URL, two.URL} {
			go func(base string, body []byte) {
				<-start
				results <- request(base, "POST", "/v1/orders", buyer.token, body)
			}(endpoint, intents[i])
		}
	}
	close(start)
	for i := 0; i < 2*matches; i++ {
		r := <-results
		if r.err != nil || r.status != 201 && r.status != 409 {
			t.Fatalf("concurrent request status=%d err=%v", r.status, r.err)
		}
	}
	// A CAS conflict is not a new order: bounded explicit retries reuse exact bytes.
	orders := make([]Order, matches)
	for i, body := range intents {
		r := request(two.URL, "POST", "/v1/orders", buyer.token, body)
		if r.err != nil || r.status != 201 || json.Unmarshal(r.body, &orders[i]) != nil || orders[i].Status != "filled" || orders[i].Account != bob {
			t.Fatalf("retry %d did not return exact filled owner order: status=%d err=%v", i, r.status, r.err)
		}
	}
	one.Close()
	two.Close()
	restarted := startOrderReplayProcess(t, cfg)
	loaded, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer loaded.Close()
	if len(loaded.state.Trades) != matches || len(loaded.state.Orders) != 2*matches {
		t.Fatalf("replay duplicated matches/orders: %d/%d", len(loaded.state.Trades), len(loaded.state.Orders))
	}
	before := digest(loaded.state)
	var quoteTotal, nativeTotal int64
	for _, owner := range []testAccount{seller, buyer} {
		r := request(restarted.URL, "GET", "/v1/account", owner.token, nil)
		var snapshot AccountSnapshot
		if r.err != nil || r.status != 200 || json.Unmarshal(r.body, &snapshot) != nil || len(snapshot.Orders) != matches || len(snapshot.Trades) != matches {
			t.Fatalf("owner recovery failed: status=%d err=%v", r.status, r.err)
		}
		assertLedgerBalances(t, snapshot)
		for _, order := range snapshot.Orders {
			if order.Account != owner.account {
				t.Fatal("foreign order in recovered account")
			}
		}
		for _, entry := range snapshot.Ledger {
			if entry.Account != owner.account {
				t.Fatal("foreign ledger in recovered account")
			}
		}
		for _, balance := range snapshot.Balances {
			if balance.Account != owner.account || balance.ReservedMicro != 0 || balance.AvailableMicro < 0 {
				t.Fatal("invalid recovered balance or reservation")
			}
			if balance.Asset == QuoteAsset {
				quoteTotal += balance.AvailableMicro
			}
			if balance.Asset == NativeAsset {
				nativeTotal += balance.AvailableMicro
			}
		}
	}
	var fees int64
	ids := map[string]bool{}
	for _, trade := range loaded.state.Trades {
		if ids[trade.ID] || trade.PriceMicro != 2*AmountScale || trade.AmountMicro != AmountScale || trade.Buyer != bob || trade.Seller != alice {
			t.Fatal("invalid or duplicated persisted match")
		}
		ids[trade.ID] = true
		if trade.BuyerFeeMicro != fee(2*AmountScale, cfg.TakerFeeBPS) || trade.SellerFeeMicro != fee(2*AmountScale, cfg.MakerFeeBPS) {
			t.Fatal("maker/taker fee mismatch")
		}
		fees += trade.BuyerFeeMicro + trade.SellerFeeMicro
	}
	if quoteTotal+fees != quoteFunding || nativeTotal != matches*AmountScale {
		t.Fatalf("asset conservation failed: quote=%d fees=%d native=%d", quoteTotal, fees, nativeTotal)
	}
	for i, body := range intents {
		r := request(restarted.URL, "POST", "/v1/orders", buyer.token, body)
		var replay Order
		if r.err != nil || r.status != 201 || json.Unmarshal(r.body, &replay) != nil || digest(replay) != digest(orders[i]) {
			t.Fatalf("restart retry %d changed committed order", i)
		}
		foreign := request(restarted.URL, "POST", "/v1/orders", seller.token, body)
		if foreign.err != nil || foreign.status != 401 || bytes.Contains(foreign.body, []byte(orders[i].ID)) {
			t.Fatal("foreign owner accepted or leaked order")
		}
	}
	if err := loaded.refreshState(); err != nil {
		t.Fatal(err)
	}
	if digest(loaded.state) != before {
		t.Fatal("retries changed persisted fees, orders, audit or ledger")
	}
	public := request(restarted.URL, "GET", "/v1/market-data/snapshot", "", nil)
	var market MarketDataSnapshot
	if public.err != nil || public.status != 200 || json.Unmarshal(public.body, &market) != nil || len(market.Trades) != matches || len(market.OrderBook.Bids) != 0 || len(market.OrderBook.Asks) != 0 {
		t.Fatal("guest projection lost persisted matches")
	}
	if bytes.Contains(public.body, []byte(alice)) || bytes.Contains(public.body, []byte(bob)) {
		t.Fatal("guest projection leaked owner")
	}
	provenance := map[string]Trade{}
	for _, trade := range loaded.state.Trades {
		provenance[trade.ID] = trade
	}
	for _, trade := range market.Trades {
		persisted, ok := provenance[trade.ID]
		if !ok || trade.SourceDigest == "" || trade.SourceDigest != persisted.SourceDigest || trade.SourceType != persisted.SourceType || trade.PriceMicro != persisted.PriceMicro || trade.AmountMicro != persisted.AmountMicro || !trade.CreatedAt.Equal(persisted.CreatedAt) {
			t.Fatal("public match cannot be traced to its exact persisted trade")
		}
	}
}
