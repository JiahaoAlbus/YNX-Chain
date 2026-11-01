package main

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cfg "github.com/cometbft/cometbft/config"
	nm "github.com/cometbft/cometbft/node"
	"github.com/spf13/pflag"
)

// This flag selects only the existing source-lab transport. It cannot select
// a provider, change a transaction, grant authority, or change consensus rules.
func registerLosslessHexFlags(flags *pflag.FlagSet, p *pqOptions) {
	flags.Var(&initializationStringFlag{target: &p.mempoolLosslessHex}, "experimental-mempool-lossless-hex", "off by default; on requires the matching experimental build and original synthetic loopback wire-observation scope")
}

func (p pqOptions) losslessConfigured() bool {
	return p.mempoolLosslessHex != "" && p.mempoolLosslessHex != "off"
}

func (p pqOptions) validateLosslessHex() error {
	if !p.losslessConfigured() {
		return nil
	}
	if p.mempoolLosslessHex != "on" {
		return errors.New("lossless carrier requires exact on or off; default is off")
	}
	if err := operatorLosslessHexCapability(); err != nil {
		return err
	}
	if p.wireObservationScope != operatorWireObservationScope || p.wireObservationOutput == "" {
		return errors.New("lossless carrier requires the original explicit synthetic loopback wire observation")
	}
	return p.validateWireObservation()
}

// Called before every normal factory opens its Application/validator/custody.
// The option is passed into the original Node constructor so its registration
// errors are returned there; applying Option(node) after construction is unsafe.
func prepareOperatorLosslessHex(config *cfg.Config, p pqOptions) ([]nm.Option, error) {
	if err := p.validateLosslessHex(); err != nil {
		return nil, err
	}
	if !p.losslessConfigured() {
		return nil, nil
	}
	if err := validateWireObservationNetwork(config, p); err != nil {
		return nil, err
	}
	if config.Mempool == nil || config.Mempool.Type != "flood" {
		return nil, errors.New("lossless carrier requires the original flood mempool; no stock/nop fallback")
	}
	raw, err := readBounded(p.migration, 1<<30)
	if err != nil {
		return nil, err
	}
	var m chain.ConsensusMigrationState
	if err = json.Unmarshal(raw, &m); err != nil {
		return nil, err
	}
	if m.Network.ChainID != consensus.PQLabNativeChainID || m.Network.IsPublicNet || !strings.HasPrefix(m.Network.Slug, "pq-lab-") {
		return nil, errors.New("lossless carrier refuses public or non-lab migration")
	}
	genesis, err := readBounded(config.GenesisFile(), 64<<20)
	if err != nil {
		return nil, err
	}
	if _, err = consensus.NewConsensusBootstrap(genesis, p.operatorFiles(config).Pins, m); err != nil {
		return nil, err
	}
	return []nm.Option{operatorLosslessHexOption()}, nil
}
