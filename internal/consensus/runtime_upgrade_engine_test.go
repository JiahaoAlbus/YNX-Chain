package consensus

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	dbm "github.com/cometbft/cometbft-db"
	cfg "github.com/cometbft/cometbft/config"
	cmtconsensus "github.com/cometbft/cometbft/consensus"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/crypto/merkle"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/mempool"
	"github.com/cometbft/cometbft/p2p"
	"github.com/cometbft/cometbft/privval"
	sm "github.com/cometbft/cometbft/state"
	blockstore "github.com/cometbft/cometbft/store"
	cmttypes "github.com/cometbft/cometbft/types"
)

// Produce genuine legacy engine blocks/commits in isolated stores. This is a
// pre-upgrade fixture, not a synthesized replacement for public chain history.
type runtimeConsumerEngineHarness struct {
	*engineWiringHarness
	databases map[string]dbm.DB
}

func runtimeEngineFixture(t *testing.T, version int) (*runtimeConsumerEngineHarness, runtimeUpgradeFixture) {
	t.Helper()
	f := newRuntimeUpgradeFixture(t, version)
	doc, err := BuildCometGenesis(f.migration, f.bootstrap.record.GenesisTime)
	if err != nil {
		t.Fatal(err)
	}
	doc.ConsensusParams.Version.App = f.plan.OldApplicationVersion
	raw, err := cmtjson.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(raw)
	if hex.EncodeToString(digest[:]) != f.plan.CometGenesisSHA256 {
		t.Fatal("fixture original genesis drift")
	}
	vf := &validatorRegistryFixture{migration: f.migration, raw: raw, bootstrap: f.bootstrap, doc: doc, legacy: make(map[string]ed25519.PrivateKey)}
	for i := range f.migration.Validators {
		key := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{byte(i + 51)}, ed25519.SeedSize))
		hash := sha256.Sum256(key.Public().(ed25519.PublicKey))
		vf.legacy[string(hash[:20])] = key
	}
	path := filepath.Join(t.TempDir(), "state.json")
	app, err := NewPersistentApplicationWithBootstrap(f.migration, path, f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	old := app.committed
	old.Version = version
	// Unmarshal into a fresh struct so omitted fields cannot survive projection.
	var initialApp CommittedState
	if err = json.Unmarshal(historicalPerformanceStateJSON(t, old), &initialApp); err != nil {
		t.Fatal(err)
	}
	initialApp.bootstrap = f.bootstrap
	app.committed, app.replayStateVersion = initialApp, version
	initResponse, err := app.InitChain(context.Background(), vf.initRequest(t))
	if err != nil {
		t.Fatal(err)
	}
	db, blocksDB := dbm.NewMemDB(), dbm.NewMemDB()
	t.Cleanup(func() { _ = db.Close(); _ = blocksDB.Close() })
	h := &engineWiringHarness{f: vf, app: app, source: &engineSourceRecorder{app: app}, raw: sm.NewStore(db, sm.StoreOptions{}), blocks: blockstore.NewBlockStore(blocksDB), path: path}
	h.proxy = startEngineTestProxy(t, app)
	initial, err := sm.MakeGenesisState(doc)
	if err != nil {
		t.Fatal(err)
	}
	// Reproduce the legacy InitChain handshake result, including its real old
	// application version, rather than using this binary's current constant.
	initial.Version.Consensus.App = f.plan.OldApplicationVersion
	initial.AppHash = bytes.Clone(initResponse.AppHash)
	initial.LastResultsHash = merkle.HashFromByteSlices(nil)
	if err = h.raw.Save(initial); err != nil {
		t.Fatal(err)
	}
	f.old = nil
	for nonce := uint64(1); nonce <= 3; nonce++ {
		h.apply(t, cmttypes.Txs{journalTransfer(t, nonce)})
		f.old = append(f.old, h.app.committed)
	}
	f.plan.CheckpointHeight = app.committed.Height
	f.plan.CheckpointAppHash = app.committed.AppHash
	f.plan.UpgradeHeight = app.committed.Height + 1
	wire, pin := runtimePlanBytes(t, f.plan)
	f.authorization, err = NewRuntimeUpgradeAuthorization(wire, pin, f.bootstrap, f.migration)
	if err != nil {
		t.Fatal(err)
	}
	return &runtimeConsumerEngineHarness{engineWiringHarness: h, databases: map[string]dbm.DB{"state": db, "blockstore": blocksDB}}, f
}

