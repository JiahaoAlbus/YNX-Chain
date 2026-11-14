//go:build unix

package consensus

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"sync"
	"time"
)

const PQLabLiveObservationVersion = "YNX-PQ-LAB-LIVE-REQUEST-OBSERVATION/v1"
const MaxPQLabLiveObservationRecords = 64
const MaxPQLabLiveObservationRecordBytes = 512

type PQLabLiveObservationCancel uint8

const (
	PQLabLiveObservationInterrupt PQLabLiveObservationCancel = iota + 1
	PQLabLiveObservationTerminate
)

// This observer carries no operation inputs, errors or authority. END records
// mean only that an interval returned, including refused/UNKNOWN returns.
// CANCEL means a termination signal was observed, never cleanup or completion.
// Its stderr sink is borrowed, not closed. After an output failure or the fixed
// truncation marker it stops emitting; absence of END is not proof of a hang.
type PQLabLiveRequestObservation struct {
	mu      sync.Mutex
	sink    io.Writer
	started time.Time
	seq     uint16
	span    uint16
	stopped bool
	closed  bool
}

type pqLabLiveObservationRecord struct {
	Version          string `json:"version"`
	Sequence         uint16 `json:"sequence"`
	Event            string `json:"event"`
	Stage            string `json:"stage"`
	Span             uint16 `json:"span"`
	ElapsedNS        int64  `json:"elapsedNs"`
	Reason           string `json:"reason"`
	AuthorityGranted bool   `json:"authorityGranted"`
}

// NewPQLabLiveRequestObservation enables only bounded DATA diagnostics. A
// regular file avoids introducing pipe/terminal backpressure into the observed
// request or signal forwarding. The normal helper already directs stderr to its
// original log file; this API neither opens a path nor changes FD flags.
func NewPQLabLiveRequestObservation(output *os.File) (*PQLabMetrics, *PQLabLiveRequestObservation, error) {
	if output == nil {
		return nil, nil, errors.New("live observation requires the original regular diagnostic file")
	}
	info, err := output.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return nil, nil, errors.New("live observation requires the original regular diagnostic file")
	}
	o := &PQLabLiveRequestObservation{sink: output, started: time.Now(), span: 1}
	if !o.emitLocked("BEGIN", "REQUEST", 1, 0, "") {
		return nil, nil, errors.New("live observation could not write its initial bounded record")
	}
	return &PQLabMetrics{observation: o}, o, nil
}

func (o *PQLabLiveRequestObservation) emitLocked(event, stage string, span uint16, elapsed int64, reason string) bool {
	if o.closed || o.stopped {
		return false
	}
	if o.seq == MaxPQLabLiveObservationRecords-1 {
		event, stage, span, elapsed, reason = "TRUNCATED", "OBSERVATION", 0, time.Since(o.started).Nanoseconds(), "RECORD_BOUND"
		o.stopped = true
	}
	o.seq++
	raw, err := json.Marshal(pqLabLiveObservationRecord{PQLabLiveObservationVersion, o.seq, event, stage, span, elapsed, reason, false})
	if err != nil || len(raw)+1 > MaxPQLabLiveObservationRecordBytes {
		o.stopped = true
		return false
	}
	raw = append(raw, '\n')
	n, err := o.sink.Write(raw)
	if err != nil || n != len(raw) {
		o.stopped = true
		return false
	}
	return true
}

func (o *PQLabLiveRequestObservation) begin(stage string) func() {
	if o == nil {
		return func() {}
	}
	label := pqLabLiveObservationStage(stage)
	if label == "" {
		return func() {}
	}
	started := time.Now()
	o.mu.Lock()
	if o.closed || o.stopped {
		o.mu.Unlock()
		return func() {}
	}
	o.span++
	span := o.span
	o.emitLocked("BEGIN", label, span, 0, "")
	o.mu.Unlock()
	var once sync.Once
	return func() {
		once.Do(func() {
			o.mu.Lock()
			defer o.mu.Unlock()
			o.emitLocked("END", label, span, time.Since(started).Nanoseconds(), "")
		})
	}
}

func (o *PQLabLiveRequestObservation) CancelObserved(reason PQLabLiveObservationCancel) {
	if o == nil {
		return
	}
	label := ""
	switch reason {
	case PQLabLiveObservationInterrupt:
		label = "SIGINT"
	case PQLabLiveObservationTerminate:
		label = "SIGTERM"
	default:
		return
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	o.emitLocked("CANCEL", "REQUEST", 1, time.Since(o.started).Nanoseconds(), label)
}

func (o *PQLabLiveRequestObservation) Finish() {
	if o == nil {
		return
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	o.emitLocked("END", "REQUEST", 1, time.Since(o.started).Nanoseconds(), "")
	o.closed = true
}

func pqLabObserve(m *PQLabMetrics, stage string) func() {
	if m == nil || m.observation == nil {
		return func() {}
	}
	return m.observation.begin(stage)
}

func pqLabLiveObservationStage(stage string) string {
	switch stage {
	case "live.publishTotal":
		return "REQUEST_PUBLISH"
	case "live.policyLoadTotal":
		return "POLICY_LOAD"
	case "live.configLoadTotal":
		return "CONFIG_LOAD"
	case "lab.loadStaticTotal":
		return "STATIC_LOAD"
	case "lab.migrationFullRead":
		return "MIGRATION_READ"
	case "lab.migrationFullDecode":
		return "MIGRATION_DECODE"
	case "lab.bootstrapFullValidation":
		return "BOOTSTRAP_VALIDATE"
	case "lab.staticOwnerHitRevalidateSources":
		return "STATIC_CURRENT"
	case "live.heldStaticWitnessCurrent":
		return "HELD_STATIC_CURRENT"
	case "live.anchorFullValidation":
		return "ANCHOR_VALIDATE"
	case "live.anchorStateFullValidation":
		return "ANCHOR_STATE_VALIDATE"
	case "live.anchorRegistryFullReplay":
		return "ANCHOR_REGISTRY_REPLAY"
	case "live.anchorCommitFullVerification":
		return "ANCHOR_COMMIT_VERIFY"
	case "live.controlDurablePublish":
		return "DURABLE_PUBLISH"
	case "live.observe.transaction":
		return "TRANSACTION_READ"
	case "live.observe.previousResult":
		return "PREVIOUS_RESULT"
	case "live.observe.currentBefore":
		return "INPUTS_CURRENT_BEFORE"
	case "live.observe.currentAfter":
		return "INPUTS_CURRENT_AFTER"
	case "live.observe.cleanup":
		return "INPUTS_CLOSE"
	case "live.observe.transactionCleanup":
		return "TRANSACTION_CLOSE"
	default:
		return ""
	}
}
