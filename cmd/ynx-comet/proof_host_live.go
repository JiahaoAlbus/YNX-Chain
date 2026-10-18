//go:build unix

package main

import (
	"encoding/json"
	"errors"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/cometbft/cometbft/node"
	"github.com/spf13/cobra"
)

func prepareOperatorProofHostLive(n *node.Node, app *consensus.Application, p pqOptions) (operatorProofHostLive, error) {
	if !p.proofLiveConfigured() {
		return nil, nil
	}
	if err := p.validateProofHostLive(); err != nil {
		return nil, err
	}
	if app == nil {
		return nil, errors.New("normal node did not retain its original owning application")
	}
	return consensus.NewProofHostLiveControl(n, app, p.proofLivePolicy, p.proofLivePolicyHash)
}

func newRequestProofHostSourceCommand() *cobra.Command {
	var path, pin string
	c := &cobra.Command{Use: "request-proof-host-source", Short: "Publish the independently pinned single-use live DATA request; no acquisition or Native authority claim", Args: cobra.NoArgs, SilenceUsage: true, SilenceErrors: true, PersistentPreRunE: func(*cobra.Command, []string) error { return nil }, RunE: func(cmd *cobra.Command, _ []string) error {
		r, err := consensus.PublishProofHostLiveRequest(path, pin)
		if err != nil {
			return err
		}
		return json.NewEncoder(cmd.OutOrStdout()).Encode(r)
	}}
	c.Flags().Var(&initializationStringFlag{target: &path}, "proof-host-live-policy", "original fixed live source policy")
	c.Flags().Var(&initializationStringFlag{target: &pin}, "proof-host-live-policy-sha256", "independent SHA256 of original whole policy bytes")
	for _, name := range []string{"proof-host-live-policy", "proof-host-live-policy-sha256"} {
		if err := c.MarkFlagRequired(name); err != nil {
			panic(err)
		}
	}
	return c
}
