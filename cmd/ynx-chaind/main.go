package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/api"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/mutationfreeze"
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
	blockProduction := flag.Bool("block-production", envBoolOrDefault("YNX_BLOCK_PRODUCTION_ENABLED", true), "enable authoritative block production")
	replicationSource := flag.String("replication-source", envOrDefault("YNX_REPLICATION_SOURCE_URL", ""), "authoritative replication source URL for follower nodes")
	replicationKey := flag.String("replication-key", envOrDefault("YNX_REPLICATION_KEY", ""), "shared key for authenticated replication snapshots")
	replicationInterval := flag.Duration("replication-interval", envDurationOrDefault("YNX_REPLICATION_INTERVAL", 2*time.Second), "authoritative replication polling interval")
	checkConfig := flag.Bool("check-config", envBoolOrDefault("YNX_CHECK_CONFIG", false), "validate node config and exit without starting services")
	exportConsensusState := flag.String("export-consensus-state", envOrDefault("YNX_EXPORT_CONSENSUS_STATE", ""), "export deterministic BFT migration state to a file and exit")
	flag.Parse()

	cfg := nodeRuntimeConfig{
		HTTPAddr:             *httpAddr,
		Network:              *network,
		BlockInterval:        *blockInterval,
		DataDir:              *dataDir,
		LocalValidator:       *localValidator,
		PeerSyncRaw:          *peerSyncRaw,
		PeerSyncInterval:     *peerSyncInterval,
		BlockProduction:      *blockProduction,
		ReplicationSource:    strings.TrimSpace(*replicationSource),
		ReplicationKey:       strings.TrimSpace(*replicationKey),
		ReplicationInterval:  *replicationInterval,
		CheckConfig:          *checkConfig,
		ExportConsensusState: strings.TrimSpace(*exportConsensusState),
	}
	if err := runNode(cfg, os.Stdout); err != nil {
		log.Fatal(err)
	}
}

type nodeRuntimeConfig struct {
	HTTPAddr             string
	Network              string
	BlockInterval        time.Duration
	DataDir              string
	LocalValidator       string
	PeerSyncRaw          string
	PeerSyncInterval     time.Duration
	BlockProduction      bool
	ReplicationSource    string
	ReplicationKey       string
	ReplicationInterval  time.Duration
	CheckConfig          bool
	ExportConsensusState string
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
	if err := validateReplicationStartupConfig(networkConfig, validators, cfg); err != nil {
		return nodeStartupInputs{}, fmt.Errorf("unsafe replication startup config: %w", err)
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
	fmt.Fprintf(out, "ynx-chaind config check passed: network=%s localValidator=%s expectedValidators=%d peerTargets=%d blockProduction=%t replicationSourceConfigured=%t buildCommit=%s release=%s buildTime=%s\n", inputs.NetworkConfig.Slug, strings.TrimSpace(cfg.LocalValidator), expectedValidators, len(inputs.PeerSyncTargets), cfg.BlockProduction, cfg.ReplicationSource != "", build.Commit, build.Release, build.BuildTime)
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
	if cfg.ExportConsensusState != "" {
		return exportConsensusState(devnet, cfg.ExportConsensusState, out)
	}
	devnet.SetNodeIdentityConfig(chain.NodeIdentityConfig{
		ValidatorAddress:  cfg.LocalValidator,
		PeerSyncTargets:   chainPeerSyncTargets(inputs.PeerSyncTargets),
		PeerSyncInterval:  cfg.PeerSyncInterval,
		BlockProduction:   cfg.BlockProduction,
		ReplicationMode:   replicationMode(cfg),
		ReplicationSource: cfg.ReplicationSource,
		Build:             currentBuildInfo(),
	})

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	if cfg.BlockProduction {
		go devnet.Start(ctx, cfg.BlockInterval)
	}
	if cfg.ReplicationSource != "" {
		startReplicationPolling(ctx, devnet, cfg.ReplicationSource, cfg.ReplicationKey, cfg.ReplicationInterval, nil)
	}
	if cfg.LocalValidator != "" && len(inputs.PeerSyncTargets) > 0 {
		startPeerSyncPolling(ctx, devnet, cfg.LocalValidator, inputs.PeerSyncTargets, cfg.PeerSyncInterval, nil)
	}

	handler := api.NewServerWithConfig(devnet, api.ServerConfig{
		AIGatewayUpstreamKey:       os.Getenv("YNX_AI_GATEWAY_UPSTREAM_KEY"),
		PayGatewayUpstreamKey:      os.Getenv("YNX_PAY_GATEWAY_UPSTREAM_KEY"),
		TrustGatewayUpstreamKey:    os.Getenv("YNX_TRUST_GATEWAY_UPSTREAM_KEY"),
		ResourceGatewayUpstreamKey: os.Getenv("YNX_RESOURCE_GATEWAY_UPSTREAM_KEY"),
		ReplicationKey:             cfg.ReplicationKey,
		ReadOnlyReplica:            cfg.ReplicationSource != "",
	})
	srv := &http.Server{Addr: cfg.HTTPAddr, Handler: mutationfreeze.FromEnv(handler), ReadHeaderTimeout: 5 * time.Second}
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

func exportConsensusState(devnet *chain.Devnet, destination string, out io.Writer) error {
	state, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		return fmt.Errorf("export consensus migration state: %w", err)
	}
	payload, err := state.CanonicalJSON()
	if err != nil {
		return fmt.Errorf("encode consensus migration state: %w", err)
	}
	if destination == "-" {
		_, err = out.Write(append(payload, '\n'))
		return err
	}
	destination = filepath.Clean(destination)
	if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
		return fmt.Errorf("create consensus export directory: %w", err)
	}
	temporary := destination + ".tmp"
	if err := os.WriteFile(temporary, append(payload, '\n'), 0o600); err != nil {
		return fmt.Errorf("write consensus migration state: %w", err)
	}
	if err := os.Rename(temporary, destination); err != nil {
		_ = os.Remove(temporary)
		return fmt.Errorf("commit consensus migration state: %w", err)
	}
	fmt.Fprintf(out, "consensus migration state exported: path=%s height=%d accounts=%d validators=%d stateHash=%s\n", destination, state.Height, len(state.Accounts), len(state.Validators), state.StateHash)
	return nil
}

