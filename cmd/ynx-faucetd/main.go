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
	"github.com/JiahaoAlbus/YNX-Chain/internal/faucet"
)

var (
	buildCommit  = "unknown"
	buildRelease = "local"
	buildTime    = "unknown"
)

func main() {
	httpAddr := flag.String("http", envOrDefault("YNX_FAUCET_HTTP_ADDR", "127.0.0.1:6428"), "faucet HTTP listen address")
	rpcURL := flag.String("rpc", envOrDefault("YNX_FAUCET_RPC_URL", "http://127.0.0.1:6420"), "YNX Chain RPC URL")
	requestLog := flag.String("request-log", envOrDefault("YNX_FAUCET_REQUEST_LOG", "tmp/faucet/requests.jsonl"), "JSONL request log path")
	defaultAmount := flag.Int64("default-amount", envInt64OrDefault("YNX_FAUCET_DEFAULT_AMOUNT", 100), "default faucet amount")
	maxAmount := flag.Int64("max-amount", envInt64OrDefault("YNX_FAUCET_MAX_AMOUNT", 100), "max faucet amount")
	window := flag.Duration("rate-window", envDurationOrDefault("YNX_FAUCET_RATE_LIMIT_WINDOW", time.Hour), "rate limit window")
	maxRequests := flag.Int("rate-max", envIntOrDefault("YNX_FAUCET_RATE_LIMIT_MAX", 1), "max requests per IP/address in window")
	flag.Parse()

	service, err := faucet.New(faucet.Config{
		RPCURL:        *rpcURL,
		HTTPAddr:      *httpAddr,
		FaucetKey:     os.Getenv("FAUCET_PRIVATE_KEY"),
		DefaultAmount: *defaultAmount,
		MaxAmount:     *maxAmount,
		Window:        *window,
		MaxRequests:   *maxRequests,
		RequestLog:    *requestLog,
	})
	if err != nil {
		log.Fatal(err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	srv := &http.Server{Addr: *httpAddr, Handler: faucet.NewServerWithBuild(service, currentBuildInfo()).Handler(), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()
	log.Printf("YNX Faucet listening on http://%s and funding via %s", *httpAddr, *rpcURL)
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

func envInt64OrDefault(key string, fallback int64) int64 {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func envIntOrDefault(key string, fallback int) int {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envDurationOrDefault(key string, fallback time.Duration) time.Duration {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return fallback
	}
	return parsed
}
