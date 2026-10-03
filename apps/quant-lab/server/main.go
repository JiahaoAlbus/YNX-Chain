package main

import (
	"context"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
	"github.com/JiahaoAlbus/YNX-Chain/internal/quantlab"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"
)

func main() {
	addr := env("YNX_QUANT_HTTP_ADDR", "127.0.0.1:6444")
	state := env("YNX_QUANT_STATE_PATH", ".ynx/quant-lab/state.json")
	databaseURL := strings.TrimSpace(os.Getenv("YNX_QUANT_DATABASE_URL"))
	stateNamespace := strings.TrimSpace(os.Getenv("YNX_QUANT_STATE_NAMESPACE"))
	if databaseURL != "" && stateNamespace == "" {
		log.Fatal("YNX_QUANT_STATE_NAMESPACE is required when YNX_QUANT_DATABASE_URL is configured")
	}
	var marketData quantlab.MarketData
	var mandateVerifier quantlab.MandateVerifier
	var testnetBroker quantlab.TestnetBroker
	var sessionCompleter quantlab.WalletSessionCompleter
	var privateSession quantlab.ProductSessionAuthorizer
	var browserSSO *productsessionv2.BrowserSSO
	centralEnabled, err := centralBrowserSSOEnabled(os.Getenv("YNX_QUANT_CENTRAL_BROWSER_SSO"))
	if err != nil {
		log.Fatal(err)
	}
	if centralEnabled {
		var err error
		browserSSO, err = productsessionv2.NewBrowserSSO("quant", quantlab.QuantPrivateAuthority, []byte(os.Getenv("YNX_QUANT_BROWSER_SSO_COOKIE_KEY")), []string{"research", "strategies", "experiments", "portfolio", "paper", "testnet", "risk", "audit"}, nil)
		if err != nil {
			log.Fatal("invalid Quant browser identity policy or durable cookie key")
		}
	}
	if os.Getenv("YNX_QUANT_PRIVATE_SESSION_V2_ENABLED") == "1" {
		client, err := quantlab.NewQuantPrivateSessionClient()
		if err != nil {
			log.Fatal("invalid fixed Quant private session policy")
		}
		privateSession = client
	}
	if endpoint := strings.TrimSpace(os.Getenv("YNX_QUANT_EXCHANGE_URL")); endpoint != "" {
		marketData = quantlab.HTTPExchangeMarketData{BaseURL: endpoint, Client: &http.Client{Timeout: 5 * time.Second}}
		adapter := quantlab.HTTPExchangeAdapter{BaseURL: endpoint, Client: &http.Client{Timeout: 8 * time.Second}}
		mandateVerifier = adapter
		testnetBroker = adapter
		sessionCompleter = adapter
	}
	s, e := quantlab.NewTenantServer(quantlab.Config{StatePath: state, FinanceReadKey: os.Getenv("YNX_QUANT_FINANCE_READ_KEY"), DatabaseURL: databaseURL, StateNamespace: stateNamespace, MarketData: marketData, MandateVerifier: mandateVerifier, TestnetBroker: testnetBroker, SessionCompleter: sessionCompleter, PrivateSession: privateSession, BrowserSSO: browserSSO}, "all")
	if e != nil {
		log.Fatal(e)
	}
	defer s.Close()
	mux := http.NewServeMux()
	registerFinanceOwnerRead(mux, s)
	if browserSSO != nil {
		mux.HandleFunc("GET /sso/start", browserSSO.Start)
		mux.HandleFunc("GET /sso/callback", browserSSO.Callback)
	}
	mux.Handle("/api/", http.StripPrefix("/api", s))
	mux.HandleFunc("/wallet-auth/callback", func(w http.ResponseWriter, r *http.Request) { http.ServeFile(w, r, "apps/quant-lab/web/index.html") })
	mux.HandleFunc("/wallet-action/callback", func(w http.ResponseWriter, r *http.Request) { http.ServeFile(w, r, "apps/quant-lab/web/index.html") })
	mux.Handle("/", http.FileServer(http.Dir("apps/quant-lab/web")))
	srv := http.Server{Addr: addr, Handler: headers(mux), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 20 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	schedulerDone := s.StartScheduler(ctx, 5*time.Second)
	// Registered after the service Close defer: cancel and join the research
	// worker before its shared database pool is closed on normal shutdown.
	defer func() { stop(); <-schedulerDone }()
	log.Printf("YNX Quant Lab simulated/testnet preview on %s", addr)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		log.Print("Quant listener unavailable")
		return
	}
	if err := serveUntilShutdown(ctx, &srv, listener, 10*time.Second); err != nil {
		log.Print("Quant HTTP server stopped with an error")
	}
}

// Serve returning ErrServerClosed does not mean Shutdown has drained handlers.
// Join both shutdown and admitted handlers before callers close their storage.
func serveUntilShutdown(ctx context.Context, srv *http.Server, listener net.Listener, grace time.Duration) error {
	var requests sync.WaitGroup
	var admission sync.Mutex
	closed := false
	handler := srv.Handler
	srv.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		admission.Lock()
		if closed {
			admission.Unlock()
			http.Error(w, "Service shutting down", http.StatusServiceUnavailable)
			return
		}
		requests.Add(1)
		admission.Unlock()
		defer requests.Done()
		handler.ServeHTTP(w, r)
	})
	srv.BaseContext = func(net.Listener) context.Context { return ctx }
	served := make(chan error, 1)
	go func() { served <- srv.Serve(listener) }()
	var serveErr error
	select {
	case <-ctx.Done():
	case serveErr = <-served:
	}
	shutdown, cancel := context.WithTimeout(context.Background(), grace)
	defer cancel()
	shutdownErr := srv.Shutdown(shutdown)
	if shutdownErr != nil {
		_ = srv.Close()
	}
	if serveErr == nil {
		serveErr = <-served
	}
	admission.Lock()
	closed = true
	admission.Unlock()
	requests.Wait()
	if serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
		return serveErr
	}
	return shutdownErr
}
func registerFinanceOwnerRead(mux *http.ServeMux, api http.Handler) {
	mux.Handle(quantlab.FinanceReadRoute, api)
}
func env(k, v string) string {
	if x := strings.TrimSpace(os.Getenv(k)); x != "" {
		return x
	}
	return v
}
func centralBrowserSSOEnabled(value string) (bool, error) {
	switch value {
	case "", "false":
		return false, nil
	case "true":
		return true, nil
	default:
		return false, errors.New("YNX_QUANT_CENTRAL_BROWSER_SSO must be true or false")
	}
}

func headers(n http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || r.URL.Path == "/index.html" || r.URL.Path == "/wallet-auth/callback" || r.URL.Path == "/wallet-action/callback" {
			w.Header().Set("Cache-Control", "no-store")
		}
		w.Header().Set("Content-Security-Policy", "default-src 'self'; connect-src 'self' https://wallet-auth.ynxweb4.com; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'")
		w.Header().Set("Referrer-Policy", "no-referrer")
		n.ServeHTTP(w, r)
	})
}
