package main

import (
	"encoding/json"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/spf13/cobra"
	"io"
)

func newInspectFreshApplicationCommand() *cobra.Command {
	var options initializeApplicationFlags
	command := &cobra.Command{Use: "inspect-fresh-application", Short: "Read an existing fresh application without node, signing custody, database or writes", Args: cobra.NoArgs, SilenceUsage: true, SilenceErrors: true, PersistentPreRunE: func(*cobra.Command, []string) error { return nil }, RunE: func(c *cobra.Command, _ []string) error { return runInspectFreshApplication(c.OutOrStdout(), options) }}
	for _, flag := range []struct {
		name, help string
		value      *string
	}{
		{"consensus-genesis", "exact existing independently pinned Comet genesis", &options.genesis},
		{"migration-state", "existing complete original bound migration", &options.migration},
		{"abci-state", "existing original fresh application state, never a new destination", &options.state},
		{"abci-state-layout", "explicit original atomic-json, snapshot-journal or block-journal", &options.layout},
		{"consensus-genesis-sha256", "independent original Comet genesis SHA256", &options.genesisHash},
		{"original-genesis-hash", "independent original native genesis pin", &options.originalGenesisHash},
		{"bound-migration-state-hash", "independent complete bound migration pin", &options.migrationHash},
	} {
		command.Flags().Var(&initializationStringFlag{target: flag.value}, flag.name, flag.help)
		if err := command.MarkFlagRequired(flag.name); err != nil {
			panic(err)
		}
	}
	return command
}

func runInspectFreshApplication(output io.Writer, options initializeApplicationFlags) error {
	genesis, err := readInitializationInput(options.genesis, 64<<20)
	if err != nil {
		return err
	}
	migration, err := readInitializationMigration(options.migration, 1<<30, nil)
	if err != nil {
		return err
	}
	result, err := consensus.InspectFreshApplication(migration, genesis, consensus.ConsensusBootstrapPins{CometGenesisSHA256: options.genesisHash, OriginalGenesisHash: options.originalGenesisHash, MigrationStateHash: options.migrationHash}, consensus.FreshApplicationInspectionOptions{StatePath: options.state, StateLayout: options.layout})
	if err != nil {
		return err
	}
	return json.NewEncoder(output).Encode(result)
}
