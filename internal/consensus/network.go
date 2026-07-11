package consensus

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	cmtconfig "github.com/cometbft/cometbft/config"
	"github.com/cometbft/cometbft/p2p"
	"github.com/cometbft/cometbft/privval"
)

const EphemeralNetworkVersion = 1

type EphemeralNetworkOptions struct {
	RootDir  string
	BaseP2P  int
	BaseRPC  int
	BaseABCI int
}

type EphemeralNetworkManifest struct {
	Version            int                    `json:"version"`
	Purpose            string                 `json:"purpose"`
	ChainID            string                 `json:"chainId"`
	MigrationPath      string                 `json:"migrationPath"`
	MigrationStateHash string                 `json:"migrationStateHash"`
	GenesisHash        string                 `json:"genesisHash"`
	Nodes              []EphemeralNetworkNode `json:"nodes"`
}

type EphemeralNetworkNode struct {
	ValidatorAddress string `json:"validatorAddress"`
	Moniker          string `json:"moniker"`
	Home             string `json:"home"`
	NodeID           string `json:"nodeId"`
	ConsensusAddress string `json:"consensusAddress"`
	ConsensusKeyType string `json:"consensusKeyType"`
	ConsensusPubKey  string `json:"consensusPubKey"`
	P2PListen        string `json:"p2pListen"`
	RPCListen        string `json:"rpcListen"`
	RPCURL           string `json:"rpcUrl"`
	ABCIListen       string `json:"abciListen"`
	ABCIStatePath    string `json:"abciStatePath"`
	PersistentPeers  string `json:"persistentPeers"`
}

