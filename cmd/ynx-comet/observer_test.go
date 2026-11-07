package main

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cfg "github.com/cometbft/cometbft/config"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/p2p"
	"github.com/spf13/cobra"
)

func observerCommandFixture(t *testing.T, layout string) (observerOptions, *cfg.Config) {
	t.Helper()
	f := newInitializeCommandFixture(t)
	home := t.TempDir()
	if err := os.Chmod(home, 0700); err != nil {
		t.Fatal(err)
	}
	conf := cfg.DefaultConfig().SetRoot(home)
	conf.TxIndex.Indexer = "null"
	conf.RPC.ListenAddress = ""
	conf.RPC.PprofListenAddress = ""
	conf.P2P.PexReactor = false
	if err := os.MkdirAll(filepath.Join(home, "config"), 0700); err != nil {
		t.Fatal(err)
	}
	raw := f.originals[f.options.genesis]
	if err := os.WriteFile(conf.GenesisFile(), raw, 0600); err != nil {
		t.Fatal(err)
	}
	cfg.WriteConfigFile(filepath.Join(home, "config/config.toml"), conf)
	key := &p2p.NodeKey{PrivKey: cmted.GenPrivKey()}
	wire, err := cmtjson.Marshal(key)
	if err != nil {
		t.Fatal(err)
	}
	defer clear(wire)
	defer clear(key.PrivKey.Bytes())
	if err = os.WriteFile(conf.NodeKeyFile(), wire, 0600); err != nil {
		t.Fatal(err)
	}
	p := pqOptions{migration: f.options.migration, state: filepath.Join(home, "application", "state"), stateLayout: layout, genesisHash: f.options.genesisHash, originalGenesisHash: f.options.originalGenesisHash, migrationHash: f.options.migrationHash, recoveryFD: -1}
	init := f.options
	init.state, init.layout = p.state, layout
	if err = runInitializeApplication(io.Discard, init); err != nil {
		t.Fatal(err)
	}
	return observerOptions{home: home, application: p}, conf
}

func TestObserverCLIPUBLICRealConstructorWithoutStart(t *testing.T) {
	for _, layout := range []string{"atomic-json", "snapshot-journal", "block-journal"} {
		t.Run(layout, func(t *testing.T) {
			options, original := observerCommandFixture(t, layout)
			before, err := os.ReadFile(original.NodeKeyFile())
			if err != nil {
				t.Fatal(err)
			}
			defer clear(before)
			conf, err := loadObserverConfig(options)
			if err != nil {
				t.Fatal("normal fixed observer configuration", err)
			}
			lease, err := consensus.AcquireApplicationStateWriterLease(options.application.state)
			if err != nil {
				t.Fatal(err)
			}
			defer lease.Close()
			n, custody, err := constructObserverNode(conf, log.NewNopLogger(), options)
			if err != nil {
				t.Fatal(err)
			}
			defer custody.Close()
			defer n.OnStop()
			if n.IsRunning() || n.PrivValidator() != nil {
				t.Fatal("observer constructor started/signs")
			}
			env, err := n.ConfigureRPC()
			if err != nil {
				t.Fatal(err)
			}
			status, err := env.Status(nil)
			if err != nil || status.ValidatorInfo.PubKey != nil || status.ValidatorInfo.VotingPower != 0 {
				t.Fatal("observer RPC identity", err)
			}
			after, err := os.ReadFile(conf.NodeKeyFile())
			if err != nil || !bytes.Equal(after, before) {
				t.Fatal("existing P2P identity changed")
			}
			clear(after)
			for _, p := range []string{conf.PrivValidatorKeyFile(), conf.PrivValidatorStateFile()} {
				if _, err = os.Lstat(p); !os.IsNotExist(err) {
					t.Fatal("validator file created")
				}
			}
		})
	}
}

