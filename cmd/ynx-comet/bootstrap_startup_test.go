package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cfg "github.com/cometbft/cometbft/config"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/p2p"
	"github.com/cometbft/cometbft/privval"
	proto "github.com/cometbft/cometbft/proto/tendermint/types"
)

func bootstrapStartupFixture(t *testing.T, f *cometJournalFixture, layout string) (*cfg.Config, pqOptions) {
	t.Helper()
	c := cfg.DefaultConfig().SetRoot(t.TempDir())
	c.TxIndex.Indexer, c.RPC.ListenAddress, c.RPC.PprofListenAddress = "null", "", ""
	c.P2P.PexReactor = false
	for _, path := range []string{c.GenesisFile(), c.PrivValidatorStateFile()} {
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
	}
	raw, err := cmtjson.Marshal(f.doc)
	if err != nil {
		t.Fatal(err)
	}
	pin := sha256.Sum256(raw)
	migration, err := json.Marshal(f.migration)
	if err != nil {
		t.Fatal(err)
	}
	options := pqOptions{migration: filepath.Join(c.RootDir, "migration.json"), state: filepath.Join(c.RootDir, "application.state"), genesisHash: hex.EncodeToString(pin[:]), originalGenesisHash: f.migration.OriginalGenesisHash, migrationHash: f.migration.StateHash, recoveryFD: -1, stateLayout: layout}
	for path, wire := range map[string][]byte{c.GenesisFile(): raw, options.migration: migration} {
		if err = os.WriteFile(path, wire, 0600); err != nil {
			t.Fatal(err)
		}
	}
	var key cmted.PrivKey
	for index := range f.migration.Validators {
		candidate := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{byte(index + 81)}, ed25519.SeedSize))
		if bytes.Equal(candidate.Public().(ed25519.PublicKey), f.doc.Validators[0].PubKey.Bytes()) {
			key = cmted.PrivKey(candidate)
			break
		}
		clear(candidate)
	}
	if key == nil {
		t.Fatal("fixture must retain the actual independently pinned original validator")
	}
	defer clear(key)
	pv := privval.NewFilePV(key, c.PrivValidatorKeyFile(), c.PrivValidatorStateFile())
	pv.Save()
	// Preserve a real, nonempty original HRS; construction must not reset it.
	if err = pv.SignVote(f.doc.ChainID, &proto.Vote{Type: proto.PrevoteType, Height: f.doc.InitialHeight, Round: 0, Timestamp: f.doc.GenesisTime}); err != nil {
		t.Fatal(err)
	}
	nodeKey := &p2p.NodeKey{PrivKey: cmted.GenPrivKey()}
	nodeWire, err := cmtjson.Marshal(nodeKey)
	if err != nil {
		t.Fatal(err)
	}
	defer clear(nodeKey.PrivKey.Bytes())
	defer clear(nodeWire)
	if err = os.WriteFile(c.NodeKeyFile(), nodeWire, 0600); err != nil {
		t.Fatal(err)
	}
	return c, options
}

func bootstrapOriginalBytes(t *testing.T, c *cfg.Config, p pqOptions) map[string][]byte {
	t.Helper()
	result := make(map[string][]byte)
	for _, path := range []string{c.GenesisFile(), p.migration, c.NodeKeyFile(), c.PrivValidatorKeyFile(), c.PrivValidatorStateFile()} {
		wire, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		result[path] = wire
	}
	t.Cleanup(func() {
		for _, wire := range result {
			clear(wire)
		}
	})
	return result
}

func assertBootstrapOriginalBytes(t *testing.T, before map[string][]byte) {
	t.Helper()
	for path, original := range before {
		after, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(original, after) {
			t.Fatal("bootstrap changed original source/key/HRS bytes", path, err)
		}
		clear(after)
	}
}

