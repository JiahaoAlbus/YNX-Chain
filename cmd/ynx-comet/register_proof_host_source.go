//go:build unix

package main

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/spf13/cobra"
)

// Register existing public DATA after the original SourceOwner independently
// qualifies its delivery and binding. This bypasses EnsureRoot, never Node.Start.
func newRegisterProofHostSourceCommand() *cobra.Command {
	var manifest, manifestPin, binding, bindingPin, output, walletOutput string
	c := &cobra.Command{Use: "register-proof-host-source", Short: "Register one independently pinned original proof source DATA catalog; no Root or Host grant",
		Args: cobra.NoArgs, SilenceUsage: true, SilenceErrors: true,
		PersistentPreRunE: func(*cobra.Command, []string) error { return nil },
		RunE: func(cmd *cobra.Command, _ []string) (resultErr error) {
			var wallet *proofHostWalletHandoff
			if walletOutput != "" {
				if walletOutput == output {
					return errors.New("catalog and Wallet source handoff must be distinct new files")
				}
				var err error
				wallet, err = prepareProofHostWalletHandoff(walletOutput)
				if err != nil {
					return err
				}
				defer func() { resultErr = errors.Join(resultErr, wallet.close()) }()
			}
			receipt, err := consensus.RegisterProofHostSourceCatalog(manifest, manifestPin, binding, bindingPin, output)
			if err != nil {
				return err
			}
			if wallet != nil {
				if err = wallet.write(receipt, binding, bindingPin, nil); err != nil {
					return fmt.Errorf("registered catalog retained; Wallet handoff may be partial/UNKNOWN: %w", err)
				}
				if err = wallet.close(); err != nil {
					return fmt.Errorf("registered catalog and Wallet handoff retained; close UNKNOWN: %w", err)
				}
			}
			// Failed stdout retains the exclusive catalog for reconciliation.
			if err = json.NewEncoder(cmd.OutOrStdout()).Encode(receipt); err != nil && wallet != nil {
				return fmt.Errorf("registered catalog and Wallet handoff retained; stdout UNKNOWN: %w", err)
			}
			return err
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
	c.Flags().Var(&initializationStringFlag{target: &walletOutput}, "wallet-main-registration-output", "optional new fixed-name private Wallet source module; DATA handoff only, no install or Root grant")
	return c
}
