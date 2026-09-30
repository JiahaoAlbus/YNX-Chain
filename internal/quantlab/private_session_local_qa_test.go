package quantlab

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

type quantBrowserQAMarket struct{}

func (quantBrowserQAMarket) History(string, int) ([]Bar, string, error) {
	return bars(), "fixture://synthetic-local-browser-only", nil
}
func (quantBrowserQAMarket) Latest(string) (MarketTick, error) {
	return MarketTick{Price: 1_200_000, Volume: 20_000_000, Source: "fixture://synthetic-local-browser-only"}, nil
}

// Opt-in isolated real Gateway/device-proof browser QA. The original service
// creates test records using existing APIs and explicit test mandate/broker
// doubles; this never proves a real execution or public Wallet acceptance.
func TestLocalNodeHostQuantBrowserBridge(t *testing.T) {
	endpoint := os.Getenv("YNX_QUANT_QA_GATEWAY_LOOPBACK")
	if endpoint == "" {
		t.Skip("isolated QA Gateway not supplied")
	}
	socket, err := url.Parse(endpoint)
	if err != nil || socket.Scheme != "http" || socket.Hostname() != "127.0.0.1" || socket.Port() == "" || socket.User != nil || socket.Path != "" || socket.RawQuery != "" || socket.Fragment != "" || socket.String() != endpoint {
		t.Fatal("invalid isolated QA socket")
	}
	native, err := productsessionv2.NewClient(QuantPrivateAuthority, QuantPrivateSessionPolicy(), privateRoundTrip(func(r *http.Request) (*http.Response, error) {
		if r.URL.String() != QuantPrivateAuthority+"/v2/product-sessions/introspect" {
			return nil, fmt.Errorf("noncanonical QA authority request")
		}
		forward := r.Clone(r.Context())
		forward.URL.Scheme, forward.URL.Host, forward.Host = "http", socket.Host, socket.Host
		return http.DefaultTransport.RoundTrip(forward)
	}))
	if err != nil {
		t.Fatal(err)
	}
	config := Config{StatePath: filepath.Join(t.TempDir(), "state.json"), PrivateSession: native, MandateVerifier: allowMandate{}, TestnetBroker: testBroker{}, MarketData: quantBrowserQAMarket{}}
	service, err := NewTenantServer(config, "all")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = service.Close() }()
	var mu sync.RWMutex
	stop := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" && r.URL.Path == "/__qa_stop" {
			select {
			case stop <- struct{}{}:
			default:
			}
			w.WriteHeader(204)
			return
		}
		if r.Method == "POST" && r.URL.Path == "/__qa_restart" {
			mu.Lock()
			defer mu.Unlock()
			if service.Close() != nil {
				http.Error(w, "QA close failed", 500)
				return
			}
			next, e := NewTenantServer(config, "all")
			if e != nil {
				http.Error(w, "QA reopen failed", 500)
				return
			}
			service = next
			w.WriteHeader(204)
			return
		}
		if r.Method == "POST" && r.URL.Path == "/__qa_seed" {
			mu.Lock()
			defer mu.Unlock()
			var body struct {
				Account string `json:"account"`
				Index   int    `json:"index"`
			}
			decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256))
			decoder.DisallowUnknownFields()
			if decoder.Decode(&body) != nil || !strings.HasPrefix(body.Account, "ynx1") || len(body.Account) != 42 || body.Index < 0 || body.Index > 1 {
				http.Error(w, "invalid QA seed", 400)
				return
			}
			cfg := config
			cfg.StatePath = filepath.Join(service.root, strings.Repeat([]string{"e", "f"}[body.Index], 64)+".json")
			seed, e := New(cfg)
			if e != nil {
				http.Error(w, "QA seed unavailable", 500)
				return
			}
			defer seed.Close()
			experiment, e := seed.RunBacktest(request())
			if e != nil {
				http.Error(w, "QA backtest rejected", 500)
				return
			}
			mandate := validMandate(time.Now().UTC(), experiment.Strategy.StrategyHash)
			mandate.Account = body.Account
			mandate.MaxDailyLoss = int64(100 + body.Index)
			registered, e := seed.RegisterMandate(mandate)
			if e != nil {
				http.Error(w, "QA mandate rejected", 500)
				return
			}
			if _, e = seed.SubmitTestnetWithSession(context.Background(), registered.Digest, "buy", 1_000_000, 1, "isolated-record-seed", "wallet-order-signature", "one-time-session", validRisk(time.Now().UTC())); e != nil {
				http.Error(w, "QA execution seed rejected", 500)
				return
			}
			w.WriteHeader(204)
			return
		}
		mu.RLock()
		defer mu.RUnlock()
		service.ServeHTTP(w, r)
	}))
	defer server.Close()
	fmt.Printf("QUANT_QA_LISTEN=%s\n", server.URL)
	select {
	case <-stop:
	case <-time.After(60 * time.Second):
		t.Fatal("isolated Quant QA did not stop")
	}
}
