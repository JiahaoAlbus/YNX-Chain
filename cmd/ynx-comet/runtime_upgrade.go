package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cfg "github.com/cometbft/cometbft/config"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/node"
)

func (p pqOptions) runtimeConfigured() bool { return p.runtimePlan != "" || p.runtimePlanHash != "" }
func (p pqOptions) runtimeOnly() bool {
	return p.runtimeConfigured() && p.schedule == "" && p.scheduleHash == "" && p.binding == "" && p.vault == "" && p.recoveryFD == -1 && !p.remote()
}

func (p pqOptions) applicationLayout() string {
	if p.stateLayout == "" {
		return "atomic-json"
	}
	return p.stateLayout
}

func (p pqOptions) validateApplicationLayout() error {
	switch p.applicationLayout() {
	case "atomic-json", "snapshot-journal", "block-journal":
		return nil
	default:
		return errors.New("unsupported application state layout; choose atomic-json, snapshot-journal or block-journal")
	}
}

func newOperatorApplication(migration chain.ConsensusMigrationState, path string, bootstrap *consensus.ConsensusBootstrap, pq *consensus.PQEngineAuthorization, options pqOptions) (*consensus.Application, error) {
	if err := options.validateApplicationLayout(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(path) == "" || bootstrap == nil {
		return nil, errors.New("operator application requires original state path and independent bootstrap")
	}
	runtime, err := consensus.LoadRuntimeUpgradeAuthorization(options.runtimePlan, options.runtimePlanHash, bootstrap, migration)
	if err != nil {
		return nil, err
	}
	var app *consensus.Application
	switch options.applicationLayout() {
	case "snapshot-journal":
		if runtime != nil {
			app, err = consensus.NewJournaledApplicationWithRuntimeUpgrade(migration, path, bootstrap, pq, runtime)
		} else if pq != nil {
			app, err = consensus.NewJournaledApplicationWithEngineAuthorization(migration, path, bootstrap, pq)
		} else {
			app, err = consensus.NewJournaledApplicationWithBootstrap(migration, path, bootstrap)
		}
	case "block-journal":
		if runtime != nil {
			app, err = consensus.NewBlockJournaledApplicationWithRuntimeUpgrade(migration, path, bootstrap, pq, runtime)
		} else if pq != nil {
			app, err = consensus.NewBlockJournaledApplicationWithEngineAuthorization(migration, path, bootstrap, pq)
		} else {
			app, err = consensus.NewBlockJournaledApplicationWithBootstrap(migration, path, bootstrap)
		}
	default:
		if runtime != nil {
			app, err = consensus.NewPersistentApplicationWithRuntimeUpgrade(migration, path, bootstrap, pq, runtime)
		} else if pq != nil {
			app, err = consensus.NewPersistentApplicationWithEngineAuthorization(migration, path, bootstrap, pq)
		} else {
			app, err = consensus.NewPersistentApplicationWithBootstrap(migration, path, bootstrap)
		}
	}
	if err == nil {
		err = app.ValidateNormalRuntime()
	}
	if err != nil {
		return nil, err
	}
	return app, nil
}

type runtimeLegacyCustody struct{ key []byte }

func (c *runtimeLegacyCustody) Close() error { clear(c.key); return nil }

// The caller holds the existing application and original FilePV HRS leases.
// This path does not generate a key, reset HRS, consume a PQ credential, or
// treat the application's file as an engine checkpoint.
func constructRuntimeNode(config *cfg.Config, logger log.Logger, options pqOptions) (*node.Node, io.Closer, error) {
	if config == nil || logger == nil || !options.runtimeOnly() || options.validate() != nil || config.PrivValidatorListenAddr != "" {
		return nil, nil, errors.New("runtime-only construction requires complete independent operator configuration")
	}
	raw, err := os.ReadFile(options.migration)
	if err != nil {
		return nil, nil, err
	}
	var migration chain.ConsensusMigrationState
	if err = json.Unmarshal(raw, &migration); err != nil {
		return nil, nil, err
	}
	genesis, err := os.ReadFile(config.GenesisFile())
	if err != nil {
		return nil, nil, err
	}
	bootstrap, err := consensus.NewConsensusBootstrap(genesis, options.operatorFiles(config).Pins, migration)
	if err != nil {
		return nil, nil, err
	}
	app, err := newOperatorApplication(migration, options.state, bootstrap, nil, options)
	if err != nil {
		return nil, nil, err
	}
	nodeKey, err := consensus.LoadPQExistingNodeKey(config.NodeKeyFile())
	if err != nil {
		return nil, nil, err
	}
	legacy, err := consensus.LoadPQOriginalLegacyValidator(config.PrivValidatorKeyFile(), config.PrivValidatorStateFile(), fmt.Sprintf("ynx_%d-1", migration.Network.ChainID))
	if err != nil {
		return nil, nil, err
	}
	custody := &runtimeLegacyCustody{key: legacy.Key.PrivKey.Bytes()}
	n, err := consensus.NewRuntimeUpgradeConsensusNode(config, app, legacy, nodeKey, logger)
	if err != nil {
		return nil, nil, errors.Join(err, custody.Close())
	}
	return n, custody, nil
}
