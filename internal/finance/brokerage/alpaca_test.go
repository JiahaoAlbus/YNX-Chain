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
)

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func config(values map[string]string) Config {
	return LoadConfig(func(k string) string { return values[k] })
}
func enabled(mode string) Config {
	return config(map[string]string{"FINANCE_TRADING_ENABLED": "true", "ALPACA_BROKER_AUTH_MODE": mode, "ALPACA_BROKER_CLIENT_ID": "fixture-id", "ALPACA_BROKER_CLIENT_SECRET": "fixture-secret", "ALPACA_BROKER_API_KEY": "fixture-key", "ALPACA_BROKER_API_SECRET": "fixture-secret"})
}
func response(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": {"application/json"}, "X-Request-Id": {"fixture-request-1"}}, Body: io.NopCloser(strings.NewReader(body))}
}

const asset = `[{"id":"00000000-0000-0000-0000-000000000001","symbol":"TEST","name":"Isolated test equity","class":"us_equity","status":"active","tradable":true}]`

func TestDefaultAndInvalidConfigurationNeverCallsProvider(t *testing.T) {
	cases := []map[string]string{{}, {"FINANCE_TRADING_ENABLED": "true"}, {"FINANCE_TRADING_ENV": "live"}, {"YNX_CHAIN_ENV": "mainnet"}, {"YNX_EVM_CHAIN_ID": "1"}, {"FINANCE_LIVE_ENABLED": "true"}, {"ALPACA_BROKER_SANDBOX_BASE_URL": "https://paper-api.alpaca.markets"}, {"ALPACA_BROKER_SANDBOX_BASE_URL": BrokerOrigin + "/"}, {"ALPACA_BROKER_TOKEN_URL": "https://attacker.invalid"}, {"ALPACA_BROKER_AUTH_MODE": "private_key_jwt"}, {"ALPACA_BROKER_ACCOUNT_ID": "shared"}, {"FINANCE_SANDBOX_WRITES_ENABLED": "true"}, {"FINANCE_TRADING_ENABLED": "TRUE"}}
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
		if r.URL.Path != "/v1/accounts/00000000-0000-0000-0000-000000000001" {
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
func TestNoRedirectOrEnvironmentProxy(t *testing.T) {
	a := NewAlpaca(enabled("legacy_basic"))
	if a.client.Transport.(*http.Transport).Proxy != nil || a.client.CheckRedirect(nil, nil) != http.ErrUseLastResponse {
		t.Fatal("credential routing fence")
	}
}
