package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/api"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func main() {
	httpAddr := flag.String("http", envOrDefault("YNX_HTTP_ADDR", "127.0.0.1:6420"), "HTTP listen address")
	network := flag.String("network", envOrDefault("YNX_NETWORK", "devnet"), "network slug")
	blockInterval := flag.Duration("block-interval", envDurationOrDefault("YNX_BLOCK_INTERVAL", 2*time.Second), "block production interval")
	dataDir := flag.String("data-dir", envOrDefault("YNX_DATA_DIR", ""), "optional local devnet state directory")
	flag.Parse()

	cfg := chain.DefaultNetworkConfig(*network)
	devnet, err := chain.NewPersistentDevnet(cfg, *dataDir)
	if err != nil {
		log.Fatal(err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	go devnet.Start(ctx, *blockInterval)

	srv := &http.Server{
		Addr:              *httpAddr,
		Handler:           api.NewServer(devnet),
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()

	log.Printf("YNX Chain %s listening on http://%s", cfg.Name, *httpAddr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func envOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
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
