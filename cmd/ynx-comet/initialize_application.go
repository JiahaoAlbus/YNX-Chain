package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/spf13/cobra"
)

type initializeApplicationFlags struct {
	genesis, migration, state, layout               string
	genesisHash, originalGenesisHash, migrationHash string
	runtimePlan, runtimePlanHash                    string
}

// This explicit offline command does not parse Comet's runtime config: its
// inherited ParseConfig pre-run would create a home/config directory. Every
// input and the new destination is supplied directly, without keys or a node.
func newInitializeApplicationCommand() *cobra.Command {
	var options initializeApplicationFlags
	command := &cobra.Command{
		Use:               "initialize-application",
		Short:             "Initialize a new private single-App state from independently pinned native migration",
		Args:              cobra.NoArgs,
		SilenceUsage:      true,
		SilenceErrors:     true,
		PersistentPreRunE: func(*cobra.Command, []string) error { return nil },
		RunE: func(command *cobra.Command, _ []string) error {
			return runInitializeApplication(command.OutOrStdout(), options)
		},
	}
	for _, flag := range []struct {
		name, help string
		value      *string
		required   bool
	}{
		{"consensus-genesis", "existing exact original Comet genesis JSON", &options.genesis, true},
		{"migration-state", "existing complete original key-bound migration JSON", &options.migration, true},
		{"abci-state", "exact absolute state path inside a destination directory which does not exist", &options.state, true},
		{"abci-state-layout", "explicit atomic-json, snapshot-journal or block-journal", &options.layout, true},
		{"consensus-genesis-sha256", "independent exact raw Comet genesis SHA256", &options.genesisHash, true},
		{"original-genesis-hash", "independent original native genesis hash", &options.originalGenesisHash, true},
		{"bound-migration-state-hash", "independent complete bound migration hash", &options.migrationHash, true},
		{"runtime-upgrade-plan", "independently authorized historical runtime plan (cannot replace an existing checkpoint)", &options.runtimePlan, false},
		{"runtime-upgrade-plan-hash", "independent exact historical runtime plan hash", &options.runtimePlanHash, false},
	} {
		command.Flags().Var(&initializationStringFlag{target: flag.value}, flag.name, flag.help)
		if flag.required {
			if err := command.MarkFlagRequired(flag.name); err != nil {
				panic(err)
			}
		}
	}
	return command
}

// Duplicate operator flags must not silently replace an independently
// approved path or hash with the last value accepted by a general flag parser.
type initializationStringFlag struct {
	target *string
	set    bool
}

func (f *initializationStringFlag) String() string { return *f.target }
func (f *initializationStringFlag) Type() string   { return "string" }
func (f *initializationStringFlag) Set(value string) error {
	if f.set || value == "" || strings.TrimSpace(value) != value {
		return errors.New("initialization flags require exactly one nonempty exact value")
	}
	f.set = true
	*f.target = value
	return nil
}

func runInitializeApplication(output io.Writer, options initializeApplicationFlags) error {
	rawGenesis, err := readInitializationInput(options.genesis, 64<<20)
	if err != nil {
		return fmt.Errorf("read original consensus genesis: %w", err)
	}
	rawMigration, err := readInitializationInput(options.migration, 1<<30)
	if err != nil {
		return fmt.Errorf("read complete original migration: %w", err)
	}
	var migration chain.ConsensusMigrationState
	var compactMigration bytes.Buffer
	if err = json.Compact(&compactMigration, rawMigration); err != nil {
		return fmt.Errorf("decode complete migration JSON: %w", err)
	}
	if err = decodeStrict(compactMigration.Bytes(), &migration); err != nil {
		return fmt.Errorf("decode canonical complete migration: %w", err)
	}
	pins := consensus.ConsensusBootstrapPins{CometGenesisSHA256: options.genesisHash, OriginalGenesisHash: options.originalGenesisHash, MigrationStateHash: options.migrationHash}
	bootstrap, err := consensus.NewConsensusBootstrap(rawGenesis, pins, migration)
	if err != nil {
		return err
	}
	runtime, err := consensus.LoadRuntimeUpgradeAuthorization(options.runtimePlan, options.runtimePlanHash, bootstrap, migration)
	if err != nil {
		return err
	}
	result, err := consensus.InitializeApplication(migration, rawGenesis, pins, consensus.ApplicationInitializationOptions{StatePath: options.state, StateLayout: options.layout, RuntimeUpgrade: runtime})
	if err != nil {
		return err
	}
	return json.NewEncoder(output).Encode(result)
}

func readInitializationInput(path string, maximum int64) ([]byte, error) {
	if path == "" || !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return nil, errors.New("initialization inputs require exact absolute file paths")
	}
	before, err := os.Lstat(path)
	if err != nil || !before.Mode().IsRegular() || before.Size() <= 0 || before.Size() > maximum {
		return nil, errors.New("initialization input must be an existing bounded regular file without a symlink")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !os.SameFile(before, opened) {
		return nil, errors.New("initialization input replaced while opening")
	}
	raw, err := io.ReadAll(io.LimitReader(f, maximum+1))
	if err != nil || int64(len(raw)) != before.Size() {
		return nil, errors.New("initialization input changed or exceeded its original bounds")
	}
	after, err := os.Lstat(path)
	if err != nil || !os.SameFile(before, after) || before.Size() != after.Size() || !before.ModTime().Equal(after.ModTime()) {
		return nil, errors.New("initialization input changed during bounded read")
	}
	return raw, nil
}
