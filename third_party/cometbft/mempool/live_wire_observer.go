package mempool

import (
	"encoding/json"
	"math"
	"os"
	"sync"
	"sync/atomic"
)

const LiveWireObservationSchema = "YNX-MEMPOOL-LIVE-WIRE-OBSERVATION/v1"

var liveWireIDs atomic.Uint64

// IDs never wrap or reset. The real PID and host CLOCK_MONOTONIC bounds remain
// separate required identity coordinates; an ID is not global authority or a
// replacement for the operator's actual process-start/source pin.
func nextLiveWireID() uint64 {
	for {
		old := liveWireIDs.Load()
		if old == math.MaxUint64 {
			return 0
		}
		if liveWireIDs.CompareAndSwap(old, old+1) {
			return old + 1
		}
	}
}

type liveWireLifetime struct {
	once            sync.Once
	id, producerPID uint64
	generation      atomic.Uint64
	active          atomic.Bool
}

func (l *liveWireLifetime) initialize() {
	l.once.Do(func() { l.id = nextLiveWireID(); l.producerPID = uint64(os.Getpid()) })
}

// LiveCounterStatus qualifies the corresponding detached original raw snapshot.
// UNKNOWN/raw-nonnull preserves incomplete evidence; it is never a usable
// checkpoint. A null snapshot is never interpreted as measured zero counters.
type LiveCounterStatus struct {
	Status   string `json:"status"`
	Reason   string `json:"reason"`
	Attached bool   `json:"attached"`
	Overflow bool   `json:"overflow"`
	Complete bool   `json:"complete"`
}

// LiveWireObservation is bounded endpoint DATA, not a measurement window,
// collector, physical-byte observation, throughput or business/AND result.
// Wire and Lossless retain their ORIGINAL schemas and numeric JSON formats.
// Only new metadata uint64s use decimal JSON strings. Every snapshot consists
// of separate completed-call counter reads; cross-layer values are non-atomic.
// No in-flight Send/CheckTx call is completed, joined or included by this getter.
//
// Core must expose this callee only through its existing private, authorized
// operator producer for the ACTUAL node's *Reactor. There is no public route,
// observer attachment, codec enable, reset, caller ID or external clock input.
type LiveWireObservation struct {
	Schema                string               `json:"schema"`
	ProducerPID           uint64               `json:"producerPID,string"`
	ReactorLifetimeID     uint64               `json:"reactorLifetimeID,string"`
	ObserverLifetimeID    *uint64              `json:"observerLifetimeID,string"`
	LifecycleGeneration   uint64               `json:"lifecycleGeneration,string"`
	Clock                 string               `json:"clock"`
	ClockStatus           string               `json:"clockStatus"`
	ClockError            string               `json:"clockError"`
	StartMonotonicNs      *uint64              `json:"startMonotonicNs,string"`
	EndMonotonicNs        *uint64              `json:"endMonotonicNs,string"`
	Status                string               `json:"status"`
	Reason                string               `json:"reason"`
	Complete              bool                 `json:"complete"`
	ReactorRunningAtStart bool                 `json:"reactorRunningAtStart"`
	ReactorRunningAtEnd   bool                 `json:"reactorRunningAtEnd"`
	NonAtomic             bool                 `json:"nonAtomic"`
	CompletedCallsOnly    bool                 `json:"completedCallsOnly"`
	InFlightExcluded      bool                 `json:"inFlightExcluded"`
	EndpointOnly          bool                 `json:"endpointOnly"`
	PhysicalBytesMeasured bool                 `json:"physicalBytesMeasured"`
	Wire                  *WireSnapshot        `json:"wire"`
	WireStatus            LiveCounterStatus    `json:"wireStatus"`
	Lossless              *LosslessHexSnapshot `json:"lossless"`
	LosslessStatus        LiveCounterStatus    `json:"losslessStatus"`
	// No normal owned proto endpoint has been supplied to this callee. Keep
	// this field NULL; logical re-encoding or proto.Size is not a substitute.
	Proto       *json.RawMessage  `json:"proto"`
	ProtoStatus LiveCounterStatus `json:"protoStatus"`
}

func (o *LiveWireObservation) incomplete(reason string) {
	o.Status, o.Reason, o.Complete = "UNKNOWN", reason, false
	if o.WireStatus.Attached {
		o.WireStatus.Status, o.WireStatus.Reason, o.WireStatus.Complete = "UNKNOWN", reason, false
	}
	if o.LosslessStatus.Attached {
		o.LosslessStatus.Status, o.LosslessStatus.Reason, o.LosslessStatus.Complete = "UNKNOWN", reason, false
	}
}

