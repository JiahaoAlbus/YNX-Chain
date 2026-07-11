package consensus

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	cmttypes "github.com/cometbft/cometbft/types"
)

func TestGenerateEphemeralNetworkBindsFourValidatorsWithoutExposingKeys(t *testing.T) {
	migration := fourValidatorMigration(t)
	root := filepath.Join(t.TempDir(), "quorum")
	manifest, err := GenerateEphemeralNetwork(migration, EphemeralNetworkOptions{RootDir: root, BaseP2P: 30656, BaseRPC: 30757, BaseABCI: 30858})
	if err != nil {
		t.Fatal(err)
	}
	if manifest.Purpose != "local-ephemeral-consensus-quorum-only-not-for-remote-or-custody" || len(manifest.Nodes) != 4 {
		t.Fatalf("unexpected ephemeral network manifest: %+v", manifest)
	}
	boundPayload, err := os.ReadFile(manifest.MigrationPath)
	if err != nil {
		t.Fatal(err)
	}
	var bound chain.ConsensusMigrationState
	if err := json.Unmarshal(boundPayload, &bound); err != nil {
		t.Fatal(err)
	}
	if err := bound.ValidateConsensusValidatorKeys(); err != nil {
		t.Fatal(err)
	}
	if bound.StateHash != manifest.MigrationStateHash || bound.StateHash == migration.StateHash {
		t.Fatal("bound migration hash is missing or unchanged")
	}

	nodeIDs := map[string]struct{}{}
	consensusAddresses := map[string]struct{}{}
	var firstGenesis []byte
	for _, node := range manifest.Nodes {
		if _, exists := nodeIDs[node.NodeID]; exists {
			t.Fatalf("duplicate node ID %s", node.NodeID)
		}
		nodeIDs[node.NodeID] = struct{}{}
		if _, exists := consensusAddresses[node.ConsensusAddress]; exists {
			t.Fatalf("duplicate consensus address %s", node.ConsensusAddress)
		}
		consensusAddresses[node.ConsensusAddress] = struct{}{}
		if strings.Count(node.PersistentPeers, ",") != 2 || strings.Contains(node.PersistentPeers, node.NodeID+"@") {
			t.Fatalf("validator %s persistent peer set is incomplete or self-referential: %s", node.ValidatorAddress, node.PersistentPeers)
		}
		for _, keyPath := range []string{
			filepath.Join(node.Home, "config", "priv_validator_key.json"),
			filepath.Join(node.Home, "data", "priv_validator_state.json"),
			filepath.Join(node.Home, "config", "node_key.json"),
		} {
			info, err := os.Stat(keyPath)
			if err != nil || info.Mode().Perm()&0o077 != 0 {
				t.Fatalf("ephemeral key file is missing or too permissive: path=%s info=%v err=%v", keyPath, info, err)
			}
		}
		genesisPath := filepath.Join(node.Home, "config", "genesis.json")
		genesisPayload, err := os.ReadFile(genesisPath)
		if err != nil {
			t.Fatal(err)
		}
		if firstGenesis == nil {
			firstGenesis = genesisPayload
		} else if !bytes.Equal(firstGenesis, genesisPayload) {
			t.Fatal("validators did not receive byte-identical genesis files")
		}
		genesis, err := cmttypes.GenesisDocFromJSON(genesisPayload)
		if err != nil {
			t.Fatal(err)
		}
		if genesis.ChainID != "ynx_6423-1" || genesis.InitialHeight != int64(bound.Height)+1 || len(genesis.Validators) != 4 || !bytes.Equal(genesis.AppHash, mustHash(t, bound.StateHash)) {
			t.Fatalf("unexpected generated genesis: %+v", genesis)
		}
		configPayload, err := os.ReadFile(filepath.Join(node.Home, "config", "config.toml"))
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Contains(configPayload, []byte(node.ABCIListen)) || !bytes.Contains(configPayload, []byte(node.PersistentPeers)) || !bytes.Contains(configPayload, []byte("allow_duplicate_ip = true")) {
			t.Fatalf("validator %s config is missing ABCI or peer wiring", node.ValidatorAddress)
		}
	}
	manifestPayload, err := os.ReadFile(filepath.Join(root, "network-manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(manifestPayload, []byte("priv_key")) || bytes.Contains(manifestPayload, []byte("privateKey")) {
		t.Fatal("public ephemeral network manifest contains private key material")
	}
}

func TestGenerateEphemeralNetworkRefusesExistingOutputAndOverlappingPorts(t *testing.T) {
	migration := fourValidatorMigration(t)
	root := filepath.Join(t.TempDir(), "existing")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(root, "keep")
	if err := os.WriteFile(marker, []byte("preserve"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := GenerateEphemeralNetwork(migration, EphemeralNetworkOptions{RootDir: root, BaseP2P: 31656, BaseRPC: 31757, BaseABCI: 31858}); err == nil {
		t.Fatal("existing output directory was overwritten")
	}
	if payload, err := os.ReadFile(marker); err != nil || string(payload) != "preserve" {
		t.Fatal("existing output content was modified")
	}
	if _, err := GenerateEphemeralNetwork(migration, EphemeralNetworkOptions{RootDir: filepath.Join(t.TempDir(), "ports"), BaseP2P: 32656, BaseRPC: 32658, BaseABCI: 32858}); err == nil {
		t.Fatal("overlapping ephemeral port ranges were accepted")
	}
}

func TestGenerateEphemeralNetworkRejectsInactiveValidator(t *testing.T) {
	validators := []chain.Validator{
		{Address: "ynx_validator_primary", Moniker: "ynx-primary", VotingPower: 1, Active: true},
		{Address: "ynx_validator_singapore", Moniker: "ynx-singapore", VotingPower: 1, Active: true},
		{Address: "ynx_validator_silicon_valley", Moniker: "ynx-silicon-valley", VotingPower: 1, Active: true},
		{Address: "ynx_validator_seoul", Moniker: "ynx-seoul", VotingPower: 1, Active: false},
	}
	devnet := chain.NewDevnetWithValidators(chain.DefaultNetworkConfig("testnet"), validators)
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := GenerateEphemeralNetwork(migration, EphemeralNetworkOptions{RootDir: filepath.Join(t.TempDir(), "inactive"), BaseP2P: 33656, BaseRPC: 33757, BaseABCI: 33858}); err == nil || !strings.Contains(err.Error(), "must be active") {
		t.Fatalf("inactive validator was not rejected: %v", err)
	}
}

func fourValidatorMigration(t *testing.T) chain.ConsensusMigrationState {
	t.Helper()
	validators := []chain.Validator{
		{Address: "ynx_validator_primary", Moniker: "ynx-primary", VotingPower: 1, Active: true},
		{Address: "ynx_validator_singapore", Moniker: "ynx-singapore", VotingPower: 1, Active: true},
		{Address: "ynx_validator_silicon_valley", Moniker: "ynx-silicon-valley", VotingPower: 1, Active: true},
		{Address: "ynx_validator_seoul", Moniker: "ynx-seoul", VotingPower: 1, Active: true},
	}
	devnet := chain.NewDevnetWithValidators(chain.DefaultNetworkConfig("testnet"), validators)
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	return migration
}
