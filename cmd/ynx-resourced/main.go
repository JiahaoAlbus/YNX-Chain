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
	"github.com/JiahaoAlbus/YNX-Chain/internal/resourcegateway"
)

var (
	buildCommit  = "unknown"
	buildRelease = "local"
	buildTime    = "unknown"
)

func main() {
	httpAddr := flag.String("http", envOrDefault("YNX_RESOURCE_GATEWAY_HTTP_ADDR", "127.0.0.1:6432"), "Resource Gateway HTTP listen address")
	chainURL := flag.String("chain", envOrDefault("YNX_RESOURCE_GATEWAY_CHAIN_URL", "http://127.0.0.1:6420"), "YNX Chain API URL")
	auditLog := flag.String("audit-log", envOrDefault("YNX_RESOURCE_GATEWAY_AUDIT_LOG", "tmp/resource-gateway/audit.jsonl"), "Resource Gateway JSONL audit log")
	window := flag.Duration("rate-window", envDurationOrDefault("YNX_RESOURCE_GATEWAY_RATE_LIMIT_WINDOW", time.Minute), "rate limit window")
	maxRequests := flag.Int("rate-max", envIntOrDefault("YNX_RESOURCE_GATEWAY_RATE_LIMIT_MAX", 60), "maximum requests per API key/IP in window")
	flag.Parse()
	service, err := resourcegateway.New(resourcegateway.Config{ChainURL: *chainURL, APIKey: os.Getenv("YNX_RESOURCE_API_KEY"), UpstreamKey: os.Getenv("YNX_RESOURCE_GATEWAY_UPSTREAM_KEY"), AuditLog: *auditLog, Window: *window, MaxRequests: *maxRequests})
	if err != nil {
		log.Fatal(err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	srv := &http.Server{Addr: *httpAddr, Handler: resourcegateway.NewServerWithBuild(service, currentBuildInfo()).Handler(), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()
	log.Printf("YNX Resource Gateway listening on http://%s with chain %s", *httpAddr, *chainURL)
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
