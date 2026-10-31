package mempool

import (
	"bytes"
	"math"
	"sync"
	"testing"
	"time"

	"github.com/cosmos/gogoproto/proto"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/cometbft/cometbft/abci/example/kvstore"
	cfg "github.com/cometbft/cometbft/config"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/p2p"
	peerMock "github.com/cometbft/cometbft/p2p/mocks"
	protomem "github.com/cometbft/cometbft/proto/tendermint/mempool"
	"github.com/cometbft/cometbft/proxy"
	"github.com/cometbft/cometbft/types"
)

// This original in-memory ABCI fixture tests observer transparency, not PQ
// signatures, production admission, actual network bytes, or a load baseline.
// Its entire filesystem is private to t.TempDir; no shared test root is reset.
func newWireTestReactor(t *testing.T, observer *WireObserver) *Reactor {
	t.Helper()
	config := cfg.TestConfig().SetRoot(t.TempDir())
	app := kvstore.NewInMemoryApplication()
	client, err := proxy.NewLocalClientCreator(app).NewABCIClient()
	require.NoError(t, err)
	require.NoError(t, client.Start())
	mp := NewCListMempool(config.Mempool, client, 0)
	mp.SetLogger(log.NewNopLogger())
	reactor := NewReactor(config.Mempool, mp)
	reactor.SetLogger(log.NewNopLogger())
	if observer != nil {
		require.NoError(t, reactor.SetWireObserver(observer))
	}
	t.Cleanup(func() {
		if reactor.IsRunning() {
			require.NoError(t, reactor.Stop())
		}
		require.NoError(t, client.Stop())
	})
	return reactor
}

func wireTestSourcePeer(reactors ...*Reactor) p2p.Peer {
	peer := &peerMock.Peer{}
	peer.On("ID").Return(p2p.ID("2222222222222222222222222222222222222222"))
	for _, reactor := range reactors {
		reactor.InitPeer(peer)
	}
	return peer
}

func TestMempoolWireObserverOriginalReceiveAndCheckTx(t *testing.T) {
	observer := &WireObserver{}
	observed := newWireTestReactor(t, observer)
	unchanged := newWireTestReactor(t, nil)
	peer := wireTestSourcePeer(observed, unchanged)
	// Opaque transaction bytes remain owned by the original protobuf/mempool
	// flow. The observer cannot decode, replace, or authorize this fixture.
	tx := types.Tx([]byte("wire-observer=original\x00\xff"))
	original := bytes.Clone(tx)
	originalID := tx.Hash()
	msg := &protomem.Txs{Txs: [][]byte{tx}}
	encoded, err := proto.Marshal(msg.Wrap())
	require.NoError(t, err)
	for _, reactor := range []*Reactor{observed, unchanged} {
		reactor.Receive(p2p.Envelope{ChannelID: MempoolChannel, Src: peer, Message: msg})
		require.Eventually(t, func() bool { return reactor.mempool.Size() == 1 }, time.Second, time.Millisecond)
		// The second original CheckTx returns ErrTxInCache synchronously.
		reactor.Receive(p2p.Envelope{ChannelID: MempoolChannel, Src: peer, Message: msg})
		require.Equal(t, types.Txs{tx}, reactor.mempool.ReapMaxTxs(-1))
	}
	observed.Receive(p2p.Envelope{ChannelID: MempoolChannel, Message: &protomem.Txs{}})
	// A typed nil Txs had the original empty-message behavior, too.
	observed.Receive(p2p.Envelope{ChannelID: MempoolChannel, Message: (*protomem.Txs)(nil)})
	snapshot := observer.Snapshot()
	require.True(t, snapshot.Attached)
	require.False(t, snapshot.PhysicalBytesMeasured)
	require.False(t, snapshot.Overflow)
	require.Equal(t, uint64(4), snapshot.Received.Messages)
	require.Equal(t, uint64(2), snapshot.Received.Transactions)
	require.Equal(t, uint64(2*len(tx)), snapshot.Received.TransactionBytes)
	// The non-nil empty Txs has a two-byte wrapper; the typed nil oneof
	// payload is omitted by the original generated encoder.
	require.Equal(t, uint64(2*len(encoded)+2), snapshot.Received.ReencodedProtoBytes)
	require.Equal(t, uint64(2), snapshot.EmptyReceived)
	require.Equal(t, uint64(2), snapshot.CheckTxCalls)
	require.Equal(t, uint64(1), snapshot.CheckTxReturnNil)
	require.Equal(t, uint64(1), snapshot.CheckTxReturnError)
	require.Equal(t, original, []byte(tx))
	require.Equal(t, originalID, tx.Hash())
	require.Nil(t, unchanged.wireObserver.Load())
	// Returned snapshots are values; changing one cannot reset the before.
	snapshot.CheckTxCalls = 0
	require.Equal(t, uint64(2), observer.Snapshot().CheckTxCalls)
}