func GenerateEphemeralNetwork(migration chain.ConsensusMigrationState, options EphemeralNetworkOptions) (manifest EphemeralNetworkManifest, err error) {
	if err := migration.Validate(); err != nil {
		return EphemeralNetworkManifest{}, err
	}
	if len(migration.Validators) != 4 {
		return EphemeralNetworkManifest{}, fmt.Errorf("ephemeral quorum network requires exactly 4 validators, got %d", len(migration.Validators))
	}
	for _, validator := range migration.Validators {
		if !validator.Active {
			return EphemeralNetworkManifest{}, fmt.Errorf("ephemeral quorum validator %s must be active", validator.Address)
		}
	}
	root := filepath.Clean(strings.TrimSpace(options.RootDir))
	if root == "." || root == "" {
		return EphemeralNetworkManifest{}, errors.New("ephemeral network root directory is required")
	}
	if err := validatePortRanges(options, len(migration.Validators)); err != nil {
		return EphemeralNetworkManifest{}, err
	}
	if _, err := os.Stat(root); !errors.Is(err, os.ErrNotExist) {
		if err == nil {
			return EphemeralNetworkManifest{}, fmt.Errorf("ephemeral network root already exists: %s", root)
		}
		return EphemeralNetworkManifest{}, fmt.Errorf("stat ephemeral network root: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(root), 0o700); err != nil {
		return EphemeralNetworkManifest{}, fmt.Errorf("create ephemeral network parent: %w", err)
	}
	if err := os.Mkdir(root, 0o700); err != nil {
		return EphemeralNetworkManifest{}, fmt.Errorf("create ephemeral network root: %w", err)
	}
	completed := false
	defer func() {
		if !completed {
			_ = os.RemoveAll(root)
		}
	}()

	nodes := make([]EphemeralNetworkNode, len(migration.Validators))
	bindings := make([]chain.ConsensusValidatorKeyBinding, len(migration.Validators))
	for index, validator := range migration.Validators {
		home := filepath.Join(root, fmt.Sprintf("validator-%d", index+1))
		configDir := filepath.Join(home, "config")
		dataDir := filepath.Join(home, "data")
		if err := os.MkdirAll(configDir, 0o700); err != nil {
			return manifest, err
		}
		if err := os.MkdirAll(dataDir, 0o700); err != nil {
			return manifest, err
		}
		privateValidator := privval.GenFilePV(filepath.Join(configDir, "priv_validator_key.json"), filepath.Join(dataDir, "priv_validator_state.json"))
		if err := savePrivateValidator(privateValidator); err != nil {
			return manifest, fmt.Errorf("save ephemeral validator %s key: %w", validator.Address, err)
		}
		nodeKey, err := p2p.LoadOrGenNodeKey(filepath.Join(configDir, "node_key.json"))
		if err != nil {
			return manifest, fmt.Errorf("save ephemeral validator %s node key: %w", validator.Address, err)
		}
		publicKey := privateValidator.Key.PubKey.Bytes()
		consensusAddress := strings.ToUpper(hex.EncodeToString(privateValidator.Key.Address))
		bindings[index] = chain.ConsensusValidatorKeyBinding{
			ValidatorAddress: validator.Address,
			KeyType:          chain.ConsensusPubKeyTypeEd25519,
			PublicKey:        base64.StdEncoding.EncodeToString(publicKey),
			ConsensusAddress: consensusAddress,
		}
		nodes[index] = EphemeralNetworkNode{
			ValidatorAddress: validator.Address,
			Moniker:          validator.Moniker,
			Home:             home,
			NodeID:           string(nodeKey.ID()),
			ConsensusAddress: consensusAddress,
			ConsensusKeyType: chain.ConsensusPubKeyTypeEd25519,
			ConsensusPubKey:  base64.StdEncoding.EncodeToString(publicKey),
			P2PListen:        fmt.Sprintf("tcp://127.0.0.1:%d", options.BaseP2P+index),
			RPCListen:        fmt.Sprintf("tcp://127.0.0.1:%d", options.BaseRPC+index),
			RPCURL:           fmt.Sprintf("http://127.0.0.1:%d", options.BaseRPC+index),
			ABCIListen:       fmt.Sprintf("tcp://127.0.0.1:%d", options.BaseABCI+index),
			ABCIStatePath:    filepath.Join(dataDir, "ynx-abci-state.json"),
		}
	}
	boundMigration, err := migration.BindConsensusValidatorKeys(bindings)
	if err != nil {
		return manifest, err
	}
	migrationPath := filepath.Join(root, "bound-migration.json")
	migrationPayload, err := boundMigration.CanonicalJSON()
	if err != nil {
		return manifest, err
	}
	if err := os.WriteFile(migrationPath, append(migrationPayload, '\n'), 0o600); err != nil {
		return manifest, fmt.Errorf("write bound migration: %w", err)
	}
	genesis, err := BuildCometGenesis(boundMigration, time.Now().UTC().Truncate(time.Second))
	if err != nil {
		return manifest, err
	}
	for index := range nodes {
		peers := make([]string, 0, len(nodes)-1)
		for peerIndex, peer := range nodes {
			if peerIndex == index {
				continue
			}
			peers = append(peers, peer.NodeID+"@127.0.0.1:"+strconv.Itoa(options.BaseP2P+peerIndex))
		}
		nodes[index].PersistentPeers = strings.Join(peers, ",")
		if err := genesis.SaveAs(filepath.Join(nodes[index].Home, "config", "genesis.json")); err != nil {
			return manifest, fmt.Errorf("write validator %s genesis: %w", nodes[index].ValidatorAddress, err)
		}
		config := cmtconfig.DefaultConfig().SetRoot(nodes[index].Home)
		config.Moniker = nodes[index].Moniker
		config.ProxyApp = nodes[index].ABCIListen
		config.ABCI = "socket"
		config.RPC.ListenAddress = nodes[index].RPCListen
		config.P2P.ListenAddress = nodes[index].P2PListen
		config.P2P.ExternalAddress = nodes[index].P2PListen
		config.P2P.PersistentPeers = nodes[index].PersistentPeers
		config.P2P.AllowDuplicateIP = true
		config.P2P.AddrBookStrict = false
		config.Consensus.TimeoutPropose = 750 * time.Millisecond
		config.Consensus.TimeoutProposeDelta = 100 * time.Millisecond
		config.Consensus.TimeoutPrevote = 350 * time.Millisecond
		config.Consensus.TimeoutPrevoteDelta = 100 * time.Millisecond
		config.Consensus.TimeoutPrecommit = 350 * time.Millisecond
		config.Consensus.TimeoutPrecommitDelta = 100 * time.Millisecond
		config.Consensus.TimeoutCommit = 500 * time.Millisecond
		if err := config.ValidateBasic(); err != nil {
			return manifest, fmt.Errorf("validate validator %s config: %w", nodes[index].ValidatorAddress, err)
		}
		if err := writeCometConfig(filepath.Join(nodes[index].Home, "config", "config.toml"), config); err != nil {
			return manifest, err
		}
	}
	genesisPayload, err := os.ReadFile(filepath.Join(nodes[0].Home, "config", "genesis.json"))
	if err != nil {
		return manifest, err
	}
	genesisSum := sha256.Sum256(genesisPayload)
	manifest = EphemeralNetworkManifest{
		Version:            EphemeralNetworkVersion,
		Purpose:            "local-ephemeral-consensus-quorum-only-not-for-remote-or-custody",
		ChainID:            genesis.ChainID,
		MigrationPath:      migrationPath,
		MigrationStateHash: boundMigration.StateHash,
		GenesisHash:        hex.EncodeToString(genesisSum[:]),
		Nodes:              nodes,
	}
	manifestPayload, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return EphemeralNetworkManifest{}, err
	}
	if err := os.WriteFile(filepath.Join(root, "network-manifest.json"), append(manifestPayload, '\n'), 0o600); err != nil {
		return EphemeralNetworkManifest{}, fmt.Errorf("write ephemeral network manifest: %w", err)
	}
	for _, node := range nodes {
		for _, keyPath := range []string{filepath.Join(node.Home, "config", "priv_validator_key.json"), filepath.Join(node.Home, "data", "priv_validator_state.json"), filepath.Join(node.Home, "config", "node_key.json")} {
			info, err := os.Stat(keyPath)
			if err != nil || info.Mode().Perm()&0o077 != 0 {
				return EphemeralNetworkManifest{}, fmt.Errorf("ephemeral key file is missing or too permissive: %s", keyPath)
			}
		}
	}
	completed = true
	return manifest, nil
}

func validatePortRanges(options EphemeralNetworkOptions, count int) error {
	seen := map[int]struct{}{}
	for _, base := range []int{options.BaseP2P, options.BaseRPC, options.BaseABCI} {
		if base < 1024 || base+count-1 > 65535 {
			return fmt.Errorf("ephemeral network port range %d-%d is invalid", base, base+count-1)
		}
		for port := base; port < base+count; port++ {
			if _, exists := seen[port]; exists {
				return fmt.Errorf("ephemeral network port %d is reused", port)
			}
			seen[port] = struct{}{}
		}
	}
	return nil
}

func savePrivateValidator(privateValidator *privval.FilePV) (err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("CometBFT private validator write failed: %v", recovered)
		}
	}()
	privateValidator.Save()
	return nil
}

func writeCometConfig(path string, config *cmtconfig.Config) (err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("CometBFT config write failed: %v", recovered)
		}
	}()
	cmtconfig.WriteConfigFile(path, config)
	return nil
}
