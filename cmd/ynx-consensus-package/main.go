package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func main() {
	if err := runCommand(os.Args[1:], os.Stdout, os.Stderr); err != nil && !errors.Is(err, flag.ErrHelp) {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func runCommand(args []string, stdout, stderr io.Writer) error {
	flags := flag.NewFlagSet("ynx-consensus-package", flag.ContinueOnError)
	flags.SetOutput(stderr)
	verifyPackage := flags.String("verify-package", "", "verify an existing production candidate package and exit")
	verifyMigration := flags.String("verify-migration-state", "", "verify one unbound YNX migration state and exit")
	verifyExecution := flags.String("verify-migration-execution", "", "read-only migration executor compatibility check; no validator binding, application restore, deployment, InitChain or PQ activation")
	migrationPath := flags.String("migration-state", "", "validated unbound YNX migration state")
	validatorManifestPath := flags.String("validator-manifest", "", "public-key-only production validator manifest")
	genesisTime := flags.String("genesis-time", "", "explicit whole-second UTC genesis time in RFC3339 format")
	output := flags.String("output", "", "new output directory for the production candidate package")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("unexpected positional arguments")
	}
	supplied := make(map[string]bool)
	flags.Visit(func(f *flag.Flag) { supplied[f.Name] = true })
	mode := ""
	for _, name := range []string{"verify-package", "verify-migration-state", "verify-migration-execution"} {
		if supplied[name] {
			if mode != "" {
				return errors.New("verification modes are mutually exclusive")
			}
			mode = name
		}
	}
	if mode != "" {
		for _, name := range []string{"migration-state", "validator-manifest", "genesis-time", "output"} {
			if supplied[name] {
				return fmt.Errorf("-%s cannot be combined with package generation flags", mode)
			}
		}
		if strings.TrimSpace(flags.Lookup(mode).Value.String()) == "" {
			return fmt.Errorf("-%s requires an existing input path", mode)
		}
	}
	switch mode {
	case "verify-migration-state":
		migration, err := verifyMigrationState(*verifyMigration)
		if err != nil {
			return err
		}
		_, err = fmt.Fprintf(stdout, "consensus migration state passed: height=%d lastBlockHash=%s stateHash=%s accounts=%d validators=%d\n", migration.Height, migration.LastBlockHash, migration.StateHash, len(migration.Accounts), len(migration.Validators))
		return err
	case "verify-migration-execution":
		migration, err := verifyMigrationExecution(*verifyExecution)
		if err != nil {
			return err
		}
		_, err = fmt.Fprintf(stdout, "consensus migration execution passed: height=%d lastBlockHash=%s stateHash=%s blockers=0 scope=executor-compatibility-only validatorBinding=unchecked applicationRestore=unchecked deployment=not-performed initChain=not-performed pqActivation=not-performed\n", migration.Height, migration.LastBlockHash, migration.StateHash)
		return err
	case "verify-package":
		if err := consensus.VerifyProductionCandidatePackage(*verifyPackage); err != nil {
			return err
		}
		_, err := fmt.Fprintln(stdout, "production BFT candidate package hashes and file boundaries passed")
		return err
	default:
		return run(*migrationPath, *validatorManifestPath, *genesisTime, *output)
	}
}

func verifyMigrationState(path string) (chain.ConsensusMigrationState, error) {
	payload, err := os.ReadFile(path)
	if err != nil {
		return chain.ConsensusMigrationState{}, fmt.Errorf("read migration state: %w", err)
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	var migration chain.ConsensusMigrationState
	if err := decoder.Decode(&migration); err != nil {
		return chain.ConsensusMigrationState{}, fmt.Errorf("decode migration state: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return chain.ConsensusMigrationState{}, errors.New("migration state contains trailing JSON data")
	}
	if err := migration.Validate(); err != nil {
		return chain.ConsensusMigrationState{}, fmt.Errorf("validate migration state: %w", err)
	}
	return migration, nil
}

// This checks the preserved source's actual executor compatibility manifest.
// It deliberately accepts unbound source validators: no validator authority,
// full Application restore, InitChain, deployment or PQ activation is implied.
func verifyMigrationExecution(path string) (chain.ConsensusMigrationState, error) {
	migration, err := verifyMigrationState(path)
	if err != nil {
		return chain.ConsensusMigrationState{}, err
	}
	if blockers := consensus.MigrationExecutionBlockers(migration); len(blockers) != 0 {
		payload, err := json.Marshal(blockers)
		if err != nil {
			return chain.ConsensusMigrationState{}, fmt.Errorf("encode migration execution blockers: %w", err)
		}
		return chain.ConsensusMigrationState{}, fmt.Errorf("consensus migration execution blocked: %s", payload)
	}
	return migration, nil
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
