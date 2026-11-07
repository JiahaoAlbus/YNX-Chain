package consensus

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	dbm "github.com/cometbft/cometbft-db"
	"github.com/cometbft/cometbft/abci/example/kvstore"
	abci "github.com/cometbft/cometbft/abci/types"
	cfg "github.com/cometbft/cometbft/config"
	"github.com/cometbft/cometbft/mempool"
	"github.com/cometbft/cometbft/privval"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	sm "github.com/cometbft/cometbft/state"
	"github.com/cometbft/cometbft/store"
	"github.com/cometbft/cometbft/types"
	"github.com/stretchr/testify/require"
)

// This intercepts only the timing of the actual persistent KV application
// Commit. It neither supplies fake results nor bypasses a signature/authority.
type heightHaltCommitBoundary struct {
	*kvstore.Application
	entered chan struct{}
	release chan struct{}
}

func (a *heightHaltCommitBoundary) Commit(ctx context.Context, request *abci.RequestCommit) (*abci.ResponseCommit, error) {
	close(a.entered)
	<-a.release
	return a.Application.Commit(ctx, request)
}

func TestYNXHeightHaltActualConsensusCommitAndColdStores(t *testing.T) {
	// Consensus State runs locally; no Node.Start, P2P or RPC listener exists.
	dir := t.TempDir()
	keyPath, hrsPath := filepath.Join(dir, "key.json"), filepath.Join(dir, "hrs.json")
	pv := privval.GenFilePV(keyPath, hrsPath)
	pv.Save()
	pub, err := pv.GetPubKey()
	require.NoError(t, err)
	keyBefore, err := os.ReadFile(keyPath)
	require.NoError(t, err)
	genesis := &types.GenesisDoc{ChainID: "ynx-real-height-halt", InitialHeight: 1,
		GenesisTime: time.Now().UTC().Add(-time.Minute), ConsensusParams: types.DefaultConsensusParams(),
		Validators: []types.GenesisValidator{{PubKey: pub, Power: 10}}}
	initial, err := sm.MakeGenesisState(genesis)
	require.NoError(t, err)
	db, err := dbm.NewGoLevelDB("engine", dir)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	app := &heightHaltCommitBoundary{Application: kvstore.NewPersistentApplication(filepath.Join(dir, "app")),
		entered: make(chan struct{}), release: make(chan struct{})}
	t.Cleanup(func() { _ = app.Close() })
	config := cfg.DefaultConfig().SetRoot(dir)
	config.Consensus.SkipTimeoutCommit = true
	config.Consensus.TimeoutPropose = 20 * time.Millisecond
	cs := newStateWithConfigAndBlockStore(config, initial, pv, app, db)
	barrier, err := sm.NewHeightHalt(initial)
	require.NoError(t, err)
	require.NoError(t, cs.SetHeightHalt(barrier))
	require.NoError(t, barrier.Arm(1))
	check := make(chan *abci.ResponseCheckTx, 1)
	require.NoError(t, cs.txNotifier.(*mempool.CListMempool).CheckTx(types.Tx("preserved=value"), func(r *abci.ResponseCheckTx) { check <- r }, mempool.TxInfo{}))
	require.Zero(t, (<-check).Code)
	require.NoError(t, cs.Start())
	t.Cleanup(func() {
		select {
		case <-app.release:
		default:
			close(app.release)
		}
		if cs.IsRunning() {
			_ = cs.Stop()
			cs.Wait()
		}
		_ = cs.eventBus.Stop()
	})
	select {
	case <-app.entered:
	case <-time.After(10 * time.Second):
		t.Fatal("actual consensus did not reach application Commit")
	}
	select {
	case <-barrier.Done():
		t.Fatal("HEIGHT_HALT_BEFORE_DURABLE_COMMIT: halt fired inside App.Commit")
	default:
	}
	beforeCommit, err := cs.blockExec.Store().Load()
	require.NoError(t, err)
	require.Zero(t, beforeCommit.LastBlockHeight)
	require.EqualValues(t, 1, cs.blockStore.Height(), "normal block-store save precedes application Commit")
	close(app.release)
	select {
	case <-barrier.Done():
	case <-time.After(10 * time.Second):
		t.Fatal("actual complete commit did not trigger halt")
	}
	require.NoError(t, cs.Stop())
	cs.Wait()
	committed, target, err := barrier.Result()
	require.NoError(t, err)
	require.EqualValues(t, 1, target)
	require.EqualValues(t, 1, committed.LastBlockHeight)
	require.EqualValues(t, 1, cs.Height, "must not even enter the next height state")
	require.EqualValues(t, 1, cs.GetLastHeight(), "halted status must expose the actual durable height")
	require.EqualValues(t, 1, pv.LastSignState.Height)
	commit := cs.blockStore.LoadSeenCommit(1)
	require.NoError(t, initial.Validators.VerifyCommit(initial.ChainID, committed.LastBlockID, 1, commit))
	hrsBefore, err := os.ReadFile(hrsPath)
	require.NoError(t, err)
	cs.enterNewRound(2, 0)
	cs.defaultDecideProposal(2, 0)
	_, err = cs.signVote(cmtproto.PrecommitType, nil, types.PartSetHeader{}, nil)
	require.ErrorIs(t, err, sm.ErrHeightHalt)
	hrsAfter, err := os.ReadFile(hrsPath)
	require.NoError(t, err)
	require.Equal(t, hrsBefore, hrsAfter, "late messages/proposals/votes must not change HRS")
	keyAfter, err := os.ReadFile(keyPath)
	require.NoError(t, err)
	require.Equal(t, keyBefore, keyAfter)
	require.NoError(t, app.Close())
	require.NoError(t, db.Close())
	coldDB, err := dbm.NewGoLevelDB("engine", dir)
	require.NoError(t, err)
	defer coldDB.Close()
	coldState, err := sm.NewStore(coldDB, sm.StoreOptions{DiscardABCIResponses: false}).Load()
	require.NoError(t, err)
	require.True(t, bytes.Equal(committed.Bytes(), coldState.Bytes()))
	coldBlocks := store.NewBlockStore(coldDB)
	require.EqualValues(t, 1, coldBlocks.Height())
	require.Nil(t, coldBlocks.LoadBlock(2))
	require.Equal(t, committed.LastBlockID.Hash, coldBlocks.LoadBlock(1).Hash())
	coldApp := kvstore.NewPersistentApplication(filepath.Join(dir, "app"))
	defer coldApp.Close()
	info, err := coldApp.Info(context.Background(), &abci.RequestInfo{})
	require.NoError(t, err)
	require.EqualValues(t, 1, info.LastBlockHeight)
	require.Equal(t, []byte(committed.AppHash), info.LastBlockAppHash)
	value, err := coldApp.Query(context.Background(), &abci.RequestQuery{Data: []byte("preserved")})
	require.NoError(t, err)
	require.Equal(t, []byte("value"), value.Value)
	coldPV := privval.LoadFilePV(keyPath, hrsPath)
	require.Equal(t, pv.LastSignState.Height, coldPV.LastSignState.Height)
	require.Equal(t, pv.LastSignState.Round, coldPV.LastSignState.Round)
	require.Equal(t, pv.LastSignState.Step, coldPV.LastSignState.Step)
}
