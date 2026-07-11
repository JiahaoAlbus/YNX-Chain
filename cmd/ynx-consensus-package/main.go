package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func main() {
	verifyPackage := flag.String("verify-package", "", "verify an existing production candidate package and exit")
	migrationPath := flag.String("migration-state", "", "validated unbound YNX migration state")
	validatorManifestPath := flag.String("validator-manifest", "", "public-key-only production validator manifest")
	genesisTime := flag.String("genesis-time", "", "explicit whole-second UTC genesis time in RFC3339 format")
	output := flag.String("output", "", "new output directory for the production candidate package")
	flag.Parse()
	if strings.TrimSpace(*verifyPackage) != "" {
		if strings.TrimSpace(*migrationPath) != "" || strings.TrimSpace(*validatorManifestPath) != "" || strings.TrimSpace(*genesisTime) != "" || strings.TrimSpace(*output) != "" {
			fmt.Fprintln(os.Stderr, "-verify-package cannot be combined with package generation flags")
			os.Exit(1)
		}
		if err := consensus.VerifyProductionCandidatePackage(*verifyPackage); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Println("production BFT candidate package hashes and file boundaries passed")
		return
	}
	if err := run(*migrationPath, *validatorManifestPath, *genesisTime, *output); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(migrationPath, validatorManifestPath, genesisTimeValue, output string) error {
	for label, value := range map[string]string{"-migration-state": migrationPath, "-validator-manifest": validatorManifestPath, "-genesis-time": genesisTimeValue, "-output": output} {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("%s is required", label)
		}
	}
	migrationPayload, err := os.ReadFile(migrationPath)
	if err != nil {
		return fmt.Errorf("read migration state: %w", err)
	}
	var migration chain.ConsensusMigrationState
	if err := json.Unmarshal(migrationPayload, &migration); err != nil {
		return fmt.Errorf("decode migration state: %w", err)
	}
	manifestPayload, err := os.ReadFile(validatorManifestPath)
	if err != nil {
		return fmt.Errorf("read validator manifest: %w", err)
	}
	if strings.Contains(strings.ToLower(string(manifestPayload)), "priv_key") || strings.Contains(strings.ToLower(string(manifestPayload)), "privatekey") || strings.Contains(strings.ToLower(string(manifestPayload)), "mnemonic") {
		return errors.New("validator manifest must contain public metadata only")
	}
	var validatorManifest consensus.ProductionValidatorManifest
	if err := json.Unmarshal(manifestPayload, &validatorManifest); err != nil {
		return fmt.Errorf("decode validator manifest: %w", err)
	}
	parsedGenesisTime, err := time.Parse(time.RFC3339, genesisTimeValue)
	if err != nil {
		return fmt.Errorf("parse genesis time: %w", err)
	}
	result, err := consensus.GenerateProductionCandidatePackage(migration, validatorManifest, output, parsedGenesisTime)
	if err != nil {
		return err
	}
	fmt.Printf("production BFT candidate package ready: chain=%s roles=%d genesisHash=%s migrationStateHash=%s output=%s\n", result.ChainID, len(result.Roles), result.GenesisHash, result.MigrationStateHash, output)
	return nil
}
