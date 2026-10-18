package main

import (
	"context"
	"encoding/json"
	"io"
	"math/bits"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
)

const phaseTimingPrefix = "YNX_ABCI_PHASE_TIMING "
const phaseTimingMaxReports = 4096

type phaseTotals struct {
	Calls           uint64 `json:"calls"`
	FailedResponses uint64 `json:"failedResponses"`
	ElapsedNs       uint64 `json:"elapsedNs"`
	// Index 0 contains zero; index i>0 contains [2^(i-1),2^i-1] ns.
	DurationBuckets [64]uint64 `json:"durationBuckets"`
}
type phaseTimingReport struct {
	Schema          int                           `json:"schema"`
	Sequence        int                           `json:"sequence"`
	Reason          string                        `json:"reason"`
	InFlight        uint64                        `json:"inFlight"`
	WindowElapsedNs int64                         `json:"windowElapsedNs"`
	Valid           bool                          `json:"valid"`
	Capped          bool                          `json:"capped"`
	Stages          map[string]phaseTotals        `json:"stages"`
	Commit          *consensus.CommitTimingSample `json:"commit"`
}
type phaseRecorder struct {
	mu                      sync.Mutex
	started                 time.Time
	stages                  map[string]phaseTotals
	writer                  io.Writer
	inFlight                uint64
	reports                 int
	invalid, capped, closed bool
}

func newPhaseRecorder(writer io.Writer) *phaseRecorder {
	return &phaseRecorder{started: time.Now(), stages: make(map[string]phaseTotals, 5), writer: writer}
}
func (r *phaseRecorder) begin() time.Time {
	r.mu.Lock()
	r.inFlight++
	r.mu.Unlock()
	return time.Now()
}

func (r *phaseRecorder) observe(stage string, started time.Time, failed bool) {
	ns := uint64(time.Since(started).Nanoseconds())
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.inFlight == 0 {
		r.invalid = true
	} else {
		r.inFlight--
	}
	value := r.stages[stage]
	value.Calls++
	if failed {
		value.FailedResponses++
	}
	if ^uint64(0)-value.ElapsedNs < ns {
		r.invalid = true
	} else {
		value.ElapsedNs += ns
	}
	bucket := bits.Len64(ns)
	if bucket > 63 {
		bucket = 63
		r.invalid = true
	}
	value.DurationBuckets[bucket]++
	r.stages[stage] = value
}

// Cumulative completion counters are not assigned to a block height. Concurrent
// CheckTx completions can cross Commit boundaries; per-block execution is not inferred.
func (r *phaseRecorder) emit(reason string, sample *consensus.CommitTimingSample) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return
	}
	if reason == "shutdown" {
		r.closed = true
	}
	if r.reports >= phaseTimingMaxReports && reason != "shutdown" {
		r.capped = true
		return
	}
	r.reports++
	report := phaseTimingReport{Schema: 1, Sequence: r.reports, Reason: reason, WindowElapsedNs: time.Since(r.started).Nanoseconds(), InFlight: r.inFlight, Valid: !r.invalid && !r.capped && (reason != "shutdown" || r.inFlight == 0), Capped: r.capped, Stages: r.stages, Commit: sample}
	raw, err := json.Marshal(report)
	if err == nil {
		raw = append(append([]byte(phaseTimingPrefix), raw...), '\n')
		var n int
		n, err = r.writer.Write(raw)
		if err == nil && n != len(raw) {
			err = io.ErrShortWrite
		}
	}
	// Diagnostic output failure invalidates later records; it never changes an ABCI result.
	if err != nil {
		r.invalid = true
	}
}

type phaseTimedApplication struct {
	abci.Application
	recorder     *phaseRecorder
	commitMu     sync.Mutex
	commitTiming func() (consensus.CommitTimingSample, bool)
}

func withPhaseTiming(app *consensus.Application, writer io.Writer) *phaseTimedApplication {
	app.SetCommitTimingEnabled(true)
	return &phaseTimedApplication{Application: app, recorder: newPhaseRecorder(writer), commitTiming: app.LastCommitTiming}
}
func (a *phaseTimedApplication) CheckTx(ctx context.Context, req *abci.RequestCheckTx) (*abci.ResponseCheckTx, error) {
	started := a.recorder.begin()
	response, err := a.Application.CheckTx(ctx, req)
	a.recorder.observe("check_tx", started, err != nil || response == nil || response.Code != 0)
	return response, err
}
func (a *phaseTimedApplication) PrepareProposal(ctx context.Context, req *abci.RequestPrepareProposal) (*abci.ResponsePrepareProposal, error) {
	started := a.recorder.begin()
	response, err := a.Application.PrepareProposal(ctx, req)
	a.recorder.observe("prepare_proposal", started, err != nil || response == nil)
	return response, err
}
func (a *phaseTimedApplication) ProcessProposal(ctx context.Context, req *abci.RequestProcessProposal) (*abci.ResponseProcessProposal, error) {
	started := a.recorder.begin()
	response, err := a.Application.ProcessProposal(ctx, req)
	a.recorder.observe("process_proposal", started, err != nil || response == nil || response.Status != abci.ResponseProcessProposal_ACCEPT)
	return response, err
}
func (a *phaseTimedApplication) FinalizeBlock(ctx context.Context, req *abci.RequestFinalizeBlock) (*abci.ResponseFinalizeBlock, error) {
	started := a.recorder.begin()
	response, err := a.Application.FinalizeBlock(ctx, req)
	a.recorder.observe("finalize_block", started, err != nil || response == nil)
	return response, err
}
func (a *phaseTimedApplication) Commit(ctx context.Context, req *abci.RequestCommit) (*abci.ResponseCommit, error) {
	started := a.recorder.begin()
	a.commitMu.Lock()
	defer a.commitMu.Unlock()
	response, err := a.Application.Commit(ctx, req)
	a.recorder.observe("commit", started, err != nil || response == nil)
	var sample *consensus.CommitTimingSample
	if value, ok := a.commitTiming(); ok {
		sample = &value
	}
	a.recorder.emit("commit", sample)
	return response, err
}
