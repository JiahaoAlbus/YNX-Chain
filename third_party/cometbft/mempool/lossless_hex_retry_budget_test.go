package mempool

import (
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/cometbft/cometbft/p2p"
	protomem "github.com/cometbft/cometbft/proto/tendermint/mempool"
	"github.com/cometbft/cometbft/types"
	"github.com/stretchr/testify/require"
)

// A full local queue, not a socket, peer handshake or physical-byte fixture.
type losslessBudgetQueuePeer struct {
	p2p.Peer
	data  sync.Map
	quit  chan struct{}
	sends atomic.Uint32
	tries atomic.Uint32
}

func (*losslessBudgetQueuePeer) ID() p2p.ID { return "3333333333333333333333333333333333333333" }
func (*losslessBudgetQueuePeer) NodeInfo() p2p.NodeInfo {
	return p2p.DefaultNodeInfo{Channels: []byte{MempoolChannel, LosslessHexV1Channel}}
}
func (p *losslessBudgetQueuePeer) Get(key string) interface{} {
	if key == types.PeerStateKey {
		return peerState{height: 1}
	}
	v, _ := p.data.Load(key)
	return v
}
func (p *losslessBudgetQueuePeer) Set(key string, v interface{}) { p.data.Store(key, v) }
func (p *losslessBudgetQueuePeer) Quit() <-chan struct{}         { return p.quit }
func (p *losslessBudgetQueuePeer) IsRunning() bool {
	select {
	case <-p.quit:
		return false
	default:
		return true
	}
}
func (p *losslessBudgetQueuePeer) Send(p2p.Envelope) bool    { p.sends.Add(1); return false }
func (p *losslessBudgetQueuePeer) TrySend(p2p.Envelope) bool { p.tries.Add(1); return false }

func TestLosslessHexBudgetFullQueueStopsWithoutRawReplay(t *testing.T) {
	r := newLosslessTransportReactor(t, nil)
	require.NoError(t, r.EnableExperimentalLosslessHex(LosslessHexLimits{}))
	require.NoError(t, r.Start())
	p := &losslessBudgetQueuePeer{quit: make(chan struct{})}
	r.InitPeer(p)
	require.NoError(t, r.mempool.CheckTx(losslessTestC(), nil, TxInfo{}))
	done := make(chan struct{})
	go func() { defer close(done); r.broadcastTxRoutine(p) }()
	stopped := false
	select {
	case <-done:
		stopped = true
	case <-time.After(600 * time.Millisecond):
	}
	close(p.quit)
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("queue fixture did not quit")
	}
	require.True(t, stopped, "experimental full queue must exhaust a finite attempt budget")
	require.Zero(t, p.sends.Load(), "experimental attempts must not enter blocking legacy Send")
	require.Equal(t, uint32(3), p.tries.Load())
	require.Equal(t, 1, r.mempool.Size(), "budget exhaustion must retain the original transaction")
	stats := r.ExperimentalLosslessHexSnapshot()
	require.Equal(t, uint64(3), stats.SendNotQueued)
	require.Zero(t, stats.SendQueued)
}

func TestLosslessHexBudgetReceiveBeforeOriginalCheckTx(t *testing.T) {
	original := losslessTestC()
	codec, err := NewLosslessHexCodec(1<<20, LosslessHexLimits{})
	require.NoError(t, err)
	frame, eligible, err := codec.Pack(original)
	require.NoError(t, err)
	require.True(t, eligible)
	cost := uint64(len(frame) + len(original))
	for _, exact := range []bool{false, true} {
		t.Run(map[bool]string{false: "one-byte-short", true: "exact-then-exhausted"}[exact], func(t *testing.T) {
			o := &WireObserver{}
			r := newLosslessTransportReactor(t, o)
			limit := cost - 1
			if exact {
				limit = cost
			}
			require.NoError(t, r.EnableExperimentalLosslessHex(LosslessHexLimits{MaxPeerBytes: limit}))
			p := &losslessBudgetQueuePeer{quit: make(chan struct{})}
			r.InitPeer(p)
			e := p2p.Envelope{ChannelID: LosslessHexV1Channel, Src: p, Message: &protomem.LosslessHexV1{Frame: frame}}
			r.Receive(e)
			if exact {
				require.Eventually(t, func() bool { return r.mempool.Size() == 1 }, time.Second, time.Millisecond)
				require.Equal(t, uint64(1), o.Snapshot().CheckTxCalls)
				r.Receive(e)
				require.Equal(t, uint64(1), o.Snapshot().CheckTxCalls, "exhausted peer never re-enters original CheckTx")
				require.Equal(t, types.Txs{original}, r.mempool.ReapMaxTxs(-1))
			} else {
				require.Zero(t, o.Snapshot().CheckTxCalls)
				require.Zero(t, r.mempool.Size())
				require.False(t, r.mempool.cache.Has(original))
			}
			require.Equal(t, uint64(1), r.ExperimentalLosslessHexSnapshot().RestoreRejected)
		})
	}
}

func TestLosslessHexBudgetFullQueueElapsedDeadline(t *testing.T) {
	r := newLosslessTransportReactor(t, nil)
	require.NoError(t, r.EnableExperimentalLosslessHex(LosslessHexLimits{
		MaxSendAttempts: 16, MaxSendDuration: 5 * time.Millisecond,
	}))
	require.NoError(t, r.Start())
	p := &losslessBudgetQueuePeer{quit: make(chan struct{})}
	r.InitPeer(p)
	require.NoError(t, r.mempool.CheckTx(losslessTestC(), nil, TxInfo{}))
	done := make(chan struct{})
	go func() { defer close(done); r.broadcastTxRoutine(p) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		close(p.quit)
		t.Fatal("elapsed send budget failed to interrupt the queue backoff")
	}
	require.LessOrEqual(t, p.tries.Load(), uint32(1))
	require.Zero(t, p.sends.Load())
	require.Zero(t, r.ExperimentalLosslessHexSnapshot().SendQueued)
	require.Equal(t, 1, r.mempool.Size())
}

