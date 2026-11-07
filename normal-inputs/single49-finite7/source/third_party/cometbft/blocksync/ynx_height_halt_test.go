package blocksync

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	dbm "github.com/cometbft/cometbft-db"
	"github.com/cometbft/cometbft/abci/example/kvstore"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/mempool"
	"github.com/cometbft/cometbft/privval"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	"github.com/cometbft/cometbft/proxy"
	sm "github.com/cometbft/cometbft/state"
	"github.com/cometbft/cometbft/store"
	"github.com/cometbft/cometbft/types"
	"github.com/stretchr/testify/require"
)

func TestYNXHeightHaltActualBlockSyncSaveApplyBoundary(t *testing.T) {
	// Exercise the exact poolRoutine save/apply callee, without peers, sockets
	// or Node.Start. The block, commit, application and database are real.
	dir := t.TempDir()
	pv := privval.GenFilePV(filepath.Join(dir, "key.json"), filepath.Join(dir, "hrs.json"))
	pv.Save()
	pub, err := pv.GetPubKey()
	require.NoError(t, err)
	genesis := &types.GenesisDoc{ChainID: "ynx-halt-blocksync", InitialHeight: 1,
		GenesisTime: time.Now().UTC().Add(-time.Minute), ConsensusParams: types.DefaultConsensusParams(),
		Validators: []types.GenesisValidator{{PubKey: pub, Power: 10}}}
	initial, err := sm.MakeGenesisState(genesis)
	require.NoError(t, err)
	db, err := dbm.NewGoLevelDB("engine", dir)
	require.NoError(t, err)
	defer db.Close()
	stateStore := sm.NewStore(db, sm.StoreOptions{DiscardABCIResponses: false})
	require.NoError(t, stateStore.Save(initial))
	blocks := store.NewBlockStore(db)
	app := kvstore.NewPersistentApplication(filepath.Join(dir, "app"))
	defer app.Close()
	connections := proxy.NewAppConns(proxy.NewLocalClientCreator(app), proxy.NopMetrics())
	require.NoError(t, connections.Start())
	defer connections.Stop()
	executor := sm.NewBlockExecutor(stateStore, log.NewNopLogger(), connections.Consensus(), &mempool.NopMempool{}, sm.EmptyEvidencePool{}, blocks)
	r := NewReactor(initial, executor, blocks, true, NopMetrics(), 0)
	halt, err := sm.NewHeightHalt(initial)
	require.NoError(t, err)
	require.NoError(t, r.SetHeightHalt(halt))
	require.NoError(t, halt.Arm(1))
	block, err := initial.MakeBlock(1, []types.Tx{types.Tx("retained=block-sync")}, &types.Commit{}, nil, pub.Address())
	require.NoError(t, err)
	parts, err := block.MakePartSet(types.BlockPartSizeBytes)
	require.NoError(t, err)
	id := types.BlockID{Hash: block.Hash(), PartSetHeader: parts.Header()}
	vote := &types.Vote{Type: cmtproto.PrecommitType, Height: 1, Round: 0, BlockID: id,
		Timestamp: block.Time, ValidatorAddress: pub.Address(), ValidatorIndex: 0}
	pb := vote.ToProto()
	require.NoError(t, pv.SignVote(initial.ChainID, pb))
	vote.Signature = pb.Signature
	commit := &types.Commit{Height: 1, Round: 0, BlockID: id, Signatures: []types.CommitSig{vote.CommitSig()}}
	require.NoError(t, initial.Validators.VerifyCommit(initial.ChainID, id, 1, commit))
	require.NoError(t, executor.ValidateBlock(initial, block))
	committed, stopped, err := r.applySyncedBlock(initial, block, parts, commit, nil, false)
	require.NoError(t, err)
	require.True(t, stopped)
	require.EqualValues(t, 1, committed.LastBlockHeight)
	actual, _, err := halt.Result()
	require.NoError(t, err)
	require.Equal(t, committed.Bytes(), actual.Bytes())
	second, err := committed.MakeBlock(2, nil, commit, nil, pub.Address())
	require.NoError(t, err)
	secondParts, err := second.MakePartSet(types.BlockPartSizeBytes)
	require.NoError(t, err)
	unchanged, stopped, err := r.applySyncedBlock(committed, second, secondParts, nil, nil, false)
	require.NoError(t, err)
	require.True(t, stopped)
	require.Equal(t, committed.Bytes(), unchanged.Bytes())
	require.EqualValues(t, 1, blocks.Height())
	require.Nil(t, blocks.LoadBlock(2))
	stored, err := stateStore.Load()
	require.NoError(t, err)
	require.Equal(t, committed.Bytes(), stored.Bytes())
	info, err := app.Info(context.Background(), &abci.RequestInfo{})
	require.NoError(t, err)
	require.EqualValues(t, 1, info.LastBlockHeight)
	value, err := app.Query(context.Background(), &abci.RequestQuery{Data: []byte("retained")})
	require.NoError(t, err)
	require.Equal(t, []byte("block-sync"), value.Value)
}
