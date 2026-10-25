package consensus

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	dbm "github.com/cometbft/cometbft-db"
	abci "github.com/cometbft/cometbft/abci/types"
	cmtconfig "github.com/cometbft/cometbft/config"
	cmtconsensus "github.com/cometbft/cometbft/consensus"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/crypto/ynxpq"
	"github.com/cometbft/cometbft/evidence"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/light"
	lightprovider "github.com/cometbft/cometbft/light/provider"
	lightmock "github.com/cometbft/cometbft/light/provider/mock"
	lightdb "github.com/cometbft/cometbft/light/store/db"
	"github.com/cometbft/cometbft/mempool"
	"github.com/cometbft/cometbft/node"
	"github.com/cometbft/cometbft/p2p"
	"github.com/cometbft/cometbft/privval"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	"github.com/cometbft/cometbft/proxy"
	sm "github.com/cometbft/cometbft/state"
	blockstore "github.com/cometbft/cometbft/store"
	cmttypes "github.com/cometbft/cometbft/types"
)

// Records real engine requests, then delegates to the actual application.
// It grants no authority and deliberately rejects empty startup hashes.
type engineSourceRecorder struct {
	app   *Application
	calls []int64
}

func (s *engineSourceRecorder) ConsensusAuthorityForState(chain string, height int64, hash []byte) (cmttypes.ConsensusAuthority, error) {
	if len(hash) != 32 {
		return nil, errors.New("engine requested authority before InitChain supplied AppHash")
	}
	authority, err := s.app.ConsensusAuthorityForState(chain, height, hash)
	if err == nil {
		s.calls = append(s.calls, height)
	}
	return authority, err
}

func startEngineTestProxy(t *testing.T, app *Application) proxy.AppConns {
	t.Helper()
	p := proxy.NewAppConns(proxy.NewLocalClientCreator(app), proxy.NopMetrics())
	if err := p.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = p.Stop() })
	return p
}

