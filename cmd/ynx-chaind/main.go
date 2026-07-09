package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/api"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func main() {
	httpAddr := flag.String("http", envOrDefault("YNX_HTTP_ADDR", "127.0.0.1:6420"), "HTTP listen address")
	network := flag.String("network", envOrDefault("YNX_NETWORK", "devnet"), "network slug")
	blockInterval := flag.Duration("block-interval", envDurationOrDefault("YNX_BLOCK_INTERVAL", 2*time.Second), "block production interval")
	dataDir := flag.String("data-dir", envOrDefault("YNX_DATA_DIR", ""), "optional local devnet state directory")
	localValidator := flag.String("validator-address", envOrDefault("YNX_LOCAL_VALIDATOR_ADDRESS", ""), "local validator address for peer sync polling")
	peerSyncRaw := flag.String("peer-rpc-urls", envOrDefault("YNX_PEER_RPC_URLS", ""), "semicolon-separated peer sync targets: address|url")
	peerSyncInterval := flag.Duration("peer-sync-interval", envDurationOrDefault("YNX_PEER_SYNC_INTERVAL", 5*time.Second), "validator peer sync polling interval")
	flag.Parse()

	cfg := chain.DefaultNetworkConfig(*network)
	validators, err := chain.ParseValidatorSet(os.Getenv("YNX_VALIDATOR_SET"))
	if err != nil {
		log.Fatalf("invalid YNX_VALIDATOR_SET: %v", err)
	}
	peers, err := chain.ParseValidatorPeers(os.Getenv("YNX_BOOTSTRAP_PEERS"))
	if err != nil {
		log.Fatalf("invalid YNX_BOOTSTRAP_PEERS: %v", err)
	}
	devnet, err := chain.NewPersistentDevnetWithValidatorsAndPeers(cfg, *dataDir, validators, peers)
	if err != nil {
		log.Fatal(err)
	}
	peerSyncTargets, err := parsePeerSyncTargets(*peerSyncRaw)
	if err != nil {
		log.Fatalf("invalid YNX_PEER_RPC_URLS: %v", err)
	}
	if err := validateNodeStartupConfig(cfg, validators, *localValidator, peerSyncTargets); err != nil {
		log.Fatalf("unsafe validator startup config: %v", err)
	}
	devnet.SetNodeIdentityConfig(chain.NodeIdentityConfig{
		ValidatorAddress: *localValidator,
		PeerSyncTargets:  chainPeerSyncTargets(peerSyncTargets),
		PeerSyncInterval: *peerSyncInterval,
	})

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	go devnet.Start(ctx, *blockInterval)
	if *localValidator != "" && len(peerSyncTargets) > 0 {
		startPeerSyncPolling(ctx, devnet, *localValidator, peerSyncTargets, *peerSyncInterval, nil)
	}

	srv := &http.Server{Addr: *httpAddr, Handler: api.NewServer(devnet), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()

	log.Printf("YNX Chain %s listening on http://%s with native coin YNXT", cfg.Name, *httpAddr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func validateNodeStartupConfig(cfg chain.NetworkConfig, validators []chain.Validator, localValidator string, targets []peerSyncTarget) error {
	normalized, err := chain.NormalizeValidators(validators)
	if err != nil {
		return err
	}
	if len(normalized) == 0 {
		normalized = chain.DefaultValidators()
	}
	if cfg.Slug != "testnet" || len(normalized) <= 1 {
		return nil
	}
	localValidator = strings.TrimSpace(localValidator)
	if localValidator == "" {
		return fmt.Errorf("YNX_LOCAL_VALIDATOR_ADDRESS is required for multi-validator testnet nodes")
	}
	validatorSet := map[string]bool{}
	for _, validator := range normalized {
		validatorSet[validator.Address] = true
	}
	if !validatorSet[localValidator] {
		return fmt.Errorf("local validator %s is not in YNX_VALIDATOR_SET", localValidator)
	}
	if len(targets) != len(normalized)-1 {
		return fmt.Errorf("expected %d peer RPC targets for validator %s, got %d", len(normalized)-1, localValidator, len(targets))
	}
	seen := map[string]bool{}
	for _, target := range targets {
		if target.Address == localValidator {
			return fmt.Errorf("peer RPC targets must not include local validator %s", localValidator)
		}
		if !validatorSet[target.Address] {
			return fmt.Errorf("peer RPC target %s is not in YNX_VALIDATOR_SET", target.Address)
		}
		if seen[target.Address] {
			return fmt.Errorf("duplicate peer RPC target %s", target.Address)
		}
		seen[target.Address] = true
	}
	for _, validator := range normalized {
		if validator.Address != localValidator && !seen[validator.Address] {
			return fmt.Errorf("missing peer RPC target for validator %s", validator.Address)
		}
	}
	return nil
}

func chainPeerSyncTargets(targets []peerSyncTarget) []chain.ValidatorPeerSyncTarget {
	out := make([]chain.ValidatorPeerSyncTarget, 0, len(targets))
	for _, target := range targets {
		out = append(out, chain.ValidatorPeerSyncTarget{Address: target.Address, URL: target.URL})
	}
	return out
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
