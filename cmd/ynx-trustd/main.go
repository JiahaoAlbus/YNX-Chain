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

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/trustgateway"
)

var (
	buildCommit  = "unknown"
	buildRelease = "local"
	buildTime    = "unknown"
)

func main() {
	httpAddr := flag.String("http", envOrDefault("YNX_TRUST_GATEWAY_HTTP_ADDR", "127.0.0.1:6431"), "Trust Gateway HTTP listen address")
	chainURL := flag.String("chain", envOrDefault("YNX_TRUST_GATEWAY_CHAIN_URL", "http://127.0.0.1:6420"), "YNX Chain API URL")
	auditLog := flag.String("audit-log", envOrDefault("YNX_TRUST_GATEWAY_AUDIT_LOG", "tmp/trust-gateway/audit.jsonl"), "Trust Gateway JSONL audit log")
	window := flag.Duration("rate-window", envDurationOrDefault("YNX_TRUST_GATEWAY_RATE_LIMIT_WINDOW", time.Minute), "rate limit window")
	maxRequests := flag.Int("rate-max", envIntOrDefault("YNX_TRUST_GATEWAY_RATE_LIMIT_MAX", 60), "maximum requests per API key/IP in window")
	upstreamMode := flag.String("upstream-mode", envOrDefault("YNX_TRUST_GATEWAY_UPSTREAM_MODE", trustgateway.UpstreamAuthoritative), "chain upstream mode: authoritative or bft")
	chainID := flag.Int64("chain-id", envInt64OrDefault("YNX_CHAIN_ID", 6423), "YNX BFT chain ID")
	flag.Parse()
	service, err := trustgateway.New(trustgateway.Config{ChainURL: *chainURL, APIKey: os.Getenv("YNX_TRUST_API_KEY"), UpstreamKey: os.Getenv("YNX_TRUST_GATEWAY_UPSTREAM_KEY"), AuditLog: *auditLog, Window: *window, MaxRequests: *maxRequests, UpstreamMode: *upstreamMode, SignerKey: os.Getenv("YNX_TRUST_GATEWAY_SIGNER_PRIVATE_KEY"), SignerKeyPath: os.Getenv("YNX_TRUST_GATEWAY_SIGNER_PRIVATE_KEY_FILE"), SignerAddress: os.Getenv("YNX_TRUST_GATEWAY_SIGNER_ADDRESS"), ChainID: *chainID})
	if err != nil {
		log.Fatal(err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	srv := &http.Server{Addr: *httpAddr, Handler: trustgateway.NewServerWithBuild(service, currentBuildInfo()).Handler(), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()
	log.Printf("YNX Trust Gateway listening on http://%s with chain %s", *httpAddr, *chainURL)
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
