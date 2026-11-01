//go:build linux && ynx_lossless_hex

package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/mempool"
	"github.com/cometbft/cometbft/p2p"
)

func TestOperatorLosslessHexTypedNormalConstructorBeforeStart(t *testing.T) {
	f := newWireObservationFixture(t)
	f.options.mempoolLosslessHex = "on"
	n, custody, err := constructBootstrapNode(f.config, log.NewNopLogger(), f.options)
	if err != nil {
		t.Fatal("normal original constructor did not consume typed option", err)
	}
	defer custody.Close()
	defer func() { n.OnStop(); _ = n.ProxyApp().Stop() }()
	if n.IsRunning() || n.BlockStore().Height() != 0 {
		t.Fatal("source test started a network")
	}
	info, ok := n.NodeInfo().(p2p.DefaultNodeInfo)
	if !ok || !info.HasChannel(mempool.LosslessHexV1Channel) {
		t.Fatal("actual normal NodeInfo lacks the typed carrier capability")
	}
	r, ok := n.MempoolReactor().(*mempool.Reactor)
	if !ok {
		t.Fatal("normal flood reactor replaced")
	}
	channels := 0
	for _, channel := range r.GetChannels() {
		if channel.ID == mempool.LosslessHexV1Channel {
			channels++
		}
	}
	if channels != 1 {
		t.Fatal("normal reactor did not register exactly one original carrier", channels)
	}
}

func TestOperatorLosslessHexTypedScopeAndSourceRefusals(t *testing.T) {
	f := newWireObservationFixture(t)
	raw, err := os.ReadFile(f.options.migration)
	if err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"missing-scope", "public-listen", "state-sync", "nop", "public-migration", "wrong-chain", "foreign-slug", "wrong-pin"} {
		t.Run(mode, func(t *testing.T) {
			p := f.options
			p.mempoolLosslessHex = "on"
			config := *f.config
			p2pConfig := *f.config.P2P
			config.P2P = &p2pConfig
			stateSync := *f.config.StateSync
			config.StateSync = &stateSync
			pool := *f.config.Mempool
			config.Mempool = &pool
			switch mode {
			case "missing-scope":
				p.wireObservationScope = ""
			case "public-listen":
				config.P2P.ListenAddress = "tcp://0.0.0.0:37220"
			case "state-sync":
				config.StateSync.Enable = true
			case "nop":
				config.Mempool.Type = "nop"
			case "wrong-pin":
				p.genesisHash = "0000000000000000000000000000000000000000000000000000000000000000"
			default:
				var m chain.ConsensusMigrationState
				if err := json.Unmarshal(raw, &m); err != nil {
					t.Fatal(err)
				}
				switch mode {
				case "public-migration":
					m.Network.IsPublicNet = true
				case "wrong-chain":
					m.Network.ChainID = 6423
				case "foreign-slug":
					m.Network.Slug = "testnet"
				}
				p.migration = filepath.Join(wireObservationTestDir(t), "migration.json")
				if err := os.WriteFile(p.migration, mustLosslessJSON(t, m), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if options, err := prepareOperatorLosslessHex(&config, p); err == nil || options != nil {
				t.Fatal("ON accepted incompatible normal source/mode", mode, err)
			}
		})
	}
	got, err := os.ReadFile(f.options.migration)
	if err != nil || string(got) != string(raw) {
		t.Fatal("negative control changed original migration", err)
	}
}
