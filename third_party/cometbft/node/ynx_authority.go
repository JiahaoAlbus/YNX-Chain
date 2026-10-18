package node

import (
	"context"
	"errors"

	cfg "github.com/cometbft/cometbft/config"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/p2p"
	"github.com/cometbft/cometbft/proxy"
	"github.com/cometbft/cometbft/types"
)

// NewNodeWithConsensusAuthority supplies independent local authority before
// handshake/replay/reactor construction. Ordinary late Node options cannot
// safely retrofit authority after votes and LastCommit have been reconstructed.
func NewNodeWithConsensusAuthority(config *cfg.Config, privValidator types.PrivValidator, nodeKey *p2p.NodeKey, clientCreator proxy.ClientCreator, genesisDocProvider GenesisDocProvider, dbProvider cfg.DBProvider, metricsProvider MetricsProvider, logger log.Logger, source types.ConsensusAuthoritySource, options ...Option) (*Node, error) {
	if source == nil {
		return nil, errors.New("explicit committed consensus authority source is required")
	}
	return newNodeWithContextAndAuthority(context.TODO(), config, privValidator, nodeKey, clientCreator, genesisDocProvider, dbProvider, metricsProvider, logger, source, options...)
}

func NewNodeWithContext(ctx context.Context, config *cfg.Config, privValidator types.PrivValidator, nodeKey *p2p.NodeKey, clientCreator proxy.ClientCreator, genesisDocProvider GenesisDocProvider, dbProvider cfg.DBProvider, metricsProvider MetricsProvider, logger log.Logger, options ...Option) (*Node, error) {
	return newNodeWithContextAndAuthority(ctx, config, privValidator, nodeKey, clientCreator, genesisDocProvider, dbProvider, metricsProvider, logger, nil, options...)
}
