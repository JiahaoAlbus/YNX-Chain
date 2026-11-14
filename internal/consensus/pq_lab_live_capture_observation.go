//go:build unix

package consensus

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"time"
)

// The original lab worker is serial. These bounded stages stay on that worker
// and publish only in a supplemental, immutable failure record.
type pqLabProofCaptureObservation struct {
	nodeIndex        int
	sequence         uint32
	policySHA256     string
	requestSHA256    string
	metrics          PQLabMetrics
	phase            string
	finishPhase      func()
	deadlineStarted  time.Time
	deadlineDuration time.Duration
	crossings        uint32
}

func newPQLabProofCaptureObservation(nodeIndex int, sequence uint32, policy, request string) *pqLabProofCaptureObservation {
	t := &pqLabProofCaptureObservation{nodeIndex: nodeIndex, sequence: sequence, policySHA256: policy, requestSHA256: request}
	t.begin("proof.intentWrite")
	return t
}

func (t *pqLabProofCaptureObservation) collector() *PQLabMetrics {
	if t == nil {
		return nil
	}
	return &t.metrics
}

func (t *pqLabProofCaptureObservation) measure(stage string) func() {
	return pqLabMeasure(t.collector(), stage)
}

func (t *pqLabProofCaptureObservation) begin(stage string) {
	if t == nil {
		return
	}
	if t.finishPhase != nil {
		t.finishPhase()
	}
	t.phase = stage
	t.finishPhase = t.measure(stage)
}

func (t *pqLabProofCaptureObservation) beginDeadline(limit time.Duration) {
	if t != nil {
		t.deadlineStarted, t.deadlineDuration = time.Now(), limit
	}
}

func (t *pqLabProofCaptureObservation) noteCrossing() {
	if t != nil {
		t.crossings++
	}
}

type pqLabProofCaptureFailureObservation struct {
	Version             string               `json:"version"`
	OwningNodeIndex     int                  `json:"owningNodeIndex"`
	Sequence            uint32               `json:"sequence"`
	PolicySHA256        string               `json:"policySHA256"`
	RequestSHA256       string               `json:"requestSHA256"`
	FirstCauseSHA256    string               `json:"firstCauseSHA256"`
	Outcome             string               `json:"outcome"`
	LastEnteredPhase    string               `json:"lastEnteredPhase"`
	TypedCrossings      uint32               `json:"typedCrossings"`
	CaptureBudgetNS     int64                `json:"captureBudgetNs"`
	SinceCaptureStartNS int64                `json:"sinceCaptureStartNs"`
	Timings             PQLabMetricsSnapshot `json:"timings"`
}

func retainPQLabProofCaptureFailure(output, pin string, sequence uint32, cause error, trace *pqLabProofCaptureObservation) error {
	if cause == nil {
		return nil
	}
	failure := struct {
		Version, PolicySHA256, Outcome, FirstCauseSHA256 string
		Sequence                                         uint32
	}{"YNX-PQ-LAB-LIVE-MATERIALS-FAILURE/v1", pin, "unknown", pqLabSHA([]byte(cause.Error())), sequence}
	observed := trace.failureSnapshot(failure.FirstCauseSHA256)
	err := errors.Join(cause, pqLabWriteJSON(filepath.Join(output, "failure.json"), failure))
	// The observation can neither finalize UNKNOWN nor change the original
	// error, including when its separate destination is unavailable.
	_ = observed.write(output)
	return err
}

func (t *pqLabProofCaptureObservation) failureSnapshot(firstCause string) *pqLabProofCaptureFailureObservation {
	if t == nil {
		return nil
	}
	if t.finishPhase != nil {
		t.finishPhase()
		t.finishPhase = nil
	}
	var elapsed int64
	if !t.deadlineStarted.IsZero() {
		elapsed = time.Since(t.deadlineStarted).Nanoseconds()
	}
	return &pqLabProofCaptureFailureObservation{
		Version: "YNX-PQ-LAB-PROOF-CAPTURE-OBSERVATION/v1", OwningNodeIndex: t.nodeIndex, Sequence: t.sequence,
		PolicySHA256: t.policySHA256, RequestSHA256: t.requestSHA256, FirstCauseSHA256: firstCause, Outcome: "unknown",
		LastEnteredPhase: t.phase, TypedCrossings: t.crossings, CaptureBudgetNS: t.deadlineDuration.Nanoseconds(),
		SinceCaptureStartNS: elapsed, Timings: t.metrics.Snapshot(),
	}
}

func (f *pqLabProofCaptureFailureObservation) write(output string) error {
	if f == nil {
		return nil
	}
	raw, err := json.Marshal(f)
	if err != nil {
		return err
	}
	if len(raw) > 16<<10 {
		return errors.New("lab proof capture observation exceeds its fixed bound")
	}
	return pqLabWrite(filepath.Join(output, "capture-observation.json"), raw)
}
