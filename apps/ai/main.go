package main

import (
	"embed"
	"encoding/base64"
	"encoding/hex"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/aiproduct"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

var (
	buildCommit  = "unknown"
	buildRelease = "local"
	buildTime    = "unknown"
)

//go:embed web/*
var assets embed.FS

func main() {
	httpAddr := flag.String("http", env("YNX_AI_CLIENT_HTTP_ADDR", "127.0.0.1:6438"), "YNX AI client listen address")
	statePath := flag.String("state", env("YNX_AI_CLIENT_STATE_PATH", ""), "absolute encrypted product state path")
	flag.Parse()
	if *statePath == "" {
		log.Fatal("YNX_AI_CLIENT_STATE_PATH is required")
	}
	key, err := decodeKey(os.Getenv("YNX_AI_CLIENT_CONTENT_KEY"))
	if err != nil {
		log.Fatal(err)
	}
	store, err := aiproduct.NewStore(*statePath, key)
	if err != nil {
		log.Fatal(err)
	}
	web, err := fs.Sub(assets, "web")
	if err != nil {
		log.Fatal(err)
	}
	server, err := aiproduct.NewServer(aiproduct.Config{GatewayURL: env("YNX_AI_CLIENT_GATEWAY_URL", "http://127.0.0.1:6429"), GatewayKey: os.Getenv("YNX_AI_GATEWAY_API_KEY"), ExactWalletCallback: env("YNX_AI_CLIENT_WALLET_CALLBACK", "ynxai://wallet-auth/callback"), TrustURL: env("YNX_AI_CLIENT_TRUST_URL", "https://trust.ynxweb4.com/appeals"), ProviderName: env("YNX_AI_CLIENT_PROVIDER_NAME", "configured OpenAI-compatible provider"), InputUSDPerMillion: envFloat("YNX_AI_CLIENT_INPUT_USD_PER_MILLION"), OutputUSDPerMillion: envFloat("YNX_AI_CLIENT_OUTPUT_USD_PER_MILLION"), ResourceUnitsPerKTokens: envInt64("YNX_AI_CLIENT_RESOURCE_UNITS_PER_KTOKENS", 1), GenerationTimeout: envDuration("YNX_AI_CLIENT_GENERATION_TIMEOUT", 45*time.Second), Build: buildinfo.Info{Commit: buildCommit, Release: buildRelease, BuildTime: buildTime}, AllowLocalFixtureAuth: env("YNX_AI_ALLOW_LOCAL_FIXTURE_AUTH", "0") == "1"}, store, web)
	if err != nil {
		log.Fatal(err)
	}
	srv := &http.Server{Addr: *httpAddr, Handler: server.Handler(), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second}
	log.Printf("YNX AI client listening on http://%s; provider responses remain Gateway-backed only", *httpAddr)
	log.Fatal(srv.ListenAndServe())
}

func decodeKey(value string) ([]byte, error) {
	value = strings.TrimSpace(value)
	if raw, err := hex.DecodeString(strings.TrimPrefix(value, "0x")); err == nil && len(raw) == 32 {
		return raw, nil
	}
	raw, err := base64.RawStdEncoding.DecodeString(value)
	if err == nil && len(raw) == 32 {
		return raw, nil
	}
	return nil, &keyError{}
}

type keyError struct{}

func (*keyError) Error() string {
	return "YNX_AI_CLIENT_CONTENT_KEY must be 32 bytes encoded as hex or raw base64"
}
func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}
func envDuration(key string, fallback time.Duration) time.Duration {
	if v, err := time.ParseDuration(strings.TrimSpace(os.Getenv(key))); err == nil && v > 0 {
		return v
	}
	return fallback
}
func envInt64(key string, fallback int64) int64 {
	var v int64
	if _, err := fmt.Sscan(strings.TrimSpace(os.Getenv(key)), &v); err == nil && v > 0 {
		return v
	}
	return fallback
}
func envFloat(key string) float64 {
	var v float64
	_, _ = fmt.Sscan(strings.TrimSpace(os.Getenv(key)), &v)
	return v
}
