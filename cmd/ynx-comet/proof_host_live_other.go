//go:build !unix

package main

import (
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/cometbft/cometbft/node"
	"github.com/spf13/cobra"
)

func prepareOperatorProofHostLive(_ *node.Node, _ *consensus.Application, p pqOptions) (operatorProofHostLive, error) {
	if !p.proofLiveConfigured() {
		return nil, nil
	}
	return nil, errors.New("live DATA capture requires the original Unix private source controls")
}
func newRequestProofHostSourceCommand() *cobra.Command {
	return &cobra.Command{Use: "request-proof-host-source", Args: cobra.NoArgs, PersistentPreRunE: func(*cobra.Command, []string) error { return nil }, RunE: func(*cobra.Command, []string) error {
		return errors.New("live DATA request publication requires the original Linux operator entry point")
	}}
}
