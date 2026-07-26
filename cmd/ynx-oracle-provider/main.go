package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/oracle"
	"github.com/JiahaoAlbus/YNX-Chain/internal/oracle/providers"
)

type registryFile struct {
	Schema    string            `json:"schema"`
	Providers []oracle.Provider `json:"providers"`
	Attestors json.RawMessage   `json:"attestors,omitempty"`
}

func main() {
	if err := run(); err != nil {
		slog.Error("oracle provider terminated", "error", err.Error())
		os.Exit(1)
	}
}

func run() error {
	registryPath := flag.String("providers", "", "approved versioned provider registry JSON path")
	providerID := flag.String("provider-id", "", "active provider registry ID")
	adapterName := flag.String("adapter", "", "official adapter: coinbase, kraken, or bitstamp")
	symbol := flag.String("symbol", "", "official provider product or market symbol")
	market := flag.String("market", "", "canonical Oracle market")
	scale := flag.Int64("scale", 1_000_000, "positive power-of-ten integer scale")
	oracleURL := flag.String("oracle", "http://127.0.0.1:6470", "Oracle service origin")
	signerPath := flag.String("signer", "", "owner-only Ed25519 reporter private-key file")
	sequencePath := flag.String("sequence-state", "", "durable reporter sequence state path")
	nonceDomain := flag.String("nonce-domain", "ynx-oracle-testnet-v1", "Oracle reporter nonce domain")
	interval := flag.Duration("interval", 5*time.Second, "poll interval")
	once := flag.Bool("once", false, "fetch and publish exactly one observation")
	flag.Parse()

	if *registryPath == "" || *providerID == "" || *adapterName == "" || *symbol == "" ||
		*market == "" || *signerPath == "" || *sequencePath == "" {
		return errors.New("providers, provider-id, adapter, symbol, market, signer, and sequence-state are required")
	}
	if *scale <= 0 || *interval < time.Second || *interval > time.Hour {
		return errors.New("scale and interval are outside the supported range")
	}
	provider, err := loadProvider(*registryPath, *providerID)
	if err != nil {
		return err
	}
	privateKey, err := providers.LoadReporterPrivateKey(*signerPath, provider)
	if err != nil {
		return err
	}
	sequences, err := providers.OpenSequenceStore(*sequencePath)
	if err != nil {
		return err
	}
	publisher, err := providers.NewPublisher(*oracleURL, nil)
	if err != nil {
		return err
	}
	official, err := providers.NewOfficialHTTP(nil)
	if err != nil {
		return err
	}
	fetch, err := officialFetcher(official, *adapterName, *symbol, *market, *scale)
	if err != nil {
		return err
	}
	worker, err := providers.NewWorker(fetch, provider, privateKey, *nonceDomain, sequences, publisher, time.Now)
	if err != nil {
		return err
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	runOnce := func(ctx context.Context) error {
		receipt, err := worker.RunOnce(ctx)
		if err != nil {
			return err
		}
		logger.Info("official provider observation accepted",
			"provider_id", provider.ID, "market", *market, "observation_id", receipt.ObservationID,
			"observation_hash", receipt.Hash, "created", receipt.Created)
		return nil
	}
	if *once {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		return runOnce(ctx)
	}
	shutdown, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	ticker := time.NewTicker(*interval)
	defer ticker.Stop()
	for {
		ctx, cancel := context.WithTimeout(shutdown, 20*time.Second)
		err := runOnce(ctx)
		cancel()
		if err != nil {
			logger.Error("official provider observation failed", "provider_id", provider.ID, "market", *market, "error", err.Error())
		}
		select {
		case <-shutdown.Done():
			return nil
		case <-ticker.C:
		}
	}
}

func officialFetcher(adapter *providers.OfficialHTTP, name, symbol, market string, scale int64) (providers.FetchFunc, error) {
	switch name {
	case "coinbase":
		return func(ctx context.Context) (providers.Candidate, error) {
			return adapter.CoinbaseTicker(ctx, symbol, market, scale)
		}, nil
	case "kraken":
		return func(ctx context.Context) (providers.Candidate, error) {
			return adapter.KrakenPostTrade(ctx, symbol, market, scale)
		}, nil
	case "bitstamp":
		return func(ctx context.Context) (providers.Candidate, error) {
			return adapter.BitstampTicker(ctx, symbol, market, scale)
		}, nil
	default:
		return nil, errors.New("official provider adapter is not supported")
	}
}

func loadProvider(path, providerID string) (oracle.Provider, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return oracle.Provider{}, fmt.Errorf("read provider registry: %w", err)
	}
	var registry registryFile
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&registry); err != nil {
		return oracle.Provider{}, fmt.Errorf("decode provider registry: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return oracle.Provider{}, errors.New("provider registry must contain exactly one JSON value")
	}
	if registry.Schema != oracle.SchemaVersion || len(registry.Providers) == 0 {
		return oracle.Provider{}, errors.New("provider registry schema or providers invalid")
	}
	for _, provider := range registry.Providers {
		if provider.ID == providerID {
			if err := provider.Validate(); err != nil {
				return oracle.Provider{}, err
			}
			if provider.Status != "active" {
				return oracle.Provider{}, errors.New("provider is not approved active")
			}
			return provider, nil
		}
	}
	return oracle.Provider{}, errors.New("provider ID is not present in registry")
}