func replicationMode(cfg nodeRuntimeConfig) string {
	if cfg.ReplicationSource != "" {
		return "authoritative_follower"
	}
	if cfg.BlockProduction {
		return "authoritative_producer"
	}
	return "disabled"
}

func validateReplicationStartupConfig(network chain.NetworkConfig, validators []chain.Validator, cfg nodeRuntimeConfig) error {
	normalized, err := chain.NormalizeValidators(validators)
	if err != nil {
		return err
	}
	if network.Slug != "testnet" || len(normalized) <= 1 {
		return nil
	}
	if len(cfg.ReplicationKey) < 32 {
		return fmt.Errorf("YNX_REPLICATION_KEY must contain at least 32 characters")
	}
	var local chain.Validator
	found := false
	for _, validator := range normalized {
		if validator.Address == strings.TrimSpace(cfg.LocalValidator) {
			local, found = validator, true
			break
		}
	}
	if !found {
		return fmt.Errorf("local validator is missing from the validator set")
	}
	isPrimary := strings.Contains(strings.ToLower(local.Role), "primary")
	if isPrimary {
		if !cfg.BlockProduction {
			return fmt.Errorf("primary validator must enable YNX_BLOCK_PRODUCTION_ENABLED")
		}
		if cfg.ReplicationSource != "" {
			return fmt.Errorf("primary validator must not configure YNX_REPLICATION_SOURCE_URL")
		}
		return nil
	}
	if cfg.BlockProduction {
		return fmt.Errorf("follower validator must disable YNX_BLOCK_PRODUCTION_ENABLED")
	}
	parsed, err := url.Parse(cfg.ReplicationSource)
	if err != nil || parsed.Scheme != "http" && parsed.Scheme != "https" || parsed.Host == "" {
		return fmt.Errorf("follower validator requires a valid YNX_REPLICATION_SOURCE_URL")
	}
	if cfg.ReplicationInterval <= 0 {
		return fmt.Errorf("YNX_REPLICATION_INTERVAL must be positive")
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
