package main

import (
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"time"
)

func main() {
	addr := env("YNX_QUANT_WEB_ADDR", "127.0.0.1:6447")
	upstream, err := url.Parse(env("YNX_QUANT_API_URL", "http://127.0.0.1:6444"))
	if err != nil || (upstream.Scheme != "http" && upstream.Scheme != "https") || upstream.User != nil || upstream.RawQuery != "" || upstream.Fragment != "" {
		log.Fatal("YNX_QUANT_API_URL must be an HTTP(S) origin without credentials, query, or fragment")
	}
	proxy := httputil.NewSingleHostReverseProxy(upstream)
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, _ error) {
		http.Error(w, `{"error":"quant API unavailable"}`, http.StatusBadGateway)
	}
	mux := http.NewServeMux()
	mux.Handle("/api/", http.StripPrefix("/api", proxy))
	mux.Handle("/", http.FileServer(http.Dir(env("YNX_QUANT_WEB_ROOT", "apps/quant-lab/web"))))
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		mux.ServeHTTP(w, r)
	})
	server := &http.Server{Addr: addr, Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 20 * time.Second, IdleTimeout: 60 * time.Second}
	log.Printf("ynx-quant-web listening on %s", addr)
	log.Fatal(server.ListenAndServe())
}

func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
