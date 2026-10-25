package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cfg "github.com/cometbft/cometbft/config"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/node"
)

// Only the complete independently pinned bootstrap selects this mode. A
// partial option set stays enabled and is rejected; it never selects stock.
func (p pqOptions) bootstrapOnly() bool {
	return p.migration != "" && p.state != "" && p.genesisHash != "" && p.originalGenesisHash != "" && p.migrationHash != "" &&
		p.schedule == "" && p.scheduleHash == "" && p.binding == "" && p.vault == "" && p.recoveryFD == -1 && !p.remote() && !p.runtimeConfigured()
}

// runPQNode owns both existing writer leases before calling this constructor.
// Every identity/pin is checked before opening the application; no key or HRS
// is generated, and old runtime domains still require their separate plan.
func constructBootstrapNode(config *cfg.Config, logger log.Logger, options pqOptions) (*node.Node, io.Closer, error) {
	if config == nil || logger == nil || !options.bootstrapOnly() || options.validate() != nil || config.PrivValidatorListenAddr != "" {
		return nil, nil, errors.New("bootstrap-only construction requires complete independent pins and original local custody")
	}
	rawMigration, err := readBounded(options.migration, 1<<30)
	if err != nil {
		return nil, nil, err
	}
	var migration chain.ConsensusMigrationState
	if err = json.Unmarshal(rawMigration, &migration); err != nil {
		return nil, nil, fmt.Errorf("decode original bootstrap migration: %w", err)
	}
	rawGenesis, err := readBounded(config.GenesisFile(), 64<<20)
	if err != nil {
		return nil, nil, err
	}
	bootstrap, err := consensus.NewConsensusBootstrap(rawGenesis, options.operatorFiles(config).Pins, migration)
	if err != nil {
		return nil, nil, err
	}
	nodeKey, err := consensus.LoadPQExistingNodeKey(config.NodeKeyFile())
	if err != nil {
		return nil, nil, err
	}
	legacy, err := consensus.LoadPQOriginalLegacyValidator(config.PrivValidatorKeyFile(), config.PrivValidatorStateFile(), fmt.Sprintf("ynx_%d-1", migration.Network.ChainID))
	if err != nil {
		clear(nodeKey.PrivKey.Bytes())
		return nil, nil, err
	}
	custody := &bootstrapCustody{legacy: legacy.Key.PrivKey.Bytes(), node: nodeKey.PrivKey.Bytes()}
	if err = bootstrap.ValidateOriginalValidator(legacy); err != nil {
		return nil, nil, errors.Join(err, custody.Close())
	}
	app, err := newOperatorApplication(migration, options.state, bootstrap, nil, options)
	if err != nil {
		return nil, nil, errors.Join(err, custody.Close())
	}
	n, err := consensus.NewBootstrapConsensusNode(config, app, legacy, nodeKey, logger)
	if err != nil {
		return nil, nil, errors.Join(err, custody.Close())
	}
	return n, custody, nil
}

type bootstrapCustody struct{ legacy, node []byte }

func (c *bootstrapCustody) Close() error {
	clear(c.legacy)
	clear(c.node)
	return nil
}
