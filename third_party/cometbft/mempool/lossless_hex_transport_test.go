package mempool

import (
	"bytes"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/cosmos/gogoproto/proto"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	abci "github.com/cometbft/cometbft/abci/types"
	cfg "github.com/cometbft/cometbft/config"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/p2p"
	peerMock "github.com/cometbft/cometbft/p2p/mocks"
	protomem "github.com/cometbft/cometbft/proto/tendermint/mempool"
	"github.com/cometbft/cometbft/proxy"
	"github.com/cometbft/cometbft/types"
)

// The real CListMempool/cache/ABCI callback runs against BaseApplication only
// to isolate carrier behavior. A JSON C is not kvstore's key=value transaction.
// This fixture does NOT assert native signature/AND admission or finality.
func newLosslessTransportReactor(t *testing.T, observer *WireObserver) *Reactor {
	t.Helper()
	config := cfg.TestConfig().SetRoot(t.TempDir())
	client, err := proxy.NewLocalClientCreator(&abci.BaseApplication{}).NewABCIClient()
	require.NoError(t, err)
	require.NoError(t, client.Start())
	mp := NewCListMempool(config.Mempool, client, 0)
	r := NewReactor(config.Mempool, mp)
	r.SetLogger(log.NewNopLogger())
	if observer != nil {
		require.NoError(t, r.SetWireObserver(observer))
	}
	t.Cleanup(func() {
		if r.IsRunning() {
			require.NoError(t, r.Stop())
		}
		require.NoError(t, client.Stop())
	})
	return r
}

func losslessTestC() types.Tx {
	return types.Tx([]byte(`{"version":1,"type":"pq_transfer","wireHex":"0001abcdff00112233445566778899aabbccdd"}`))
}

func losslessTestPeer(r *Reactor, capable bool) *peerMock.Peer {
	p := &peerMock.Peer{}
	p.On("ID").Return(p2p.ID("2222222222222222222222222222222222222222"))
	channels := []byte{MempoolChannel}
	if capable {
		channels = append(channels, LosslessHexV1Channel)
	}
	p.On("NodeInfo").Return(p2p.DefaultNodeInfo{Channels: channels})
	r.InitPeer(p)
	return p
}

func TestLosslessHexTransportDefaultOffAndSingleCarrier(t *testing.T) {
	r := newLosslessTransportReactor(t, nil)
	require.Len(t, r.GetChannels(), 1)
	require.Equal(t, MempoolChannel, r.GetChannels()[0].ID)
	require.False(t, r.ExperimentalLosslessHexSnapshot().Enabled)
	capable := losslessTestPeer(r, true)
	original := losslessTestC()
	msg := &protomem.Txs{Txs: [][]byte{original}}
	// Even a capable peer receives the original wrapper from a default reactor.
	e := r.losslessHexEnvelope(capable, msg)
	require.Equal(t, MempoolChannel, e.ChannelID)
	require.Same(t, msg, e.Message)
	require.NoError(t, r.EnableExperimentalLosslessHex(LosslessHexLimits{}))
	require.Error(t, r.EnableExperimentalLosslessHex(LosslessHexLimits{}))
	ch := r.GetChannels()
	require.Len(t, ch, 2)
	require.Equal(t, LosslessHexV1Channel, ch[1].ID)
	require.IsType(t, &protomem.LosslessHexV1{}, ch[1].MessageType)
	for _, cap := range []bool{false, true} {
		peer := losslessTestPeer(r, cap)
		e = r.losslessHexEnvelope(peer, msg)
		if !cap {
			require.Equal(t, MempoolChannel, e.ChannelID)
			require.Same(t, msg, e.Message)
			continue
		}
		require.Equal(t, LosslessHexV1Channel, e.ChannelID)
		packed := e.Message.(*protomem.LosslessHexV1)
		encoded, err := proto.Marshal(packed)
		require.NoError(t, err)
		require.LessOrEqual(t, len(encoded), ch[1].RecvMessageCapacity)
		decoded := &protomem.LosslessHexV1{}
		require.NoError(t, proto.Unmarshal(encoded, decoded))
		restored, err := r.losslessHex.Load().codec.Restore(decoded.Frame)
		require.NoError(t, err)
		require.Equal(t, []byte(original), restored)
	}
	for _, tx := range [][]byte{[]byte("legacy=original"), []byte(`{"version":2,"type":"pq_transfer","wireHex":"aa"}`), nil} {
		legacy := &protomem.Txs{Txs: [][]byte{tx}}
		e = r.losslessHexEnvelope(capable, legacy)
		require.Equal(t, MempoolChannel, e.ChannelID)
		require.Same(t, legacy, e.Message)
	}
	unknown := &peerMock.Peer{}
	unknown.On("NodeInfo").Return(nil)
	require.Equal(t, MempoolChannel, r.losslessHexEnvelope(unknown, msg).ChannelID)
}

