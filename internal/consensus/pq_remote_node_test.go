//go:build unix

package consensus

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	dbm "github.com/cometbft/cometbft-db"
	cfg "github.com/cometbft/cometbft/config"
	cmtconsensus "github.com/cometbft/cometbft/consensus"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/crypto/ynxpq"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/p2p"
	p2pconn "github.com/cometbft/cometbft/p2p/conn"
	"github.com/cometbft/cometbft/privval"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	sm "github.com/cometbft/cometbft/state"
	blockstore "github.com/cometbft/cometbft/store"
	cmttypes "github.com/cometbft/cometbft/types"
)

func remoteRuntimeBinding(t *testing.T, q *pqPVFixture, owner int) ynxconsensusauth.HostKeyBinding {
	t.Helper()
	i, err := q.signers[owner].Identity()
	if err != nil {
		t.Fatal(err)
	}
	return ynxconsensusauth.HostKeyBinding{Policy: i.Policy, ValidatorAddress: i.ValidatorAddress, Epoch: i.Epoch, MLDSA87PublicKey: i.MLDSA87PublicKey, SLHDSASHA2256fPublicKey: i.SLHDSASHA2256fPublicKey, SignerStatePath: q.signerPaths[owner]}
}

// This fixture enters the same one-session runtime as the CLI. Only the socket
// is supplied by net.Pipe; transport identities, full peer pins, FileSource and
// original durable transition signer are real and independently loaded.
func remoteRuntimeSession(t *testing.T, q *pqPVFixture, owner int) (*p2pconn.SecretConnection, cmted.PubKey, *PQEngineFileSource, string) {
	conn, pin, source, path, _ := remoteRuntimeSessionWithLoss(t, q, owner, false)
	return conn, pin, source, path
}

type remoteRuntimeLossPV struct {
	*PQTransitionPrivValidator
	fault *pqRemoteFailWrite
	votes atomic.Int32
}

func (p *remoteRuntimeLossPV) SignVote(chain string, vote *cmtproto.Vote) error {
	p.votes.Add(1)
	err := p.PQTransitionPrivValidator.SignVote(chain, vote)
	if err == nil {
		p.fault.fail.Store(true)
	}
	return err
}

func remoteRuntimeSessionWithLoss(t *testing.T, q *pqPVFixture, owner int, dropAfterSign bool) (*p2pconn.SecretConnection, cmted.PubKey, *PQEngineFileSource, string, *remoteRuntimeLossPV) {
	t.Helper()
	a, b := remoteRuntimeConfigs(t)
	a.Timeout, b.Timeout = 5*time.Second, 5*time.Second
	source, err := NewPQEngineFileSource(q.f.migration, q.path, q.f.bootstrap, q.authorization)
	if err != nil {
		t.Fatal(err)
	}
	pq, err := NewPQPrivValidator(q.signers[owner], source)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	legacyPath := filepath.Join(dir, "original-legacy-hrs.json")
	keyPath := filepath.Join(dir, "original-legacy-key.json")
	legacy := privval.NewFilePV(cmted.PrivKey(bytes.Clone(q.f.legacy[string(q.f.bootstrap.record.Members[owner].Address)])), keyPath, legacyPath)
	legacy.Save() // isolated QA fixture only; production entrypoint never Save/Generate.
	lease, err := AcquireApplicationStateWriterLease(legacyPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = lease.Close() })
	loaded, err := LoadPQOriginalLegacyValidator(keyPath, legacyPath, q.f.doc.ChainID)
	if err != nil {
		t.Fatal(err)
	}
	transition, err := NewPQTransitionPrivValidator(loaded, pq, q.f.bootstrap, q.authorization)
	if err != nil {
		t.Fatal(err)
	}
	left, right := net.Pipe()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	fault := &pqRemoteFailWrite{Conn: right}
	loss := &remoteRuntimeLossPV{PQTransitionPrivValidator: transition, fault: fault}
	var actual cmttypes.PrivValidator = transition
	if dropAfterSign {
		actual = loss
	}
	go func() { done <- ServePQRemoteConnection(ctx, fault, b, q.f.doc.ChainID, source, actual) }()
	conn, pin, err := AuthenticatePQRemoteConnection(ctx, left, a)
	if err != nil {
		cancel()
		_ = left.Close()
		_ = right.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cancel()
		_ = conn.Close()
		_ = right.Close()
		select {
		case <-done:
		case <-time.After(6 * time.Second):
			t.Error("normal remote runtime did not close its original session")
		}
	})
	return conn, pin.(cmted.PubKey), source, legacyPath, loss
}