func TestBootstrapStartupNormalConstructorAllLayoutsAndColdOriginalHRS(t *testing.T) {
	f := newCometJournalFixture(t)
	for _, layout := range []string{"atomic-json", "snapshot-journal", "block-journal"} {
		t.Run(layout, func(t *testing.T) {
			c, options := bootstrapStartupFixture(t, f, layout)
			before := bootstrapOriginalBytes(t, c, options)
			lease, err := consensus.AcquireApplicationStateWriterLease(options.state)
			if err != nil {
				t.Fatal(err)
			}
			defer lease.Close()
			hrsLease, err := consensus.AcquireApplicationStateWriterLease(c.PrivValidatorStateFile())
			if err != nil {
				t.Fatal(err)
			}
			defer hrsLease.Close()
			var originalState, appHash []byte
			var originalExists bool
			for attempt := 0; attempt < 2; attempt++ {
				n, custody, err := constructBootstrapNode(c, log.NewNopLogger(), options)
				if err != nil {
					t.Fatal("normal bootstrap constructor/Handshake", attempt, err)
				}
				func() {
					defer custody.Close()
					defer func() { n.OnStop(); _ = n.ProxyApp().Stop() }()
					if n.IsRunning() || n.BlockStore().Height() != 0 {
						t.Fatal("constructor started a node or invented Comet history")
					}
					env, err := n.ConfigureRPC()
					if err != nil {
						t.Fatal(err)
					}
					state, err := env.StateStore.Load()
					if err != nil || state.InitialHeight != f.doc.InitialHeight || state.LastBlockHeight != 0 || len(state.AppHash) != 32 {
						t.Fatal("normal single-App Handshake checkpoint missing", err)
					}
					current, err := os.ReadFile(options.state)
					if err != nil && !(layout == "atomic-json" && os.IsNotExist(err)) {
						t.Fatal(err)
					}
					// InitChain returns the migration hash but does not fabricate an
					// atomic committed file before the first actual block Commit.
					exists := err == nil
					if attempt == 0 {
						originalState, appHash, originalExists = current, bytes.Clone(state.AppHash), exists
					} else if originalExists != exists || !bytes.Equal(originalState, current) || !bytes.Equal(appHash, state.AppHash) {
						t.Fatal("cold constructor rewrote original layout/AppHash or fabricated a commit")
					}
					assertBootstrapOriginalBytes(t, before)
				}()
			}
		})
	}
}

