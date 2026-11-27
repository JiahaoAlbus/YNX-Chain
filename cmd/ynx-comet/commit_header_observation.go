package main

import (
	"encoding/hex"
	"errors"
	"strconv"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func (p pqOptions) validateCommitHeaderStream() error {
	if p.commitHeaderStreamOutput == "" {
		return nil
	}
	if p.commitMonotonicOutput == "" || p.commitObservationOutput == "" || p.commitObservationScope == "" {
		return errors.New("synthetic header stream requires original Commit and monotonic observations")
	}
	for _, path := range []string{p.commitObservationOutput, p.commitMonotonicOutput, p.finalizeObservationOutput, p.wireObservationOutput} {
		if path != "" && (path == p.commitHeaderStreamOutput || path == p.commitHeaderStreamOutput+".receipt.json") {
			return errors.New("synthetic header stream output must be distinct")
		}
	}
	q := p
	q.commitObservationOutput, q.commitHeaderStreamOutput, q.commitMonotonicOutput, q.finalizeObservationOutput = p.commitHeaderStreamOutput, "", "", ""
	q.commitValidationObservation = false
	if err := q.validateCommitObservation(); err != nil {
		return err
	}
	q.commitObservationOutput = p.commitHeaderStreamOutput + ".receipt.json"
	return q.validateCommitObservation()
}

// These helpers run only under the original observer lock. A getter alone is
// not an event: a value is emitted solely from the synchronous state callback.
func (o *operatorCommitObservation) readArmedHeader() (consensus.SyntheticCommitHeader, consensus.CommitTimingSample, bool) {
	if o.headerEvents == nil || !o.headerArmed || o.app == nil {
		return consensus.SyntheticCommitHeader{}, consensus.CommitTimingSample{}, false
	}
	return o.app.LastSyntheticCommitHeaderAndTiming()
}

// Caller holds o.mu. Preserve the first diagnostic failure without I/O.
func (o *operatorCommitObservation) loseHeader(reason string) {
	if o.headerEvents != nil {
		o.headerCaptureLost = true
		o.headerEvents.fail(errors.New(reason))
	}
}

func rawTimingInProjection(raw, projected consensus.CommitTimingSample) bool {
	if raw.Height != projected.Height || raw.Storage != projected.Storage || raw.Durable != projected.Durable || raw.ElapsedNs != projected.ElapsedNs || raw.PayloadBytes != projected.PayloadBytes {
		return false
	}
	for key, value := range raw.StagesNs {
		actual, ok := projected.StagesNs[key]
		if !ok || actual != value {
			return false
		}
	}
	return true
}

func (o *operatorCommitObservation) emitArmedHeader(height int64, reading commitMonotonicReading, sample *operatorCommitSample, first consensus.SyntheticCommitHeader, timing consensus.CommitTimingSample, available bool) {
	if o.headerEvents == nil {
		return
	}
	second, nextTiming, secondAvailable := o.readArmedHeader()
	ns, err := strconv.ParseUint(reading.NS, 10, 64)
	if o.headerCaptureLost {
		return
	}
	if !o.ran {
		o.loseHeader("original callback occurred before Node.Start returned")
		return
	}
	if !available || !secondAvailable || first != second || !equalCommitTiming(timing, nextTiming) || !rawTimingInProjection(timing, sample.Persistence) || first.Height != height || sample.Height != height || sample.AppHash != hex.EncodeToString(first.AppHash[:]) || first.CaptureEpoch == 0 || first.Attempt == 0 {
		o.loseHeader("original callback header and Commit attempt could not be bound")
		return
	}
	if err != nil || ns == 0 || strconv.FormatUint(ns, 10) != reading.NS || reading.Reason != "" {
		o.loseHeader("original callback monotonic clock unavailable")
		return
	}
	if o.headerEpoch != 0 && (first.CaptureEpoch != o.headerEpoch || first.Attempt != o.headerAttempt+1 || height != o.headerHeight+1) {
		o.loseHeader("original callback header sequence changed or has a gap")
		return
	}
	if !o.headerEvents.tryAppend(syntheticHeaderEvent{Height: height, HeaderHash: first.HeaderHash, AppHash: first.AppHash, CaptureEpoch: first.CaptureEpoch, Attempt: first.Attempt, MonotonicNs: reading.NS}) {
		o.headerCaptureLost = true
		return
	}
	o.headerEpoch, o.headerAttempt, o.headerHeight = first.CaptureEpoch, first.Attempt, height
}

// Called only after the original Node.Stop/Quit boundary. The stream covers
// callbacks admitted after Node.Start returned; it makes no claim about earlier
// handshake, WAL replay, or the start transition.
func (o *operatorCommitObservation) finishHeaderAfterStop() error {
	if o == nil {
		return nil
	}
	o.mu.Lock()
	stream := o.headerEvents
	if stream == nil {
		o.mu.Unlock()
		return nil
	}
	if o.headerFinished {
		o.mu.Unlock()
		return errors.New("synthetic header stop readback already attempted; preserve original")
	}
	last, _, ok := o.readArmedHeader()
	lost := o.headerCaptureLost || !o.ran || !o.headerArmed || !ok || o.headerHeight == 0 || last.Height != o.headerHeight || last.CaptureEpoch != o.headerEpoch || last.Attempt != o.headerAttempt
	o.headerArmed = false
	o.headerFinished = true
	o.mu.Unlock()
	return stream.finish(lost)
}
