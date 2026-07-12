package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/aigateway"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/mutationfreeze"
)

var (
	buildCommit  = "unknown"
	buildRelease = "local"
	buildTime    = "unknown"
)

func main() {
	httpAddr := flag.String("http", envOrDefault("YNX_AI_GATEWAY_HTTP_ADDR", "127.0.0.1:6429"), "AI Gateway HTTP listen address")
	chainURL := flag.String("chain", envOrDefault("YNX_AI_GATEWAY_CHAIN_URL", "http://127.0.0.1:6420"), "YNX Chain API URL")
	providerURL := flag.String("provider", envOrDefault("YNX_AI_PROVIDER_URL", "https://api.openai.com/v1"), "OpenAI-compatible provider base URL")
	model := flag.String("model", os.Getenv("AI_MODEL_NAME"), "AI provider model")
	auditLog := flag.String("audit-log", envOrDefault("YNX_AI_GATEWAY_AUDIT_LOG", "tmp/ai-gateway/audit.jsonl"), "AI Gateway JSONL audit log")
	window := flag.Duration("rate-window", envDurationOrDefault("YNX_AI_GATEWAY_RATE_LIMIT_WINDOW", time.Minute), "rate limit window")
	maxRequests := flag.Int("rate-max", envIntOrDefault("YNX_AI_GATEWAY_RATE_LIMIT_MAX", 30), "maximum requests per API key/IP in window")
	upstreamMode := flag.String("upstream-mode", envOrDefault("YNX_AI_GATEWAY_UPSTREAM_MODE", aigateway.UpstreamAuthoritative), "chain upstream mode: authoritative or bft")
	chainID := flag.Int64("chain-id", envInt64OrDefault("YNX_CHAIN_ID", 6423), "YNX BFT chain ID")
	flag.Parse()

	service, err := aigateway.New(aigateway.Config{
		ChainURL:       *chainURL,
		ProviderURL:    *providerURL,
		ProviderAPIKey: os.Getenv("OPENAI_API_KEY"),
		Model:          *model,
		AccessAPIKey:   os.Getenv("YNX_AI_GATEWAY_API_KEY"),
		UpstreamKey:    os.Getenv("YNX_AI_GATEWAY_UPSTREAM_KEY"),
		AuditLog:       *auditLog,
		Window:         *window,
		MaxRequests:    *maxRequests,
		UpstreamMode:   *upstreamMode,
		SignerKey:      os.Getenv("YNX_AI_GATEWAY_SIGNER_PRIVATE_KEY"),
		SignerKeyPath:  os.Getenv("YNX_AI_GATEWAY_SIGNER_PRIVATE_KEY_FILE"),
		SignerAddress:  os.Getenv("YNX_AI_GATEWAY_SIGNER_ADDRESS"),
		ChainID:        *chainID,
	})
	if err != nil {
		log.Fatal(err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	srv := &http.Server{Addr: *httpAddr, Handler: mutationfreeze.FromEnv(aigateway.NewServerWithBuild(service, currentBuildInfo()).Handler()), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()
	log.Printf("YNX AI Gateway listening on http://%s with chain %s and provider %s", *httpAddr, *chainURL, *providerURL)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func currentBuildInfo() buildinfo.Info {
	return buildinfo.Normalize(buildinfo.Info{Commit: strings.TrimSpace(buildCommit), Release: strings.TrimSpace(buildRelease), BuildTime: strings.TrimSpace(buildTime)})
}

func envOrDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func envDurationOrDefault(key string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envIntOrDefault(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envInt64OrDefault(key string, fallback int64) int64 {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return fallback
	}
	return parsed
}
