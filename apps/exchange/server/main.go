package main

import (
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/exchangeproduct"
)

func main() {
	addr := env("YNX_EXCHANGE_HTTP_ADDR", "127.0.0.1:6442")
	state := env("YNX_EXCHANGE_STATE_PATH", ".ynx/exchange/state.json")
	apiKey := strings.TrimSpace(os.Getenv("YNX_EXCHANGE_ADMIN_API_KEY"))
	if len(apiKey) < 16 {
		log.Fatal("YNX_EXCHANGE_ADMIN_API_KEY of at least 16 characters is required")
	}
	callback := env("YNX_EXCHANGE_WALLET_CALLBACK", "ynxexchange://wallet/callback")
	var chain exchangeproduct.ChainReader
	if u := strings.TrimSpace(os.Getenv("YNX_EXCHANGE_INDEXER_URL")); u != "" {
		chain = exchangeproduct.IndexerChainReader{BaseURL: u, Client: &http.Client{Timeout: 5 * time.Second}}
	}
	service, err := exchangeproduct.New(exchangeproduct.Config{StatePath: state, APIKey: apiKey, WalletCallback: callback, CustodyAddress: strings.TrimSpace(os.Getenv("YNX_EXCHANGE_CUSTODY_ADDRESS")), RequiredConfirmations: int64(envInt("YNX_EXCHANGE_CONFIRMATIONS", 12)), MakerFeeBPS: int64(envInt("YNX_EXCHANGE_MAKER_FEE_BPS", 10)), TakerFeeBPS: int64(envInt("YNX_EXCHANGE_TAKER_FEE_BPS", 20)), WithdrawalFeeMicroYNXT: int64(envInt("YNX_EXCHANGE_WITHDRAWAL_FEE_MICRO", 10000)), Chain: chain})
	if err != nil {
		log.Fatal(err)
	}
	api := exchangeproduct.NewServer(service)
	mux := http.NewServeMux()
	mux.Handle("/api/", http.StripPrefix("/api", api))
	mux.Handle("/", spa(http.Dir("apps/exchange/web")))
	server := &http.Server{Addr: addr, Handler: securityHeaders(mux), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	log.Printf("YNX Exchange testnet venue listening on %s", addr)
	log.Fatal(server.ListenAndServe())
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