func attachRuntimeEngineApp(t *testing.T, h *runtimeConsumerEngineHarness, f runtimeUpgradeFixture, checkpoint CommittedState) *Application {
	t.Helper()
	if err := saveCommittedState(h.path, checkpoint, f.migration); err != nil {
		t.Fatal(err)
	}
	app, err := NewPersistentApplicationWithRuntimeUpgrade(f.migration, h.path, f.bootstrap, nil, f.authorization)
	if err != nil {
		t.Fatal(err)
	}
	h.app, h.source.app = app, app
	h.proxy = startEngineTestProxy(t, app)
	return app
}

func handshakeRuntimeEngine(t *testing.T, h *runtimeConsumerEngineHarness) error {
	t.Helper()
	state, err := h.raw.Load()
	if err != nil {
		t.Fatal(err)
	}
	handshake := cmtconsensus.NewHandshaker(h.raw, state, h.blocks, h.f.doc)
	handshake.SetConsensusAuthoritySource(h.app)
	return handshake.Handshake(h.proxy)
}

func TestRuntimeConsumerActualHandshakeReplayAndEngineSave(t *testing.T) {
	for _, version := range []int{12, 13} {
		t.Run(fmt.Sprint(version), func(t *testing.T) {
			h, f := runtimeEngineFixture(t, version)
			// Reopen the real app two stored blocks behind. Ordinary Comet replay
			// must confirm each old checkpoint; no block-journal hook is involved.
			app := attachRuntimeEngineApp(t, h, f, f.old[0])
			if err := handshakeRuntimeEngine(t, h); err != nil {
				t.Fatal("normal replay failed", err)
			}
			if app.runtimeUpgradeCursor == nil || app.runtimeUpgradeCursor.height != f.plan.CheckpointHeight || app.committed.AppHash != f.plan.CheckpointAppHash || app.committed.Version != version {
				t.Fatal("normal replay changed old hash/profile")
			}
			state, block, id, _ := h.makeBlock(t, cmttypes.Txs{journalTransfer(t, 4)})
			if block.Version.App != f.plan.OldApplicationVersion {
				t.Fatal("upgrade block rewrote its parent header version")
			}
			executor := sm.NewBlockExecutor(sm.WithConsensusAuthorityStore(h.raw, app), log.NewNopLogger(), h.proxy.Consensus(), &mempool.NopMempool{}, sm.EmptyEvidencePool{}, h.blocks)
			next, err := executor.ApplyBlock(state, id, block)
			if err != nil {
				t.Fatal("actual upgrade ApplyBlock", err)
			}
			if next.Version.Consensus.App != 20 || app.committed.Version != 18 || app.runtimeUpgradeCursor.height != next.LastBlockHeight || next.LastHeightConsensusParamsChanged != f.plan.UpgradeHeight+1 {
				t.Fatal("actual post-Save callback or H+1 version update missing")
			}
			past, err := h.raw.LoadConsensusParams(f.plan.UpgradeHeight)
			if err != nil {
				t.Fatal(err)
			}
			future, err := h.raw.LoadConsensusParams(f.plan.UpgradeHeight + 1)
			if err != nil || past.Version.App != f.plan.OldApplicationVersion || future.Version.App != 20 {
				t.Fatal("actual historical params changed", err)
			}
			cold := attachRuntimeEngineApp(t, h, f, app.committed)
			if err = handshakeRuntimeEngine(t, h); err != nil || cold.runtimeUpgradeCursor == nil || cold.runtimeUpgradeCursor.height != next.LastBlockHeight {
				t.Fatal("normal cold handshake lost confirmed new domain", err)
			}
		})
	}
}

type runtimeFailEngineSave struct {
	sm.Store
	failure error
}

func (s runtimeFailEngineSave) Save(sm.State) error { return s.failure }

