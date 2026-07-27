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
	Attestors []oracle.Attestor `json:"attestors,omitempty"`
}

type candidateRegistryFile struct {
	Schema             string                      `json:"schema"`
	AsOf               time.Time                   `json:"asOf"`
	ProductionRegistry bool                        `json:"productionRegistry"`
	Candidates         []candidateRegistryProvider `json:"candidates"`
	SourceLimitation   string                      `json:"sourceLimitation"`
}

type candidateRegistryProvider struct {
	ID                  string     `json:"id"`
	Provider            string     `json:"provider"`
	Endpoint            string     `json:"endpoint"`
	Version             string     `json:"version"`
	AssetMarketCoverage []string   `json:"assetMarketCoverage"`
	YNXMarketCoverage   bool       `json:"ynxMarketCoverage"`
	License             string     `json:"license"`
	Terms               string     `json:"terms"`
	PermittedStorage    string     `json:"permittedStorage"`
	Authentication      string     `json:"authentication"`
	RateLimit           string     `json:"rateLimit"`
	Timestamp           string     `json:"timestamp"`
	Precision           string     `json:"precision"`
	Timezone            string     `json:"timezone"`
	Region              string     `json:"region"`
	Jurisdiction        string     `json:"jurisdiction"`
	Cost                string     `json:"cost"`
	Retention           string     `json:"retention"`
	DataRights          string     `json:"dataRights"`
	Health              string     `json:"health"`
	LastSuccess         *time.Time `json:"lastSuccess"`
	Fallback            string     `json:"fallback"`
	DecommissionPlan    string     `json:"decommissionPlan"`
	Status              string     `json:"status"`
	Adapter             string     `json:"adapter"`
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
	publicOrigin := flag.String("public-origin", "", "exact HTTPS Oracle Web origin allowed to read public endpoints")
	checkConfig := flag.Bool("check-config", false, "validate registry, state integrity, policy, and public-origin configuration without listening")
	flag.Parse()
	if *registryPath == "" {
		return errors.New("--providers is required; provider success is never fabricated")
	}
	key, err := hex.DecodeString(os.Getenv("YNX_ORACLE_STATE_HMAC_KEY_HEX"))
	if err != nil || len(key) < 32 {
		return errors.New("YNX_ORACLE_STATE_HMAC_KEY_HEX must decode to at least 32 bytes")
	}
	providers, attestors, sourceLimitation, err := loadRegistry(*registryPath)
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
	if sourceLimitation != "" {
		if err := service.ConfigureSourceLimitation(sourceLimitation); err != nil {
			return err
		}
	}
	if len(attestors) > 0 {
		if err := service.ConfigureAttestors(attestors); err != nil {
			return err
		}
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	handler, err := oracle.NewServer(service, logger)
	if err != nil {
		return err
	}
	if err := handler.SetPublicOrigin(*publicOrigin); err != nil {
		return err
	}
	if *checkConfig {
		return nil
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
	logger.Info("oracle listening", "address", *listen, "product_id", oracle.ProductID, "version", oracle.Version, "provider_count", len(providers), "attestor_count", len(attestors))
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

func loadRegistry(path string) ([]oracle.Provider, []oracle.Attestor, string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, "", fmt.Errorf("read provider registry: %w", err)
	}
	var envelope struct {
		Schema string `json:"schema"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil {
		return nil, nil, "", fmt.Errorf("decode provider registry: %w", err)
	}
	switch envelope.Schema {
	case oracle.SchemaVersion:
		var registry registryFile
		if err := decodeRegistry(data, &registry); err != nil {
			return nil, nil, "", err
		}
		if len(registry.Providers) == 0 {
			return nil, nil, "", errors.New("provider registry providers invalid")
		}
		return registry.Providers, registry.Attestors, "", nil
	case "ynx.oracle.provider-candidates.v1":
		var registry candidateRegistryFile
		if err := decodeRegistry(data, &registry); err != nil {
			return nil, nil, "", err
		}
		if registry.ProductionRegistry || registry.AsOf.IsZero() || len(registry.Candidates) == 0 || len(registry.SourceLimitation) == 0 {
			return nil, nil, "", errors.New("provider candidate registry truth fields invalid")
		}
		providers := make([]oracle.Provider, 0, len(registry.Candidates))
		seen := make(map[string]struct{}, len(registry.Candidates))
		for _, candidate := range registry.Candidates {
			if candidate.Status == "active" || candidate.YNXMarketCoverage {
				return nil, nil, "", errors.New("candidate registry cannot activate providers or claim YNX coverage")
			}
			provider := oracle.Provider{
				ID: candidate.ID, Name: candidate.Provider, Endpoint: candidate.Endpoint, APIVersion: candidate.Version,
				AssetMarketCoverage: candidate.AssetMarketCoverage, License: candidate.License, TermsURL: candidate.Terms,
				PermittedStorage: candidate.PermittedStorage, Authentication: candidate.Authentication,
				RateLimit: candidate.RateLimit, TimestampSemantics: candidate.Timestamp, Precision: candidate.Precision,
				Timezone: candidate.Timezone, Region: candidate.Region, Jurisdiction: candidate.Jurisdiction,
				Cost: candidate.Cost, Retention: candidate.Retention, DataRights: candidate.DataRights,
				Fallback: candidate.Fallback, DecommissionPlan: candidate.DecommissionPlan, Status: candidate.Status,
				UpdatedAt: registry.AsOf,
			}
			if candidate.LastSuccess != nil {
				provider.LastSuccess = candidate.LastSuccess.UTC()
			}
			if err := provider.Validate(); err != nil {
				return nil, nil, "", err
			}
			if _, exists := seen[provider.ID]; exists {
				return nil, nil, "", errors.New("duplicate provider candidate ID")
			}
			seen[provider.ID] = struct{}{}
			providers = append(providers, provider)
		}
		return providers, nil, registry.SourceLimitation, nil
	default:
		return nil, nil, "", errors.New("provider registry schema invalid")
	}
}

func decodeRegistry(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("decode provider registry: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return errors.New("provider registry must contain exactly one JSON value")
	}
	return nil
}
