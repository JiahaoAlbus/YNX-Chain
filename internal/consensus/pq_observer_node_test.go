package consensus

import (
	"bytes"
	"crypto/ed25519"
	"os"
	"path/filepath"
	"testing"

	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/p2p"
	sm "github.com/cometbft/cometbft/state"
)

func TestPQObserverPUBLICConstructorAllLayoutsNoValidator(t *testing.T) {
	f := validatedMigrationFixture(t)
	for _, layout := range []string{"atomic-json", "snapshot-journal", "block-journal"} {
		t.Run(layout, func(t *testing.T) {
			config := bootstrapNodeConfig(t, f.raw)
			path := filepath.Join(config.RootDir, "observer.state")
			lease, err := AcquireApplicationStateWriterLease(path)
			if err != nil {
				t.Fatal(err)
			}
			defer lease.Close()
			var app *Application
			switch layout {
			case "atomic-json":
				app, err = NewPersistentApplicationWithBootstrap(f.migration, path, f.bootstrap)
			case "snapshot-journal":
				app, err = NewJournaledApplicationWithBootstrap(f.migration, path, f.bootstrap)
			case "block-journal":
				app, err = NewBlockJournaledApplicationWithBootstrap(f.migration, path, f.bootstrap)
			}
			if err != nil {
				t.Fatal(err)
			}
			key := &p2p.NodeKey{PrivKey: cmted.GenPrivKey()}
			defer clear(key.PrivKey.Bytes())
			n, err := NewPQObserverNode(config, app, key, log.NewNopLogger())
			if err != nil {
				t.Fatal("original observer constructor", err)
			}
			defer n.OnStop()
			if n.IsRunning() || n.PrivValidator() != nil {
				t.Fatal("observer started or acquired a validator")
			}
			if err = n.RegisterProofSourceConsumer(func() error { return nil }); err == nil {
				t.Fatal("observer failed to bind the original single live-policy consumer")
			}
			originalSource, err := app.WalletPolicyLiveSource()
			if err != nil {
				t.Fatal("actual original live-policy getter unavailable", err)
			}
			secondConfig := bootstrapNodeConfig(t, f.raw)
			if duplicate, duplicateErr := NewPQObserverNode(secondConfig, app, key, log.NewNopLogger()); duplicateErr == nil || duplicate != nil {
				if duplicate != nil {
					duplicate.OnStop()
				}
				t.Fatal("original app rebound to a second observer")
			}
			if entries, err := os.ReadDir(secondConfig.DBDir()); err != nil || len(entries) != 0 {
				t.Fatal("duplicate pairing opened new engine stores")
			}
			if stillOriginal, err := app.WalletPolicyLiveSource(); err != nil || stillOriginal != originalSource {
				t.Fatal("duplicate constructor changed/retired original source", err)
			}
			for _, p := range []string{config.PrivValidatorKeyFile(), config.PrivValidatorStateFile()} {
				if _, e := os.Lstat(p); !os.IsNotExist(e) {
					t.Fatal("observer touched validator key/HRS")
				}
			}
			env, err := n.ConfigureRPC()
			if err != nil {
				t.Fatal("actual observer RPC environment", err)
			}
			status, err := env.Status(nil)
			if err != nil {
				t.Fatal(err)
			}
			if status.ValidatorInfo.PubKey != nil || len(status.ValidatorInfo.Address) != 0 || status.ValidatorInfo.VotingPower != 0 {
				t.Fatal("observer status fabricated validator identity")
			}
			if _, err = cmtjson.Marshal(status); err != nil {
				t.Fatal("actual RPC wire cannot encode observer status", err)
			}
			state, err := env.StateStore.Load()
			if err != nil {
				t.Fatal(err)
			}
			if state.ChainID != f.bootstrap.record.ChainID || len(state.AppHash) != 32 {
				t.Fatal("observer lost authenticated original engine binding")
			}
			if _, err = sm.BindConsensusStateFromSource(state, app); err != nil {
				t.Fatal("original consensus authority was bypassed", err)
			}
			forged := state
			forged.AppHash = bytes.Clone(state.AppHash)
			forged.AppHash[0] ^= 1
			if _, err = sm.BindConsensusStateFromSource(forged, app); err == nil {
				t.Fatal("observer admitted substituted engine hash")
			}
			forged = state
			forged.ChainID += "-substitution"
			if _, err = sm.BindConsensusStateFromSource(forged, app); err == nil {
				t.Fatal("observer admitted substituted network")
			}
		})
	}
}

func TestPQObserverPUBLICRejectsSignerAndUnboundState(t *testing.T) {
	f := validatedMigrationFixture(t)
	for _, name := range []string{"missing-app", "missing-node-key", "remote-signer", "wrong-genesis", "pending", "old-runtime", "missing-bootstrap", "validator-key-reuse", "malformed-node-key", "node-key-mismatch"} {
		t.Run(name, func(t *testing.T) {
			conf := bootstrapNodeConfig(t, f.raw)
			app, err := NewPersistentApplicationWithBootstrap(f.migration, filepath.Join(conf.RootDir, "state"), f.bootstrap)
			if err != nil {
				t.Fatal(err)
			}
			key := &p2p.NodeKey{PrivKey: cmted.GenPrivKey()}
			defer clear(key.PrivKey.Bytes())
			switch name {
			case "missing-app":
				app = nil
			case "missing-node-key":
				key = nil
			case "remote-signer":
				conf.PrivValidatorListenAddr = "tcp://127.0.0.1:1"
			case "wrong-genesis":
				if err = os.WriteFile(conf.GenesisFile(), append(bytes.Clone(f.raw), '\n'), 0600); err != nil {
					t.Fatal(err)
				}
			case "pending":
				p := app.committed
				app.pending = &p
			case "old-runtime":
				app.committed.Version = 13
			case "missing-bootstrap":
				app.bootstrap = nil
			case "validator-key-reuse":
				// Original PUBLIC fixture validator seed, never a production key.
				original := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{71}, ed25519.SeedSize))
				defer clear(original)
				key = &p2p.NodeKey{PrivKey: cmted.PrivKey(original)}
			case "malformed-node-key":
				key = &p2p.NodeKey{PrivKey: cmted.PrivKey{1}}
			case "node-key-mismatch":
				key.PrivKey.Bytes()[ed25519.SeedSize] ^= 1
			}
			if n, err := NewPQObserverNode(conf, app, key, log.NewNopLogger()); err == nil || n != nil {
				if n != nil {
					n.OnStop()
				}
				t.Fatal("invalid observer constructed", name)
			}
			for _, p := range []string{conf.PrivValidatorKeyFile(), conf.PrivValidatorStateFile()} {
				if _, e := os.Lstat(p); !os.IsNotExist(e) {
					t.Fatal("refusal touched validator key/HRS")
				}
			}
		})
	}
}
