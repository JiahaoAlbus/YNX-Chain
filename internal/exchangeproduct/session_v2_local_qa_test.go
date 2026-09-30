package exchangeproduct

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

// Opt-in isolated browser QA only. Canonical URLs, device proofs and the actual
// durable Gateway remain unchanged; only the loopback socket is substituted.
func TestLocalNodeHostExchangeBrowserBridge(t *testing.T) {
	endpoint := os.Getenv("YNX_EXCHANGE_QA_GATEWAY_LOOPBACK")
	if endpoint == "" {
		t.Skip("isolated QA Gateway not supplied")
	}
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Scheme != "http" || parsed.Hostname() != "127.0.0.1" || parsed.Port() == "" || parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.String() != endpoint {
		t.Fatal("invalid isolated QA socket")
	}
	service, api, _ := v2Server(t, func(r *http.Request) (*http.Response, error) {
		if r.URL.String() != exchangeSessionAuthority+"/v2/product-sessions/introspect" {
			return nil, fmt.Errorf("noncanonical QA authority request")
		}
		forward := r.Clone(r.Context())
		forward.URL.Scheme, forward.URL.Host, forward.Host = "http", parsed.Host, parsed.Host
		return http.DefaultTransport.RoundTrip(forward)
	})
	defer func() { _ = service.Close() }()
	stop := make(chan struct{}, 1)
	var mu sync.RWMutex
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/__qa_stop" {
			select {
			case stop <- struct{}{}:
			default:
			}
			w.WriteHeader(204)
			return
		}
		if r.Method == http.MethodPost && r.URL.Path == "/__qa_seed" {
			mu.Lock()
			defer mu.Unlock()
			var body struct {
				Account string `json:"account"`
				Amount  int64  `json:"amount"`
			}
			decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256))
			decoder.DisallowUnknownFields()
			if decoder.Decode(&body) != nil {
				http.Error(w, "invalid QA seed", 400)
				return
			}
			if body.Amount == 0 {
				body.Amount = 17
			}
			if body.Amount != 17 && body.Amount != 31 {
				http.Error(w, "invalid QA amount", 400)
				return
			}
			if _, err := service.CreditTestQuote("Bearer "+adminKey, body.Account, body.Amount*AmountScale, "isolated-hosted-credit-"+body.Account); err != nil {
				http.Error(w, "QA seed rejected", 400)
				return
			}
			w.WriteHeader(204)
			return
		}
		if r.Method == http.MethodPost && r.URL.Path == "/__qa_restart" {
			mu.Lock()
			defer mu.Unlock()
			cfg := service.cfg
			if service.Close() != nil {
				http.Error(w, "QA close failed", 500)
				return
			}
			next, err := New(cfg)
			if err != nil {
				http.Error(w, "QA reopen failed", 500)
				return
			}
			service = next
			api = NewServer(service)
			w.WriteHeader(204)
			return
		}
		mu.RLock()
		defer mu.RUnlock()
		if r.URL.Path == "/v1/account" {
			var proof map[string]any
			raw, _ := base64.RawURLEncoding.DecodeString(r.Header.Get("X-YNX-Product-Session-Proof-V2"))
			_ = json.Unmarshal(raw, &proof)
			var fields []string
			for key, value := range map[string]string{"productId": "exchange", "clientId": "ynx-exchange-v1", "applicationId": "com.ynxweb4.exchange.web", "origin": exchangeWebOrigin, "callback": exchangeWebOrigin + "/wallet-auth/callback"} {
				if proof[key] != value {
					fields = append(fields, key)
				}
			}
			for _, key := range []string{"bundleId", "packageId"} {
				value, exists := proof[key]
				if !exists || value != nil {
					fields = append(fields, key)
				}
			}
			if len(fields) > 0 {
				fmt.Printf("EXCHANGE_QA_POLICY_MISMATCH=%s\n", strings.Join(fields, ","))
			}
		}
		api.ServeHTTP(w, r)
	}))
	defer server.Close()
	fmt.Printf("EXCHANGE_QA_LISTEN=%s\n", server.URL)
	select {
	case <-stop:
	case <-time.After(60 * time.Second):
		t.Fatal("isolated Exchange QA did not stop")
	}
}