func TestLosslessHexTransportRestoresBeforeOriginalPrecheckCacheAndTxKey(t *testing.T) {
	observer := &WireObserver{}
	r := newLosslessTransportReactor(t, observer)
	require.NoError(t, r.EnableExperimentalLosslessHex(LosslessHexLimits{}))
	peer := losslessTestPeer(r, true)
	original := losslessTestC()
	originalID := bytes.Clone(original.Hash())
	frame, ok, err := r.losslessHex.Load().codec.Pack(original)
	require.NoError(t, err)
	require.True(t, ok)
	frameBefore := bytes.Clone(frame)
	var prechecks atomic.Int32
	r.mempool.preCheck = func(tx types.Tx) error {
		prechecks.Add(1)
		if !bytes.Equal(tx, original) || !bytes.Equal(tx.Hash(), originalID) {
			return fmt.Errorf("packed bytes reached original precheck")
		}
		return nil
	}
	r.Receive(p2p.Envelope{ChannelID: LosslessHexV1Channel, Src: peer, Message: &protomem.LosslessHexV1{Frame: frame}})
	require.Eventually(t, func() bool { return r.mempool.Size() == 1 }, time.Second, time.Millisecond)
	require.Equal(t, int32(1), prechecks.Load())
	require.True(t, r.mempool.cache.Has(original))
	require.False(t, r.mempool.cache.Has(types.Tx(frameBefore)))
	require.NotNil(t, r.mempool.getMemTx(original.Key()))
	require.Nil(t, r.mempool.getMemTx(types.Tx(frameBefore).Key()))
	for i := range frame {
		frame[i] = 0
	}
	stored := r.mempool.ReapMaxTxs(-1)
	require.Equal(t, types.Txs{original}, stored)
	require.Equal(t, originalID, stored[0].Hash())
	// The same original hash hits the same cache through the legacy carrier.
	r.Receive(p2p.Envelope{ChannelID: MempoolChannel, Src: peer, Message: &protomem.Txs{Txs: [][]byte{original}}})
	require.Equal(t, 1, r.mempool.Size())
	baseline := observer.Snapshot()
	require.Equal(t, uint64(2), baseline.Received.Messages)
	require.Equal(t, uint64(2*len(original)), baseline.Received.TransactionBytes)
	originalWrapper := (&protomem.Txs{Txs: [][]byte{original}}).Wrap()
	require.Equal(t, uint64(2*proto.Size(originalWrapper)), baseline.Received.ReencodedProtoBytes)
	require.False(t, baseline.PhysicalBytesMeasured)
	stats := r.ExperimentalLosslessHexSnapshot()
	require.Equal(t, uint64(1), stats.RestoredFrames)
	require.Equal(t, uint64(len(original)), stats.RestoredOriginalBytes)
	require.Equal(t, uint64(len(frameBefore)), stats.ReceivedFrameBytes)
	require.False(t, stats.PhysicalBytesMeasured)
}

func TestLosslessHexTransportRejectsBeforeCheckTxNoRawFallback(t *testing.T) {
	for _, mode := range []string{"disabled", "old-peer", "wrong-channel", "nil-frame", "malformed", "legacy-on-new-channel"} {
		t.Run(mode, func(t *testing.T) {
			r := newLosslessTransportReactor(t, nil)
			if mode != "disabled" {
				require.NoError(t, r.EnableExperimentalLosslessHex(LosslessHexLimits{}))
			}
			codec, err := NewLosslessHexCodec(r.config.MaxTxBytes, LosslessHexLimits{})
			require.NoError(t, err)
			frame, _, err := codec.Pack(losslessTestC())
			require.NoError(t, err)
			peer := losslessTestPeer(r, mode != "old-peer")
			var prechecks atomic.Int32
			r.mempool.preCheck = func(types.Tx) error { prechecks.Add(1); return nil }
			e := p2p.Envelope{ChannelID: LosslessHexV1Channel, Src: peer, Message: &protomem.LosslessHexV1{Frame: frame}}
			switch mode {
			case "wrong-channel":
				e.ChannelID = MempoolChannel
			case "nil-frame":
				e.Message = &protomem.LosslessHexV1{}
			case "malformed":
				frame[0] ^= 0xff
			case "legacy-on-new-channel":
				e.Message = &protomem.Txs{Txs: [][]byte{losslessTestC()}}
			}
			r.Receive(e)
			require.Zero(t, prechecks.Load())
			require.Zero(t, r.mempool.Size())
			require.False(t, r.mempool.cache.Has(losslessTestC()))
		})
	}
}

