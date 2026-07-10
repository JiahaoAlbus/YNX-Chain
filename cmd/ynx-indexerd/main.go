package main

import (
	"context"
	"encoding/json"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/indexer"
)

var (
	buildCommit  = "unknown"
	buildRelease = "local"
	buildTime    = "unknown"
)

func main() {
	rpcURL := flag.String("rpc", envOrDefault("YNX_INDEXER_RPC_URL", "http://127.0.0.1:6420"), "YNX Chain RPC URL")
	httpAddr := flag.String("http", envOrDefault("YNX_INDEXER_HTTP_ADDR", "127.0.0.1:6426"), "indexer HTTP listen address")
	storePath := flag.String("db", envOrDefault("YNX_INDEXER_DB_PATH", "tmp/indexer/indexer-db.json"), "local index database path")
	pollInterval := flag.Duration("poll-interval", envDurationOrDefault("YNX_INDEXER_POLL_INTERVAL", 2*time.Second), "RPC polling interval")
	once := flag.Bool("once", false, "run one sync cycle and exit")
	flag.Parse()

	idx, err := indexer.New(indexer.Config{RPCURL: *rpcURL, StorePath: *storePath})
	if err != nil {
		log.Fatal(err)
	}
	server := indexer.NewServerWithBuild(idx, currentBuildInfo())
	if *once {
		result, err := server.SyncOnce(context.Background())
		if err != nil {
			log.Fatal(err)
		}
		_ = json.NewEncoder(os.Stdout).Encode(result)
		return
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	go server.StartPolling(ctx, *pollInterval)

	srv := &http.Server{Addr: *httpAddr, Handler: server.Handler(), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()

	log.Printf("YNX Indexer listening on http://%s and syncing %s", *httpAddr, *rpcURL)
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
