package main

import (
	"context"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/quantlab"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
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
	s, e := quantlab.NewTenantServer(quantlab.Config{StatePath: state, FinanceReadKey: os.Getenv("YNX_QUANT_FINANCE_READ_KEY"), DatabaseURL: databaseURL, StateNamespace: stateNamespace, MarketData: marketData, MandateVerifier: mandateVerifier, TestnetBroker: testnetBroker, SessionCompleter: sessionCompleter, PrivateSession: privateSession}, "all")
	if e != nil {
		log.Fatal(e)
	}
	defer s.Close()
	mux := http.NewServeMux()
	registerFinanceOwnerRead(mux, s)
	mux.Handle("/api/", http.StripPrefix("/api", s))
	mux.HandleFunc("/wallet-auth/callback", func(w http.ResponseWriter, r *http.Request) { http.ServeFile(w, r, "apps/quant-lab/web/index.html") })
	mux.HandleFunc("/wallet-action/callback", func(w http.ResponseWriter, r *http.Request) { http.ServeFile(w, r, "apps/quant-lab/web/index.html") })
	mux.Handle("/", http.FileServer(http.Dir("apps/quant-lab/web")))
	srv := http.Server{Addr: addr, Handler: headers(mux), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 20 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	s.StartScheduler(ctx, 5*time.Second)
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()
	log.Printf("YNX Quant Lab simulated/testnet preview on %s", addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
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
func headers(n http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'self'; connect-src 'self' https://wallet-auth.ynxweb4.com; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'")
		w.Header().Set("Referrer-Policy", "no-referrer")
		n.ServeHTTP(w, r)
	})
}