func remoteRuntimeBind(t *testing.T, q *pqPVFixture, pv *PQRemotePrivValidator, set *cmttypes.ValidatorSet, round int32) {
	t.Helper()
	hash, err := hex.DecodeString(q.app.committed.AppHash)
	if err != nil {
		t.Fatal(err)
	}
	if err = pv.SetConsensusCheckpointSigningContext(q.f.doc.ChainID, q.app.committed.Height, hash, q.app.committed.Height+1, round, set); err != nil {
		t.Fatal(err)
	}
}

func TestPQRemoteRuntimeNormalPublicBindingSignsDualObjectsAndKeepsOriginalHRS(t *testing.T) {
	q := newPQPVFixture(t, true)
	q.advance(t, q.schedule.ActivationHeight-1)
	set, owner := q.context(t, 0)
	conn, pin, _, legacyPath := remoteRuntimeSession(t, q, owner)
	binding := remoteRuntimeBinding(t, q, owner)
	pv, err := NewPQRemotePrivValidator(conn, pin, 5*time.Second, q.f.bootstrap, q.authorization, binding, q.app)
	if err != nil {
		t.Fatal(err)
	}
	startup, err := pv.GetPubKey()
	if err != nil || startup.Type() != cmted.KeyType {
		t.Fatal("startup must retain independent original Ed identity", err)
	}
	legacyBefore, err := os.ReadFile(legacyPath)
	if err != nil {
		t.Fatal(err)
	}
	remoteRuntimeBind(t, q, pv, set, 0)
	vote := pqPVVote(q, set, owner, 0)
	proposal := &cmtproto.Proposal{Type: cmtproto.ProposalType, Height: vote.Height, Round: vote.Round, PolRound: -1, BlockID: copyPQSigningBlock(vote.BlockID), Timestamp: vote.Timestamp}
	if err = pv.SignProposal(q.f.doc.ChainID, proposal); err != nil {
		t.Fatal(err)
	}
	if err = pv.SignVote(q.f.doc.ChainID, vote); err != nil {
		t.Fatal(err)
	}
	key, err := pv.GetPubKeyForHeight(q.f.doc.ChainID, vote.Height)
	if err != nil {
		t.Fatal(err)
	}
	full, ok := key.(ynxpq.PubKey)
	if !ok || !full.VerifyProposal(q.f.doc.ChainID, proposal) || !full.VerifyVote(q.f.doc.ChainID, vote) || !full.VerifyVoteExtension(q.f.doc.ChainID, vote) {
		t.Fatal("normal remote entrypoint did not return all actual dual signatures")
	}
	after, err := os.ReadFile(legacyPath)
	if err != nil || !bytes.Equal(after, legacyBefore) {
		t.Fatal("PQ remote signing changed original legacy history", err)
	}
	persisted, err := os.ReadFile(q.signerPaths[owner])
	if err != nil {
		t.Fatal(err)
	}
	// Same original request is explicit readback; it must return original
	// randomized signatures and cannot consume a second signing reservation.
	retry := clonePQPVVote(vote)
	retry.Signature, retry.ExtensionSignature = nil, nil
	if err = pv.SignVote(q.f.doc.ChainID, retry); err != nil || !bytes.Equal(retry.Signature, vote.Signature) || !bytes.Equal(retry.ExtensionSignature, vote.ExtensionSignature) {
		t.Fatal("exact explicit readback changed original signatures", err)
	}
	after, err = os.ReadFile(q.signerPaths[owner])
	if err != nil || !bytes.Equal(after, persisted) {
		t.Fatal("readback rewrote original durable HRS", err)
	}
	// Independent public-binding mismatch is rejected before remote execution.
	wrong := binding
	wrong.MLDSA87PublicKey = bytes.Clone(binding.MLDSA87PublicKey)
	wrong.MLDSA87PublicKey[0] ^= 1
	wrongPV, err := NewPQRemotePrivValidator(conn, pin, 5*time.Second, q.f.bootstrap, q.authorization, wrong, q.app)
	if err != nil {
		t.Fatal(err)
	}
	hash, _ := hex.DecodeString(q.app.committed.AppHash)
	if err = wrongPV.SetConsensusCheckpointSigningContext(q.f.doc.ChainID, q.app.committed.Height, hash, vote.Height, 0, set); err == nil {
		t.Fatal("registered remote key silently replaced independent operator full binding")
	}
	after, err = os.ReadFile(q.signerPaths[owner])
	if err != nil || !bytes.Equal(after, persisted) {
		t.Fatal("bad public binding reached durable signing", err)
	}
	_ = conn.Close()
	unsigned := clonePQPVVote(vote)
	unsigned.Signature, unsigned.ExtensionSignature = nil, nil
	if err = pv.SignVote(q.f.doc.ChainID, unsigned); err == nil || len(unsigned.Signature) != 0 || len(unsigned.ExtensionSignature) != 0 {
		t.Fatal("closed session retried or published a signature", err)
	}
	after, err = os.ReadFile(q.signerPaths[owner])
	if err != nil || !bytes.Equal(after, persisted) {
		t.Fatal("closed session executed again", err)
	}
}

