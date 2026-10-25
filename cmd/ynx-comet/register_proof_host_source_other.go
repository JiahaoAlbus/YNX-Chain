//go:build !unix

package main

import (
	"errors"

	"github.com/spf13/cobra"
)

func newRegisterProofHostSourceCommand() *cobra.Command {
	return &cobra.Command{Use: "register-proof-host-source", Args: cobra.NoArgs, SilenceUsage: true, SilenceErrors: true,
		PersistentPreRunE: func(*cobra.Command, []string) error { return nil },
		RunE: func(*cobra.Command, []string) error {
			return errors.New("proof source catalog registration requires original Unix private inode and exclusive delivery support")
		},
	}
}
