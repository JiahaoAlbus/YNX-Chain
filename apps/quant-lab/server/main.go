package main

import (
	"github.com/JiahaoAlbus/YNX-Chain/internal/quantlab"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

func main() {
	addr := env("YNX_QUANT_HTTP_ADDR", "127.0.0.1:6444")
	state := env("YNX_QUANT_STATE_PATH", ".ynx/quant-lab/state.json")
	var marketData quantlab.MarketData
	if endpoint := strings.TrimSpace(os.Getenv("YNX_QUANT_EXCHANGE_URL")); endpoint != "" {
		marketData = quantlab.HTTPExchangeMarketData{BaseURL: endpoint, Client: &http.Client{Timeout: 5 * time.Second}}
	}
	s, e := quantlab.New(quantlab.Config{StatePath: state, MarketData: marketData})
	if e != nil {
		log.Fatal(e)
	}
	mux := http.NewServeMux()
	mux.Handle("/api/", http.StripPrefix("/api", quantlab.NewServer(s)))
	mux.Handle("/", http.FileServer(http.Dir("apps/quant-lab/web")))
	srv := http.Server{Addr: addr, Handler: headers(mux), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 20 * time.Second}
	log.Printf("YNX Quant Lab simulated/testnet preview on %s", addr)
	log.Fatal(srv.ListenAndServe())
}
func env(k, v string) string {
	if x := strings.TrimSpace(os.Getenv(k)); x != "" {
		return x
	}
	return v
}
func headers(n http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'")
		w.Header().Set("Referrer-Policy", "no-referrer")
		n.ServeHTTP(w, r)
	})
}
