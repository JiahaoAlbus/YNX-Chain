package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	dbm "github.com/cometbft/cometbft-db"
	abci "github.com/cometbft/cometbft/abci/types"
	cfg "github.com/cometbft/cometbft/config"
	cryptoenc "github.com/cometbft/cometbft/crypto/encoding"
	cmtflags "github.com/cometbft/cometbft/libs/cli/flags"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/mempool"
	"github.com/cometbft/cometbft/proxy"
	sm "github.com/cometbft/cometbft/state"
	blockstore "github.com/cometbft/cometbft/store"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

type commitObservationFixture struct {
	migration chain.ConsensusMigrationState
	bootstrap *consensus.ConsensusBootstrap
	doc       *cmttypes.GenesisDoc
	transfer  []byte
	owner     string
}

func newCommitObservationFixture(t *testing.T) commitObservationFixture {
	t.Helper()
	key := secp256k1.PrivKeyFromBytes(bytes.Repeat([]byte{0x63}, 32))
	defer key.Zero()
	owner, err := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	recipientKey := secp256k1.PrivKeyFromBytes(bytes.Repeat([]byte{0x64}, 32))
	defer recipientKey.Zero()
	recipient, err := consensus.NativeAddress(recipientKey.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	network := chain.DefaultNetworkConfig("testnet")
	network.ChainID = consensus.PQLabNativeChainID
	network.Slug = "pq-lab-commit-observation"
	network.IsPublicNet = false
	d := chain.NewDevnet(network)
	if _, err = d.Faucet(owner, 1000); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	m, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	var bindings []chain.ConsensusValidatorKeyBinding
	for i, v := range m.Validators {
		private := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{byte(121 + i)}, 32))
		public := private.Public().(ed25519.PublicKey)
		sum := sha256.Sum256(public)
		bindings = append(bindings, chain.ConsensusValidatorKeyBinding{ValidatorAddress: v.Address, KeyType: chain.ConsensusPubKeyTypeEd25519, PublicKey: base64.StdEncoding.EncodeToString(public), ConsensusAddress: strings.ToUpper(hex.EncodeToString(sum[:20]))})
		clear(private)
	}
	m, err = m.BindConsensusValidatorKeys(bindings)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := consensus.BuildCometGenesis(m, time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := cmtjson.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(raw)
	bootstrap, err := consensus.NewConsensusBootstrap(raw, consensus.ConsensusBootstrapPins{CometGenesisSHA256: hex.EncodeToString(digest[:]), OriginalGenesisHash: m.OriginalGenesisHash, MigrationStateHash: m.StateHash}, m)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := consensus.NewSignedTransfer(key, m.Network.ChainID, recipient, 7, 1)
	if err != nil {
		t.Fatal(err)
	}
	wire, err := consensus.EncodeSignedTransaction(tx)
	if err != nil {
		t.Fatal(err)
	}
	return commitObservationFixture{migration: m, bootstrap: bootstrap, doc: doc, transfer: wire, owner: owner}
}

func (f commitObservationFixture) initialize(t *testing.T, app *consensus.Application) {
	t.Helper()
	params := f.doc.ConsensusParams.ToProto()
	req := &abci.RequestInitChain{Time: f.doc.GenesisTime, ChainId: f.doc.ChainID, InitialHeight: f.doc.InitialHeight, ConsensusParams: &params, AppStateBytes: bytes.Clone(f.doc.AppState)}
	for _, v := range f.doc.Validators {
		key, err := cryptoenc.PubKeyToProto(v.PubKey)
		if err != nil {
			t.Fatal(err)
		}
		req.Validators = append(req.Validators, abci.ValidatorUpdate{PubKey: key, Power: v.Power})
	}
	if _, err := app.InitChain(context.Background(), req); err != nil {
		t.Fatal(err)
	}
}

func commitObservationOptions(t *testing.T, state string) (*cfg.Config, pqOptions) {
	t.Helper()
	dir := wireObservationTestDir(t)
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	c := cfg.DefaultConfig().SetRoot(dir)
	c.P2P.ListenAddress = "tcp://127.0.0.1:37111"
	c.P2P.ExternalAddress = ""
	c.P2P.Seeds = ""
	c.P2P.PersistentPeers = ""
	c.RPC.ListenAddress = ""
	c.RPC.GRPCListenAddress = ""
	c.RPC.PprofListenAddress = ""
	c.Instrumentation.Prometheus = false
	p := pqOptions{state: state, recoveryFD: -1, commitObservationOutput: filepath.Join(dir, "commit.json"), commitObservationScope: operatorWireObservationScope}
	return c, p
}

