package main

import (
	"bytes"
	"context"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/bundler"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

var (
	buildCommit  = "unknown"
	buildRelease = "local"
	buildTime    = "unknown"
)

func main() {
	address := flag.String("http", env("YNX_BUNDLER_HTTP_ADDR", "127.0.0.1:6428"), "Bundler HTTP listen address")
	gateway := flag.String("gateway", env("YNX_BUNDLER_GATEWAY_URL", "http://127.0.0.1:27620"), "BFT Gateway URL")
	keyPath := flag.String("key", strings.TrimSpace(os.Getenv("YNX_BUNDLER_PRIVATE_KEY_FILE")), "mode-0600 raw Bundler secp256k1 key")
	flag.Parse()
	key, err := loadKey(*keyPath)
	if err != nil {
		log.Fatal(err)
	}
	service, err := bundler.New(bundler.Config{GatewayURL: *gateway, APIKey: os.Getenv("YNX_BUNDLER_API_KEY"), PrivateKey: key, Build: buildinfo.Normalize(buildinfo.Info{Commit: buildCommit, Release: buildRelease, BuildTime: buildTime})})
	if err != nil {
		log.Fatal(err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	server := &http.Server{Addr: *address, Handler: service.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 20 * time.Second, IdleTimeout: 60 * time.Second}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	log.Printf("YNX Bundler listening on http://%s", *address)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func loadKey(path string) (*secp256k1.PrivateKey, error) {
	if strings.TrimSpace(path) == "" {
		return nil, errors.New("YNX_BUNDLER_PRIVATE_KEY_FILE is required")
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if info.Mode().Perm()&0o077 != 0 {
		return nil, errors.New("Bundler key must not allow group or other access")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if len(raw) != 32 || bytes.Equal(raw, make([]byte, 32)) {
		return nil, errors.New("Bundler key must be one non-zero raw 32-byte scalar")
	}
	key := secp256k1.PrivKeyFromBytes(raw)
	if !bytes.Equal(key.Serialize(), raw) {
		return nil, errors.New("Bundler key scalar is not canonical")
	}
	return key, nil
}

func env(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}