func TestPQEngineNodeConstructorAuthenticatesAfterInitialHandshake(t *testing.T) {
	f := newValidatorRegistryFixture(t)
	app, err := NewPersistentApplicationWithBootstrap(f.migration, "", f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	info, err := app.Info(context.Background(), &abci.RequestInfo{})
	if err != nil || info.LastBlockHeight != 0 || len(info.LastBlockAppHash) != 0 || f.doc.InitialHeight <= 1 {
		t.Fatal("fixture must exercise real fresh Info/continued InitialHeight", err)
	}
	source := &engineSourceRecorder{app: app}
	config := cmtconfig.DefaultConfig().SetRoot(t.TempDir())
	config.TxIndex.Indexer = "null"
	config.P2P.PexReactor = false
	config.RPC.ListenAddress = ""
	config.RPC.PprofListenAddress = ""
	legacy := cmted.PrivKey(bytes.Clone(f.legacy[string(f.bootstrap.record.Members[0].Address)]))
	pv := privval.NewFilePV(legacy, filepath.Join(config.RootDir, "key.json"), filepath.Join(config.RootDir, "sign.json"))
	n, err := node.NewNodeWithConsensusAuthority(config, pv, &p2p.NodeKey{PrivKey: cmted.GenPrivKey()},
		proxy.NewLocalClientCreator(app), func() (*cmttypes.GenesisDoc, error) { return f.doc, nil },
		func(*cmtconfig.DBContext) (dbm.DB, error) { return dbm.NewMemDB(), nil },
		node.DefaultMetricsProvider(config.Instrumentation), log.NewNopLogger(), source)
	if err != nil {
		t.Fatal("real node constructor/InitChain failed:", err)
	}
	// Construction only: never start consensus, P2P, RPC, a listener or a node.
	t.Cleanup(func() { n.OnStop(); _ = n.ProxyApp().Stop() })
	if n.IsRunning() || n.BlockStore().Height() != 0 || len(source.calls) == 0 {
		t.Fatal("constructor did not bind checkpoint, or started/created chain history")
	}
	for _, h := range source.calls {
		if h != f.doc.InitialHeight-1 {
			t.Fatal("bootstrap used fabricated engine height", h)
		}
	}
}

type engineWiringHarness struct {
	f      *validatorRegistryFixture
	app    *Application
	source *engineSourceRecorder
	raw    sm.Store
	blocks *blockstore.BlockStore
	proxy  proxy.AppConns
	path   string
	keys   []engineTestKey
}

func newEngineWiringHarness(t *testing.T) *engineWiringHarness {
	t.Helper()
	f := newValidatorRegistryFixture(t)
	path := filepath.Join(t.TempDir(), "committed.json")
	app, err := NewPersistentApplicationWithBootstrap(f.migration, path, f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	db, blocksDB := dbm.NewMemDB(), dbm.NewMemDB()
	t.Cleanup(func() { _ = db.Close(); _ = blocksDB.Close() })
	h := &engineWiringHarness{f: f, app: app, source: &engineSourceRecorder{app: app}, raw: sm.NewStore(db, sm.StoreOptions{}), blocks: blockstore.NewBlockStore(blocksDB), path: path}
	h.proxy = startEngineTestProxy(t, app)
	initial, err := sm.MakeGenesisState(f.doc)
	if err != nil {
		t.Fatal(err)
	}
	// The engine can have no application hash until InitChain. The independent
	// pinned GenesisDoc remains unchanged and is still fully validated by App.
	initial.AppHash = nil
	if err := h.raw.Save(initial); err != nil {
		t.Fatal(err)
	}
	handshake := cmtconsensus.NewHandshaker(h.raw, initial, h.blocks, f.doc)
	handshake.SetConsensusAuthoritySource(h.source)
	if err := handshake.Handshake(h.proxy); err != nil {
		t.Fatal(err)
	}
	if len(h.source.calls) != 0 {
		t.Fatal("empty-genesis handshake requested authority prematurely")
	}
	restored, err := h.wrapped().Load()
	if err != nil {
		t.Fatal(err)
	}
	hash, _ := hex.DecodeString(app.committed.AppHash)
	if restored.LastBlockHeight != 0 || restored.InitialHeight <= 1 || !bytes.Equal(restored.AppHash, hash) || !restored.LastValidators.IsNilOrEmpty() {
		t.Fatal("InitChain lost actual app hash or invented pre-migration Comet history")
	}
	return h
}
func (h *engineWiringHarness) wrapped() sm.Store {
	return sm.WithConsensusAuthorityStore(h.raw, h.source)
}

func (h *engineWiringHarness) makeBlock(t *testing.T, txs cmttypes.Txs) (sm.State, *cmttypes.Block, cmttypes.BlockID, *cmttypes.Commit) {
	t.Helper()
	state, err := h.wrapped().Load()
	if err != nil {
		t.Fatal(err)
	}
	height := state.LastBlockHeight + 1
	previous := &cmttypes.Commit{}
	if state.LastBlockHeight == 0 {
		height = state.InitialHeight
	} else {
		previous = h.blocks.LoadSeenCommit(state.LastBlockHeight)
	}
	block, err := state.MakeBlock(height, txs, previous, nil, state.Validators.GetProposer().Address)
	if err != nil {
		t.Fatal(err)
	}
	parts, err := block.MakePartSet(cmttypes.BlockPartSizeBytes)
	if err != nil {
		t.Fatal(err)
	}
	id := cmttypes.BlockID{Hash: block.Hash(), PartSetHeader: parts.Header()}
	commit := &cmttypes.Commit{Height: height, Round: 0, BlockID: id}
	for i, member := range state.Validators.Validators {
		vote := &cmttypes.Vote{Type: cmtproto.PrecommitType, Height: height, Round: 0, BlockID: id, Timestamp: block.Time.Add(time.Second), ValidatorAddress: bytes.Clone(member.Address), ValidatorIndex: int32(i)}
		if member.PubKey.Type() == ynxpq.KeyType {
			var key *engineTestKey
			for j := range h.keys {
				if bytes.Equal(h.keys[j].address, member.Address) {
					key = &h.keys[j]
					break
				}
			}
			if key == nil {
				t.Fatal("missing actual fixture PQ secret")
			}
			request, err := ynxconsensusauth.NewVoteRequestV2(h.f.bootstrap.genesisID, h.f.doc.ChainID, vote.ToProto())
			if err != nil {
				t.Fatal(err)
			}
			message, err := request.SigningBytes(1)
			if err != nil {
				t.Fatal(err)
			}
			a, b := key.signatures(t, message)
			vote.Signature, err = (ynxconsensusauth.Envelope{KeyEpoch: 1, MLDSA87: a, SLHDSASHA2256f: b}).MarshalBinary()
			if err != nil {
				t.Fatal(err)
			}
		} else {
			vote.Signature = ed25519.Sign(h.f.legacy[string(member.Address)], cmttypes.VoteSignBytes(h.f.doc.ChainID, vote.ToProto()))
		}
		if err := vote.Verify(h.f.doc.ChainID, member.PubKey); err != nil {
			t.Fatal("real engine-height fixture signature:", err)
		}
		commit.Signatures = append(commit.Signatures, vote.CommitSig())
	}
	h.blocks.SaveBlock(block, parts, commit)
	return state, block, id, commit
}
func (h *engineWiringHarness) apply(t *testing.T, txs cmttypes.Txs) sm.State {
	t.Helper()
	state, block, id, _ := h.makeBlock(t, txs)
	executor := sm.NewBlockExecutor(h.wrapped(), log.NewNopLogger(), h.proxy.Consensus(), &mempool.NopMempool{}, sm.EmptyEvidencePool{}, h.blocks)
	next, err := executor.ApplyBlock(state, id, block)
	if err != nil {
		t.Fatal("actual BlockExecutor:", err)
	}
	return next
}

func TestPQEngineHandshakeFirstBlockAppAheadUsesDurableExactCheckpoint(t *testing.T) {
	for _, mode := range []string{"valid", "missing-hash", "wrong-hash"} {
		t.Run(mode, func(t *testing.T) {
			h := newEngineWiringHarness(t)
			old, block, _, _ := h.makeBlock(t, nil)
			result, err := h.app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: block.Height, Time: block.Time, Hash: block.Hash(), NextValidatorsHash: block.NextValidatorsHash, ProposerAddress: block.ProposerAddress})
			if err != nil {
				t.Fatal(err)
			}
			if _, err = h.app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
				t.Fatal(err)
			}
			actualHash := bytes.Clone(result.AppHash)
			switch mode {
			case "missing-hash":
				result.AppHash = nil
			case "wrong-hash":
				result.AppHash = bytes.Repeat([]byte{91}, 32)
			}
			if err = h.raw.SaveFinalizeBlockResponse(block.Height, result); err != nil {
				t.Fatal(err)
			}
			if old.LastBlockHeight != 0 || block.Height != old.InitialHeight {
				t.Fatal("not the initial-height crash boundary")
			}
			handshake := cmtconsensus.NewHandshaker(h.raw, old, h.blocks, h.f.doc)
			handshake.SetConsensusAuthoritySource(h.source)
			err = handshake.Handshake(h.proxy)
			if mode != "valid" {
				if err == nil {
					t.Fatal("missing/mismatched durable Finalize authority accepted")
				}
				still, loadErr := h.raw.Load()
				if loadErr != nil || still.LastBlockHeight != 0 {
					t.Fatal("rejected replay changed engine state", loadErr)
				}
				return
			}
			if err != nil {
				t.Fatal("actual first-block app-ahead replay:", err)
			}
			restored, err := h.wrapped().Load()
			if err != nil || restored.LastBlockHeight != block.Height || !bytes.Equal(restored.AppHash, actualHash) || handshake.NBlocks() != 1 {
				t.Fatal("replay did not reconcile exact committed checkpoint", err)
			}
			if h.app.committed.Height != block.Height || h.app.pending != nil {
				t.Fatal("recovery re-executed the real committed app")
			}
		})
	}
}

