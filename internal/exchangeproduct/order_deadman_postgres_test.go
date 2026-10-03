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

func TestPostgreSQLDeadManTerminalReplayTwoProcessesAndRestart(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("YNX_EXCHANGE_POSTGRES_TEST_URL"))
	if databaseURL == "" {
		t.Skip("YNX_EXCHANGE_POSTGRES_TEST_URL is not configured")
	}
	seed, owner, other, original, cancelled := expiredOrderRecoveryFixture(t)
	cfg := seed.cfg
	cfg.StateDatabaseURL = isolatedExchangePostgresURL(t, databaseURL)
	cfg.Gateway = orderReplayHTTPGateway{owner.token: owner.session, other.token: other.session}
	cfg.GatewayClientID, cfg.GatewayBundleID = "ynx-exchange-v1", "com.ynxweb4.exchange"
	if err := seed.Close(); err != nil {
		t.Fatal(err)
	}
	one, two := startOrderReplayProcess(t, cfg), startOrderReplayProcess(t, cfg)
	loaded, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer loaded.Close()
	before := digest(loaded.state)
	client := &http.Client{Timeout: 5 * time.Second}
	type result struct {
		status int
		body   []byte
		err    error
	}
	call := func(base string, account testAccount, req PlaceOrderRequest) result {
		payload, err := json.Marshal(req)
		if err != nil {
			return result{err: err}
		}
		r, err := http.NewRequest("POST", base+"/v1/orders", bytes.NewReader(payload))
		if err != nil {
			return result{err: err}
		}
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-YNX-Product-Session-Proof", account.token)
		response, err := client.Do(r)
		if err != nil {
			return result{err: err}
		}
		defer response.Body.Close()
		body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
		return result{response.StatusCode, body, err}
	}
	results := make(chan result, 12)
	for i := 0; i < 12; i++ {
		base := one.URL
		if i%2 != 0 {
			base = two.URL
		}
		go func() { results <- call(base, owner, original) }()
	}
	for i := 0; i < 12; i++ {
		r := <-results
		var order Order
		if r.err != nil || r.status != 201 || json.Unmarshal(r.body, &order) != nil || digest(order) != digest(cancelled) {
			t.Fatal("concurrent exact recovery did not read terminal effect", r.status, r.err)
		}
	}
	one.Close()
	two.Close()
	third := startOrderReplayProcess(t, cfg)
	r := call(third.URL, owner, original)
	var replay Order
	if r.err != nil || r.status != 201 || json.Unmarshal(r.body, &replay) != nil || digest(replay) != digest(cancelled) {
		t.Fatal("restart recovery changed terminal effect", r.status, r.err)
	}
	for _, kind := range []string{"changed", "foreign", "fresh"} {
		req, account, status := original, owner, 409
		switch kind {
		case "changed":
			req.AmountMicro++
		case "foreign":
			account = other
		case "fresh":
			req.IdempotencyKey = "deadman-pg-new-intent"
			status = 403
		}
		req.WalletSignature = signAction(account.private, OrderAuthorizationPayload(account.account, req))
		r := call(third.URL, account, req)
		if r.err != nil || r.status != status {
			t.Fatal("risk/owner intent fence changed", kind, r.status, r.err)
		}
		if bytes.Contains(r.body, []byte(cancelled.ID)) {
			t.Fatal("rejected intent leaked original order")
		}
	}
	third.Close()
	if err := loaded.refreshState(); err != nil {
		t.Fatal(err)
	}
	if digest(loaded.state) != before || len(loaded.state.Orders) != 1 || len(loaded.state.Trades) != 0 {
		t.Fatal("HTTP recovery changed durable order/fees/audit")
	}
	for _, account := range []string{owner.account, other.account} {
		assertLedgerBalances(t, loaded.Snapshot(account))
	}
	if b := loaded.state.Balances[balanceKey(owner.account, NativeAsset)]; b.AvailableMicro != 2*AmountScale || b.ReservedMicro != 0 {
		t.Fatal("cancelled reserve was reopened")
	}
}
