//go:build unix

package main

import (
	"encoding/json"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/spf13/cobra"
)

// Register existing public DATA after the original SourceOwner independently
// qualifies its delivery and binding. This bypasses EnsureRoot, never Node.Start.
func newRegisterProofHostSourceCommand() *cobra.Command {
	var manifest, manifestPin, binding, bindingPin, output string
	c := &cobra.Command{Use: "register-proof-host-source", Short: "Register one independently pinned original proof source DATA catalog; no Root or Host grant",
		Args: cobra.NoArgs, SilenceUsage: true, SilenceErrors: true,
		PersistentPreRunE: func(*cobra.Command, []string) error { return nil },
		RunE: func(cmd *cobra.Command, _ []string) error {
			receipt, err := consensus.RegisterProofHostSourceCatalog(manifest, manifestPin, binding, bindingPin, output)
			if err != nil {
				return err
			}
			// Failed stdout retains the exclusive catalog for reconciliation.
			return json.NewEncoder(cmd.OutOrStdout()).Encode(receipt)
		},
	}
	for _, option := range []struct {
		name string
		dest *string
		help string
	}{
		{"delivery-manifest", &manifest, "existing original delivery.json, not a capture or RPC endpoint"},
		{"delivery-manifest-sha256", &manifestPin, "independent SHA256 of the complete original delivery manifest"},
		{"binding", &binding, "independent original operation/account/network and both transaction hashes"},
		{"binding-sha256", &bindingPin, "independent SHA256 of the complete original binding file"},
		{"output", &output, "new exclusive 0600 catalog beneath an existing private 0700 parent"},
	} {
		c.Flags().Var(&initializationStringFlag{target: option.dest}, option.name, option.help)
		if err := c.MarkFlagRequired(option.name); err != nil {
			panic(err)
		}
	}
	return c
}
