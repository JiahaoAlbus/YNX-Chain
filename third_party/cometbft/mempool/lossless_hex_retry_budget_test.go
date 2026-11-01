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

// A real broadcast routine with bounded PUBLIC connection-local controls only.
// No socket, handshake, Source, signature admission or running-node claim.
type losslessPreReadyPeer struct {
	*losslessBudgetQueuePeer
	statePresent atomic.Bool
	height       atomic.Int64
	stateRead    chan struct{}
	readOnce     sync.Once
	attempts     chan p2p.Envelope
	queueSecond  bool
}

func (p *losslessPreReadyPeer) Get(key string) interface{} {
	if key != types.PeerStateKey {
		return p.losslessBudgetQueuePeer.Get(key)
	}
	// Capture before notifying so a ready transition cannot erase the first
	// missing/lagging observation that caused the original routine to wait.
	present, height := p.statePresent.Load(), p.height.Load()
	p.readOnce.Do(func() { close(p.stateRead) })
	if !present {
		return nil
	}
	return peerState{height: height}
}

func (p *losslessPreReadyPeer) TrySend(envelope p2p.Envelope) bool {
	n := p.tries.Add(1)
	if p.attempts != nil {
		p.attempts <- envelope
	}
	return p.queueSecond && n == 2
}

func TestLosslessHexBudgetInitialPeerReadinessDeadline(t *testing.T) {
	for _, mode := range []string{"missing-peer-state", "lagging-height"} {
		t.Run(mode, func(t *testing.T) {
			r := newLosslessTransportReactor(t, nil)
			require.NoError(t, r.EnableExperimentalLosslessHex(LosslessHexLimits{MaxSendDuration: 20 * time.Millisecond}))
			require.NoError(t, r.Start())
			p := &losslessPreReadyPeer{losslessBudgetQueuePeer: &losslessBudgetQueuePeer{quit: make(chan struct{})}, stateRead: make(chan struct{})}
			if mode == "lagging-height" {
				p.statePresent.Store(true)
				p.height.Store(-2) // original mempool height is zero: more than one block behind
			}
			r.InitPeer(p)
			original := losslessTestC()
			require.NoError(t, r.mempool.CheckTx(original, nil, TxInfo{}))
			done := make(chan struct{})
			go func() { defer close(done); r.broadcastTxRoutine(p) }()
			var quitOnce sync.Once
			t.Cleanup(func() {
				quitOnce.Do(func() { close(p.quit) })
				select {
				case <-done:
				case <-time.After(time.Second):
					t.Error("original broadcast routine did not join after peer Quit")
				}
			})
			select {
			case <-p.stateRead:
			case <-time.After(time.Second):
				t.Fatal("broadcast routine did not inspect the actual pending peer state")
			}
			stopped := false
			select {
			case <-done:
				stopped = true
			case <-time.After(250 * time.Millisecond):
			}
			require.True(t, stopped, "initial ready/lag wait must share the finite experimental send deadline")
			require.True(t, p.IsRunning(), "local budget stop must not disconnect and reopen a persistent peer")
			require.Zero(t, p.sends.Load())
			require.Zero(t, p.tries.Load(), "a stalled peer must receive neither an experimental attempt nor legacy fallback")
			require.Equal(t, types.Txs{original}, r.mempool.ReapMaxTxs(-1))
			stats := r.ExperimentalLosslessHexSnapshot()
			require.Equal(t, uint64(1), stats.PackCalls)
			require.Equal(t, uint64(1), stats.PackEligible)
			require.Zero(t, stats.SendAttempts)
			transport := r.losslessHex.Load()
			state, err := transport.peerBudget(p)
			require.NoError(t, err)
			r.InitPeer(p)
			again, err := transport.peerBudget(p)
			require.NoError(t, err)
			require.Same(t, state, again)
			require.ErrorIs(t, transport.reservePeer(p, 1), ErrLosslessHexPeerBudget, "repeated InitPeer cannot refresh the spent connection")
		})
	}
}

func TestLosslessHexBudgetReadyTransitionKeepsSelectedCarrier(t *testing.T) {
	r := newLosslessTransportReactor(t, nil)
	require.NoError(t, r.EnableExperimentalLosslessHex(LosslessHexLimits{MaxSendAttempts: 2}))
	require.NoError(t, r.Start())
	p := &losslessPreReadyPeer{losslessBudgetQueuePeer: &losslessBudgetQueuePeer{quit: make(chan struct{})}, stateRead: make(chan struct{}), attempts: make(chan p2p.Envelope, 2), queueSecond: true}
	r.InitPeer(p)
	original := losslessTestC()
	require.NoError(t, r.mempool.CheckTx(original, nil, TxInfo{}))
	done := make(chan struct{})
	go func() { defer close(done); r.broadcastTxRoutine(p) }()
	t.Cleanup(func() {
		close(p.quit)
		select {
		case <-done:
		case <-time.After(time.Second):
			t.Error("original broadcast did not join after peer Quit")
		}
	})
	select {
	case <-p.stateRead:
	case <-time.After(time.Second):
		t.Fatal("original routine did not reach its first not-ready peer state")
	}
	stats := r.ExperimentalLosslessHexSnapshot()
	require.Equal(t, uint64(1), stats.PackCalls, "select and charge once before the initial readiness wait")
	require.Zero(t, stats.SendAttempts)
	state, err := r.losslessHex.Load().peerBudget(p)
	require.NoError(t, err)
	state.mu.Lock()
	firstUse, initialCost := state.firstUse, state.used
	state.mu.Unlock()
	p.height.Store(1)
	p.statePresent.Store(true)
	var attempts [2]p2p.Envelope
	for i := range attempts {
		select {
		case attempts[i] = <-p.attempts:
		case <-done:
			t.Fatal("initial readiness transition abandoned the original selected carrier")
		case <-time.After(time.Second):
			t.Fatal("original selected carrier did not reach the queue")
		}
	}
	require.Equal(t, LosslessHexV1Channel, attempts[0].ChannelID)
	require.Equal(t, attempts[0].ChannelID, attempts[1].ChannelID)
	require.Same(t, attempts[0].Message, attempts[1].Message, "ready transition/queue false must not select or allocate another carrier")
	frame := attempts[0].Message.(*protomem.LosslessHexV1).Frame
	restored, err := r.losslessHex.Load().codec.Restore(frame)
	require.NoError(t, err)
	require.Equal(t, []byte(original), restored)
	require.Equal(t, original.Hash(), types.Tx(restored).Hash())
	require.NoError(t, r.Stop())
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("queued original broadcast did not stop")
	}
	stats = r.ExperimentalLosslessHexSnapshot()
	require.Equal(t, uint64(1), stats.PackCalls)
	require.Equal(t, uint64(2), stats.SendAttempts)
	require.Equal(t, uint64(1), stats.SendNotQueued)
	require.Equal(t, uint64(1), stats.SendQueued)
	require.Equal(t, uint32(2), p.tries.Load())
	require.Zero(t, p.sends.Load())
	state.mu.Lock()
	defer state.mu.Unlock()
	require.Equal(t, firstUse, state.firstUse, "readiness cannot refresh the original connection budget")
	require.Equal(t, uint64(len(original)+len(frame)), initialCost)
	require.Equal(t, initialCost+2*uint64(len(frame)), state.used)
	require.Equal(t, types.Txs{original}, r.mempool.ReapMaxTxs(-1))
}

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
