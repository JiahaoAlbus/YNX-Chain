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
	"github.com/JiahaoAlbus/YNX-Chain/internal/explorer"
)

var (
	buildCommit  = "unknown"
	buildRelease = "local"
	buildTime    = "unknown"
)

func main() {
	httpAddr := flag.String("http", envOrDefault("YNX_EXPLORER_HTTP_ADDR", "127.0.0.1:6427"), "explorer HTTP listen address")
	rpcURL := flag.String("rpc", envOrDefault("YNX_EXPLORER_RPC_URL", "http://127.0.0.1:6420"), "YNX Chain RPC URL")
	indexerURL := flag.String("indexer", envOrDefault("YNX_EXPLORER_INDEXER_URL", "http://127.0.0.1:6426"), "YNX indexer URL")
	publicRPCURL := flag.String("public-rpc", envOrDefault("YNX_EXPLORER_PUBLIC_RPC_URL", ""), "wallet-visible HTTPS public RPC URL")
	publicExplorerURL := flag.String("public-url", envOrDefault("YNX_EXPLORER_PUBLIC_URL", ""), "wallet-visible HTTPS public explorer URL")
	maxConcurrent := flag.Int("max-concurrent", envIntOrDefault("YNX_EXPLORER_MAX_CONCURRENT", 64), "maximum concurrent non-stream HTTP requests")
	maxRequestsPerSec := flag.Int("max-requests-per-second", envIntOrDefault("YNX_EXPLORER_MAX_REQUESTS_PER_SECOND", 500), "global public HTTP request rate")
	maxStreamClients := flag.Int("max-stream-clients", envIntOrDefault("YNX_EXPLORER_MAX_STREAM_CLIENTS", 256), "maximum concurrent SSE clients")
	queueWait := flag.Duration("queue-wait", envDurationOrDefault("YNX_EXPLORER_QUEUE_WAIT", 150*time.Millisecond), "maximum bounded request queue wait")
	flag.Parse()

	service, err := explorer.New(explorer.Config{
		RPCURL:              *rpcURL,
		IndexerURL:          *indexerURL,
		PublicRPCURL:        *publicRPCURL,
		PublicExplorerURL:   *publicExplorerURL,
		ResourceUpstreamKey: os.Getenv("YNX_RESOURCE_GATEWAY_UPSTREAM_KEY"),
	})
	if err != nil {
		log.Fatal(err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	limits := explorer.Limits{MaxConcurrent: *maxConcurrent, MaxRequestsPerSec: *maxRequestsPerSec, MaxStreamClients: *maxStreamClients, QueueWait: *queueWait}
	// WriteTimeout stays disabled because SSE responses are intentionally long-lived;
	// per-request dependency timeouts and the bounded stream-client pool cap resources.
	srv := &http.Server{Addr: *httpAddr, Handler: explorer.NewServerWithBuildAndLimits(service, currentBuildInfo(), limits).Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 * 1024}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()

	log.Printf("YNX Explorer listening on http://%s with RPC %s and indexer %s", *httpAddr, *rpcURL, *indexerURL)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func currentBuildInfo() buildinfo.Info {
	return buildinfo.Normalize(buildinfo.Info{
		Commit:    strings.TrimSpace(buildCommit),
		Release:   strings.TrimSpace(buildRelease),
		BuildTime: strings.TrimSpace(buildTime),
	})
}

func envOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func envIntOrDefault(key string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(key)))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func envDurationOrDefault(key string, fallback time.Duration) time.Duration {
	value, err := time.ParseDuration(strings.TrimSpace(os.Getenv(key)))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}
