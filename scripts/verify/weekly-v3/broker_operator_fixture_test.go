//go:build weekly_v3_integration

package main

// Shared command-package fixture. Every provider socket is TLS-pinned to this
// ephemeral loopback server; no official credential, DNS, or account is used.
import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/finance"
)

const weeklyOperatorAccount = "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"
const weeklyOperatorKey = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"

type weeklyOperatorProvider struct {
	mu                    sync.Mutex
	posts, deletes, reads int
	order                 map[string]any
	quoteStatus           int
}

func weeklyOperatorSetup(t *testing.T) (map[string]string, *finance.Store, *weeklyOperatorProvider) {
	t.Helper()
	statePath := filepath.Join(t.TempDir(), "finance.json")
	store, err := finance.OpenStore(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.PutBrokerSandboxMappingWithWalletKey(weeklyOperatorAccount, "01234567-89ab-4cde-8fab-0123456789ab", weeklyOperatorKey, time.Now()); err != nil {
		t.Fatal(err)
	}
	config := map[string]string{"YNX_FINANCE_STATE_PATH": statePath, "YNX_FINANCE_BROKER_VERIFY_ACCOUNT": weeklyOperatorAccount, "FINANCE_TRADING_ENABLED": "true", "FINANCE_SANDBOX_WRITES_ENABLED": "false", "FINANCE_SANDBOX_WRITE_ACTIVATION_RECEIPT_SHA256": strings.Repeat("a", 64), "ALPACA_BROKER_AUTH_MODE": "legacy_basic", "ALPACA_BROKER_API_KEY": "public-isolated-fixture", "ALPACA_BROKER_API_SECRET": "not-a-credential"}
	var raw map[string]json.RawMessage
	data, err := os.ReadFile(os.Getenv("WEEKLY_PROVIDER_FIXTURES"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatal(err)
	}
	var account map[string]any
	if err := json.Unmarshal(raw["tradingAccount"], &account); err != nil {
		t.Fatal(err)
	}
	account["id"] = "01234567-89ab-4cde-8fab-0123456789ab"
	var event map[string]any
	if err := json.Unmarshal(raw["tradeUpdateNew"], &event); err != nil {
		t.Fatal(err)
	}
	p := &weeklyOperatorProvider{}
	local := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p.mu.Lock()
		defer p.mu.Unlock()
		user, password, ok := r.BasicAuth()
		if !ok || user != config["ALPACA_BROKER_API_KEY"] || password != config["ALPACA_BROKER_API_SECRET"] {
			http.Error(w, "fixture authentication failed", 401)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Request-ID", "operator-loopback-fixture")
		switch {
		case r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/orders"):
			p.posts++
			var body map[string]any
			if json.NewDecoder(r.Body).Decode(&body) != nil {
				http.Error(w, "invalid", 400)
				return
			}
			for key, value := range event["order"].(map[string]any) {
				if _, found := body[key]; !found {
					body[key] = value
				}
			}
			body["id"] = "22222222-3333-4444-8555-666666666666"
			body["status"] = "accepted"
			body["filled_qty"] = "0"
			body["submitted_at"] = time.Now().UTC().Format(time.RFC3339Nano)
			p.order = body
			w.WriteHeader(201)
			_ = json.NewEncoder(w).Encode(body)
		case r.Method == "DELETE":
			p.deletes++
			if p.order != nil {
				p.order["status"] = "canceled"
			}
			w.WriteHeader(204)
		case r.Method == "GET":
			p.reads++
			switch {
			case r.URL.Path == "/v1/assets":
				_ = json.NewEncoder(w).Encode([]map[string]any{{"id": "11111111-2222-4333-8444-555555555555", "symbol": "ACME", "name": "Synthetic operator asset", "class": "us_equity", "status": "active", "tradable": true}})
			case r.URL.Path == "/v2/stocks/ACME/quotes/latest":
				if p.quoteStatus != 0 {
					http.Error(w, "synthetic entitlement failure", p.quoteStatus)
					return
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"symbol": "ACME", "quote": map[string]any{"ap": 125.34, "as": 100, "bp": 125.33, "bs": 100, "t": time.Now().UTC().Format(time.RFC3339Nano)}})
			case strings.HasSuffix(r.URL.Path, "/account"):
				_ = json.NewEncoder(w).Encode(account)
			case strings.HasSuffix(r.URL.Path, "/positions"):
				_ = json.NewEncoder(w).Encode([]any{})
			case strings.HasSuffix(r.URL.Path, "/orders"):
				orders := []any{}
				if p.order != nil {
					orders = append(orders, p.order)
				}
				_ = json.NewEncoder(w).Encode(orders)
			default:
				http.Error(w, "unexpected fixture read", 404)
			}
		default:
			http.Error(w, "unexpected fixture method", 405)
		}
	}))
	t.Cleanup(local.Close)
	transport := local.Client().Transport.(*http.Transport).Clone()
	transport.TLSClientConfig = transport.TLSClientConfig.Clone()
	transport.TLSClientConfig.ServerName = "example.com"
	transport.Proxy = nil
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		if address != "broker-api.sandbox.alpaca.markets:443" && address != "data.sandbox.alpaca.markets:443" {
			return nil, errors.New("operator fixture forbids remote network")
		}
		return (&net.Dialer{}).DialContext(ctx, "tcp", local.Listener.Addr().String())
	}
	original := http.DefaultTransport
	http.DefaultTransport = transport
	t.Cleanup(func() { http.DefaultTransport = original; transport.CloseIdleConnections() })
	return config, store, p
}