// LiveWireObservation synchronously reads fixed-size copies, using TryLock so
// an active writer cannot make the producer wait. BUSY means UNKNOWN, not zero
// or a cached earlier snapshot. Actual CLOCK_MONOTONIC calls bracket capture;
// neither wall time nor process-relative time.Since is a clock fallback.
func (memR *Reactor) LiveWireObservation() LiveWireObservation {
	out := LiveWireObservation{
		Schema: LiveWireObservationSchema, Clock: "CLOCK_MONOTONIC", ClockStatus: "UNKNOWN",
		Status: "UNKNOWN", Reason: "reactor_unavailable", NonAtomic: true, CompletedCallsOnly: true, InFlightExcluded: true, EndpointOnly: true,
		WireStatus:     LiveCounterStatus{Status: "UNKNOWN", Reason: "not_supplied"},
		LosslessStatus: LiveCounterStatus{Status: "DISABLED", Reason: "not_enabled"},
		ProtoStatus:    LiveCounterStatus{Status: "UNKNOWN", Reason: "not_supplied"},
	}
	if memR == nil {
		return out
	}
	out.ProducerPID = memR.liveWire.producerPID
	out.ReactorLifetimeID = memR.liveWire.id
	out.LifecycleGeneration = memR.liveWire.generation.Load()
	out.ReactorRunningAtStart = memR.IsRunning() && memR.liveWire.active.Load()
	start, startErr := liveWireMonotonicNS()
	if startErr == nil {
		out.StartMonotonicNs = &start
	}
	observer := memR.wireObserver.Load()
	if observer != nil {
		out.WireStatus = LiveCounterStatus{Status: "UNKNOWN", Reason: "capture_busy", Attached: true}
		id := observer.liveID.Load()
		if id != 0 {
			out.ObserverLifetimeID = &id
		}
		if observer.mu.TryLock() {
			raw := observer.snapshot
			raw.Schema, raw.Attached = "YNX-MEMPOOL-WIRE-OBSERVATION/v1", observer.claimed.Load()
			observer.mu.Unlock()
			out.Wire = &raw
			out.WireStatus = LiveCounterStatus{Status: "OBSERVED", Attached: raw.Attached, Overflow: raw.Overflow, Complete: true}
			if !raw.Attached || id == 0 {
				out.WireStatus.Status, out.WireStatus.Reason, out.WireStatus.Complete = "UNKNOWN", "observer_not_attached", false
			} else if raw.Overflow {
				out.WireStatus.Status, out.WireStatus.Reason, out.WireStatus.Complete = "UNKNOWN", "overflow", false
			}
		}
	}
	lossless := memR.losslessHex.Load()
	if lossless != nil {
		out.LosslessStatus = LiveCounterStatus{Status: "UNKNOWN", Reason: "capture_busy", Attached: true}
		if lossless.mu.TryLock() {
			raw := lossless.totals
			raw.Schema, raw.Enabled = "YNX-MEMPOOL-LOSSLESS-HEX/v1", true
			lossless.mu.Unlock()
			out.Lossless = &raw
			out.LosslessStatus = LiveCounterStatus{Status: "OBSERVED", Attached: true, Overflow: raw.Overflow, Complete: true}
			if raw.Overflow {
				out.LosslessStatus.Status, out.LosslessStatus.Reason, out.LosslessStatus.Complete = "UNKNOWN", "overflow", false
			}
		}
	}
	end, endErr := liveWireMonotonicNS()
	if endErr == nil {
		out.EndMonotonicNs = &end
	}
	out.ReactorRunningAtEnd = memR.IsRunning() && memR.liveWire.active.Load()
	if startErr != nil || endErr != nil {
		out.ClockError = "clock_unavailable"
		out.incomplete("clock_unavailable")
		return out
	}
	if end < start {
		out.ClockError = "clock_regressed"
		out.incomplete("clock_regressed")
		return out
	}
	out.ClockStatus = "OBSERVED"
	memR.finishLiveWireObservation(&out, observer, lossless)
	return out
}

// The final lifecycle read is shared by normal capture and deterministic
// stop-between-checkpoints tests. It never changes an observer or its counters.
func (memR *Reactor) finishLiveWireObservation(out *LiveWireObservation, observer *WireObserver, lossless *losslessHexTransport) {
	out.ReactorRunningAtEnd = memR.IsRunning() && memR.liveWire.active.Load()
	if out.ProducerPID == 0 || out.ProducerPID != uint64(os.Getpid()) || out.ReactorLifetimeID == 0 {
		out.incomplete("reactor_identity_unavailable")
		return
	}
	if !out.ReactorRunningAtStart {
		out.incomplete("reactor_not_running")
		return
	}
	if !out.ReactorRunningAtEnd || memR.liveWire.generation.Load() != out.LifecycleGeneration {
		out.incomplete("reactor_stopped_during_capture")
		return
	}
	if observer != memR.wireObserver.Load() || lossless != memR.losslessHex.Load() {
		out.incomplete("observation_source_changed")
		return
	}
	if !out.WireStatus.Complete {
		out.Status, out.Reason = "UNKNOWN", "wire_"+out.WireStatus.Reason
		return
	}
	if lossless != nil && !out.LosslessStatus.Complete {
		out.Status, out.Reason = "UNKNOWN", "lossless_"+out.LosslessStatus.Reason
		return
	}
	// A stop may begin while the above fixed-size status checks run. Re-read
	// the actual phase immediately before publishing a complete checkpoint.
	// This remains endpoint/non-atomic evidence, never an active-lifetime lock.
	if !memR.IsRunning() || !memR.liveWire.active.Load() || memR.liveWire.generation.Load() != out.LifecycleGeneration {
		out.ReactorRunningAtEnd = false
		out.incomplete("reactor_stopped_during_capture")
		return
	}
	out.Status, out.Reason, out.Complete = "OBSERVED", "", true
}
