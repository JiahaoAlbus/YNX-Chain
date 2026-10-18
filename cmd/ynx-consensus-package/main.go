package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"golang.org/x/sys/unix"
)

func main() {
	if err := runCommand(os.Args[1:], os.Stdout, os.Stderr); err != nil && !errors.Is(err, flag.ErrHelp) {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

// Read only the exact public operator document selected by an independent pin.
// No source rewrite, symlink traversal, pipe read, or unbounded allocation.
func readPinnedOperatorPlan(path, expected string, maximum int64) ([]byte, error) {
	pin, err := hex.DecodeString(expected)
	if err != nil || len(pin) != sha256.Size || hex.EncodeToString(pin) != expected || bytes.Equal(pin, make([]byte, sha256.Size)) {
		return nil, errors.New("operator plan requires an independent nonzero lowercase SHA256 pin")
	}
	if maximum <= 0 {
		return nil, errors.New("invalid operator plan size bound")
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("operator plan path: %w", err)
	}
	resolved, err := filepath.EvalSymlinks(absolute)
	if err != nil || resolved != absolute {
		return nil, errors.New("operator plan must be an existing original file without symlink traversal")
	}
	fd, err := unix.Open(absolute, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, fmt.Errorf("open operator plan: %w", err)
	}
	file := os.NewFile(uintptr(fd), "public-operator-plan")
	defer file.Close()
	before, err := file.Stat()
	if err != nil || !before.Mode().IsRegular() || before.Size() <= 0 || before.Size() > maximum {
		return nil, errors.New("operator plan must be a nonempty bounded regular file")
	}
	raw, err := io.ReadAll(io.LimitReader(file, maximum+1))
	if err != nil || int64(len(raw)) != before.Size() || int64(len(raw)) > maximum {
		return nil, errors.New("operator plan changed or exceeded its bound during read")
	}
	after, statErr := file.Stat()
	current, pathErr := os.Lstat(absolute)
	same := func(info os.FileInfo) bool {
		return info != nil && os.SameFile(before, info) && before.Mode() == info.Mode() && before.Size() == info.Size() && before.ModTime().Equal(info.ModTime())
	}
	if statErr != nil || pathErr != nil || !same(after) || !same(current) {
		return nil, errors.New("operator plan original changed during read")
	}
	digest := sha256.Sum256(raw)
	if !bytes.Equal(digest[:], pin) {
		return nil, errors.New("operator plan differs from its independent SHA256 pin")
	}
	return raw, nil
}

func runCommand(args []string, stdout, stderr io.Writer) error {
	flags := flag.NewFlagSet("ynx-consensus-package", flag.ContinueOnError)
	flags.SetOutput(stderr)
	supplied := make(map[string]bool)
	stringFlag := func(name, usage string) *string {
		value := new(string)
		flags.Func(name, usage, func(input string) error {
			if supplied[name] {
				return fmt.Errorf("duplicate -%s", name)
			}
			supplied[name] = true
			*value = input
			return nil
		})
		return value
	}
	verifyPackage := stringFlag("verify-package", "verify an existing production candidate package and exit")
	verifyMigration := stringFlag("verify-migration-state", "verify one unbound YNX migration state and exit")
	verifyExecution := stringFlag("verify-migration-execution", "read-only migration executor compatibility check; no validator binding, application restore, deployment, InitChain or PQ activation")
	migrationPath := stringFlag("migration-state", "validated unbound YNX migration state")
	validatorManifestPath := stringFlag("validator-manifest", "public-key-only production validator manifest")
	genesisTime := stringFlag("genesis-time", "explicit whole-second UTC genesis time in RFC3339 format")
	output := stringFlag("output", "new output directory for the production candidate package")
	operatorPlan := stringFlag("operator-plan", "existing public operator plan for the single-Application package; requires -operator-plan-hash")
	operatorPlanHash := stringFlag("operator-plan-hash", "independent lowercase SHA256 pin of the exact operator plan bytes")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("unexpected positional arguments")
	}
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
		for _, name := range []string{"migration-state", "validator-manifest", "genesis-time", "output", "operator-plan"} {
			if supplied[name] {
				return fmt.Errorf("-%s cannot be combined with package generation flags", mode)
			}
		}
		if supplied["operator-plan-hash"] && (mode != "verify-package" || strings.TrimSpace(*operatorPlanHash) == "") {
			return errors.New("-operator-plan-hash is allowed only for pinned package generation or -verify-package with a nonempty independent pin")
		}
		modeInput := map[string]string{"verify-package": *verifyPackage, "verify-migration-state": *verifyMigration, "verify-migration-execution": *verifyExecution}
		if strings.TrimSpace(modeInput[mode]) == "" {
			return fmt.Errorf("-%s requires an existing input path", mode)
		}
	}
	if mode == "" && (supplied["operator-plan"] != supplied["operator-plan-hash"] || (supplied["operator-plan"] && (strings.TrimSpace(*operatorPlan) == "" || strings.TrimSpace(*operatorPlanHash) == ""))) {
		return errors.New("-operator-plan and -operator-plan-hash must be supplied together and nonempty")
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
		if supplied["operator-plan-hash"] {
			if err := consensus.VerifyProductionOperatorCandidatePackage(*verifyPackage, *operatorPlanHash); err != nil {
				return err
			}
			_, err := fmt.Fprintf(stdout, "production BFT candidate package hashes and file boundaries passed: mode=single-app-operator source=independently-pinned-public-operator-plan operatorPlanHash=%s runtimeStarted=false deployment=not-performed pqActivation=not-performed\n", *operatorPlanHash)
			return err
		}
		if err := consensus.VerifyProductionCandidatePackage(*verifyPackage); err != nil {
			return err
		}
		_, err := fmt.Fprintln(stdout, "production BFT candidate package hashes and file boundaries passed: mode=legacy-external-abci runtimeStarted=false deployment=not-performed pqActivation=not-performed")
		return err
	default:
		var rawPlan []byte
		if supplied["operator-plan"] {
			var err error
			rawPlan, err = readPinnedOperatorPlan(*operatorPlan, *operatorPlanHash, consensus.MaxProductionOperatorPlanBytes)
			if err != nil {
				return err
			}
		}
		return runGeneration(*migrationPath, *validatorManifestPath, *genesisTime, *output, rawPlan, *operatorPlanHash, stdout)
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
	return runGeneration(migrationPath, validatorManifestPath, genesisTimeValue, output, nil, "", os.Stdout)
}

func runGeneration(migrationPath, validatorManifestPath, genesisTimeValue, output string, rawPlan []byte, planHash string, stdout io.Writer) error {
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
	var result consensus.ProductionCandidatePackageManifest
	mode, source := "legacy-external-abci", "original-migration-and-validator-manifest"
	if rawPlan != nil {
		result, err = consensus.GenerateProductionCandidatePackageWithOperator(migration, validatorManifest, output, parsedGenesisTime, rawPlan, planHash)
		mode, source = "single-app-operator", "independently-pinned-public-operator-plan"
	} else {
		result, err = consensus.GenerateProductionCandidatePackage(migration, validatorManifest, output, parsedGenesisTime)
	}
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(stdout, "production BFT candidate package ready: chain=%s roles=%d genesisHash=%s migrationStateHash=%s output=%s mode=%s source=%s operatorPlanHash=%s runtimeStarted=false deployment=not-performed pqActivation=not-performed\n", result.ChainID, len(result.Roles), result.GenesisHash, result.MigrationStateHash, output, mode, source, planHash)
	return err
}
