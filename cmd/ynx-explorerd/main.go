package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/explorer"
)

func main() {
	httpAddr := flag.String("http", envOrDefault("YNX_EXPLORER_HTTP_ADDR", "127.0.0.1:6427"), "explorer HTTP listen address")
	rpcURL := flag.String("rpc", envOrDefault("YNX_EXPLORER_RPC_URL", "http://127.0.0.1:6420"), "YNX Chain RPC URL")
	indexerURL := flag.String("indexer", envOrDefault("YNX_EXPLORER_INDEXER_URL", "http://127.0.0.1:6426"), "YNX indexer URL")
	publicRPCURL := flag.String("public-rpc", envOrDefault("YNX_EXPLORER_PUBLIC_RPC_URL", *rpcURL), "wallet-visible public RPC URL")
	publicExplorerURL := flag.String("public-url", envOrDefault("YNX_EXPLORER_PUBLIC_URL", "http://127.0.0.1:6427"), "wallet-visible public explorer URL")
	flag.Parse()

	service, err := explorer.New(explorer.Config{
		RPCURL:            *rpcURL,
		IndexerURL:        *indexerURL,
		PublicRPCURL:      *publicRPCURL,
		PublicExplorerURL: *publicExplorerURL,
	})
	if err != nil {
		log.Fatal(err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	srv := &http.Server{Addr: *httpAddr, Handler: explorer.NewServer(service).Handler(), ReadHeaderTimeout: 5 * time.Second}
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

func envOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
