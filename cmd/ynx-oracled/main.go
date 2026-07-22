package main

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/oracle"
)

type registryFile struct {
	Schema    string            `json:"schema"`
	Providers []oracle.Provider `json:"providers"`
}

func main() {
	if err := run(); err != nil {
		slog.Error("oracle terminated", "error", err.Error())
		os.Exit(1)
	}
}

func run() error {
	listen := flag.String("listen", "127.0.0.1:6470", "HTTP listen address")
	metricsListen := flag.String("metrics-listen", "127.0.0.1:9470", "internal metrics listen address; empty disables")
	statePath := flag.String("state", "var/oracle/state.json", "integrity-protected state path")
	registryPath := flag.String("providers", "", "versioned provider registry JSON path")
	nonceDomain := flag.String("nonce-domain", "ynx-oracle-testnet-v1", "signed observation nonce domain")
	flag.Parse()
	if *registryPath == "" {
		return errors.New("--providers is required; provider success is never fabricated")
	}
	key, err := hex.DecodeString(os.Getenv("YNX_ORACLE_STATE_HMAC_KEY_HEX"))
	if err != nil || len(key) < 32 {
		return errors.New("YNX_ORACLE_STATE_HMAC_KEY_HEX must decode to at least 32 bytes")
	}
	providers, err := loadRegistry(*registryPath)
	if err != nil {
		return err
	}
	store, err := oracle.OpenStore(*statePath, key, *nonceDomain)
	if err != nil {
		return err
	}
	service, err := oracle.NewService(store, providers, oracle.DefaultPolicy(), time.Now)
	if err != nil {
		return err
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	handler, err := oracle.NewServer(service, logger)
	if err != nil {
		return err
	}
	server := &http.Server{Addr: *listen, Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	var metricsServer *http.Server
	if *metricsListen != "" {
		host, _, splitErr := net.SplitHostPort(*metricsListen)
		ip := net.ParseIP(host)
		if splitErr != nil || (host != "localhost" && (ip == nil || !ip.IsLoopback())) {
			return errors.New("--metrics-listen must bind to loopback")
		}
		metricsServer = &http.Server{Addr: *metricsListen, Handler: handler.MetricsHandler(), ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 8 << 10}
	}
	shutdown, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	result := make(chan error, 2)
	go func() { result <- server.ListenAndServe() }()
	if metricsServer != nil {
		go func() { result <- metricsServer.ListenAndServe() }()
	}
	logger.Info("oracle listening", "address", *listen, "product_id", oracle.ProductID, "version", oracle.Version, "provider_count", len(providers))
	if metricsServer != nil {
		logger.Info("oracle metrics listening", "address", *metricsListen)
	}
	select {
	case err := <-result:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	case <-shutdown.Done():
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if metricsServer != nil {
			if err := metricsServer.Shutdown(ctx); err != nil {
				return err
			}
		}
		return server.Shutdown(ctx)
	}
}

func loadRegistry(path string) ([]oracle.Provider, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read provider registry: %w", err)
	}
	var registry registryFile
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&registry); err != nil {
		return nil, fmt.Errorf("decode provider registry: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return nil, errors.New("provider registry must contain exactly one JSON value")
	}
	if registry.Schema != oracle.SchemaVersion || len(registry.Providers) == 0 {
		return nil, errors.New("provider registry schema or providers invalid")
	}
	return registry.Providers, nil
}
