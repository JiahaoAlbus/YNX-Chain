//go:build !unix

package main

import (
	"errors"
	"github.com/spf13/cobra"
)

func newExportProofHostSourceCommand() *cobra.Command {
	return &cobra.Command{Use: "export-proof-host-source", Args: cobra.NoArgs, SilenceUsage: true, SilenceErrors: true, PersistentPreRunE: func(*cobra.Command, []string) error { return nil }, RunE: func(*cobra.Command, []string) error {
		return errors.New("proof Host source publication requires the original Unix readonly locking and exclusive delivery support")
	}}
}