func TestPQRemoteRuntimeLostResponseKeepsFirstUnknownAndTerminatesWithoutRetry(t *testing.T) {
	q := newPQPVFixture(t, false)
	q.advance(t, q.schedule.ActivationHeight-1)
	set, owner := q.context(t, 0)
	conn, pin, _, _, loss := remoteRuntimeSessionWithLoss(t, q, owner, true)
	pv, err := NewPQRemotePrivValidator(conn, pin, 5*time.Second, q.f.bootstrap, q.authorization, remoteRuntimeBinding(t, q, owner), q.app)
	if err != nil {
		t.Fatal(err)
	}
	remoteRuntimeBind(t, q, pv, set, 0)
	vote := pqPVVote(q, set, owner, 0)
	original, err := vote.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	err = pv.SignVote(q.f.doc.ChainID, vote)
	var unknown *privval.RemoteConsensusUnknown
	if !errors.As(err, &unknown) || len(unknown.Request) == 0 || unknown.RequestHash != sha256.Sum256(unknown.Request) {
		t.Fatal("actual lost response failed to retain original UNKNOWN identity", err)
	}
	select {
	case <-pv.Done():
	default:
		t.Fatal("normal node session did not terminate on original UNKNOWN")
	}
	after, err := vote.Marshal()
	if err != nil || !bytes.Equal(original, after) {
		t.Fatal("lost response published partial signatures", err)
	}
	if loss.votes.Load() != 1 {
		t.Fatal("fault did not follow exactly one actual durable execution")
	}
	hrs, err := os.ReadFile(q.signerPaths[owner])
	if err != nil {
		t.Fatal(err)
	}
	request := bytes.Clone(unknown.Request)
	hash := unknown.RequestHash
	unknown.Request[0] ^= 1
	_, err = pv.GetPubKeyForHeight(q.f.doc.ChainID, vote.Height)
	var retained *privval.RemoteConsensusUnknown
	if !errors.As(err, &retained) || retained.RequestHash != hash || !bytes.Equal(retained.Request, request) {
		t.Fatal("later engine call replaced or aliased the original UNKNOWN", err)
	}
	err = pv.SignVote(q.f.doc.ChainID, vote)
	if !errors.As(err, &retained) || retained.RequestHash != hash || loss.votes.Load() != 1 {
		t.Fatal("terminal session retried original signing", err)
	}
	after, err = os.ReadFile(q.signerPaths[owner])
	if err != nil || !bytes.Equal(after, hrs) {
		t.Fatal("terminal session rewrote durable original HRS", err)
	}
}