func TestLosslessHexBudgetInvalidEnableStaysDefaultOff(t *testing.T) {
	r := newLosslessTransportReactor(t, nil)
	require.Error(t, r.EnableExperimentalLosslessHex(LosslessHexLimits{MaxSendAttempts: -1}))
	require.Nil(t, r.losslessHex.Load())
	require.Len(t, r.GetChannels(), 1)
}

func TestLosslessHexBudgetPackReservesBeforeFrameAllocation(t *testing.T) {
	codec, err := NewLosslessHexCodec(1<<20, LosslessHexLimits{})
	require.NoError(t, err)
	want, eligible, err := codec.Pack(losslessTestC())
	require.NoError(t, err)
	require.True(t, eligible)
	denied := errors.New("local reservation refused")
	calls := 0
	frame, eligible, err := codec.pack(losslessTestC(), func(cost uint64) error {
		calls++
		require.Equal(t, uint64(len(losslessTestC())+len(want)), cost)
		return denied
	})
	require.ErrorIs(t, err, denied)
	require.Nil(t, frame)
	require.False(t, eligible)
	require.Equal(t, 1, calls)
	for _, legacy := range [][]byte{[]byte("legacy=original"), []byte(`{"version":2,"wireHex":"aa"}`)} {
		frame, eligible, err = codec.pack(legacy, func(uint64) error { t.Fatal("legacy must bypass experimental reservation"); return denied })
		require.NoError(t, err)
		require.False(t, eligible)
		require.Nil(t, frame)
	}
}

func TestLosslessHexBudgetPackFailureNeverFallsBack(t *testing.T) {
	for _, mode := range []string{"work", "length", "format"} {
		t.Run(mode, func(t *testing.T) {
			r := newLosslessTransportReactor(t, nil)
			require.NoError(t, r.EnableExperimentalLosslessHex(LosslessHexLimits{}))
			p := &losslessBudgetQueuePeer{quit: make(chan struct{})}
			r.InitPeer(p)
			codec := r.losslessHex.Load().codec
			original := losslessTestC()
			want := ErrLosslessHexWork
			switch mode {
			case "work":
				clock := time.Unix(100, 0)
				codec.now = func() time.Time { clock = clock.Add(time.Second); return clock }
			case "length":
				codec.maxOriginal = len(original) - 1
				want = ErrLosslessHexLimit
			case "format":
				original = types.Tx(`{"version":1,"type":"pq_transfer","wireHex":"GG"}`)
				want = ErrLosslessHexFormat
			}
			e, err := r.losslessHexEnvelope(p, &protomem.Txs{Txs: [][]byte{original}})
			require.ErrorIs(t, err, want)
			require.Nil(t, e.Message, "a Pack failure must not select raw legacy Send")
			require.Zero(t, p.sends.Load())
			require.Zero(t, p.tries.Load())
		})
	}
}

func TestLosslessHexBudgetTypedNilPeerCannotClaimCapability(t *testing.T) {
	r := newLosslessTransportReactor(t, nil)
	require.NoError(t, r.EnableExperimentalLosslessHex(LosslessHexLimits{}))
	var typedNil *losslessBudgetQueuePeer
	for _, peer := range []p2p.Peer{nil, typedNil} {
		require.False(t, losslessHexPeerV1(peer))
		e, err := r.losslessHexEnvelope(peer, &protomem.Txs{Txs: [][]byte{losslessTestC()}})
		require.NoError(t, err)
		require.Equal(t, MempoolChannel, e.ChannelID, "unconfirmed capability selects original before any send")
		r.receiveLosslessHex(p2p.Envelope{ChannelID: LosslessHexV1Channel, Src: peer}, &protomem.LosslessHexV1{})
	}
	require.Zero(t, r.mempool.Size())
	require.Zero(t, r.ExperimentalLosslessHexSnapshot().RestoredFrames)
	require.Equal(t, uint64(2), r.ExperimentalLosslessHexSnapshot().RestoreRejected)
}

func TestLosslessHexBudgetLocalExhaustionDoesNotDisconnectAndRedial(t *testing.T) {
	r := newLosslessTransportReactor(t, nil)
	require.NoError(t, r.EnableExperimentalLosslessHex(LosslessHexLimits{}))
	p := &losslessBudgetQueuePeer{quit: make(chan struct{})}
	r.InitPeer(p)
	// A zero, unstarted Switch deliberately has no disconnect machinery.
	// Any attempt to delegate local exhaustion to it is an invalid side effect.
	r.Switch = &p2p.Switch{}
	r.stopLosslessHexSend(p, ErrLosslessHexPeerBudget)
	require.True(t, p.IsRunning())
	require.ErrorIs(t, r.losslessHex.Load().reservePeer(p, 1), ErrLosslessHexPeerBudget)
	frame, eligible, err := r.losslessHex.Load().codec.Pack(losslessTestC())
	require.NoError(t, err)
	require.True(t, eligible)
	r.Receive(p2p.Envelope{ChannelID: LosslessHexV1Channel, Src: p, Message: &protomem.LosslessHexV1{Frame: frame}})
	require.True(t, p.IsRunning(), "legal inbound after local exhaustion must not cause redial")
	require.Zero(t, r.mempool.Size())
	require.Equal(t, uint64(1), r.ExperimentalLosslessHexSnapshot().RestoreRejected)
	require.Zero(t, p.sends.Load())
	require.Zero(t, p.tries.Load())
}
