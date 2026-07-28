package main

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
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
	providerEventKey, providerEventKeys := providerEventVerificationConfig()
	var provider cardproduct.IssuerProvider = cardproduct.UnavailableProvider{ProviderName: env("YNX_CARD_PROVIDER_NAME", "unconfigured-issuer")}
	if env("YNX_CARD_PROVIDER_MODE", "unavailable") == "sandbox" {
		provider = cardproduct.NewSandboxProvider(nil)
	}
	var ai cardproduct.AIProvider
	if base := strings.TrimSpace(os.Getenv("YNX_CARD_AI_URL")); base != "" {
		ai = &cardproduct.HTTPAIProvider{BaseURL: base, APIKey: required("YNX_CARD_AI_KEY"), Model: required("YNX_CARD_AI_MODEL"), Client: &http.Client{Timeout: 60 * time.Second}}
	}
	service, err := cardproduct.New(cardproduct.Config{StorePath: required("YNX_CARD_PRODUCT_STORE"), IntegrityKey: integrity, GatewayKey: gateway, ProviderEventKey: providerEventKey, ProviderEventKeys: providerEventKeys, Provider: provider, AI: ai})
	if err != nil {
		log.Fatal(err)
	}
	addr := env("YNX_CARD_PRODUCT_ADDR", "127.0.0.1:6432")
	cardServer := cardproduct.NewServerWithObservability(service, buildinfo.Info{Commit: commit, Release: release, BuildTime: buildTime}, cardproduct.ObservabilityConfig{LogWriter: os.Stdout})
	server := &http.Server{Addr: addr, Handler: cardServer.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 75 * time.Second, IdleTimeout: 60 * time.Second}
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
func providerEventVerificationConfig() ([]byte, map[string][]byte) {
	keySetJSON := strings.TrimSpace(os.Getenv("YNX_CARD_PROVIDER_EVENT_KEYS_JSON"))
	if keySetJSON == "" {
		return decodeRequiredKey("YNX_CARD_PROVIDER_EVENT_KEY"), nil
	}
	if strings.TrimSpace(os.Getenv("YNX_CARD_PROVIDER_EVENT_KEY")) != "" {
		log.Fatal("configure either YNX_CARD_PROVIDER_EVENT_KEY or YNX_CARD_PROVIDER_EVENT_KEYS_JSON, not both")
	}
	keys, err := decodeKeySet(keySetJSON)
	if err != nil {
		log.Fatalf("YNX_CARD_PROVIDER_EVENT_KEYS_JSON: %v", err)
	}
	return nil, keys
}

func decodeKeySet(raw string) (map[string][]byte, error) {
	var encoded map[string]string
	if err := json.Unmarshal([]byte(raw), &encoded); err != nil {
		return nil, fmt.Errorf("must be one JSON object of key id to encoded key: %w", err)
	}
	if len(encoded) == 0 {
		return nil, fmt.Errorf("must contain at least one verification key")
	}
	keys := make(map[string][]byte, len(encoded))
	for keyID, value := range encoded {
		key, err := decodeKeyValue(value)
		if err != nil {
			return nil, fmt.Errorf("key %q: %w", keyID, err)
		}
		keys[keyID] = key
	}
	return keys, nil
}

func decodeRequiredKey(name string) []byte {
	raw, err := decodeKeyValue(required(name))
	if err != nil {
		log.Fatalf("%s: %v", name, err)
	}
	return raw
}

func decodeKeyValue(value string) ([]byte, error) {
	value = strings.TrimSpace(value)
	if raw, err := hex.DecodeString(strings.TrimPrefix(value, "0x")); err == nil && len(raw) >= 32 {
		return raw, nil
	}
	raw, err := base64.RawStdEncoding.DecodeString(value)
	if err != nil || len(raw) < 32 {
		return nil, fmt.Errorf("must be 32+ byte hex or raw base64")
	}
	return raw, nil
}
