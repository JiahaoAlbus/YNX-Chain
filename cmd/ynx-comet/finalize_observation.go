package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// The new projection is separate: original Commit JSON and notification rules
// are untouched. It is available only under the same closed synthetic opt-in.
func (p pqOptions) validateFinalizeObservation() error {
	if p.finalizeObservationOutput == "" {
		return nil
	}
	if p.commitObservationOutput == "" || p.commitObservationScope == "" || p.finalizeObservationOutput == p.commitObservationOutput {
		return errors.New("Finalize observation requires original Commit opt-in and distinct output")
	}
	q := p
	q.commitObservationOutput = p.finalizeObservationOutput
	q.finalizeObservationOutput = ""
	return q.validateCommitObservation()
}

type operatorFinalizeObservation struct {
	mu                     sync.Mutex
	file                   *commitObservationOutput
	app                    *consensus.Application
	chainID, genesis       string
	ran, attempted, closed bool
}
type operatorFinalizeResult struct {
	Version                     string                              `json:"version"`
	Scope                       string                              `json:"scope"`
	ProcessID                   int                                 `json:"processID"`
	ChainID                     string                              `json:"chainID"`
	OriginalGenesisHash         string                              `json:"originalGenesisHash"`
	CaptureBoundary             string                              `json:"captureBoundary"`
	LockWaitIncluded            bool                                `json:"lockWaitIncluded"`
	IndependentFinality         bool                                `json:"independentFinality"`
	MaxSamples                  int                                 `json:"maxSamples"`
	CaptureComplete             bool                                `json:"captureComplete"`
	UnreportedStagesAreUnknown  bool                                `json:"unreportedStagesAreUnknown"`
	ChildrenOverlapParentPhases bool                                `json:"childrenOverlapParentPhases"`
	Observation                 consensus.FinalizeTimingObservation `json:"observation"`
}

func prepareOperatorFinalizeObservation(p pqOptions) (*operatorFinalizeObservation, error) {
	if p.finalizeObservationOutput == "" {
		return nil, nil
	}
	if err := p.validateFinalizeObservation(); err != nil {
		return nil, err
	}
	file, err := openCommitObservationOutput(p.finalizeObservationOutput)
	if err != nil {
		return nil, err
	}
	return &operatorFinalizeObservation{file: file}, nil
}
func (o *operatorFinalizeObservation) bind(app *consensus.Application, m chain.ConsensusMigrationState) error {
	if o == nil {
		return nil
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if app == nil || o.app != nil || o.closed || o.ran || o.attempted {
		return errors.New("Finalize observation requires one original application")
	}
	if m.Network.ChainID != consensus.PQLabNativeChainID || m.Network.IsPublicNet || !strings.HasPrefix(m.Network.Slug, "pq-lab-") {
		return errors.New("Finalize observation refuses public/non-synthetic source")
	}
	if err := o.file.parentCurrent(); err != nil {
		return err
	}
	o.app = app
	o.chainID = fmt.Sprintf("ynx_%d-1", m.Network.ChainID)
	o.genesis = m.OriginalGenesisHash
	app.SetFinalizeTimingEnabled(true)
	return nil
}
func (o *operatorFinalizeObservation) started() {
	if o != nil {
		o.mu.Lock()
		o.ran = o.app != nil && !o.closed
		o.mu.Unlock()
	}
}
func (o *operatorCommitObservation) writeAfterStop() error {
	if o == nil {
		return nil
	}
	// Evaluate both exactly once even when no Commit notification exists because
	// Finalize failed early. That failure must still have its original projection.
	if o.finalize == nil {
		return o.writeCommitAfterStop()
	}
	return errors.Join(o.writeCommitAfterStop(), o.finalize.writeAfterStop())
}
func (o *operatorFinalizeObservation) writeAfterStop() error {
	if o == nil {
		return nil
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.closed || !o.ran || o.app == nil || o.attempted {
		return errors.New("Finalize observation requires one started lifetime and completed normal stop")
	}
	o.attempted = true
	snapshot, ok := o.app.FinalizeTimingSnapshot()
	if !ok {
		return errors.New("Finalize observation capture disabled or lost")
	}
	complete := snapshot.Attempts > 0 && snapshot.Dropped == 0 && uint64(len(snapshot.Samples)) == snapshot.Attempts && snapshot.Latest != nil && snapshot.Latest.Attempt == snapshot.Attempts
	// Both failed and successful attempts are evidence; failures do not become
	// timing success, while their complete capture remains usable diagnostics.
	result := operatorFinalizeResult{Version: "YNX-COMET-FINALIZE-OBSERVATION/v1", Scope: operatorWireObservationScope, ProcessID: os.Getpid(), ChainID: o.chainID, OriginalGenesisHash: o.genesis,
		CaptureBoundary: "owning-Application-FinalizeBlock-after-lock;after-opt-in;normal-stop-output;pre-bind-replay-not-covered", MaxSamples: consensus.FinalizeTimingMaxSamples, CaptureComplete: complete, UnreportedStagesAreUnknown: true, ChildrenOverlapParentPhases: true, Observation: snapshot}
	raw, err := json.Marshal(result)
	if err != nil {
		return errors.New("Finalize observation public projection encoding failed")
	}
	if err = o.file.write(append(raw, '\n')); err != nil {
		return err
	}
	if !complete {
		return errors.New("Finalize observation incomplete; preserve bounded original/UNKNOWN, no retry")
	}
	return nil
}
func (o *operatorFinalizeObservation) close() error {
	if o == nil {
		return nil
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.closed {
		return nil
	}
	o.closed = true
	if o.app != nil {
		o.app.SetFinalizeTimingEnabled(false)
	}
	return o.file.close()
}
