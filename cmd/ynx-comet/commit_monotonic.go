package main

import (
	"encoding/json"
	"errors"
	"os"
	"strings"

	"github.com/spf13/cobra"
)

// Set only by the synthetic held build's explicit -ldflags. This value is a
// declaration, not source attestation: the reader must independently bind the
// source manifest, build argv, binary digest and original owning process.
var operatorCommitBuildSource string

func newCommitMonotonicBuildIdentityCommand() *cobra.Command {
	var synthetic bool
	command := &cobra.Command{Use: "synthetic-commit-clock-build-identity", Args: cobra.NoArgs,
		Short: "read synthetic clock build declaration without starting a node",
		RunE: func(command *cobra.Command, _ []string) error {
			if !synthetic {
				return errors.New("explicit synthetic scope required")
			}
			source := binarySourceRevision()
			status := "DECLARED"
			if source == "" {
				status = "UNKNOWN"
			}
			return json.NewEncoder(command.OutOrStdout()).Encode(map[string]interface{}{
				"version": "YNX-COMET-COMMIT-CLOCK-BUILD/v1", "status": status,
				"sourceRevision": source, "sourceBinding": "linker-declared-requires-original-manifest-build-binary-and-process-proof",
				"syntheticOnly": true, "runtimeAuthorized": false, "nodeStarted": false})
		}}
	command.Flags().BoolVar(&synthetic, "synthetic", false, "explicit synthetic-only inspection")
	return command
}

// This projection is independent of the existing v1 Commit and Finalize
// outputs. It never changes their schema or grants a runtime/finality claim.
func (p pqOptions) validateCommitMonotonic() error {
	if p.commitMonotonicOutput == "" {
		return nil
	}
	if p.commitObservationOutput == "" || p.commitObservationScope == "" || p.commitMonotonicOutput == p.commitObservationOutput || p.commitMonotonicOutput == p.finalizeObservationOutput {
		return errors.New("monotonic Commit observation requires distinct original synthetic Commit output")
	}
	q := p
	q.commitObservationOutput, q.commitMonotonicOutput, q.finalizeObservationOutput = p.commitMonotonicOutput, "", ""
	return q.validateCommitObservation()
}

type commitMonotonicReading struct {
	NS     string `json:"monotonicNs,omitempty"`
	Reason string `json:"unknownReason,omitempty"`
}
type commitMonotonicSample struct {
	Height  int64  `json:"height"`
	AppHash string `json:"appHash"`
	commitMonotonicReading
}
type operatorCommitMonotonic struct {
	file      *commitObservationOutput
	clock     commitMonotonicClock
	samples   []commitMonotonicSample
	attempted bool
}

func binarySourceRevision() string {
	revision := operatorCommitBuildSource
	if len(revision) != 40 {
		return ""
	}
	for _, c := range revision {
		if !strings.ContainsRune("0123456789abcdef", c) {
			return ""
		}
	}
	return revision
}

func prepareOperatorCommitMonotonic(p pqOptions) (*operatorCommitMonotonic, error) {
	if p.commitMonotonicOutput == "" {
		return nil, nil
	}
	if err := p.validateCommitMonotonic(); err != nil {
		return nil, err
	}
	file, err := openCommitObservationOutput(p.commitMonotonicOutput)
	if err != nil {
		return nil, err
	}
	return &operatorCommitMonotonic{file: file, clock: newCommitMonotonicClock(binarySourceRevision()), samples: []commitMonotonicSample{}}, nil
}
func (o *operatorCommitMonotonic) capture() commitMonotonicReading {
	if o == nil {
		return commitMonotonicReading{}
	}
	return o.clock.read()
}

// Called only under the original Commit observer lock after exact height and
// application checkpoint identity were rechecked.
func (o *operatorCommitMonotonic) append(sample *operatorCommitSample, reading commitMonotonicReading) {
	if o != nil {
		o.samples = append(o.samples, commitMonotonicSample{Height: sample.Height, AppHash: sample.AppHash, commitMonotonicReading: reading})
	}
}
func (o *operatorCommitMonotonic) writeAfterStop(parent *operatorCommitObservation, parentErr error) error {
	if o == nil {
		return nil
	}
	parent.mu.Lock()
	defer parent.mu.Unlock()
	if o.attempted || !parent.attempted || !parent.ran || parent.closed {
		return errors.New("monotonic Commit observation requires one completed original stop")
	}
	o.attempted = true
	status, reason := "OBSERVED", ""
	if parentErr != nil || !parent.result.Coverage.NotificationCaptureComplete || len(o.samples) != len(parent.result.Samples) {
		status, reason = "UNKNOWN", "original Commit notification coverage incomplete"
	}
	if o.clock.reason != "" {
		status, reason = "UNKNOWN", o.clock.reason
	}
	for _, sample := range o.samples {
		if sample.NS == "" {
			status = "UNKNOWN"
			if reason == "" {
				reason = sample.Reason
			}
		}
	}
	result := struct {
		Version             string                  `json:"version"`
		Status              string                  `json:"status"`
		UnknownReason       string                  `json:"unknownReason,omitempty"`
		Scope               string                  `json:"scope"`
		ProcessID           int                     `json:"processID"`
		ChainID             string                  `json:"chainID"`
		OriginalGenesisHash string                  `json:"originalGenesisHash"`
		SourceRevision      string                  `json:"sourceRevision,omitempty"`
		SourceBinding       string                  `json:"sourceBinding"`
		BootID              string                  `json:"bootID,omitempty"`
		TimeNamespace       string                  `json:"timeNamespace,omitempty"`
		Clock               string                  `json:"clock"`
		CaptureBoundary     string                  `json:"captureBoundary"`
		IndependentFinality bool                    `json:"independentFinality"`
		Samples             []commitMonotonicSample `json:"samples"`
	}{"YNX-COMET-COMMIT-MONOTONIC/v1", status, reason, parent.result.Scope, os.Getpid(), parent.result.ChainID, parent.result.OriginalGenesisHash,
		o.clock.source, "linker-declared-requires-original-manifest-build-binary-and-process-proof", o.clock.boot, o.clock.namespace, "CLOCK_MONOTONIC", "local-persistent-ABCI-Commit-return-upper-bound-before-mempool-update;not-consensus-vote-or-finality", false, o.samples}
	raw, err := json.Marshal(result)
	if err != nil {
		return err
	}
	return o.file.write(append(raw, '\n'))
}
func (o *operatorCommitMonotonic) close() error {
	if o == nil {
		return nil
	}
	return o.file.close()
}
