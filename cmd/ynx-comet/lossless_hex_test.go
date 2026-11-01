package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/spf13/pflag"
)

func TestOperatorLosslessHexDefaultOffAndClosedFlags(t *testing.T) {
	for _, value := range []string{"", "off", "ON", "true", " on", "on "} {
		p := pqOptions{recoveryFD: -1}
		flags := pflag.NewFlagSet("normal", pflag.ContinueOnError)
		flags.SetOutput(io.Discard)
		registerLosslessHexFlags(flags, &p)
		var args []string
		if value != "" {
			args = []string{"--experimental-mempool-lossless-hex", value}
		}
		err := flags.Parse(args)
		if err == nil {
			err = p.validateLosslessHex()
		}
		if value == "" || value == "off" {
			if err != nil || p.enabled() {
				t.Fatal("OFF changed stock/normal selection", err)
			}
			options, err := prepareOperatorLosslessHex(nil, p)
			if err != nil || options != nil {
				t.Fatal("OFF read config/source or added an option", err)
			}
		} else if err == nil {
			t.Fatal("ambiguous opt-in accepted", value)
		}
	}
	p := pqOptions{recoveryFD: -1}
	f := pflag.NewFlagSet("normal", pflag.ContinueOnError)
	f.SetOutput(io.Discard)
	registerLosslessHexFlags(f, &p)
	if err := f.Parse([]string{"--experimental-mempool-lossless-hex", "on", "--experimental-mempool-lossless-hex", "off"}); err == nil {
		t.Fatal("duplicate ON/OFF request accepted")
	}
}

// The original Application hashes records containing the actual block time.
// These three independent stores reuse ONE original PQ signed wire, genesis
// and membership. No signature, height or timestamp is rewritten for equality.
// This is an ABCI preimage counterexample, not a carrier/network performance run.
func TestOperatorLosslessPairOriginalPQTimeIsConsensusState(t *testing.T) {
	f := newWireObservationFixture(t)
	raw, err := os.ReadFile(f.options.migration)
	if err != nil {
		t.Fatal(err)
	}
	var m chain.ConsensusMigrationState
	if err = json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	genesis, err := os.ReadFile(f.config.GenesisFile())
	if err != nil {
		t.Fatal(err)
	}
	b, err := consensus.NewConsensusBootstrap(genesis, f.options.operatorFiles(f.config).Pins, m)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := cmttypes.GenesisDocFromJSON(genesis)
	if err != nil {
		t.Fatal(err)
	}
	init := commitObservationFixture{migration: m, bootstrap: b, doc: doc}
	stamp := doc.GenesisTime.Add(time.Second)
	type result struct {
		raw, hash []byte
		state     consensus.CommittedState
	}
	results := make([]result, 3)
	for i, at := range []time.Time{stamp, stamp, stamp.Add(time.Second)} {
		path := filepath.Join(wireObservationTestDir(t), "state.json")
		app, err := consensus.NewPersistentApplicationWithBootstrap(m, path, b)
		if err != nil {
			t.Fatal(err)
		}
		init.initialize(t, app)
		snapshot, err := app.CommittedPQEngineSnapshot()
		if err != nil {
			t.Fatal(err)
		}
		next, err := snapshot.ExpectedValidatorHash(doc.InitialHeight + 1)
		if err != nil {
			t.Fatal(err)
		}
		finalized, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: doc.InitialHeight,
			Time: at, Txs: [][]byte{bytes.Clone(f.wire)}, NextValidatorsHash: next})
		if err != nil || len(finalized.TxResults) != 1 || finalized.TxResults[0].Code != 0 {
			t.Fatal("original PQ execution", finalized, err)
		}
		if _, err = app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
		results[i].raw, err = os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if err = json.Unmarshal(results[i].raw, &results[i].state); err != nil {
			t.Fatal(err)
		}
		cold, err := consensus.NewPersistentApplicationWithBootstrap(m, path, b)
		if err != nil {
			t.Fatal("normal cold recovery", err)
		}
		info, err := cold.Info(context.Background(), &abci.RequestInfo{})
		if err != nil || info.LastBlockHeight != doc.InitialHeight {
			t.Fatal("actual cold coordinates", err)
		}
		results[i].hash = bytes.Clone(info.LastBlockAppHash)
	}
	if !bytes.Equal(results[0].raw, results[1].raw) || !bytes.Equal(results[0].hash, results[1].hash) {
		t.Fatal("same complete inputs failed exact equality")
	}
	if bytes.Equal(results[0].raw, results[2].raw) || bytes.Equal(results[0].hash, results[2].hash) {
		t.Fatal("different real block time was normalized out of original state/AppHash")
	}
	if !bytes.Equal(mustLosslessJSON(t, results[0].state.Accounts), mustLosslessJSON(t, results[2].state.Accounts)) {
		t.Fatal("preimage counterexample must keep balances and nonces equal")
	}
	if bytes.Equal(mustLosslessJSON(t, results[0].state.FeeEvents), mustLosslessJSON(t, results[2].state.FeeEvents)) ||
		bytes.Equal(mustLosslessJSON(t, results[0].state.PQHistory), mustLosslessJSON(t, results[2].state.PQHistory)) {
		t.Fatal("time-bearing original fee/PQ history unexpectedly equal")
	}
}

func mustLosslessJSON(t *testing.T, value any) []byte {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
