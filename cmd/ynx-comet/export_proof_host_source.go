//go:build unix

package main

import (
	"encoding/json"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/spf13/cobra"
)

// The normal operator command publishes from the stopped original stores. It
// does not inherit Comet's EnsureRoot, start a node, call RPC or create keys.
func newExportProofHostSourceCommand() *cobra.Command {
	var planPath, planHash, destination string
	command := &cobra.Command{
		Use: "export-proof-host-source", Short: "Export public proof Host material from independently pinned stopped original ledger stores",
		Args: cobra.NoArgs, SilenceUsage: true, SilenceErrors: true,
		PersistentPreRunE: func(*cobra.Command, []string) error { return nil },
		RunE: func(command *cobra.Command, _ []string) error {
			raw, err := readInitializationInput(planPath, consensus.MaxProofHostSourcePlanBytes)
			if err != nil {
				return err
			}
			captured, err := consensus.ExportStoppedProofHostSource(raw, planHash, destination, time.Now().UTC())
			if err != nil {
				return err
			}
			receipt, err := consensus.WriteProofHostDelivery(destination, captured)
			if err != nil {
				return err
			}
			// A stdout failure retains the committed delivery. Never replay or
			// remove it; the operator reconciles its original manifest/pins.
			return json.NewEncoder(command.OutOrStdout()).Encode(receipt)
		},
	}
	for _, f := range []struct {
		name  string
		value *string
		help  string
	}{
		{"source-plan", &planPath, "original explicit operator source/trust/operation plan"},
		{"source-plan-sha256", &planHash, "independent SHA256 of the exact complete source plan bytes"},
		{"output", &destination, "exclusive new public delivery directory beneath an existing private parent"},
	} {
		command.Flags().Var(&initializationStringFlag{target: f.value}, f.name, f.help)
		if err := command.MarkFlagRequired(f.name); err != nil {
			panic(err)
		}
	}
	return command
}
