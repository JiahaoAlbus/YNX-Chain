package consensus

import (
	"bytes"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	cfg "github.com/cometbft/cometbft/config"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/mempool"
	"github.com/cometbft/cometbft/p2p"
	"github.com/cometbft/cometbft/privval"
	proto "github.com/cometbft/cometbft/proto/tendermint/types"
	sm "github.com/cometbft/cometbft/state"
	types "github.com/cometbft/cometbft/types"
)

func bootstrapNodeConfig(t *testing.T, raw []byte) *cfg.Config {
	t.Helper()
	c := cfg.DefaultConfig().SetRoot(t.TempDir())
	c.TxIndex.Indexer, c.RPC.ListenAddress, c.RPC.PprofListenAddress = "null", "", ""
	c.P2P.PexReactor = false
	for _, path := range []string{c.GenesisFile(), c.PrivValidatorStateFile()} {
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(c.GenesisFile(), raw, 0600); err != nil {
		t.Fatal(err)
	}
	return c
}

func TestBootstrapNodeNormalFactoryCommitsRegistryAndRecoversOriginalHistory(t *testing.T) {
	f := newValidatorRegistryFixture(t)
	config := bootstrapNodeConfig(t, f.raw)
	path := filepath.Join(config.RootDir, "application.state")
	appLease, err := AcquireApplicationStateWriterLease(path)
	if err != nil {
		t.Fatal(err)
	}
	defer appLease.Close()
	pvLease, err := AcquireApplicationStateWriterLease(config.PrivValidatorStateFile())
	if err != nil {
		t.Fatal(err)
	}
	defer pvLease.Close()
	key := cmted.PrivKey(bytes.Clone(f.legacy[string(f.bootstrap.record.Members[0].Address)]))
	pv := privval.NewFilePV(key, config.PrivValidatorKeyFile(), config.PrivValidatorStateFile())
	pv.Save()
	vote := &proto.Vote{Type: proto.PrevoteType, Height: f.doc.InitialHeight, Round: 0, Timestamp: f.doc.GenesisTime}
	if err = pv.SignVote(f.doc.ChainID, vote); err != nil {
		t.Fatal(err)
	}
	keyBefore, err := os.ReadFile(config.PrivValidatorKeyFile())
	if err != nil {
		t.Fatal(err)
	}
	hrsBefore, err := os.ReadFile(config.PrivValidatorStateFile())
	if err != nil {
		t.Fatal(err)
	}
	nodeKey := &p2p.NodeKey{PrivKey: cmted.GenPrivKey()}
	app, err := NewPersistentApplicationWithBootstrap(f.migration, path, f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	n, err := NewBootstrapConsensusNode(config, app, pv, nodeKey, log.NewNopLogger())
	if err != nil {
		t.Fatal("normal bootstrap constructor/handshake", err)
	}
	t.Cleanup(func() {
		if n != nil {
			n.OnStop()
			_ = n.ProxyApp().Stop()
		}
	})
	if n.IsRunning() || n.BlockStore().Height() != 0 {
		t.Fatal("constructor started consensus or fabricated old Comet blocks")
	}
	env, err := n.ConfigureRPC()
	if err != nil {
		t.Fatal(err)
	}
	state, err := env.StateStore.Load()
	if err != nil || state.LastBlockHeight != 0 || state.InitialHeight != f.doc.InitialHeight {
		t.Fatal("real engine bootstrap checkpoint differs", err)
	}
	appHash, _ := hex.DecodeString(app.committed.AppHash)
	if !bytes.Equal(state.AppHash, appHash) {
		t.Fatal("handshake did not bind the same Application AppHash")
	}
	var txs types.Txs
	for index := range f.bootstrap.record.Members {
		tx, _ := f.transaction(t, index, f.doc.InitialHeight)
		txs = append(txs, tx)
	}
	block, err := state.MakeBlock(state.InitialHeight, txs, &types.Commit{}, nil, state.Validators.GetProposer().Address)
	if err != nil {
		t.Fatal(err)
	}
	parts, err := block.MakePartSet(types.BlockPartSizeBytes)
	if err != nil {
		t.Fatal(err)
	}
	id := types.BlockID{Hash: block.Hash(), PartSetHeader: parts.Header()}
	commit := &types.Commit{Height: block.Height, Round: 0, BlockID: id}
	for index, member := range state.Validators.Validators {
		v := &types.Vote{Type: proto.PrecommitType, Height: block.Height, Round: 0, BlockID: id, Timestamp: block.Time.Add(time.Second), ValidatorAddress: bytes.Clone(member.Address), ValidatorIndex: int32(index)}
		v.Signature = ed25519.Sign(f.legacy[string(member.Address)], types.VoteSignBytes(f.doc.ChainID, v.ToProto()))
		if err = v.Verify(f.doc.ChainID, member.PubKey); err != nil {
			t.Fatal(err)
		}
		commit.Signatures = append(commit.Signatures, v.CommitSig())
	}
	n.BlockStore().SaveBlock(block, parts, commit)
	executor := sm.NewBlockExecutor(env.StateStore, log.NewNopLogger(), n.ProxyApp().Consensus(), &mempool.NopMempool{}, sm.EmptyEvidencePool{}, n.BlockStore())
	next, err := executor.ApplyBlock(state, id, block)
	if err != nil {
		t.Fatal("actual original engine BlockExecutor registry commit", err)
	}
	if app.committed.ValidatorRegistry == nil || len(app.committed.ValidatorRegistry.Events) != len(txs) || app.committed.PQEngineSchedule != nil {
		t.Fatal("real registry commit missing or silently activated PQ")
	}
	if !bytes.Equal(next.Validators.Hash(), f.bootstrap.validatorSetHash) || !bytes.Equal(next.NextValidators.Hash(), f.bootstrap.validatorSetHash) {
		t.Fatal("registration changed the original voting set without schedule authorization")
	}
	if _, err = app.ConsensusAuthorityForState(f.doc.ChainID, next.LastBlockHeight, next.AppHash); err != nil {
		t.Fatal("normal Save callback lost actual checkpoint authority", err)
	}
	registryBefore, _ := json.Marshal(app.committed.ValidatorRegistry)
	stateBefore, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	n.OnStop()
	_ = n.ProxyApp().Stop()
	n = nil
	cold, err := NewPersistentApplicationWithBootstrap(f.migration, path, f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	original, err := LoadPQOriginalLegacyValidator(config.PrivValidatorKeyFile(), config.PrivValidatorStateFile(), f.doc.ChainID)
	if err != nil {
		t.Fatal(err)
	}
	n, err = NewBootstrapConsensusNode(config, cold, original, nodeKey, log.NewNopLogger())
	if err != nil || n.BlockStore().Height() != next.LastBlockHeight || n.IsRunning() {
		t.Fatal("same-directory normal cold recovery lost real engine history", err)
	}
	registryAfter, _ := json.Marshal(cold.committed.ValidatorRegistry)
	if !bytes.Equal(registryBefore, registryAfter) || cold.committed.AppHash != app.committed.AppHash {
		t.Fatal("cold startup reinterpreted original complete registry/AppHash")
	}
	for file, before := range map[string][]byte{path: stateBefore, config.PrivValidatorKeyFile(): keyBefore, config.PrivValidatorStateFile(): hrsBefore} {
		after, err := os.ReadFile(file)
		if err != nil || !bytes.Equal(before, after) {
			t.Fatal("constructor rewrote original state/key/HRS", file, err)
		}
	}
	if duplicate, err := AcquireApplicationStateWriterLease(path); err == nil {
		duplicate.Close()
		t.Fatal("single Application writer lease was bypassed")
	}
	if duplicate, err := AcquireApplicationStateWriterLease(config.PrivValidatorStateFile()); err == nil {
		duplicate.Close()
		t.Fatal("original HRS lease was bypassed")
	}
}

func TestBootstrapNodeRefusesWrongMembershipModesAndHistoricalRuntime(t *testing.T) {
	f := newValidatorRegistryFixture(t)
	config := bootstrapNodeConfig(t, f.raw)
	key := cmted.PrivKey(bytes.Clone(f.legacy[string(f.bootstrap.record.Members[0].Address)]))
	pv := privval.NewFilePV(key, config.PrivValidatorKeyFile(), config.PrivValidatorStateFile())
	nodeKey := &p2p.NodeKey{PrivKey: cmted.GenPrivKey()}
	for _, mode := range []string{"missing_bootstrap", "wrong_validator", "socket", "pq_authorization", "runtime_authorization", "stored_schedule", "pending", "historical_runtime", "changed_genesis"} {
		t.Run(mode, func(t *testing.T) {
			app, err := NewPersistentApplicationWithBootstrap(f.migration, "", f.bootstrap)
			if err != nil {
				t.Fatal(err)
			}
			c := bootstrapNodeConfig(t, f.raw)
			original := types.PrivValidator(pv)
			switch mode {
			case "missing_bootstrap":
				app.bootstrap = nil
			case "wrong_validator":
				original = privval.NewFilePV(cmted.GenPrivKey(), c.PrivValidatorKeyFile(), c.PrivValidatorStateFile())
			case "socket":
				c.PrivValidatorListenAddr = "tcp://127.0.0.1:30001"
			case "pq_authorization":
				app.pqEngineAuthorization = &PQEngineAuthorization{}
			case "runtime_authorization":
				app.runtimeUpgradeAuthorization = &RuntimeUpgradeAuthorization{}
			case "stored_schedule":
				app.committed.PQEngineSchedule = &PQEngineSchedule{}
			case "pending":
				pending := app.committed
				app.pending = &pending
			case "historical_runtime":
				app.committed.Version = 13
			case "changed_genesis":
				if err = os.WriteFile(c.GenesisFile(), append(bytes.Clone(f.raw), '\n'), 0600); err != nil {
					t.Fatal(err)
				}
			}
			before, _ := json.Marshal(app.committed)
			if n, err := NewBootstrapConsensusNode(c, app, original, nodeKey, log.NewNopLogger()); err == nil || n != nil {
				if n != nil {
					n.OnStop()
					_ = n.ProxyApp().Stop()
				}
				t.Fatal("invalid bootstrap mode fell through to a normal node")
			}
			after, _ := json.Marshal(app.committed)
			if !bytes.Equal(before, after) {
				t.Fatal("rejected constructor mutated committed state")
			}
		})
	}
	// The separate runtime factory still refuses an absent independent plan.
	app, err := NewPersistentApplicationWithBootstrap(f.migration, "", f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	if n, err := NewRuntimeUpgradeConsensusNode(config, app, pv, nodeKey, log.NewNopLogger()); err == nil || n != nil {
		t.Fatal("bootstrap changed the existing runtime factory's nil-plan refusal")
	}
}

func TestBootstrapNodeCannotReinterpretActualOldRuntimeCheckpoint(t *testing.T) {
	for _, version := range []int{12, 13} {
		t.Run(strconv.Itoa(version), func(t *testing.T) {
			f := newRuntimeUpgradeFixture(t, version)
			doc, err := BuildCometGenesis(f.migration, time.Unix(1802736000, 0).UTC())
			if err != nil {
				t.Fatal(err)
			}
			doc.ConsensusParams.Version.App = f.plan.OldApplicationVersion
			raw, err := cmtjson.Marshal(doc)
			if err != nil {
				t.Fatal(err)
			}
			config := bootstrapNodeConfig(t, raw)
			path := filepath.Join(config.RootDir, "old-runtime.state")
			checkpoint := f.old[len(f.old)-1]
			if err = saveCommittedState(path, checkpoint, f.migration); err != nil {
				t.Fatal(err)
			}
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			app, err := NewPersistentApplicationWithBootstrap(f.migration, path, f.bootstrap)
			if err != nil {
				t.Fatal("actual old-domain checkpoint must remain readable without rehash", err)
			}
			key := cmted.PrivKey(ed25519.NewKeyFromSeed(bytes.Repeat([]byte{51}, ed25519.SeedSize)))
			defer clear(key)
			pv := privval.NewFilePV(key, config.PrivValidatorKeyFile(), config.PrivValidatorStateFile())
			if err = f.bootstrap.ValidateOriginalValidator(pv); err != nil {
				t.Fatal("old-runtime test requires a real pinned signer", err)
			}
			n, err := NewBootstrapConsensusNode(config, app, pv, &p2p.NodeKey{PrivKey: cmted.GenPrivKey()}, log.NewNopLogger())
			if n != nil {
				n.OnStop()
				_ = n.ProxyApp().Stop()
			}
			if err == nil || !strings.Contains(err.Error(), "historical runtime requires") || n != nil {
				t.Fatal("bootstrap bypassed normal old-runtime plan gate", err)
			}
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(before, after) || app.committed.Version != version || app.committed.AppHash != checkpoint.AppHash || app.committed.Height != checkpoint.Height {
				t.Fatal("rejected startup changed original old runtime/hash/history", err)
			}
		})
	}
}
