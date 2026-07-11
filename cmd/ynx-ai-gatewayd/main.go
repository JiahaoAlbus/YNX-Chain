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
	})
	if err != nil {
		log.Fatal(err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	srv := &http.Server{Addr: *httpAddr, Handler: aigateway.NewServerWithBuild(service, currentBuildInfo()).Handler(), ReadHeaderTimeout: 5 * time.Second}
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
