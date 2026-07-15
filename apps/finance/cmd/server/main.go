package main

import (
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/finance"
)

func main() {
	store, err := finance.OpenStore(required("YNX_FINANCE_STATE_PATH"))
	if err != nil {
		log.Fatal(err)
	}
	upstreams, err := finance.NewUpstreams(required("YNX_EXPLORER_URL"), os.Getenv("YNX_PAY_URL"), os.Getenv("YNX_PAY_API_KEY"), required("YNX_FINANCE_DISPUTE_URL"))
	if err != nil {
		log.Fatal(err)
	}
	auth, err := finance.NewAuthenticator(required("YNX_FINANCE_WALLET_ASSERTION_SECRET"), required("YNX_FINANCE_WALLET_CLIENT_ID"), store)
	if err != nil {
		log.Fatal(err)
	}
	service := &finance.Service{Store: store, Upstreams: upstreams, AI: &finance.HTTPAIProvider{URL: os.Getenv("YNX_AI_GATEWAY_URL"), APIKey: os.Getenv("YNX_AI_GATEWAY_KEY")}, Support: finance.SupportLinks{HelpURL: required("YNX_FINANCE_HELP_URL"), PrivacyURL: required("YNX_FINANCE_PRIVACY_URL"), DisputeURL: required("YNX_FINANCE_DISPUTE_URL")}}
	webDir := os.Getenv("YNX_FINANCE_WEB_DIR")
	if webDir == "" {
		webDir = "apps/finance/web"
	}
	server, err := finance.NewServer(service, auth, finance.ServerConfig{WalletCallback: required("YNX_FINANCE_WALLET_CALLBACK"), WalletClientID: required("YNX_FINANCE_WALLET_CLIENT_ID"), AllowedOrigins: split(os.Getenv("YNX_FINANCE_ALLOWED_ORIGINS")), WebDir: webDir})
	if err != nil {
		log.Fatal(err)
	}
	httpServer := &http.Server{Addr: envDefault("YNX_FINANCE_LISTEN", "127.0.0.1:6436"), Handler: server.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 45 * time.Second, IdleTimeout: 60 * time.Second}
	log.Printf("YNX Finance listening on %s", httpServer.Addr)
	log.Fatal(httpServer.ListenAndServe())
}

func required(key string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		log.Fatalf("%s is required", key)
	}
	return value
}
func envDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
func split(value string) []string {
	out := []string{}
	for _, part := range strings.Split(value, ",") {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}