func TestBootstrapStartupOptionsRequireExactlyCompleteBootstrap(t *testing.T) {
	base := pqOptions{migration: "migration.json", state: "original.state", genesisHash: "comet-pin", originalGenesisHash: "native-pin", migrationHash: "migration-pin", recoveryFD: -1}
	if !base.enabled() || !base.bootstrapOnly() || base.validate() != nil {
		t.Fatal("complete bootstrap requires no PQ or runtime credentials")
	}
	for name, mutate := range map[string]func(*pqOptions){
		"missing_migration": func(p *pqOptions) { p.migration = "" }, "missing_state": func(p *pqOptions) { p.state = "" },
		"missing_comet_pin": func(p *pqOptions) { p.genesisHash = "" }, "missing_native_pin": func(p *pqOptions) { p.originalGenesisHash = "" }, "missing_migration_pin": func(p *pqOptions) { p.migrationHash = "" },
		"schedule": func(p *pqOptions) { p.schedule = "schedule.json" }, "schedule_pin": func(p *pqOptions) { p.scheduleHash = "hash" },
		"binding": func(p *pqOptions) { p.binding = "binding.json" }, "vault": func(p *pqOptions) { p.vault = "original.vault" },
		"credential": func(p *pqOptions) { p.recoveryFD = 3 }, "invalid_credential": func(p *pqOptions) { p.recoveryFD = -2 },
		"remote": func(p *pqOptions) { p.remoteAddress = "tcp://127.0.0.1:27701" }, "transport": func(p *pqOptions) { p.transportKey = "original.transport" }, "peer_pin": func(p *pqOptions) { p.peerPin = "full-pin" }, "timeout": func(p *pqOptions) { p.remoteTimeout = time.Second },
		"runtime_plan": func(p *pqOptions) { p.runtimePlan = "runtime.json" }, "runtime_pin": func(p *pqOptions) { p.runtimePlanHash = "pin" }, "layout": func(p *pqOptions) { p.stateLayout = "unknown" },
	} {
		t.Run(name, func(t *testing.T) {
			candidate := base
			mutate(&candidate)
			if !candidate.enabled() || candidate.validate() == nil {
				t.Fatal("partial bootstrap acquired a normal/stock startup path")
			}
		})
	}
	if (pqOptions{recoveryFD: -1}).enabled() || !(pqOptions{recoveryFD: -2}).enabled() {
		t.Fatal("only default empty protocol options may select stock")
	}
	runtime := base
	runtime.runtimePlan, runtime.runtimePlanHash = "runtime.json", "runtime-pin"
	if runtime.bootstrapOnly() || !runtime.runtimeOnly() || runtime.validate() != nil {
		t.Fatal("complete independent runtime plan lost its existing mode")
	}
	local := base
	local.schedule, local.scheduleHash, local.binding, local.vault, local.recoveryFD = "schedule.json", "schedule-pin", "binding.json", "vault", 3
	if local.bootstrapOnly() || local.runtimeOnly() || local.validate() != nil {
		t.Fatal("complete local PQ mode changed")
	}
	remote := local
	remote.vault, remote.recoveryFD = "", -1
	remote.remoteAddress, remote.transportKey, remote.peerPin = "tcp://127.0.0.1:27701", "transport", "peer"
	if remote.bootstrapOnly() || !remote.remote() || remote.validate() != nil {
		t.Fatal("complete remote PQ mode changed")
	}
}

func TestBootstrapStartupRefusesWrongPinsBeforeOpeningState(t *testing.T) {
	f := newCometJournalFixture(t)
	for _, layout := range []string{"atomic-json", "snapshot-journal", "block-journal"} {
		for _, field := range []string{"comet", "native", "migration", "wrong_validator", "missing_hrs"} {
			t.Run(layout+"/"+field, func(t *testing.T) {
				c, options := bootstrapStartupFixture(t, f, layout)
				switch field {
				case "comet":
					options.genesisHash = strings.Repeat("a", 64)
				case "native":
					options.originalGenesisHash = strings.Repeat("b", 64)
				case "migration":
					options.migrationHash = strings.Repeat("c", 64)
				case "wrong_validator":
					pv := privval.NewFilePV(cmted.GenPrivKey(), c.PrivValidatorKeyFile(), c.PrivValidatorStateFile())
					pv.Save()
				case "missing_hrs":
					if err := os.Remove(c.PrivValidatorStateFile()); err != nil {
						t.Fatal(err)
					}
				}
				var before map[string][]byte
				if field != "missing_hrs" {
					before = bootstrapOriginalBytes(t, c, options)
				}
				n, custody, err := constructBootstrapNode(c, log.NewNopLogger(), options)
				if n != nil {
					n.OnStop()
					_ = n.ProxyApp().Stop()
				}
				if custody != nil {
					_ = custody.Close()
				}
				if err == nil || n != nil || custody != nil {
					t.Fatal("untrusted or missing original identity acquired bootstrap")
				}
				for _, path := range []string{options.state, options.state + ".read.lock", options.state + ".lock"} {
					if _, err = os.Lstat(path); !os.IsNotExist(err) {
						t.Fatal("rejected authority opened/created application state", path, err)
					}
				}
				if field == "missing_hrs" {
					if _, err = os.Lstat(c.PrivValidatorStateFile()); !os.IsNotExist(err) {
						t.Fatal("missing original HRS regenerated")
					}
				} else {
					assertBootstrapOriginalBytes(t, before)
				}
			})
		}
	}
}
