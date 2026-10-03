package exchangeproduct

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

// Isolated fixture identities/funding only; no public Wallet or settlement proof.
func TestPostgreSQLPartialFillConcurrentCancelOwnerReplayAfterRestart(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("YNX_EXCHANGE_POSTGRES_TEST_URL"))
	if databaseURL == "" {
		t.Skip("YNX_EXCHANGE_POSTGRES_TEST_URL is not configured")
	}
	seed, chain, _ := newTestService(t)
	seller := accountSession(t, seed, alice, "cancel-pg-seller", "exchange:read", "exchange:trade")
	buyer := accountSession(t, seed, bob, "cancel-pg-buyer", "exchange:read", "exchange:trade")
	confirmDeposit(t, seed, chain, seller, "abababababababab", 2*AmountScale)
	if _, err := seed.CreditTestQuote(adminKey, bob, 10*AmountScale, "cancel-pg-quote"); err != nil {
		t.Fatal(err)
	}
	maker, err := place(t, seed, seller, "sell", 2*AmountScale, 2*AmountScale, "cancel-pg-maker")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := place(t, seed, buyer, "buy", 2*AmountScale, AmountScale, "cancel-pg-taker"); err != nil {
		t.Fatal(err)
	}
	if seed.state.Orders[maker.ID].Status != "partially_filled" || len(seed.state.Trades) != 1 {
		t.Fatal("fixture did not partially fill")
	}
	cfg := seed.cfg
	cfg.StateDatabaseURL = isolatedExchangePostgresURL(t, databaseURL)
	cfg.Gateway = orderReplayHTTPGateway{seller.token: seller.session, buyer.token: buyer.session}
	cfg.GatewayClientID, cfg.GatewayBundleID = "ynx-exchange-v1", "com.ynxweb4.exchange"
	one, two := startOrderReplayProcess(t, cfg), startOrderReplayProcess(t, cfg)
	client := &http.Client{Timeout: 5 * time.Second}
	key := "cancel-pg-exact-replay"
	body := func(owner testAccount) []byte {
		b, err := json.Marshal(map[string]string{"idempotencyKey": key, "walletSignature": signAction(owner.private, OrderCancelAuthorizationPayload(owner.account, maker.ID, key))})
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	ownerBody, foreignBody := body(seller), body(buyer)
	type result struct {
		status int
		body   []byte
		err    error
	}
	request := func(base string, owner testAccount, payload []byte) result {
		r, err := http.NewRequest("POST", base+"/v1/orders/"+maker.ID+"/cancel", bytes.NewReader(payload))
		if err != nil {
			return result{err: err}
		}
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-YNX-Product-Session-Proof", owner.token)
		response, err := client.Do(r)
		if err != nil {
			return result{err: err}
		}
		defer response.Body.Close()
		raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
		return result{response.StatusCode, raw, err}
	}
	results := make(chan result, 12)
	start := make(chan struct{})
	for i := 0; i < 12; i++ {
		base := one.URL
		if i%2 == 1 {
			base = two.URL
		}
		go func(base string) { <-start; results <- request(base, seller, ownerBody) }(base)
	}
	close(start)
	for i := 0; i < 12; i++ {
		r := <-results
		if r.err != nil || r.status != 200 && r.status != 409 {
			t.Fatalf("concurrent cancel: status=%d err=%v", r.status, r.err)
		}
	}
	confirmed := request(two.URL, seller, ownerBody)
	var cancelled Order
	if confirmed.err != nil || confirmed.status != 200 || json.Unmarshal(confirmed.body, &cancelled) != nil || cancelled.Status != "cancelled" {
		t.Fatal("exact owner cancellation not confirmed")
	}
	one.Close()
	two.Close()
	restarted := startOrderReplayProcess(t, cfg)
	loaded, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer loaded.Close()
	before := digest(loaded.state)
	if len(loaded.state.Trades) != 1 || len(loaded.state.Orders) != 2 {
		t.Fatal("duplicate fill/order after cancel")
	}
	var nativeTotal, quoteTotal, fees int64
	for _, owner := range []testAccount{seller, buyer} {
		snapshot := loaded.Snapshot(owner.account)
		assertLedgerBalances(t, snapshot)
		for _, balance := range snapshot.Balances {
			if balance.ReservedMicro != 0 {
				t.Fatal("remaining funds were not released exactly once")
			}
			if balance.Asset == NativeAsset {
				nativeTotal += balance.AvailableMicro
			}
			if balance.Asset == QuoteAsset {
				quoteTotal += balance.AvailableMicro
			}
		}
	}
	for _, trade := range loaded.state.Trades {
		fees += trade.BuyerFeeMicro + trade.SellerFeeMicro
	}
	if nativeTotal != 2*AmountScale || quoteTotal+fees != 10*AmountScale {
		t.Fatal("cancel/restart violated native or quote-plus-fees conservation")
	}
	for i := 0; i < 3; i++ {
		r := request(restarted.URL, seller, ownerBody)
		if r.err != nil || r.status != 200 || !bytes.Equal(r.body, confirmed.body) {
			t.Fatal("restart changed exact owner cancel receipt")
		}
		foreign := request(restarted.URL, buyer, foreignBody)
		if foreign.err != nil || foreign.status != 403 || bytes.Contains(foreign.body, []byte(maker.ID)) {
			t.Fatal("foreign replay leaked order after restart")
		}
	}
	if err := loaded.refreshState(); err != nil {
		t.Fatal(err)
	}
	if digest(loaded.state) != before {
		t.Fatal("replays mutated persisted balances, audit or orders")
	}
}