func makeObservedOperatorApplication(t *testing.T, f commitObservationFixture, layout, path string, enabled bool) (*consensus.Application, *operatorCommitObservation, pqOptions) {
	t.Helper()
	p := pqOptions{stateLayout: layout, recoveryFD: -1}
	var observation *operatorCommitObservation
	if enabled {
		c, options := commitObservationOptions(t, path)
		p = options
		p.stateLayout = layout
		var err error
		observation, err = prepareOperatorCommitObservation(c, p)
		if err != nil {
			t.Fatal(err)
		}
		p.commitObservationBind = observation.bind
		t.Cleanup(func() { _ = observation.close() })
	}
	app, err := newOperatorApplication(f.migration, path, f.bootstrap, nil, p)
	if err != nil {
		t.Fatal(err)
	}
	f.initialize(t, app)
	return app, observation, p
}

// Execute the original real local ABCI client and BlockExecutor. No Node,
// listener, remote signer, synthetic timing or substitute Commit is used.
func executeObservedEngineCommit(t *testing.T, f commitObservationFixture, app *consensus.Application, logger log.Logger, txs cmttypes.Txs) (sm.State, *cmttypes.Block, error) {
	t.Helper()
	p := proxy.NewAppConns(proxy.NewLocalClientCreator(app), proxy.NopMetrics())
	if err := p.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = p.Stop() }()
	state, err := sm.MakeGenesisState(f.doc)
	if err != nil {
		t.Fatal(err)
	}
	info, err := app.Info(context.Background(), &abci.RequestInfo{})
	if err != nil {
		t.Fatal(err)
	}
	state.Version.Consensus.App = info.AppVersion
	db := dbm.NewMemDB()
	defer db.Close()
	raw := sm.NewStore(db, sm.StoreOptions{})
	if err = raw.Save(state); err != nil {
		t.Fatal(err)
	}
	blocksDB := dbm.NewMemDB()
	defer blocksDB.Close()
	blocks := blockstore.NewBlockStore(blocksDB)
	block, err := state.MakeBlock(state.InitialHeight, txs, &cmttypes.Commit{}, nil, state.Validators.GetProposer().Address)
	if err != nil {
		t.Fatal(err)
	}
	parts, err := block.MakePartSet(cmttypes.BlockPartSizeBytes)
	if err != nil {
		t.Fatal(err)
	}
	id := cmttypes.BlockID{Hash: block.Hash(), PartSetHeader: parts.Header()}
	executor := sm.NewBlockExecutor(sm.WithConsensusAuthorityStore(raw, app), logger.With("module", "state"), p.Consensus(), &mempool.NopMempool{}, sm.EmptyEvidencePool{}, blocks)
	next, err := executor.ApplyBlock(state, id, block)
	return next, block, err
}

