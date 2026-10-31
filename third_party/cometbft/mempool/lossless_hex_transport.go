package mempool

import (
	"errors"
	"fmt"
	"math"
	"sync"

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
	memR.losslessHex.Store(&losslessHexTransport{codec: codec})
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
	if peer == nil {
		return false
	}
	info, ok := peer.NodeInfo().(p2p.DefaultNodeInfo)
	return ok && info.HasChannel(LosslessHexV1Channel)
}

func (memR *Reactor) losslessHexEnvelope(peer p2p.Peer, msg *protomem.Txs) p2p.Envelope {
	legacy := p2p.Envelope{ChannelID: MempoolChannel, Message: msg}
	t := memR.losslessHex.Load()
	if t == nil || !losslessHexPeerV1(peer) || len(msg.GetTxs()) != 1 {
		return legacy
	}
	frame, eligible, err := t.codec.Pack(msg.Txs[0])
	t.mu.Lock()
	t.add(&t.totals.PackCalls, 1)
	if err != nil {
		t.add(&t.totals.PackRejected, 1)
	} else if eligible {
		t.add(&t.totals.PackEligible, 1)
	}
	t.mu.Unlock()
	// No frame has been sent at this point. Non-canonical/legacy/unknown forms
	// retain the original carrier and original validator, exactly one attempt.
	if err != nil || !eligible {
		return legacy
	}
	return p2p.Envelope{ChannelID: LosslessHexV1Channel, Message: &protomem.LosslessHexV1{Frame: frame}}
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
	memR.Logger.Error("experimental mempool frame rejected", "err", err)
	if memR.Switch != nil && e.Src != nil {
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