func TestRuntimeConsumerAppAheadWaitsForNormalMockReplaySave(t *testing.T) {
	h, f := runtimeEngineFixture(t, 13)
	app := attachRuntimeEngineApp(t, h, f, f.old[2])
	if err := handshakeRuntimeEngine(t, h); err != nil {
		t.Fatal(err)
	}
	state, block, id, _ := h.makeBlock(t, cmttypes.Txs{journalTransfer(t, 4)})
	failure := errors.New("injected engine state Save failure after real app Commit")
	store := sm.WithConsensusAuthorityStore(runtimeFailEngineSave{Store: h.raw, failure: failure}, app)
	executor := sm.NewBlockExecutor(store, log.NewNopLogger(), h.proxy.Consensus(), &mempool.NopMempool{}, sm.EmptyEvidencePool{}, h.blocks)
	if _, err := executor.ApplyBlock(state, id, block); !errors.Is(err, failure) {
		t.Fatal("failure did not reach actual engine Save", err)
	}
	if app.committed.Height != f.plan.UpgradeHeight || app.runtimeUpgradeCursor.height != f.plan.CheckpointHeight {
		t.Fatal("app-ahead Save failure advanced cursor")
	}
	appHash := app.committed.AppHash
	// Cold app cannot invent a checkpoint from its newer file. The persisted
	// Finalize result and original block drive Comet's normal mock replay.
	cold, err := NewPersistentApplicationWithRuntimeUpgrade(f.migration, h.path, f.bootstrap, nil, f.authorization)
	if err != nil || cold.runtimeUpgradeCursor != nil {
		t.Fatal("cold app self-confirmed", err)
	}
	h.app, h.source.app = cold, cold
	h.proxy = startEngineTestProxy(t, cold)
	before, err := os.ReadFile(h.path)
	if err != nil {
		t.Fatal(err)
	}
	if err = handshakeRuntimeEngine(t, h); err != nil {
		t.Fatal("normal app-ahead mock replay", err)
	}
	after, err := os.ReadFile(h.path)
	if err != nil || !bytes.Equal(before, after) || cold.committed.AppHash != appHash || cold.runtimeUpgradeCursor == nil || cold.runtimeUpgradeCursor.height != f.plan.UpgradeHeight {
		t.Fatal("recovery re-executed application or failed to confirm actual saved engine state", err)
	}
}

func TestRuntimeConsumerNormalNodeFactoryUsesActualDurableCheckpointWithoutStart(t *testing.T) {
	h, f := runtimeEngineFixture(t, 13)
	app := attachRuntimeEngineApp(t, h, f, f.old[2])
	config := cfg.DefaultConfig().SetRoot(t.TempDir())
	config.TxIndex.Indexer = "null"
	config.P2P.PexReactor = false
	config.RPC.ListenAddress = ""
	config.RPC.PprofListenAddress = ""
	if err := os.MkdirAll(filepath.Dir(config.GenesisFile()), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(config.GenesisFile(), h.f.raw, 0600); err != nil {
		t.Fatal(err)
	}
	legacy := cmted.PrivKey(bytes.Clone(h.f.legacy[string(h.f.bootstrap.record.Members[0].Address)]))
	pv := privval.NewFilePV(legacy, filepath.Join(config.RootDir, "key.json"), filepath.Join(config.RootDir, "sign.json"))
	database := func(ctx *cfg.DBContext) (dbm.DB, error) {
		if db := h.databases[ctx.ID]; db != nil {
			return db, nil
		}
		db := dbm.NewMemDB()
		h.databases[ctx.ID] = db
		return db, nil
	}
	n, err := newPQNodeWithDatabase(config, app, pv, &p2p.NodeKey{PrivKey: cmted.GenPrivKey()}, log.NewNopLogger(), database)
	if err != nil {
		t.Fatal("normal factory failed actual runtime handshake", err)
	}
	t.Cleanup(func() { n.OnStop(); _ = n.ProxyApp().Stop() })
	if n.IsRunning() || n.BlockStore().Height() != f.plan.CheckpointHeight || app.runtimeUpgradeCursor == nil || app.runtimeUpgradeCursor.height != f.plan.CheckpointHeight {
		t.Fatal("normal constructor started node or failed actual checkpoint binding")
	}
	old, err := NewPersistentApplicationWithBootstrap(f.migration, h.path, f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = newPQNodeWithDatabase(config, old, pv, &p2p.NodeKey{PrivKey: cmted.GenPrivKey()}, log.NewNopLogger(), database); err == nil {
		t.Fatal("normal factory silently promoted old state without independent plan")
	}
}
