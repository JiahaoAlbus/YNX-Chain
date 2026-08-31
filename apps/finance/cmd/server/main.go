package main

import (
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/finance"
)

var buildCommit = "unknown"
var buildRelease = "local"
var buildTime = "unknown"

func main() {
	requireMultiInstance := envBool("YNX_FINANCE_REQUIRE_MULTI_INSTANCE", true)
	databaseURL := os.Getenv("YNX_FINANCE_DATABASE_URL")
	if requireMultiInstance && strings.TrimSpace(databaseURL) == "" {
		log.Fatal("YNX_FINANCE_DATABASE_URL is required when YNX_FINANCE_REQUIRE_MULTI_INSTANCE is enabled")
	}
	store, err := finance.OpenStoreWithDatabase(required("YNX_FINANCE_STATE_PATH"), databaseURL)
	if err != nil {
		log.Fatal(err)
	}
	upstreams, err := finance.NewUpstreams(required("YNX_EXPLORER_URL"), os.Getenv("YNX_PAY_URL"), os.Getenv("YNX_PAY_API_KEY"), required("YNX_FINANCE_DISPUTE_URL"))
	if err != nil {
		log.Fatal(err)
	}
	if err := upstreams.ConfigureReadSourceActions(finance.ReadSourceActionConfig{
		ExchangeURL:  os.Getenv("YNX_FINANCE_EXCHANGE_ACTION_URL"),
		DEXURL:       os.Getenv("YNX_FINANCE_DEX_ACTION_URL"),
		QuantURL:     os.Getenv("YNX_FINANCE_QUANT_ACTION_URL"),
		EconomicsURL: os.Getenv("YNX_FINANCE_ECONOMICS_ACTION_URL"),
	}); err != nil {
		log.Fatal(err)
	}
	if err := upstreams.ConfigureReadSourceIntegrations(finance.ReadSourceIntegrationConfig{
		ExchangeURL: os.Getenv("YNX_FINANCE_EXCHANGE_READ_URL"),
		ExchangeKey: os.Getenv("YNX_FINANCE_EXCHANGE_READ_KEY"),
		DEXURL:      os.Getenv("YNX_FINANCE_DEX_READ_URL"),
		DEXKey:      os.Getenv("YNX_FINANCE_DEX_READ_KEY"),
		QuantURL:    os.Getenv("YNX_FINANCE_QUANT_READ_URL"),
		QuantKey:    os.Getenv("YNX_FINANCE_QUANT_READ_KEY"),
	}); err != nil {
		log.Fatal(err)
	}
	auth, err := finance.NewAuthenticator(required("YNX_FINANCE_WALLET_GATEWAY_URL"), required("YNX_FINANCE_INTERNAL_KEY"), "ynx-finance-v1", "com.ynxweb4.finance")
	if err != nil {
		log.Fatal(err)
	}
	service := &finance.Service{Store: store, Upstreams: upstreams, AI: &finance.HTTPAIProvider{URL: os.Getenv("YNX_AI_GATEWAY_URL"), APIKey: os.Getenv("YNX_AI_GATEWAY_KEY")}, Support: finance.SupportLinks{HelpURL: required("YNX_FINANCE_HELP_URL"), PrivacyURL: required("YNX_FINANCE_PRIVACY_URL"), DisputeURL: required("YNX_FINANCE_DISPUTE_URL")}}
	webDir := os.Getenv("YNX_FINANCE_WEB_DIR")
	if webDir == "" {
		webDir = "apps/finance/web"
	}
	server, err := finance.NewServer(service, auth, finance.ServerConfig{AllowedOrigins: split(os.Getenv("YNX_FINANCE_ALLOWED_ORIGINS")), WebDir: webDir, CursorSigningKey: required("YNX_FINANCE_CURSOR_SIGNING_KEY"), OperationsKey: required("YNX_FINANCE_OPERATIONS_KEY"), WalletGatewayURL: required("YNX_FINANCE_WALLET_GATEWAY_URL"), LogWriter: os.Stdout, Build: buildinfo.Info{Commit: buildCommit, Release: buildRelease, BuildTime: buildTime}, RequireMultiInstance: requireMultiInstance})
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

func envBool(key string, fallback bool) bool {
	value := strings.TrimSpace(strings.ToLower(os.Getenv(key)))
	switch value {
	case "":
		return fallback
	case "1", "true", "yes":
		return true
	case "0", "false", "no":
		return false
	default:
		log.Fatalf("%s must be a boolean", key)
		return fallback
	}
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
