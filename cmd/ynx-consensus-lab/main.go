package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func main() {
	output := flag.String("output", "", "new directory for the ephemeral four-validator network")
	migrationPath := flag.String("migration-state", "", "validated unbound YNX migration state")
	localFixture := flag.Bool("local-fixture", false, "create a local-only four-validator migration fixture")
	ephemeral := flag.Bool("ephemeral", false, "required acknowledgement that generated keys are local-only and disposable")
	baseP2P := flag.Int("base-p2p-port", 27656, "first local P2P port")
	baseRPC := flag.Int("base-rpc-port", 27757, "first local RPC port")
	baseABCI := flag.Int("base-abci-port", 27858, "first local ABCI port")
	flag.Parse()
	if err := run(*output, *migrationPath, *localFixture, *ephemeral, *baseP2P, *baseRPC, *baseABCI); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(output, migrationPath string, localFixture, ephemeral bool, baseP2P, baseRPC, baseABCI int) error {
	if !ephemeral {
		return errors.New("-ephemeral acknowledgement is required; generated keys must never be used for remote testnet or custody")
	}
	if strings.TrimSpace(output) == "" {
		return errors.New("-output is required")
	}
	if localFixture == (strings.TrimSpace(migrationPath) != "") {
		return errors.New("choose exactly one of -local-fixture or -migration-state")
	}
	var migration chain.ConsensusMigrationState
	var fixtureSigner *secp256k1.PrivateKey
	var err error
	if localFixture {
		migration, fixtureSigner, err = localMigrationFixture()
	} else {
		payload, readErr := os.ReadFile(migrationPath)
		if readErr != nil {
			return fmt.Errorf("read migration state: %w", readErr)
		}
		if decodeErr := json.Unmarshal(payload, &migration); decodeErr != nil {
			return fmt.Errorf("decode migration state: %w", decodeErr)
		}
		err = migration.Validate()
	}
	if err != nil {
		return fmt.Errorf("prepare migration state: %w", err)
	}
	manifest, err := consensus.GenerateEphemeralNetwork(migration, consensus.EphemeralNetworkOptions{
		RootDir:  output,
		BaseP2P:  baseP2P,
		BaseRPC:  baseRPC,
		BaseABCI: baseABCI,
	})
	if err != nil {
		return err
	}
	completed := false
	defer func() {
		if !completed {
			_ = os.RemoveAll(output)
		}
	}()
	if fixtureSigner != nil {
		signerPath := filepath.Join(output, "fixture-signer.key")
		if err := os.WriteFile(signerPath, fixtureSigner.Serialize(), 0o600); err != nil {
			return fmt.Errorf("write ephemeral fixture signer: %w", err)
		}
		signerAddress, err := consensus.NativeAddress(fixtureSigner.PubKey().SerializeCompressed())
		if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(output, "fixture-signer-address"), []byte(signerAddress+"\n"), 0o600); err != nil {
			return fmt.Errorf("write ephemeral fixture signer address: %w", err)
		}
	}
	completed = true
	fmt.Printf("ephemeral YNX consensus lab ready: chain=%s validators=%d manifest=%s\n", manifest.ChainID, len(manifest.Nodes), strings.TrimRight(output, "/")+"/network-manifest.json")
	return nil
}

func localMigrationFixture() (chain.ConsensusMigrationState, *secp256k1.PrivateKey, error) {
	validators := []chain.Validator{
		{Address: "ynx_validator_primary", Moniker: "ynx-primary", VotingPower: 1, Active: true},
		{Address: "ynx_validator_singapore", Moniker: "ynx-singapore", VotingPower: 1, Active: true},
		{Address: "ynx_validator_silicon_valley", Moniker: "ynx-silicon-valley", VotingPower: 1, Active: true},
		{Address: "ynx_validator_seoul", Moniker: "ynx-seoul", VotingPower: 1, Active: true},
	}
	devnet := chain.NewDevnetWithValidators(chain.DefaultNetworkConfig("testnet"), validators)
	fixtureSigner, err := secp256k1.GeneratePrivateKey()
	if err != nil {
		return chain.ConsensusMigrationState{}, nil, err
	}
	fixtureAddress, err := consensus.NativeAddress(fixtureSigner.PubKey().SerializeCompressed())
	if err != nil {
		return chain.ConsensusMigrationState{}, nil, err
	}
	if _, err := devnet.Faucet(fixtureAddress, 1000); err != nil {
		return chain.ConsensusMigrationState{}, nil, err
	}
	devnet.ProduceBlock()
	migration, err := devnet.ExportConsensusMigrationState()
	return migration, fixtureSigner, err
}
