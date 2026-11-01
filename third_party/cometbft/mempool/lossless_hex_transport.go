package mempool

import (
	"errors"
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/cometbft/cometbft/p2p"
	protomem "github.com/cometbft/cometbft/proto/tendermint/mempool"
)

// LosslessHexV1Channel is a dedicated VERSIONED experimental capability. It is
// never advertised by NewReactor without explicit opt-in. Merely sharing the
// legacy channel, a peer software version, or CanSend is not this capability.
const LosslessHexV1Channel = byte(0x31)

type losslessHexTransport struct {
	codec  *LosslessHexCodec
	mu     sync.Mutex
	totals LosslessHexSnapshot
	budget losslessHexBudgetLimits
	now    func() time.Time
}

// LosslessHexSnapshot counts this codec's bounded frames and restored original
// bytes. These are not physical socket/SecretConnection/MConnection bytes, an
// original before baseline, throughput, admission, AND verification or finality.
// The original WireObserver retains its logical/reencodedOriginalC definition.
type LosslessHexSnapshot struct {
	Schema                string `json:"schema"`
	Enabled               bool   `json:"enabled"`
	PhysicalBytesMeasured bool   `json:"physicalBytesMeasured"`
	PackCalls             uint64 `json:"packCalls"`
	PackEligible          uint64 `json:"packEligible"`
	PackRejected          uint64 `json:"packRejected"`
	SendAttempts          uint64 `json:"sendAttempts"`
	SendQueued            uint64 `json:"sendQueued"`
	SendNotQueued         uint64 `json:"sendNotQueued"`
	// AttemptedFrameBytes includes queue-false attempts. It is neither queued
	// protobuf bytes nor delivered/physical bytes.
	AttemptedFrameBytes   uint64 `json:"attemptedFrameBytes"`
	ReceivedFrames        uint64 `json:"receivedFrames"`
	ReceivedFrameBytes    uint64 `json:"receivedFrameBytes"`
	RestoredFrames        uint64 `json:"restoredFrames"`
	RestoredOriginalBytes uint64 `json:"restoredOriginalBytes"`
	RestoreRejected       uint64 `json:"restoreRejected"`
	Overflow              bool   `json:"overflow"`
}

func (t *losslessHexTransport) add(p *uint64, n uint64) {
	if math.MaxUint64-*p < n {
		*p = math.MaxUint64
		t.totals.Overflow = true
		return
	}
	*p += n
}

// EnableExperimentalLosslessHex is a source-lab opt-in, not deployment or
// production activation. It must run once before start AND before Switch channel
// registration; normal node callers use node.ExperimentalMempoolLosslessHex.
// Default NewReactor and all original mempool/consensus validation stay intact.
func (memR *Reactor) EnableExperimentalLosslessHex(limits LosslessHexLimits) error {
	memR.wireObserverMu.Lock()
	defer memR.wireObserverMu.Unlock()
	if memR.wireObserverStarted || memR.IsRunning() || memR.Switch != nil || memR.losslessHex.Load() != nil {
		return errors.New("mempool: lossless hex experiment must be enabled once before start")
	}
	codec, err := NewLosslessHexCodec(memR.config.MaxTxBytes, limits)
	if err != nil {
		return err
	}
	budget, err := normalizeLosslessHexBudget(limits)
	if err != nil {
		return err
	}
	memR.losslessHex.Store(&losslessHexTransport{codec: codec, budget: budget, now: time.Now})
	return nil
}

func (memR *Reactor) ExperimentalLosslessHexSnapshot() LosslessHexSnapshot {
	result := LosslessHexSnapshot{Schema: "YNX-MEMPOOL-LOSSLESS-HEX/v1"}
	t := memR.losslessHex.Load()
	if t == nil {
		return result
	}
	t.mu.Lock()
	result = t.totals
	t.mu.Unlock()
	result.Schema = "YNX-MEMPOOL-LOSSLESS-HEX/v1"
	result.Enabled = true
	return result
}

func (t *losslessHexTransport) channel() *p2p.ChannelDescriptor {
	maximum := &protomem.LosslessHexV1{Frame: make([]byte, t.codec.MaxFrameBytes())}
	return &p2p.ChannelDescriptor{ID: LosslessHexV1Channel, Priority: 5, RecvMessageCapacity: maximum.Size(), MessageType: &protomem.LosslessHexV1{}}
}

func losslessHexPeerV1(peer p2p.Peer) bool {
	if !losslessHexBudgetPeerPointer(peer) {
		return false
	}
	info, ok := peer.NodeInfo().(p2p.DefaultNodeInfo)
	return ok && info.HasChannel(LosslessHexV1Channel)
}

