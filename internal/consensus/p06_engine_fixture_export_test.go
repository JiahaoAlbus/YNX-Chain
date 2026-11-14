//go:build pay_engine_host_fixture

package consensus

import (
	"bytes"
	"crypto/ed25519"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/mempool"
	"github.com/cometbft/cometbft/node"
	"github.com/cometbft/cometbft/p2p"
	"github.com/cometbft/cometbft/privval"
	proto "github.com/cometbft/cometbft/proto/tendermint/types"
	sm "github.com/cometbft/cometbft/state"
	types "github.com/cometbft/cometbft/types"
	"path/filepath"
	"testing"
	"time"
)

func OpenP06OriginalBootstrapNodeFixture(t *testing.T) (*Application, *node.Node) {
	t.Helper()
	f := newValidatorRegistryFixture(t)
	c := bootstrapNodeConfig(t, f.raw)
	c.P2P.ListenAddress = "tcp://127.0.0.1:0"
	statePath := filepath.Join(c.RootDir, "application.state")
	lease, e := AcquireApplicationStateWriterLease(statePath)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _ = lease.Close() })
	pvLease, e := AcquireApplicationStateWriterLease(c.PrivValidatorStateFile())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _ = pvLease.Close() })
	key := cmted.PrivKey(bytes.Clone(f.legacy[string(f.bootstrap.record.Members[0].Address)]))
	pv := privval.NewFilePV(key, c.PrivValidatorKeyFile(), c.PrivValidatorStateFile())
	pv.Save()
	app, e := NewPersistentApplicationWithBootstrap(f.migration, statePath, f.bootstrap)
	if e != nil {
		t.Fatal(e)
	}
	nodeKey := &p2p.NodeKey{PrivKey: cmted.GenPrivKey()}
	n, e := NewBootstrapConsensusNode(c, app, pv, nodeKey, log.NewNopLogger())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() {
		if n != nil {
			select {
			case <-n.Quit():
			default:
				if n.IsRunning() {
					_ = n.Stop()
				} else {
					n.OnStop()
					_ = n.ProxyApp().Stop()
				}
			}
		}
	})
	env, err := n.ConfigureRPC()
	if err != nil {
		t.Fatal(err)
	}
	state, err := env.StateStore.Load()
	if err != nil {
		t.Fatal(err)
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
	n.OnStop()
	_ = n.ProxyApp().Stop()
	cold, err := NewPersistentApplicationWithBootstrap(f.migration, statePath, f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	original, err := LoadPQOriginalLegacyValidator(c.PrivValidatorKeyFile(), c.PrivValidatorStateFile(), f.doc.ChainID)
	if err != nil {
		t.Fatal(err)
	}
	n, err = NewBootstrapConsensusNode(c, cold, original, nodeKey, log.NewNopLogger())
	if err != nil {
		t.Fatal(err)
	}
	return cold, n
}