func TestMempoolWireObserverOriginalSendRetryAndBytes(t *testing.T) {
	observer := &WireObserver{}
	reactor := newWireTestReactor(t, observer)
	require.NoError(t, reactor.Start())
	peer := &peerMock.Peer{}
	peer.On("ID").Return(p2p.ID("1111111111111111111111111111111111111111"))
	peer.On("IsRunning").Return(true)
	peer.On("Get", types.PeerStateKey).Return(peerState{height: 1})
	var peerQuit <-chan struct{} = make(chan struct{})
	peer.On("Quit").Return(peerQuit)
	reactor.InitPeer(peer)
	tx := types.Tx([]byte("wire-observer=retry-original\x00\xff"))
	original := bytes.Clone(tx)
	originalID := tx.Hash()
	msg := &protomem.Txs{Txs: [][]byte{tx}}
	encoded, err := proto.Marshal(msg.Wrap())
	require.NoError(t, err)
	checkSend := func(args mock.Arguments) {
		e := args.Get(0).(p2p.Envelope)
		require.Equal(t, MempoolChannel, e.ChannelID)
		wire, eErr := proto.Marshal(e.Message.(p2p.Wrapper).Wrap())
		require.NoError(t, eErr)
		require.Equal(t, encoded, wire)
	}
	peer.On("Send", mock.Anything).Run(checkSend).Return(false).Once()
	peer.On("Send", mock.Anything).Run(checkSend).Return(true).Once()
	require.NoError(t, reactor.mempool.CheckTx(tx, nil, TxInfo{SenderID: UnknownPeerID}))
	done := make(chan struct{})
	go func() { defer close(done); reactor.broadcastTxRoutine(peer) }()
	require.Eventually(t, func() bool { return observer.Snapshot().SendQueued.Messages == 1 }, 3*time.Second, time.Millisecond)
	require.NoError(t, reactor.Stop())
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("original broadcaster did not stop")
	}
	snapshot := observer.Snapshot()
	require.Equal(t, uint64(2), snapshot.SendAttempts.Messages)
	require.Equal(t, uint64(2*len(tx)), snapshot.SendAttempts.TransactionBytes)
	require.Equal(t, uint64(2*len(encoded)), snapshot.SendAttempts.ReencodedProtoBytes)
	require.Equal(t, uint64(1), snapshot.SendQueued.Messages)
	require.Equal(t, uint64(1), snapshot.SendNotQueued.Messages)
	require.Equal(t, uint64(len(encoded)), snapshot.SendQueued.ReencodedProtoBytes)
	require.Zero(t, snapshot.CheckTxCalls) // local RPC insertion is outside Receive
	require.Equal(t, original, []byte(tx))
	require.Equal(t, originalID, tx.Hash())
	peer.AssertExpectations(t)
}

func TestMempoolWireObserverLifecycleAndConcurrentSnapshot(t *testing.T) {
	observer := &WireObserver{}
	reactor := newWireTestReactor(t, observer)
	peer := wireTestSourcePeer(reactor)
	require.Error(t, reactor.SetWireObserver(observer))
	require.Error(t, reactor.SetWireObserver(nil))
	other := newWireTestReactor(t, nil)
	require.Error(t, other.SetWireObserver(observer))
	require.NoError(t, other.Start())
	require.Error(t, other.SetWireObserver(&WireObserver{}))
	require.NoError(t, other.Stop())
	require.Error(t, other.SetWireObserver(&WireObserver{}))
	tx := []byte("wire-observer=concurrent-original")
	msg := &protomem.Txs{Txs: [][]byte{tx}}
	const workers, calls = 4, 32
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < calls; j++ {
				reactor.Receive(p2p.Envelope{ChannelID: MempoolChannel, Src: peer, Message: msg})
				_ = observer.Snapshot()
			}
		}()
	}
	wg.Wait()
	snapshot := observer.Snapshot()
	require.Equal(t, uint64(workers*calls), snapshot.CheckTxCalls)
	require.Equal(t, snapshot.CheckTxCalls, snapshot.CheckTxReturnNil+snapshot.CheckTxReturnError)
	require.Equal(t, uint64(workers*calls*len(tx)), snapshot.Received.TransactionBytes)
	var missing *WireObserver
	require.False(t, missing.Snapshot().Attached)
}

func TestMempoolWireObserverOverflowIsExplicit(t *testing.T) {
	observer := &WireObserver{}
	observer.snapshot.Received.TransactionBytes = math.MaxUint64
	reactor := newWireTestReactor(t, observer)
	peer := wireTestSourcePeer(reactor)
	reactor.Receive(p2p.Envelope{ChannelID: MempoolChannel, Src: peer, Message: &protomem.Txs{Txs: [][]byte{[]byte("x=y")}}})
	snapshot := observer.Snapshot()
	require.True(t, snapshot.Overflow)
	require.Equal(t, uint64(math.MaxUint64), snapshot.Received.TransactionBytes)
	require.Equal(t, uint64(1), snapshot.Received.Messages)
}