func TestLosslessHexTransportQueuedRetryKeepsSelectedFormat(t *testing.T) {
	for _, capable := range []bool{false, true} {
		t.Run(fmt.Sprint(capable), func(t *testing.T) {
			observer := &WireObserver{}
			r := newLosslessTransportReactor(t, observer)
			require.NoError(t, r.EnableExperimentalLosslessHex(LosslessHexLimits{}))
			require.NoError(t, r.Start())
			peer := &peerMock.Peer{}
			peer.On("ID").Return(p2p.ID("1111111111111111111111111111111111111111"))
			peer.On("IsRunning").Return(true)
			peer.On("Get", types.PeerStateKey).Return(peerState{height: 1})
			var quit <-chan struct{} = make(chan struct{})
			peer.On("Quit").Return(quit)
			channels := []byte{MempoolChannel}
			if capable {
				channels = append(channels, LosslessHexV1Channel)
			}
			// A capability change in this mock after queue failure must NOT cause a
			// second per-request decision. Real NodeInfo is fixed by its handshake.
			peer.On("NodeInfo").Return(p2p.DefaultNodeInfo{Channels: channels}).Once()
			r.InitPeer(peer)
			var first *p2p.Envelope
			var firstWire []byte
			check := func(args mock.Arguments) {
				e := args.Get(0).(p2p.Envelope)
				var msg proto.Message = e.Message
				if wrapped, ok := msg.(p2p.Wrapper); ok {
					msg = wrapped.Wrap()
				}
				wire, err := proto.Marshal(msg)
				require.NoError(t, err)
				if first == nil {
					copy := e
					first = &copy
					firstWire = bytes.Clone(wire)
				} else {
					require.Equal(t, first.ChannelID, e.ChannelID)
					require.Same(t, first.Message, e.Message)
					require.Equal(t, firstWire, wire)
				}
				if capable {
					require.Equal(t, LosslessHexV1Channel, e.ChannelID)
				} else {
					require.Equal(t, MempoolChannel, e.ChannelID)
				}
			}
			peer.On("Send", mock.Anything).Run(check).Return(false).Once()
			peer.On("Send", mock.Anything).Run(check).Return(true).Once()
			require.NoError(t, r.mempool.CheckTx(losslessTestC(), nil, TxInfo{}))
			done := make(chan struct{})
			go func() { defer close(done); r.broadcastTxRoutine(peer) }()
			require.Eventually(t, func() bool { return observer.Snapshot().SendQueued.Messages == 1 }, 3*time.Second, time.Millisecond)
			require.NoError(t, r.Stop())
			select {
			case <-done:
			case <-time.After(time.Second):
				t.Fatal("broadcast did not stop")
			}
			peer.AssertExpectations(t)
			if capable {
				stats := r.ExperimentalLosslessHexSnapshot()
				require.Equal(t, uint64(1), stats.PackCalls)
				require.Equal(t, uint64(2), stats.SendAttempts)
				require.Equal(t, uint64(1), stats.SendNotQueued)
				require.Equal(t, uint64(1), stats.SendQueued)
			}
		})
	}
}

func TestLosslessHexTransportCannotEnableAfterLifecycleStart(t *testing.T) {
	r := newLosslessTransportReactor(t, nil)
	require.NoError(t, r.Start())
	require.Error(t, r.EnableExperimentalLosslessHex(LosslessHexLimits{}))
	require.NoError(t, r.Stop())
	require.Error(t, r.EnableExperimentalLosslessHex(LosslessHexLimits{}))
	registered := newLosslessTransportReactor(t, nil)
	switcher := p2p.NewSwitch(cfg.TestConfig().P2P, nil)
	switcher.AddReactor("MEMPOOL", registered)
	require.Error(t, registered.EnableExperimentalLosslessHex(LosslessHexLimits{}))
	require.Len(t, registered.GetChannels(), 1)
}

func TestLosslessHexTransportLegacyEmptyUnknownAndMalformedKeepOriginalEntry(t *testing.T) {
	observer := &WireObserver{}
	r := newLosslessTransportReactor(t, observer)
	require.NoError(t, r.EnableExperimentalLosslessHex(LosslessHexLimits{}))
	peer := losslessTestPeer(r, false)
	var seen [][]byte
	r.mempool.preCheck = func(tx types.Tx) error { seen = append(seen, bytes.Clone(tx)); return nil }
	r.Receive(p2p.Envelope{ChannelID: MempoolChannel, Src: peer, Message: &protomem.Txs{}})
	r.Receive(p2p.Envelope{ChannelID: MempoolChannel, Src: peer, Message: (*protomem.Txs)(nil)})
	originals := [][]byte{[]byte("legacy=untouched"), []byte(`{"version":2,"type":"pq_transfer","wireHex":"ab"}`), []byte(`{"version":1,"type":"unknown","wireHex":"ABx"}`)}
	for _, tx := range originals {
		r.Receive(p2p.Envelope{ChannelID: MempoolChannel, Src: peer, Message: &protomem.Txs{Txs: [][]byte{tx}}})
	}
	require.Equal(t, originals, seen)
	require.Equal(t, len(originals), r.mempool.Size())
	require.Equal(t, uint64(2), observer.Snapshot().EmptyReceived)
	require.Zero(t, r.ExperimentalLosslessHexSnapshot().ReceivedFrames)
}