func (memR *Reactor) losslessHexEnvelope(peer p2p.Peer, msg *protomem.Txs) (p2p.Envelope, error) {
	legacy := p2p.Envelope{ChannelID: MempoolChannel, Message: msg}
	t := memR.losslessHex.Load()
	if t == nil || !losslessHexPeerV1(peer) || len(msg.GetTxs()) != 1 {
		return legacy, nil
	}
	frame, eligible, err := t.codec.pack(msg.Txs[0], func(cost uint64) error {
		return t.reservePeer(peer, cost)
	})
	t.mu.Lock()
	t.add(&t.totals.PackCalls, 1)
	if err != nil {
		t.add(&t.totals.PackRejected, 1)
	} else if eligible {
		t.add(&t.totals.PackEligible, 1)
	}
	t.mu.Unlock()
	// Resource/work/format failures on a recognized experimental candidate
	// terminate locally. Downgrading an error to raw would bypass the finite
	// attempt/time budget through the blocking legacy send loop.
	if err != nil {
		return p2p.Envelope{}, err
	}
	// Ineligible legacy/unknown shapes select their original carrier before
	// any send. No failed packed attempt is replayed in another representation.
	if !eligible {
		return legacy, nil
	}
	return p2p.Envelope{ChannelID: LosslessHexV1Channel, Message: &protomem.LosslessHexV1{Frame: frame}}, nil
}

func (memR *Reactor) stopLosslessHexSend(peer p2p.Peer, err error) {
	if t := memR.losslessHex.Load(); t != nil {
		t.closePeer(peer)
	}
	memR.Logger.Error("experimental mempool send stopped without replay", "err", err)
	// End only this connection's experimental sender. Disconnecting here
	// would make Switch automatically redial persistent peers and reopen a
	// fresh budget for the same pending transaction. Other channels stay live.
}

func (memR *Reactor) recordLosslessHexSend(e p2p.Envelope, queued bool) {
	msg, ok := e.Message.(*protomem.LosslessHexV1)
	if !ok || msg == nil {
		return
	}
	t := memR.losslessHex.Load()
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.add(&t.totals.SendAttempts, 1)
	t.add(&t.totals.AttemptedFrameBytes, uint64(len(msg.Frame)))
	if queued {
		t.add(&t.totals.SendQueued, 1)
	} else {
		t.add(&t.totals.SendNotQueued, 1)
	}
}

func (memR *Reactor) rejectLosslessHex(e p2p.Envelope, err error) {
	if t := memR.losslessHex.Load(); t != nil {
		t.mu.Lock()
		t.add(&t.totals.RestoreRejected, 1)
		t.mu.Unlock()
	}
	if errors.Is(err, ErrLosslessHexPeerBudget) {
		if t := memR.losslessHex.Load(); t != nil {
			t.closePeer(e.Src)
		}
		// Local connection resource limits must not disconnect a persistent
		// peer and thereby reopen its budget via automatic redial. Keep the
		// fixed-size rejection counter; avoid per-frame error-log flooding.
		memR.Logger.Debug("experimental mempool frame dropped at local peer budget", "err", err)
		return
	}
	memR.Logger.Error("experimental mempool frame rejected", "err", err)
	if memR.Switch != nil && losslessHexBudgetPeerPointer(e.Src) {
		memR.Switch.StopPeerForError(e.Src, err)
	}
}

func (memR *Reactor) receiveLosslessHex(e p2p.Envelope, msg *protomem.LosslessHexV1) {
	t := memR.losslessHex.Load()
	if t == nil || e.ChannelID != LosslessHexV1Channel || !losslessHexPeerV1(e.Src) || msg == nil {
		memR.rejectLosslessHex(e, errors.New("mempool: unnegotiated experimental carrier"))
		return
	}
	t.mu.Lock()
	t.add(&t.totals.ReceivedFrames, 1)
	t.add(&t.totals.ReceivedFrameBytes, uint64(len(msg.Frame)))
	t.mu.Unlock()
	originalLen, _, err := t.codec.inspectFrame(msg.Frame)
	if err == nil {
		err = t.reservePeer(e.Src, uint64(len(msg.Frame))+originalLen)
	}
	if err != nil {
		memR.rejectLosslessHex(e, err)
		return
	}
	original, err := t.codec.Restore(msg.Frame)
	if err != nil {
		memR.rejectLosslessHex(e, fmt.Errorf("mempool: restore before CheckTx: %w", err))
		return
	}
	t.mu.Lock()
	t.add(&t.totals.RestoredFrames, 1)
	t.add(&t.totals.RestoredOriginalBytes, uint64(len(original)))
	t.mu.Unlock()
	// Exactly one restored, independent owned original C enters the unchanged
	// CheckTx/cache/TxKey/ABCI/AND path. Packed failure never falls back to raw.
	memR.receiveOriginalTxs(e, &protomem.Txs{Txs: [][]byte{original}})
}
