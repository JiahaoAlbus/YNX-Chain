package consensus

import (
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
)

const FinalizeTimingMaxSamples = 128

// FinalizeTimingSample is local diagnostics, never committed state or finality.
// PhaseNs partitions elapsed time after the Application lock is acquired.
// ChildrenNs overlap their parent phases: NEVER add them to PhaseNs. Missing
// children were not executed, not measured zero. No error/body/identity is kept.
type FinalizeTimingSample struct {
	Attempt        uint64            `json:"attempt"`
	RequestPresent bool              `json:"requestPresent"`
	Height         int64             `json:"height"`
	Success        bool              `json:"success"`
	AppHash        string            `json:"appHash"` // only after successful Finalize; never preceding hash
	FailedPhase    string            `json:"failedPhase"`
	ElapsedNs      int64             `json:"elapsedNs"`
	PhaseNs        map[string]int64  `json:"phaseNs"`
	ChildrenNs     map[string]int64  `json:"childrenNs"`
	Counts         map[string]uint64 `json:"counts"`
}

type FinalizeTimingObservation struct {
	Attempts uint64                 `json:"attempts"`
	Dropped  uint64                 `json:"dropped"`
	Samples  []FinalizeTimingSample `json:"samples"`
	Latest   *FinalizeTimingSample  `json:"latest"`
}
type finalizeTimingCapture struct {
	observation FinalizeTimingObservation
	now         func() time.Time // only package-owned deterministic controls; no public clock injection
}
type finalizeTimings struct {
	sample                FinalizeTimingSample
	started, phaseStarted time.Time
	phase                 string
	now                   func() time.Time
}

// Enabling is explicit. Disabled Finalize performs no diagnostic clock calls,
// allocations or output; changing the setting discards the previous capture.
func (a *Application) SetFinalizeTimingEnabled(enabled bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.finalizeTiming = nil
	if enabled {
		a.finalizeTiming = &finalizeTimingCapture{observation: FinalizeTimingObservation{Samples: []FinalizeTimingSample{}}}
	}
}
func cloneFinalizeSample(s FinalizeTimingSample) FinalizeTimingSample {
	p := s
	p.PhaseNs = make(map[string]int64, len(s.PhaseNs))
	p.ChildrenNs = make(map[string]int64, len(s.ChildrenNs))
	p.Counts = make(map[string]uint64, len(s.Counts))
	for k, v := range s.PhaseNs {
		p.PhaseNs[k] = v
	}
	for k, v := range s.ChildrenNs {
		p.ChildrenNs[k] = v
	}
	for k, v := range s.Counts {
		p.Counts[k] = v
	}
	return p
}

// Snapshot is detached and bounded. Latest remains the last attempt even when
// the first 128 samples filled the buffer; Dropped explicitly exposes loss.
func (a *Application) FinalizeTimingSnapshot() (FinalizeTimingObservation, bool) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if a.finalizeTiming == nil {
		return FinalizeTimingObservation{}, false
	}
	in := a.finalizeTiming.observation
	out := in
	out.Samples = make([]FinalizeTimingSample, len(in.Samples))
	for i, s := range in.Samples {
		out.Samples[i] = cloneFinalizeSample(s)
	}
	if in.Latest != nil {
		p := cloneFinalizeSample(*in.Latest)
		out.Latest = &p
	}
	return out, true
}
func (t *finalizeTimings) clock() time.Time {
	if t.now != nil {
		return t.now()
	}
	return time.Now()
}
func (a *Application) beginFinalizeTiming(req *abci.RequestFinalizeBlock) *finalizeTimings {
	if a.finalizeTiming == nil {
		return nil
	}
	o := &a.finalizeTiming.observation
	o.Attempts++
	t := &finalizeTimings{now: a.finalizeTiming.now, phase: "preflight", sample: FinalizeTimingSample{Attempt: o.Attempts, RequestPresent: req != nil, PhaseNs: map[string]int64{}, ChildrenNs: map[string]int64{}, Counts: map[string]uint64{}}}
	if req != nil {
		t.sample.Height = req.Height
		t.sample.Counts["requested_transactions"] = uint64(len(req.Txs))
	}
	t.started = t.clock()
	t.phaseStarted = t.started
	a.finalizeTimingActive = t
	return t
}
func (t *finalizeTimings) enter(phase string) {
	if t == nil {
		return
	}
	now := t.clock()
	t.sample.PhaseNs[t.phase] += now.Sub(t.phaseStarted).Nanoseconds()
	t.phase, t.phaseStarted = phase, now
}
func (t *finalizeTimings) transaction(rejected bool) {
	if t == nil {
		return
	}
	t.sample.Counts["attempted_transactions"]++
	if rejected {
		t.sample.Counts["rejected_transactions"]++
	}
}
func (t *finalizeTimings) succeeded(hash string) {
	if t != nil {
		t.sample.Success = true
		t.sample.AppHash = hash
	}
}
func (a *Application) finishFinalizeTiming(t *finalizeTimings) {
	if t == nil {
		return
	}
	defer func() { a.finalizeTimingActive = nil }()
	now := t.clock()
	t.sample.PhaseNs[t.phase] += now.Sub(t.phaseStarted).Nanoseconds()
	t.sample.ElapsedNs = now.Sub(t.started).Nanoseconds()
	if !t.sample.Success && t.sample.FailedPhase == "" {
		t.sample.FailedPhase = t.phase
	}
	o := &a.finalizeTiming.observation
	o.Latest = &t.sample
	if len(o.Samples) < FinalizeTimingMaxSamples {
		o.Samples = append(o.Samples, t.sample)
	} else {
		o.Dropped++
	}
}
func (t *finalizeTimings) childStart() time.Time {
	if t == nil {
		return time.Time{}
	}
	return t.clock()
}
func (t *finalizeTimings) childFinish(name string, started time.Time, err error) {
	if t == nil {
		return
	}
	t.sample.ChildrenNs[name] += t.clock().Sub(started).Nanoseconds()
	if err != nil && t.sample.FailedPhase == "" {
		t.sample.FailedPhase = name
	}
}

// Keep each expression at its original evaluation position in the struct
// literal. Only these original functions materialize accounts/Lots and fees.
func (t *finalizeTimings) accounts(state executionState, phase string) []chain.ConsensusAccount {
	started := t.childStart()
	out := cloneExecutionAccounts(state)
	t.childFinish(phase, started, nil)
	if t != nil {
		t.sample.Counts[phase] += uint64(len(out))
	}
	return out
}
func (t *finalizeTimings) fees(j feeEventJournal) []BFTFeeEvent {
	started := t.childStart()
	out := j.events()
	t.childFinish("seal.fee_materialize", started, nil)
	if t != nil {
		t.sample.Counts["seal.fee_materialize"] = uint64(len(out))
	}
	return out
}
