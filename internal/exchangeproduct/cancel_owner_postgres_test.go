package exchangeproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
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
	// Guest projections must reflect the persisted match, not cancellation
	// traffic: no invented trades/volume and no remaining cancelled depth.
	readPublic := func(path string, target any) {
		t.Helper()
		response, err := client.Get(restarted.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
		if err != nil || response.StatusCode != 200 || json.Unmarshal(raw, target) != nil {
			t.Fatalf("guest projection failed: status=%d err=%v", response.StatusCode, err)
		}
		for _, forbidden := range []string{seller.account, buyer.account, `"buyer"`, `"seller"`, `"authorizationDigest"`, `"reservedMicro"`} {
			if bytes.Contains(raw, []byte(forbidden)) {
				t.Fatal("guest projection contains private account material")
			}
		}
	}
	var market MarketDataSnapshot
	readPublic("/v1/market-data/snapshot", &market)
	if len(market.Trades) != 1 || len(market.OrderBook.Bids) != 0 || len(market.OrderBook.Asks) != 0 {
		t.Fatal("cancelled remainder invented public depth or trades")
	}
	for _, persisted := range loaded.state.Trades {
		if market.Trades[0].ID != persisted.ID || market.Trades[0].SourceDigest != persisted.SourceDigest || market.Trades[0].SourceDigest == "" {
			t.Fatal("public match lost persisted source identity")
		}
	}
	for _, interval := range []string{"60", "300", "900", "3600", "14400", "86400"} {
		var projection struct {
			Candles []Candle `json:"candles"`
		}
		readPublic("/v1/market-data/candles?market="+DefaultMarket+"&interval="+interval+"&limit=20", &projection)
		if len(projection.Candles) != 1 {
			t.Fatal("cancellation or restart generated extra/empty candles")
		}
		c := projection.Candles[0]
		if c.Trades != 1 || c.BaseVolumeMicro != AmountScale || c.QuoteVolumeMicro != 2*AmountScale || c.OpenMicro != 2*AmountScale || c.HighMicro != c.OpenMicro || c.LowMicro != c.OpenMicro || c.CloseMicro != c.OpenMicro {
			t.Fatal("candle does not aggregate the one persisted fill exactly")
		}
	}
	if err := loaded.refreshState(); err != nil {
		t.Fatal(err)
	}
	if digest(loaded.state) != before {
		t.Fatal("guest projections changed persisted business state")
	}
	if node, err := exec.LookPath("node"); err == nil {
		// Two separate consumer launches; each performs real GET, offline and
		// retry through the owned JS transport, not a mocked snapshot.
		for launch := 0; launch < 2; launch++ {
			ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
			cmd := exec.CommandContext(ctx, node, filepath.Join("..", "..", "apps", "exchange", "tests", "http-cancelled-market-flow.mjs"), restarted.URL)
			output, err := cmd.CombinedOutput()
			cancel()
			if err != nil || string(output) != "CANCELLED_MARKET_RECOVERY=verified\n" {
				t.Fatalf("owned guest consumer recovery failed: %v %s", err, output)
			}
		}
	} else {
		t.Log("Node unavailable: cross-language guest recovery NOT_RUN")
	}
}