func commitObservationStateFiles(t *testing.T, root string) map[string][]byte {
	t.Helper()
	result := map[string][]byte{}
	err := filepath.WalkDir(root, func(path string, e fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if e.IsDir() {
			return nil
		}
		if strings.HasSuffix(path, ".lock") {
			return nil
		}
		name, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		result[name], err = os.ReadFile(path)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestOperatorCommitObservationRealBlockExecutorStateFeesAndJournalEquivalent(t *testing.T) {
	f := newCommitObservationFixture(t)
	for _, layout := range []string{"atomic-json", "snapshot-journal", "block-journal"} {
		t.Run(layout, func(t *testing.T) {
			var checkpoints [][]byte
			var fees [][]byte
			var stores []map[string][]byte
			for _, enabled := range []bool{false, true} {
				dir := t.TempDir()
				path := filepath.Join(dir, "state")
				app, o, options := makeObservedOperatorApplication(t, f, layout, path, enabled)
				base := log.NewNopLogger()
				filtered, err := cmtflags.ParseLogLevel("none", base, cfg.DefaultLogLevel)
				if err != nil {
					t.Fatal(err)
				}
				logger := wrapOperatorCommitLogger(filtered, o).With("module", "main").With("service", "original-node")
				stopRead := make(chan struct{})
				readDone := make(chan struct{})
				go func() {
					defer close(readDone)
					for {
						select {
						case <-stopRead:
							return
						default:
							_, _ = app.Info(context.Background(), &abci.RequestInfo{})
							_, _ = app.LastCommitTiming()
						}
					}
				}()
				next, block, err := executeObservedEngineCommit(t, f, app, logger, cmttypes.Txs{f.transfer})
				close(stopRead)
				select {
				case <-readDone:
				case <-time.After(2 * time.Second):
					t.Fatal("Commit observer lock ordering deadlocked")
				}
				if err != nil {
					t.Fatal("actual BlockExecutor failed", err)
				}
				checkpoints = append(checkpoints, cometJournalQuery(t, app, "/state", nil))
				fees = append(fees, cometJournalQuery(t, app, "/economics/fees", nil))
				stores = append(stores, commitObservationStateFiles(t, dir))
				var committed consensus.CommittedState
				if err = json.Unmarshal(checkpoints[len(checkpoints)-1], &committed); err != nil {
					t.Fatal(err)
				}
				if len(committed.FeeEvents) == 0 {
					t.Fatal("real transaction must produce the original fee event")
				}
				found := false
				for _, a := range committed.Accounts {
					if a.Address == f.owner {
						found = a.Nonce == 1
					}
				}
				if !found {
					t.Fatal("original account nonce did not advance exactly once")
				}
				if enabled {
					detail, available := app.LastCommitValidationTiming()
					if !available || !detail.Valid || detail.Height != next.LastBlockHeight {
						t.Fatal("normal synthetic bind did not opt into original validation detail")
					}
					if len(o.result.Samples) != 1 {
						t.Fatal("normal synchronous engine event was not consumed", o.result.RejectedNotifications)
					}
					sample := o.result.Samples[0]
					if sample.Height != next.LastBlockHeight || sample.AppHash != hex.EncodeToString(next.AppHash) || sample.AppHash == hex.EncodeToString(block.AppHash) || sample.Persistence.Height != sample.Height || !sample.Persistence.Durable || len(sample.Persistence.StagesNs) == 0 {
						t.Fatal("sample was not tied to actual new committed checkpoint", sample)
					}
					for _, name := range []string{"validator_registry", "engine_schedule", "engine_snapshot", "pq_state", "ledger_records", "app_hash"} {
						if ns, ok := sample.Persistence.StagesNs["validate_child_"+name]; !ok || ns != detail.PhaseNs[name] {
							t.Fatal("normal observer lost an actual validator phase", name)
						}
					}
					if sample.Persistence.StagesNs["validate_child_hash_document"] != detail.HashDocumentNs || sample.Persistence.StagesNs["validate_child_hash_encode_digest"] != detail.HashEncodeDigestNs || detail.HashDocumentNs <= 0 || detail.HashEncodeDigestNs <= 0 {
						t.Fatal("actual changed-state hash child intervals not captured")
					}
					o.started()
					if err = o.writeAfterStop(); err != nil {
						t.Fatal(err)
					}
					var result operatorCommitObservationResult
					raw, err := os.ReadFile(options.commitObservationOutput)
					if err != nil || json.Unmarshal(raw, &result) != nil || result.ProcessID != os.Getpid() || !result.Coverage.NotificationCaptureComplete || result.Coverage.AllCommitAttemptsCovered || result.Coverage.ReplayCoverageComplete || result.IndependentFinality || result.SignerFsyncMeasured {
						t.Fatal("actual private output overstated measurement or lost identity", err)
					}
					if err = o.writeAfterStop(); err == nil {
						t.Fatal("normal output was overwritten/replayed")
					}
					if err = o.close(); err != nil {
						t.Fatal(err)
					}
					if _, available := app.LastCommitValidationTiming(); available {
						t.Fatal("normal observer close retained validation timing")
					}
				} else {
					if _, ok := app.LastCommitTiming(); ok {
						t.Fatal("default-off common application enabled timing")
					}
					if _, ok := app.LastCommitValidationTiming(); ok {
						t.Fatal("default-off common application enabled validation timing")
					}
				}
				cold, coldErr := newOperatorApplication(f.migration, path, f.bootstrap, nil, pqOptions{stateLayout: layout, recoveryFD: -1})
				if coldErr != nil || !bytes.Equal(cometJournalQuery(t, cold, "/state", nil), checkpoints[len(checkpoints)-1]) || !bytes.Equal(cometJournalQuery(t, cold, "/economics/fees", nil), fees[len(fees)-1]) {
					t.Fatal("timing changed cold journal recovery", coldErr)
				}
			}
			if !bytes.Equal(checkpoints[0], checkpoints[1]) || !bytes.Equal(fees[0], fees[1]) || !reflect.DeepEqual(stores[0], stores[1]) {
				t.Fatal("observer changed state, balances/nonces, fees or actual journal bytes")
			}
		})
	}
}
