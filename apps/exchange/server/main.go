package main

import (
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/exchangeproduct"
)

func main() {
	addr := env("YNX_EXCHANGE_HTTP_ADDR", "127.0.0.1:6442")
	state := env("YNX_EXCHANGE_STATE_PATH", ".ynx/exchange/state.json")
	databaseURL := strings.TrimSpace(os.Getenv("YNX_EXCHANGE_DATABASE_URL"))
	apiKey := strings.TrimSpace(os.Getenv("YNX_EXCHANGE_ADMIN_API_KEY"))
	if len(apiKey) < 16 {
		log.Fatal("YNX_EXCHANGE_ADMIN_API_KEY of at least 16 characters is required")
	}
	callback := env("YNX_EXCHANGE_WALLET_CALLBACK", "ynxexchange://wallet/callback")
	var chain exchangeproduct.ChainReader
	if u := strings.TrimSpace(os.Getenv("YNX_EXCHANGE_INDEXER_URL")); u != "" {
		chain = exchangeproduct.IndexerChainReader{BaseURL: u, Client: &http.Client{Timeout: 5 * time.Second}}
	}
	gatewayURL := strings.TrimSpace(os.Getenv("YNX_EXCHANGE_GATEWAY_URL"))
	var gateway exchangeproduct.GatewayAuthorizer
	if gatewayURL != "" {
		gateway = exchangeproduct.HTTPGatewayAuthorizer{BaseURL: gatewayURL, Client: &http.Client{Timeout: 5 * time.Second}}
	}
	service, err := exchangeproduct.New(exchangeproduct.Config{StatePath: state, DatabaseURL: databaseURL, APIKey: apiKey, WalletCallback: callback, CustodyAddress: strings.TrimSpace(os.Getenv("YNX_EXCHANGE_CUSTODY_ADDRESS")), GatewayURL: gatewayURL, GatewayClientID: strings.TrimSpace(os.Getenv("YNX_EXCHANGE_GATEWAY_CLIENT_ID")), Gateway: gateway, IndexerURL: strings.TrimSpace(os.Getenv("YNX_EXCHANGE_INDEXER_URL")), RequiredConfirmations: int64(envInt("YNX_EXCHANGE_CONFIRMATIONS", 12)), MakerFeeBPS: int64(envInt("YNX_EXCHANGE_MAKER_FEE_BPS", 10)), TakerFeeBPS: int64(envInt("YNX_EXCHANGE_TAKER_FEE_BPS", 20)), WithdrawalFeeMicroYNXT: envInt64("YNX_EXCHANGE_WITHDRAWAL_FEE_MICRO", 10000), MaxOrderNotionalMicro: envInt64("YNX_EXCHANGE_MAX_ORDER_NOTIONAL_MICRO", 100_000*exchangeproduct.AmountScale), MaxWithdrawalMicro: envInt64("YNX_EXCHANGE_MAX_WITHDRAWAL_MICRO", 25_000*exchangeproduct.AmountScale), Chain: chain})
	if err != nil {
		log.Fatal(err)
	}
	defer service.Close()
	api := exchangeproduct.NewServer(service)
	mux := http.NewServeMux()
	mux.Handle("/api/", http.StripPrefix("/api", api))
	mux.Handle("/", spa(http.Dir("apps/exchange/web")))
	server := &http.Server{Addr: addr, Handler: securityHeaders(newAdmission(128, 600, time.Minute).wrap(mux)), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	log.Printf("YNX Exchange testnet venue listening on %s", addr)
	log.Fatal(server.ListenAndServe())
}

type rateWindow struct {
	count int
	reset time.Time
}

type admission struct {
	slots   chan struct{}
	limit   int
	window  time.Duration
	now     func() time.Time
	mu      sync.Mutex
	clients map[string]rateWindow
}

func newAdmission(maxConcurrent, limit int, window time.Duration) *admission {
	return &admission{slots: make(chan struct{}, maxConcurrent), limit: limit, window: window, now: time.Now, clients: map[string]rateWindow{}}
}

func (a *admission) wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		client := requestClient(r)
		if !a.allow(client) {
			w.Header().Set("Retry-After", "60")
			http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
			return
		}
		select {
		case a.slots <- struct{}{}:
			defer func() { <-a.slots }()
			next.ServeHTTP(w, r)
		default:
			w.Header().Set("Retry-After", "1")
			http.Error(w, "service busy", http.StatusServiceUnavailable)
		}
	})
}

func (a *admission) allow(client string) bool {
	now := a.now()
	a.mu.Lock()
	defer a.mu.Unlock()
	entry, ok := a.clients[client]
	if !ok || !now.Before(entry.reset) {
		a.clients[client] = rateWindow{count: 1, reset: now.Add(a.window)}
		return true
	}
	if entry.count >= a.limit {
		return false
	}
	entry.count++
	a.clients[client] = entry
	return true
}

func requestClient(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	if ip != nil && ip.IsLoopback() {
		if forwarded := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-For"), ",")[0]); net.ParseIP(forwarded) != nil {
			return forwarded
		}
	}
	if ip != nil {
		return ip.String()
	}
	return "unknown"
}

func env(k, v string) string {
	if x := strings.TrimSpace(os.Getenv(k)); x != "" {
		return x
	}
	return v
}
func envInt(k string, v int) int {
	if x := strings.TrimSpace(os.Getenv(k)); x != "" {
		if n, e := strconv.Atoi(x); e == nil {
			return n
		}
	}
	return v
}
func envInt64(k string, v int64) int64 {
	if x := strings.TrimSpace(os.Getenv(k)); x != "" {
		if n, e := strconv.ParseInt(x, 10, 64); e == nil {
			return n
		}
	}
	return v
}
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'self'; connect-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		next.ServeHTTP(w, r)
	})
}
func spa(root http.FileSystem) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f, err := root.Open(r.URL.Path)
		if err == nil {
			if info, e := f.Stat(); e == nil && !info.IsDir() {
				f.Close()
				http.FileServer(root).ServeHTTP(w, r)
				return
			}
			f.Close()
		}
		r.URL.Path = "/"
		http.FileServer(root).ServeHTTP(w, r)
	})
}