func TestObserverCLIPUBLICRejectsSignerFlagsAndManagedEscape(t *testing.T) {
	for _, flag := range []string{"--pq-host-key-vault", "--pq-host-key-binding", "--pq-recovery-fd", "--pq-remote-signer", "--pq-transport-key", "--pq-signer-peer-pin", "--priv_validator_laddr"} {
		t.Run(flag, func(t *testing.T) {
			c := newObserverCommand()
			c.SetOut(io.Discard)
			c.SetErr(io.Discard)
			c.SetArgs([]string{flag, "unused"})
			if err := c.Execute(); err == nil || !strings.Contains(err.Error(), "unknown flag") {
				t.Fatal("signer flag did not fail at parsing", err)
			}
		})
	}
	// The real command must override, rather than enter, the inherited Comet
	// home/config creator. Parsing and preflight never generate an identity.
	parent := &cobra.Command{Use: "ynx-comet", PersistentPreRunE: func(*cobra.Command, []string) error {
		t.Fatal("observer entered inherited Comet home/key setup")
		return nil
	}}
	parent.AddCommand(newObserverCommand())
	parent.SetArgs([]string{"start-observer", "--observer-home", t.TempDir()})
	parent.SetOut(io.Discard)
	parent.SetErr(io.Discard)
	if err := parent.Execute(); err == nil {
		t.Fatal("missing observer inputs accepted")
	}
	o, conf := observerCommandFixture(t, "atomic-json")
	for _, name := range []string{"missing-pin", "partial-schedule", "partial-runtime", "vault", "remote", "outside-state", "validator-key", "signing-state", "home-alias", "config-parent-alias", "database-parent-alias", "state-parent-alias", "state-leaf-alias"} {
		t.Run(name, func(t *testing.T) {
			changed := o
			switch name {
			case "missing-pin":
				changed.application.genesisHash = ""
			case "partial-schedule":
				changed.application.schedule = "unused"
			case "partial-runtime":
				changed.application.runtimePlan = "unused"
			case "vault":
				changed.application.vault = "unused"
			case "remote":
				changed.application.remoteAddress = "tcp://127.0.0.1:1"
			case "outside-state":
				changed.application.state = filepath.Join(t.TempDir(), "outside")
			case "validator-key", "signing-state":
				p := conf.PrivValidatorKeyFile()
				if name == "signing-state" {
					p = conf.PrivValidatorStateFile()
				}
				if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(p, []byte("PUBLIC occupied original slot"), 0600); err != nil {
					t.Fatal(err)
				}
				defer os.Remove(p)
			case "home-alias":
				alias := filepath.Join(t.TempDir(), "alias")
				if err := os.Symlink(o.home, alias); err != nil {
					t.Fatal(err)
				}
				changed.home = alias
			case "config-parent-alias":
				path := filepath.Join(o.home, "config")
				saved := filepath.Join(o.home, "original-config")
				if err := os.Rename(path, saved); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(saved, path); err != nil {
					t.Fatal(err)
				}
				defer func() { _ = os.Remove(path); _ = os.Rename(saved, path) }()
			case "database-parent-alias", "state-parent-alias":
				path := filepath.Join(o.home, "alias")
				if err := os.Symlink(t.TempDir(), path); err != nil {
					t.Fatal(err)
				}
				defer os.Remove(path)
				if name == "state-parent-alias" {
					changed.application.state = filepath.Join(path, "absent-state")
				} else {
					old := conf.DBPath
					conf.DBPath = "alias/new-db"
					cfg.WriteConfigFile(filepath.Join(o.home, "config/config.toml"), conf)
					defer func() { conf.DBPath = old; cfg.WriteConfigFile(filepath.Join(o.home, "config/config.toml"), conf) }()
				}
			case "state-leaf-alias":
				path := filepath.Join(o.home, "alias.state")
				if err := os.Symlink(o.application.state, path); err != nil {
					t.Fatal(err)
				}
				defer os.Remove(path)
				changed.application.state = path
			}
			if _, err := loadObserverConfig(changed); err == nil {
				t.Fatal("invalid managed observer accepted", name)
			}
		})
	}
	c := newObserverCommand()
	c.SetArgs([]string{"--observer-home", o.home, "--observer-home", o.home})
	c.SetOut(io.Discard)
	c.SetErr(io.Discard)
	if err := c.Execute(); err == nil {
		t.Fatal("duplicate original flag accepted")
	}
}
