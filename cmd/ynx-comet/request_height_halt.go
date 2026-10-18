package main

import (
	"encoding/json"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/cometbft/cometbft/node"
	"github.com/spf13/cobra"
)

func newRequestHeightHaltCommand() *cobra.Command {
	var request, requestSHA256 string
	var options consensus.HeightHaltPublicationOptions
	command := &cobra.Command{
		Use: "request-height-halt", Short: "Publish one independently approved height-halt request without replacement",
		Args: cobra.NoArgs, SilenceUsage: true, SilenceErrors: true,
		// This is a file publisher, never Comet ParseConfig/EnsureRoot/Node.Start.
		PersistentPreRunE: func(*cobra.Command, []string) error { return nil },
		RunE: func(command *cobra.Command, _ []string) error {
			raw, err := readInitializationInput(request, node.MaxHeightHaltRequestBytes)
			if err != nil {
				return err
			}
			result, err := consensus.PublishHeightHaltRequest(raw, requestSHA256, options)
			if err != nil {
				return err
			}
			return json.NewEncoder(command.OutOrStdout()).Encode(result)
		},
	}
	for _, flag := range []struct {
		name, help string
		value      *string
	}{
		{"request", "exact existing public six-field approved request", &request},
		{"request-sha256", "independent SHA256 of the exact original request bytes", &requestSHA256},
		{"abci-state", "existing original private application state; only its identity is inspected", &options.ApplicationStatePath},
		{"height-halt-control", "exact approved session path under the original application directory", &options.Control.Path},
		{"chain-id", "independently configured original Comet chain ID", &options.Control.ChainID},
		{"consensus-genesis-sha256", "independent original Comet genesis SHA256", &options.Control.GenesisSHA256},
		{"operator-plan-sha256", "independent original full operator plan SHA256", &options.Control.OperatorPlanSHA256},
		{"height-halt-session-id", "independently approved exact session identity", &options.Control.SessionID},
	} {
		command.Flags().Var(&initializationStringFlag{target: flag.value}, flag.name, flag.help)
		if err := command.MarkFlagRequired(flag.name); err != nil {
			panic(err)
		}
	}
	return command
}