func TestPQEngineActualBlockExecutionHistoricalStoresEvidenceAndLight(t *testing.T) {
	h := newEngineWiringHarness(t)
	var registrations cmttypes.Txs
	for i := range h.f.bootstrap.record.Members {
		key, wire := engineRegistration(t, h.f, i, h.f.doc.InitialHeight)
		h.keys = append(h.keys, key)
		tx, err := EncodeValidatorRegistryTransaction(wire)
		if err != nil {
			t.Fatal(err)
		}
		registrations = append(registrations, tx)
	}
	h.apply(t, registrations)
	schedule, err := NewPQEngineSchedule(h.f.bootstrap, h.app.committed.ValidatorRegistry, h.app.committed.Height, h.app.committed.Height+4)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(schedule)
	pin, _ := schedule.Hash()
	auth, err := NewPQEngineAuthorization(raw, pin)
	if err != nil {
		t.Fatal(err)
	}
	app, err := NewPersistentApplicationWithEngineAuthorization(h.f.migration, h.path, h.f.bootstrap, auth)
	if err != nil {
		t.Fatal(err)
	}
	h.app = app
	h.source.app = app
	h.proxy = startEngineTestProxy(t, app)
	for app.committed.Height < schedule.ActivationHeight+1 {
		h.apply(t, nil)
	}
	state, err := h.wrapped().Load()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = sm.BindConsensusState(state, nil); err == nil {
		t.Fatal("actual PQ state accepted without independent source")
	}
	loaded, err := h.wrapped().LoadValidators(schedule.ActivationHeight)
	if err != nil {
		t.Fatal(err)
	}
	bare, err := h.raw.LoadValidators(schedule.ActivationHeight)
	if err != nil {
		t.Fatal(err)
	}
	commit := h.blocks.LoadSeenCommit(schedule.ActivationHeight)
	if bare.VerifyCommit(h.f.doc.ChainID, commit.BlockID, commit.Height, commit) == nil {
		t.Fatal("protobuf store smuggled local authority")
	}
	if err = loaded.VerifyCommit(h.f.doc.ChainID, commit.BlockID, commit.Height, commit); err != nil {
		t.Fatal("actual historical load lacks authority", err)
	}
	old, err := h.wrapped().LoadValidators(h.f.doc.InitialHeight)
	if err != nil {
		t.Fatal(err)
	}
	oldCommit := h.blocks.LoadSeenCommit(h.f.doc.InitialHeight)
	if err = old.VerifyCommit(h.f.doc.ChainID, oldCommit.BlockID, oldCommit.Height, oldCommit); err != nil {
		t.Fatal("historical Ed commit changed", err)
	}
	snapshot, err := app.CommittedPQEngineSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	past, err := h.wrapped().LoadConsensusParams(schedule.ParamsUpdateHeight)
	if err != nil {
		t.Fatal(err)
	}
	if len(past.YNXProfile) != 0 || len(state.ConsensusParams.YNXProfile) == 0 {
		t.Fatal("historical params lost activation boundary")
	}
	// The real evidence pool loads the authenticated historical set. Both
	// conflicting votes carry real dual signatures, never an accepting mock.
	first := commit.GetVote(0)
	second := first.Copy()
	second.BlockID = cmttypes.BlockID{Hash: bytes.Repeat([]byte{77}, 32), PartSetHeader: first.BlockID.PartSetHeader}
	var signingKey engineTestKey
	for _, key := range h.keys {
		if bytes.Equal(key.address, first.ValidatorAddress) {
			signingKey = key
		}
	}
	request, err := ynxconsensusauth.NewVoteRequestV2(h.f.bootstrap.genesisID, h.f.doc.ChainID, second.ToProto())
	if err != nil {
		t.Fatal(err)
	}
	message, err := request.SigningBytes(1)
	if err != nil {
		t.Fatal(err)
	}
	a, b := signingKey.signatures(t, message)
	second.Signature, err = (ynxconsensusauth.Envelope{KeyEpoch: 1, MLDSA87: a, SLHDSASHA2256f: b}).MarshalBinary()
	if err != nil {
		t.Fatal(err)
	}
	ev, err := cmttypes.NewDuplicateVoteEvidence(first, second, h.blocks.LoadBlock(commit.Height).Time, loaded)
	if err != nil {
		t.Fatal(err)
	}
	evdb := dbm.NewMemDB()
	defer evdb.Close()
	pool, err := evidence.NewPool(evdb, h.wrapped(), h.blocks)
	if err != nil {
		t.Fatal(err)
	}
	if err = pool.AddEvidence(ev); err != nil {
		t.Fatal("actual evidence pool rejected genuine conflicting PQ votes:", err)
	}
	conflictingHeader := h.blocks.LoadBlock(commit.Height).Header
	conflictingHeader.DataHash = bytes.Repeat([]byte{66}, 32)
	conflictingID := cmttypes.BlockID{Hash: conflictingHeader.Hash(), PartSetHeader: commit.BlockID.PartSetHeader}
	conflictingCommit := &cmttypes.Commit{Height: commit.Height, Round: commit.Round, BlockID: conflictingID}
	for i, member := range loaded.Validators {
		vote := commit.GetVote(int32(i))
		vote.BlockID = conflictingID
		var key engineTestKey
		for _, candidate := range h.keys {
			if bytes.Equal(candidate.address, member.Address) {
				key = candidate
			}
		}
		request, err := ynxconsensusauth.NewVoteRequestV2(h.f.bootstrap.genesisID, h.f.doc.ChainID, vote.ToProto())
		if err != nil {
			t.Fatal(err)
		}
		message, err := request.SigningBytes(1)
		if err != nil {
			t.Fatal(err)
		}
		a, b := key.signatures(t, message)
		vote.Signature, err = (ynxconsensusauth.Envelope{KeyEpoch: 1, MLDSA87: a, SLHDSASHA2256f: b}).MarshalBinary()
		if err != nil {
			t.Fatal(err)
		}
		conflictingCommit.Signatures = append(conflictingCommit.Signatures, vote.CommitSig())
	}
	conflicting := &cmttypes.LightBlock{SignedHeader: &cmttypes.SignedHeader{Header: &conflictingHeader, Commit: conflictingCommit}, ValidatorSet: bare}
	attack := &cmttypes.LightClientAttackEvidence{ConflictingBlock: conflicting, CommonHeight: commit.Height, TotalVotingPower: loaded.TotalVotingPower(), Timestamp: conflictingHeader.Time}
	trustedHeader := &cmttypes.SignedHeader{Header: &h.blocks.LoadBlock(commit.Height).Header, Commit: commit}
	attack.ByzantineValidators = attack.GetByzantineValidators(loaded, trustedHeader)
	if err := attack.ValidateBasic(); err != nil {
		t.Fatal(err)
	}
	if err := pool.CheckEvidence(cmttypes.EvidenceList{attack}); err != nil {
		t.Fatal("actual pool failed to bind decoded embedded PQ evidence set", err)
	}
	if bare.VerifyCommitLight(h.f.doc.ChainID, conflictingID, commit.Height, conflictingCommit) == nil {
		t.Fatal("evidence binding mutated peer-decoded keys to carry authority")
	}
	badAttack := *attack
	badBlock := *conflicting
	badEvidenceSigned := *conflicting.SignedHeader
	badCommit := conflictingCommit.Clone()
	badCommit.Signatures[0].Signature = bytes.Clone(badCommit.Signatures[0].Signature)
	badCommit.Signatures[0].Signature[len(badCommit.Signatures[0].Signature)-1] ^= 1
	badEvidenceSigned.Commit = badCommit
	badBlock.SignedHeader = &badEvidenceSigned
	badAttack.ConflictingBlock = &badBlock
	if err := pool.CheckEvidence(cmttypes.EvidenceList{&badAttack}); err == nil {
		t.Fatal("invalid embedded dual evidence proof accepted")
	}
	claimed := bare.Copy()
	claimed.Validators[0].VotingPower++
	if _, err := snapshot.BindValidatorSet(commit.Height, claimed); err == nil {
		t.Fatal("engine accepted malicious claimed power")
	}
	if _, err := snapshot.BindEvidenceValidatorSet(commit.Height, claimed); err != nil {
		t.Fatal("evidence lost independently registered key proof for a conflicting power claim", err)
	}
	executor := sm.NewBlockExecutor(h.wrapped(), log.NewNopLogger(), h.proxy.Consensus(), &mempool.NopMempool{}, pool, h.blocks)
	consensusState := cmtconsensus.NewState(cmtconfig.DefaultConsensusConfig(), state, executor, h.blocks, &mempool.NopMempool{}, pool)
	roundState := consensusState.GetRoundState()
	if roundState.Height != state.LastBlockHeight+1 || roundState.LastCommit == nil || !roundState.LastCommit.HasTwoThirdsMajority() {
		t.Fatal("actual ConsensusState failed to reconstruct authenticated PQ LastCommit")
	}
	// Provider transports decoded bare keys. The option must bind primary,
	// witness, and a serialized cold trusted-store read before verification.
	headers := map[int64]*cmttypes.SignedHeader{}
	sets := map[int64]*cmttypes.ValidatorSet{}
	for height := schedule.ActivationHeight; height <= schedule.ActivationHeight+1; height++ {
		block := h.blocks.LoadBlock(height)
		headers[height] = &cmttypes.SignedHeader{Header: &block.Header, Commit: h.blocks.LoadSeenCommit(height)}
		sets[height], err = h.raw.LoadValidators(height)
		if err != nil {
			t.Fatal(err)
		}
	}
	primary := lightmock.New(h.f.doc.ChainID, headers, sets)
	witness := lightmock.New(h.f.doc.ChainID, headers, sets)
	db := dbm.NewMemDB()
	defer db.Close()
	trusted := lightdb.New(db, "pq-wiring")
	ctx := context.Background()
	opts := light.TrustOptions{Period: 100 * 365 * 24 * time.Hour, Height: schedule.ActivationHeight, Hash: headers[schedule.ActivationHeight].Hash()}
	client, err := light.NewClient(ctx, h.f.doc.ChainID, opts, primary, []lightprovider.Provider{witness}, trusted, light.WithConsensusAuthority(snapshot))
	if err != nil {
		t.Fatal("actual light initialize:", err)
	}
	now := headers[schedule.ActivationHeight+1].Time.Add(time.Second)
	if _, err = client.VerifyLightBlockAtHeight(ctx, schedule.ActivationHeight+1, now); err != nil {
		t.Fatal("actual light advance:", err)
	}
	reopened, err := light.NewClientFromTrustedStore(h.f.doc.ChainID, opts.Period, primary, []lightprovider.Provider{witness}, trusted, light.WithConsensusAuthority(snapshot))
	if err != nil {
		t.Fatal("actual light cold load:", err)
	}
	cold, err := reopened.TrustedLightBlock(schedule.ActivationHeight + 1)
	if err != nil {
		t.Fatal(err)
	}
	if err = cold.ValidatorSet.VerifyCommitLight(h.f.doc.ChainID, cold.Commit.BlockID, cold.Height, cold.Commit); err != nil {
		t.Fatal("cold light set lost authority", err)
	}
	bad := *cold
	badHeader := *cold.Header
	badHeader.ConsensusHash = bytes.Repeat([]byte{33}, 32)
	badSigned := *cold.SignedHeader
	badSigned.Header = &badHeader
	bad.SignedHeader = &badSigned
	if _, err = light.BindLightBlock(snapshot, &bad); err == nil {
		t.Fatal("light accepted another ConsensusHash")
	}
	if _, err = light.BindLightBlock(nil, cold); err == nil {
		t.Fatal("light accepted absent authority")
	}
	if bytes.Equal(state.Validators.Proposer.Address, []byte{}) {
		t.Fatal("actual proposer was lost")
	}
}