// Replays the fixture's real registration wires through BlockExecutor into
// actual engine state/block databases, rather than inventing a store checkpoint
// from a standalone app snapshot. All blocks here are still original Ed era.
func remoteRuntimeNodeHistory(t *testing.T, q *pqPVFixture) (*engineWiringHarness, cfg.DBProvider) {
	t.Helper()
	f := q.f
	path := filepath.Join(t.TempDir(), "committed.json")
	app, err := NewPersistentApplicationWithBootstrap(f.migration, path, f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	dbs := map[string]dbm.DB{"state": dbm.NewMemDB(), "blockstore": dbm.NewMemDB()}
	provider := func(c *cfg.DBContext) (dbm.DB, error) {
		if db, ok := dbs[c.ID]; ok {
			return db, nil
		}
		db := dbm.NewMemDB()
		dbs[c.ID] = db
		return db, nil
	}
	t.Cleanup(func() {
		for _, db := range dbs {
			_ = db.Close()
		}
	})
	h := &engineWiringHarness{f: f, app: app, source: &engineSourceRecorder{app: app}, raw: sm.NewStore(dbs["state"], sm.StoreOptions{}), blocks: blockstore.NewBlockStore(dbs["blockstore"]), path: path}
	h.proxy = startEngineTestProxy(t, app)
	initial, err := sm.MakeGenesisState(f.doc)
	if err != nil {
		t.Fatal(err)
	}
	initial.AppHash = nil
	if err = h.raw.Save(initial); err != nil {
		t.Fatal(err)
	}
	handshake := cmtconsensus.NewHandshaker(h.raw, initial, h.blocks, f.doc)
	handshake.SetConsensusAuthoritySource(h.source)
	if err = handshake.Handshake(h.proxy); err != nil {
		t.Fatal(err)
	}
	var txs cmttypes.Txs
	for _, event := range q.app.committed.ValidatorRegistry.Events {
		tx, e := EncodeValidatorRegistryTransaction(event.Wire)
		if e != nil {
			t.Fatal(e)
		}
		txs = append(txs, tx)
	}
	h.apply(t, txs)
	app, err = NewPersistentApplicationWithEngineAuthorization(f.migration, path, f.bootstrap, q.authorization)
	if err != nil {
		t.Fatal(err)
	}
	h.app, h.source.app = app, app
	h.proxy = startEngineTestProxy(t, app)
	h.apply(t, nil)
	q.app, q.source.app, q.path = app, app, path
	return h, provider
}

func TestPQRemoteNodeFactoryUsesActualStoredHistoryWithoutStarting(t *testing.T) {
	q := newPQPVFixture(t, false)
	h, database := remoteRuntimeNodeHistory(t, q)
	conn, pin, source, _ := remoteRuntimeSession(t, q, 0)
	config := cfg.DefaultConfig().SetRoot(t.TempDir())
	config.TxIndex.Indexer = "null"
	config.P2P.PexReactor = false
	config.RPC.ListenAddress = ""
	config.RPC.PprofListenAddress = ""
	if err := os.MkdirAll(filepath.Dir(config.GenesisFile()), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(config.GenesisFile(), q.f.raw, 0600); err != nil {
		t.Fatal(err)
	}
	n, session, err := newPQRemoteConsensusNode(config, q.app, conn, pin, 5*time.Second, remoteRuntimeBinding(t, q, 0), &p2p.NodeKey{PrivKey: cmted.GenPrivKey()}, log.NewNopLogger(), database)
	if err != nil {
		t.Fatal("normal remote factory actual recovery failed", err)
	}
	t.Cleanup(func() { _ = conn.Close(); n.OnStop(); _ = n.ProxyApp().Stop() })
	if n.IsRunning() || n.BlockStore().Height() != q.app.committed.Height || n.BlockStore().Height() != h.blocks.Height() {
		t.Fatal("constructor started a node or fabricated/lost real block history")
	}
	if session == nil || session.Err() != nil {
		t.Fatal("constructor lost live original remote session")
	}
	source.mu.Lock()
	seen, height := source.signingSeen, source.signingHeight
	source.mu.Unlock()
	if !seen || height != q.app.committed.Height {
		t.Fatal("actual node constructor did not consume fresh remote checkpoint")
	}
	if _, err = n.ConfigureRPC(); err != nil {
		t.Fatal("normal engine did not retain its checkpoint-bound remote public identity", err)
	}
	if _, err = os.Stat(config.PrivValidatorKeyFile()); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("remote factory generated or required local validator private key")
	}
	if _, err = os.Stat(config.PrivValidatorStateFile()); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("remote factory generated local validator HRS")
	}
}
