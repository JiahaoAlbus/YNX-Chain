package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/api"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

var (
	buildCommit  = "unknown"
	buildRelease = "local"
	buildTime    = "unknown"
)

func main() {
	httpAddr := flag.String("http", envOrDefault("YNX_HTTP_ADDR", "127.0.0.1:6420"), "HTTP listen address")
	network := flag.String("network", envOrDefault("YNX_NETWORK", "devnet"), "network slug")
	blockInterval := flag.Duration("block-interval", envDurationOrDefault("YNX_BLOCK_INTERVAL", 2*time.Second), "block production interval")
	dataDir := flag.String("data-dir", envOrDefault("YNX_DATA_DIR", ""), "optional local devnet state directory")
	localValidator := flag.String("validator-address", envOrDefault("YNX_LOCAL_VALIDATOR_ADDRESS", ""), "local validator address for peer sync polling")
	peerSyncRaw := flag.String("peer-rpc-urls", envOrDefault("YNX_PEER_RPC_URLS", ""), "semicolon-separated peer sync targets: address|url")
	peerSyncInterval := flag.Duration("peer-sync-interval", envDurationOrDefault("YNX_PEER_SYNC_INTERVAL", 5*time.Second), "validator peer sync polling interval")
	checkConfig := flag.Bool("check-config", envBoolOrDefault("YNX_CHECK_CONFIG", false), "validate node config and exit without starting services")
	flag.Parse()

	cfg := nodeRuntimeConfig{
		HTTPAddr:         *httpAddr,
		Network:          *network,
		BlockInterval:    *blockInterval,
		DataDir:          *dataDir,
		LocalValidator:   *localValidator,
		PeerSyncRaw:      *peerSyncRaw,
		PeerSyncInterval: *peerSyncInterval,
		CheckConfig:      *checkConfig,
	}
	if err := runNode(cfg, os.Stdout); err != nil {
		log.Fatal(err)
	}
}

type nodeRuntimeConfig struct {
	HTTPAddr         string
	Network          string
	BlockInterval    time.Duration
	DataDir          string
	LocalValidator   string
	PeerSyncRaw      string
	PeerSyncInterval time.Duration
	CheckConfig      bool
}

type nodeStartupInputs struct {
	NetworkConfig   chain.NetworkConfig
	Validators      []chain.Validator
	Peers           []chain.ValidatorPeer
	PeerSyncTargets []peerSyncTarget
}

func loadNodeStartupInputs(cfg nodeRuntimeConfig) (nodeStartupInputs, error) {
	networkConfig := chain.DefaultNetworkConfig(cfg.Network)
	validators, err := chain.ParseValidatorSet(os.Getenv("YNX_VALIDATOR_SET"))
	if err != nil {
		return nodeStartupInputs{}, fmt.Errorf("invalid YNX_VALIDATOR_SET: %w", err)
	}
	peers, err := chain.ParseValidatorPeers(os.Getenv("YNX_BOOTSTRAP_PEERS"))
	if err != nil {
		return nodeStartupInputs{}, fmt.Errorf("invalid YNX_BOOTSTRAP_PEERS: %w", err)
	}
	peerSyncTargets, err := parsePeerSyncTargets(cfg.PeerSyncRaw)
	if err != nil {
		return nodeStartupInputs{}, fmt.Errorf("invalid YNX_PEER_RPC_URLS: %w", err)
	}
	if err := validateNodeStartupConfig(networkConfig, validators, cfg.LocalValidator, peerSyncTargets); err != nil {
		return nodeStartupInputs{}, fmt.Errorf("unsafe validator startup config: %w", err)
	}
	return nodeStartupInputs{
		NetworkConfig:   networkConfig,
		Validators:      validators,
		Peers:           peers,
		PeerSyncTargets: peerSyncTargets,
	}, nil
}

func checkNodeRuntimeConfig(cfg nodeRuntimeConfig, out io.Writer) error {
	inputs, err := loadNodeStartupInputs(cfg)
	if err != nil {
		return err
	}
	expectedValidators := len(inputs.Validators)
	if expectedValidators == 0 {
		expectedValidators = len(chain.DefaultValidators())
	}
	build := currentBuildInfo()
	fmt.Fprintf(out, "ynx-chaind config check passed: network=%s localValidator=%s expectedValidators=%d peerTargets=%d buildCommit=%s release=%s buildTime=%s\n", inputs.NetworkConfig.Slug, strings.TrimSpace(cfg.LocalValidator), expectedValidators, len(inputs.PeerSyncTargets), build.Commit, build.Release, build.BuildTime)
	return nil
}

func runNode(cfg nodeRuntimeConfig, out io.Writer) error {
	inputs, err := loadNodeStartupInputs(cfg)
	if err != nil {
		return err
	}
	if cfg.CheckConfig {
		return checkNodeRuntimeConfig(cfg, out)
	}
	devnet, err := chain.NewPersistentDevnetWithValidatorsAndPeers(inputs.NetworkConfig, cfg.DataDir, inputs.Validators, inputs.Peers)
	if err != nil {
		return err
	}
	devnet.SetNodeIdentityConfig(chain.NodeIdentityConfig{
		ValidatorAddress: cfg.LocalValidator,
		PeerSyncTargets:  chainPeerSyncTargets(inputs.PeerSyncTargets),
		PeerSyncInterval: cfg.PeerSyncInterval,
		Build:            currentBuildInfo(),
	})

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	go devnet.Start(ctx, cfg.BlockInterval)
	if cfg.LocalValidator != "" && len(inputs.PeerSyncTargets) > 0 {
		startPeerSyncPolling(ctx, devnet, cfg.LocalValidator, inputs.PeerSyncTargets, cfg.PeerSyncInterval, nil)
	}

	srv := &http.Server{Addr: cfg.HTTPAddr, Handler: api.NewServerWithConfig(devnet, api.ServerConfig{
		AIGatewayUpstreamKey:  os.Getenv("YNX_AI_GATEWAY_UPSTREAM_KEY"),
		PayGatewayUpstreamKey: os.Getenv("YNX_PAY_GATEWAY_UPSTREAM_KEY"),
	}), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()

	log.Printf("YNX Chain %s listening on http://%s with native coin YNXT", inputs.NetworkConfig.Name, cfg.HTTPAddr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
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

func currentBuildInfo() chain.BuildInfo {
	info := chain.BuildInfo{
		Commit:    strings.TrimSpace(buildCommit),
		Release:   strings.TrimSpace(buildRelease),
		BuildTime: strings.TrimSpace(buildTime),
	}
	if info.Commit == "" {
		info.Commit = "unknown"
	}
	if info.Release == "" {
		info.Release = "local"
	}
	if info.BuildTime == "" {
		info.BuildTime = "unknown"
	}
	return info
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

func envBoolOrDefault(key string, fallback bool) bool {
	value := strings.TrimSpace(strings.ToLower(os.Getenv(key)))
	if value == "" {
		return fallback
	}
	return value == "1" || value == "true" || value == "yes" || value == "on"
}
