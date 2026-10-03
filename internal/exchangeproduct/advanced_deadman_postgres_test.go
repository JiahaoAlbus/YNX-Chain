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

func advancedRecoveryHTTPIntent(kind string, a testAccount, key string, amount int64) (string, any) {
	switch kind {
	case "conditional":
		r := ConditionalOrderRequest{Market: DefaultMarket, Side: "sell", Kind: "stop", TriggerPriceMicro: AmountScale, LimitPriceMicro: 2 * AmountScale, AmountMicro: amount, IdempotencyKey: key}
		r.WalletSignature = signAction(a.private, ConditionalOrderAuthorizationPayload(a.account, r))
		return "/v1/conditional-orders", r
	case "oco":
		r := OCORequest{Market: DefaultMarket, Side: "sell", StopTriggerPriceMicro: AmountScale, StopLimitPriceMicro: AmountScale, TakeProfitTriggerMicro: 3 * AmountScale, TakeProfitLimitMicro: 3 * AmountScale, AmountMicro: amount, IdempotencyKey: key}
		r.WalletSignature = signAction(a.private, OCOAuthorizationPayload(a.account, r))
		return "/v1/oco", r
	case "twap":
		r := TWAPRequest{Market: DefaultMarket, Side: "sell", LimitPriceMicro: 2 * AmountScale, TotalAmountMicro: amount, Slices: 2, IntervalSeconds: 10, IdempotencyKey: key}
		r.WalletSignature = signAction(a.private, TWAPAuthorizationPayload(a.account, r))
		return "/v1/twap", r
	case "scale":
		r := ScaleRequest{Market: DefaultMarket, Side: "sell", StartPriceMicro: 2 * AmountScale, EndPriceMicro: 3 * AmountScale, TotalAmountMicro: amount, Levels: 2, IdempotencyKey: key}
		r.WalletSignature = signAction(a.private, ScaleAuthorizationPayload(a.account, r))
		return "/v1/scale", r
	case "iceberg":
		r := IcebergRequest{Market: DefaultMarket, Side: "sell", PriceMicro: 2 * AmountScale, TotalAmountMicro: amount, DisplayAmountMicro: AmountScale / 2, IdempotencyKey: key}
		r.WalletSignature = signAction(a.private, IcebergAuthorizationPayload(a.account, r))
		return "/v1/iceberg", r
	}
	panic("unknown existing order kind")
}

func TestPostgreSQLAdvancedDeadManReplayTwoProcessesAndRestart(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("YNX_EXCHANGE_POSTGRES_TEST_URL"))
	if databaseURL == "" {
		t.Skip("YNX_EXCHANGE_POSTGRES_TEST_URL is not configured")
	}
	for _, tt := range advancedRecoveryCases(t) {
		t.Run(tt.name, func(t *testing.T) {
			seed, owner, other, key, terminal := expiredAdvancedRecoveryFixture(t, tt)
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
			expected, _ := json.Marshal(terminal)
			var terminalFields map[string]any
			if err := json.Unmarshal(expected, &terminalFields); err != nil {
				t.Fatal(err)
			}
			terminalID, _ := terminalFields["id"].(string)
			if terminalID == "" {
				t.Fatal("terminal effect has no stable ID")
			}
			client := &http.Client{Timeout: 5 * time.Second}
			type result struct {
				status int
				body   []byte
				err    error
			}
			call := func(base string, a testAccount, key string, amount int64, unsigned ...bool) result {
				route, intent := advancedRecoveryHTTPIntent(tt.name, a, key, amount)
				payload, err := json.Marshal(intent)
				if err != nil {
					return result{err: err}
				}
				if len(unsigned) > 0 && unsigned[0] {
					var fields map[string]any
					if err := json.Unmarshal(payload, &fields); err != nil {
						return result{err: err}
					}
					fields["walletSignature"] = ""
					payload, err = json.Marshal(fields)
					if err != nil {
						return result{err: err}
					}
				}
				r, err := http.NewRequest("POST", base+route, bytes.NewReader(payload))
				if err != nil {
					return result{err: err}
				}
				r.Header.Set("Content-Type", "application/json")
				r.Header.Set("X-YNX-Product-Session-Proof", a.token)
				response, err := client.Do(r)
				if err != nil {
					return result{err: err}
				}
				defer response.Body.Close()
				body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
				return result{response.StatusCode, body, err}
			}
			check := func(r result) {
				t.Helper()
				if r.err != nil || r.status != 201 || !bytes.Equal(bytes.TrimSpace(r.body), expected) {
					t.Fatal("terminal HTTP replay differs", r.status, r.err)
				}
			}
			results := make(chan result, 12)
			for i := 0; i < 12; i++ {
				base := one.URL
				if i%2 != 0 {
					base = two.URL
				}
				go func() { results <- call(base, owner, key, AmountScale) }()
			}
			for i := 0; i < 12; i++ {
				check(<-results)
			}
			one.Close()
			two.Close()
			third := startOrderReplayProcess(t, cfg)
			check(call(third.URL, owner, key, AmountScale))
			for _, kind := range []string{"changed", "foreign", "fresh", "unsigned"} {
				a, k, amount, status := owner, key, int64(AmountScale), 409
				switch kind {
				case "changed":
					amount++
				case "foreign":
					a = other
				case "fresh":
					k += "-fresh"
					status = 403
				case "unsigned":
					status = 401
				}
				r := call(third.URL, a, k, amount, kind == "unsigned")
				if r.err != nil || r.status != status {
					t.Fatal("rejected intent fence changed", kind, r.status, r.err)
				}
				if bytes.Contains(r.body, []byte(terminalID)) {
					t.Fatal("rejected intent exposed terminal effect ID", kind)
				}
			}
			third.Close()
			if err := loaded.refreshState(); err != nil {
				t.Fatal(err)
			}
			if digest(loaded.state) != before {
				t.Fatal("parallel recovery changed durable effects")
			}
			if b := loaded.state.Balances[balanceKey(owner.account, NativeAsset)]; b.AvailableMicro != 2*AmountScale || b.ReservedMicro != 0 {
				t.Fatal("terminal reserve reopened")
			}
			assertLedgerBalances(t, loaded.Snapshot(owner.account))
			assertLedgerBalances(t, loaded.Snapshot(other.account))
		})
	}
}
