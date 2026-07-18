package main

import (
	"context"
	"encoding/base64"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/dex"
)

var buildCommit = "unknown"
var buildRelease = "local"
var buildTime = "unknown"

func main() {
	stateSecret, err := base64.RawStdEncoding.DecodeString(os.Getenv("YNX_DEX_STATE_HMAC_SECRET"))
	if err != nil {
		log.Fatal("YNX_DEX_STATE_HMAC_SECRET must be unpadded base64")
	}
	store, err := dex.OpenStore(env("YNX_DEX_STATE_PATH", "tmp/dex/indexer-state.json"), stateSecret)
	if err != nil {
		log.Fatal(err)
	}
	authorizer := dex.SessionAuthorizer(dex.UnavailableAuthorizer{})
	if endpoint := strings.TrimSpace(os.Getenv("YNX_DEX_WALLET_INTROSPECTION_URL")); endpoint != "" {
		authorizer = dex.RemoteAuthorizer{URL: endpoint}
	}
	server, err := dex.NewServer(store, buildinfo.Info{Commit: buildCommit, Release: buildRelease, BuildTime: buildTime}, os.Getenv("YNX_DEX_INDEXER_INGESTION_KEY"), authorizer)
	if err != nil {
		log.Fatal(err)
	}
	httpServer := &http.Server{Addr: env("YNX_DEX_HTTP_ADDR", "127.0.0.1:6436"), Handler: server.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 30 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutdown)
	}()
	log.Printf("YNX DEX Indexer API listening on %s", httpServer.Addr)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
