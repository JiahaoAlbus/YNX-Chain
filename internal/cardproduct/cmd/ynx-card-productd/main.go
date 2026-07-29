package main

import (
	"encoding/base64"
	"encoding/hex"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/cardproduct"
)

var commit = "unknown"
var release = "local"
var buildTime = "unknown"

func main() {
	integrity := decodeRequiredKey("YNX_CARD_PRODUCT_INTEGRITY_KEY")
	gateway := decodeRequiredKey("YNX_CARD_PRODUCT_GATEWAY_ASSERTION_KEY")
	providerEvents := decodeRequiredKey("YNX_CARD_PROVIDER_EVENT_KEY")
	var provider cardproduct.IssuerProvider = cardproduct.UnavailableProvider{ProviderName: env("YNX_CARD_PROVIDER_NAME", "unconfigured-issuer")}
	if env("YNX_CARD_PROVIDER_MODE", "unavailable") == "sandbox" {
		provider = cardproduct.NewSandboxProvider(nil)
	}
	var ai cardproduct.AIProvider
	if base := strings.TrimSpace(os.Getenv("YNX_CARD_AI_URL")); base != "" {
		ai = &cardproduct.HTTPAIProvider{BaseURL: base, APIKey: required("YNX_CARD_AI_KEY"), Model: required("YNX_CARD_AI_MODEL"), Client: &http.Client{Timeout: 60 * time.Second}}
	}
	service, err := cardproduct.New(cardproduct.Config{StorePath: required("YNX_CARD_PRODUCT_STORE"), IntegrityKey: integrity, GatewayKey: gateway, ProviderEventKey: providerEvents, Provider: provider, AI: ai})
	if err != nil {
		log.Fatal(err)
	}
	addr := env("YNX_CARD_PRODUCT_ADDR", "127.0.0.1:6432")
	server := &http.Server{Addr: addr, Handler: cardproduct.NewServer(service, buildinfo.Info{Commit: commit, Release: release, BuildTime: buildTime}).Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 75 * time.Second, IdleTimeout: 60 * time.Second}
	log.Printf("ynx-card-productd listening on %s mode=%s", addr, env("YNX_CARD_PROVIDER_MODE", "unavailable"))
	log.Fatal(server.ListenAndServe())
}
func required(name string) string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		log.Fatalf("%s is required", name)
	}
	return value
}
func env(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}
func decodeRequiredKey(name string) []byte {
	value := required(name)
	if raw, err := hex.DecodeString(strings.TrimPrefix(value, "0x")); err == nil && len(raw) >= 32 {
		return raw
	}
	raw, err := base64.RawStdEncoding.DecodeString(value)
	if err != nil || len(raw) < 32 {
		log.Fatalf("%s must be 32+ byte hex or raw base64", name)
	}
	return raw
}
