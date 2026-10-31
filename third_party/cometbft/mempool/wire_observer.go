package mempool

import (
	"errors"
	"math"
	"sync"
	"sync/atomic"
	"time"

	protomem "github.com/cometbft/cometbft/proto/tendermint/mempool"
)

// WireObserver observes the existing reactor path without retaining transaction
// bytes, peer identities, or messages. It has fixed-size cumulative counters,
// no reset, no callback, and no effect on admission or transmission. The default
// reactor has no observer. Use a separate zero-value observer for each reactor.
//
// The normal node caller may type-assert Node.MempoolReactor() to *Reactor and
// call SetWireObserver before starting the node. Snapshot is safe while running.
// This does not register a channel, packing capability, or alternative encoding.
type WireObserver struct {
	claimed  atomic.Bool
	mu       sync.Mutex
	snapshot WireSnapshot
}

// WireMessageTotals counts original transaction bytes and the size of their
// canonical protobuf wrapper. ReencodedProtoBytes is calculated with the
// existing generated Message.Size, without marshaling or copying the payload.
// Inbound values reconstruct the known fields after Unwrap: they do not measure
// the original received protobuf, unknown fields, or alternate encodings.
type WireMessageTotals struct {
	Messages            uint64 `json:"messages"`
	Transactions        uint64 `json:"transactions"`
	TransactionBytes    uint64 `json:"transactionBytes"`
	ReencodedProtoBytes uint64 `json:"reencodedProtoBytes"`
}

// WireSnapshot is a detached cumulative observation, not a performance result.
// SendAttempts counts completed Peer.Send calls, including unchanged retries.
// Queued means Peer.Send returned true, not that the peer received or admitted
// the transaction. In-flight Send/CheckTx calls are absent until they return.
// CheckTxReturnNil means only the synchronous CheckTx returned nil; asynchronous
// ABCI response, insertion, execution, and finality are not measured here.
//
// No field measures SecretConnection, handshake, TCP, packet fragmentation, or
// full physical bytes. Preserve original p2p metrics and external physical-byte
// measurements separately. Timings include only the named original calls and
// exclude observer bookkeeping. A saturated counter sets Overflow permanently;
// such a snapshot must not be used as a complete baseline.
type WireSnapshot struct {
	Schema                string            `json:"schema"`
	Attached              bool              `json:"attached"`
	PhysicalBytesMeasured bool              `json:"physicalBytesMeasured"`
	SendAttempts          WireMessageTotals `json:"sendAttempts"`
	SendQueued            WireMessageTotals `json:"sendQueued"`
	SendNotQueued         WireMessageTotals `json:"sendNotQueued"`
	Received              WireMessageTotals `json:"received"`
	EmptyReceived         uint64            `json:"emptyReceived"`
	SendCallNs            uint64            `json:"sendCallNs"`
	SendCallMaxNs         uint64            `json:"sendCallMaxNs"`
	CheckTxCalls          uint64            `json:"checkTxCalls"`
	CheckTxReturnNil      uint64            `json:"checkTxReturnNil"`
	CheckTxReturnError    uint64            `json:"checkTxReturnError"`
	CheckTxCallNs         uint64            `json:"checkTxCallNs"`
	CheckTxCallMaxNs      uint64            `json:"checkTxCallMaxNs"`
	Overflow              bool              `json:"overflow"`
}

// SetWireObserver attaches one lifetime observer before the reactor starts.
// Neither a running reactor, an already observed reactor, nor an observer
// previously attached elsewhere can be rebound. There is deliberately no detach
// or reset that could erase the original before window.
func (memR *Reactor) SetWireObserver(observer *WireObserver) error {
	if observer == nil {
		return errors.New("mempool: wire observer is nil")
	}
	memR.wireObserverMu.Lock()
	defer memR.wireObserverMu.Unlock()
	if memR.wireObserverStarted || memR.IsRunning() || memR.wireObserver.Load() != nil {
		return errors.New("mempool: wire observer must be attached once before start")
	}
	if !observer.claimed.CompareAndSwap(false, true) {
		return errors.New("mempool: wire observer already belongs to a reactor")
	}
	memR.wireObserver.Store(observer)
	return nil
}

func (observer *WireObserver) Snapshot() WireSnapshot {
	if observer == nil {
		return WireSnapshot{Schema: "YNX-MEMPOOL-WIRE-OBSERVATION/v1"}
	}
	observer.mu.Lock()
	defer observer.mu.Unlock()
	result := observer.snapshot
	result.Schema = "YNX-MEMPOOL-WIRE-OBSERVATION/v1"
	result.Attached = observer.claimed.Load()
	return result
}

func wireMessageTotals(msg *protomem.Txs) WireMessageTotals {
	wrapper := protomem.Message{Sum: &protomem.Message_Txs{Txs: msg}}
	txs := msg.GetTxs()
	totals := WireMessageTotals{Messages: 1, Transactions: uint64(len(txs)), ReencodedProtoBytes: uint64(wrapper.Size())}
	for _, tx := range txs {
		totals.TransactionBytes += uint64(len(tx))
	}
	return totals
}

func (observer *WireObserver) add(target *uint64, value uint64) {
	if math.MaxUint64-*target < value {
		*target = math.MaxUint64
		observer.snapshot.Overflow = true
		return
	}
	*target += value
}

func (observer *WireObserver) addMessage(target *WireMessageTotals, value WireMessageTotals) {
	observer.add(&target.Messages, value.Messages)
	observer.add(&target.Transactions, value.Transactions)
	observer.add(&target.TransactionBytes, value.TransactionBytes)
	observer.add(&target.ReencodedProtoBytes, value.ReencodedProtoBytes)
}

func (observer *WireObserver) received(msg *protomem.Txs) {
	totals := wireMessageTotals(msg)
	observer.mu.Lock()
	defer observer.mu.Unlock()
	observer.addMessage(&observer.snapshot.Received, totals)
	if len(msg.GetTxs()) == 0 {
		observer.add(&observer.snapshot.EmptyReceived, 1)
	}
}

func (observer *WireObserver) sent(msg *protomem.Txs, elapsed time.Duration, queued bool) {
	totals := wireMessageTotals(msg)
	observer.mu.Lock()
	defer observer.mu.Unlock()
	observer.addMessage(&observer.snapshot.SendAttempts, totals)
	if queued {
		observer.addMessage(&observer.snapshot.SendQueued, totals)
	} else {
		observer.addMessage(&observer.snapshot.SendNotQueued, totals)
	}
	observer.add(&observer.snapshot.SendCallNs, uint64(elapsed))
	if uint64(elapsed) > observer.snapshot.SendCallMaxNs {
		observer.snapshot.SendCallMaxNs = uint64(elapsed)
	}
}

func (observer *WireObserver) checked(elapsed time.Duration, err error) {
	observer.mu.Lock()
	defer observer.mu.Unlock()
	observer.add(&observer.snapshot.CheckTxCalls, 1)
	if err == nil {
		observer.add(&observer.snapshot.CheckTxReturnNil, 1)
	} else {
		observer.add(&observer.snapshot.CheckTxReturnError, 1)
	}
	observer.add(&observer.snapshot.CheckTxCallNs, uint64(elapsed))
	if uint64(elapsed) > observer.snapshot.CheckTxCallMaxNs {
		observer.snapshot.CheckTxCallMaxNs = uint64(elapsed)
	}
}
