package main

import (
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// Per-execute deltas of process-wide setup/observation/replay/readback counters,
// not a phase CPU
// attribution or business execution/finality authority. Only selected reports
// carry this inventory; original report and plan shapes remain unchanged.
type clientHashEncodingReport struct {
	Mode              string `json:"mode"`
	CandidateAttempts uint64 `json:"candidateAttempts"`
	EncodingErrors    uint64 `json:"encodingErrors"`
}

func configureClientHashEncoding(o options) error {
	if err := validateNativeStreamingOptions(o); err != nil {
		return err
	}
	mode := consensus.StateHashOriginalJSON
	if o.nativeCachedFeeJSON {
		mode = consensus.StateHashCachedFeeJSON
	}
	return consensus.ConfigureStateHashEncoding(mode)
}

func currentClientHashEncoding() *clientHashEncodingReport {
	mode, calls, failures := consensus.StateHashEncodingMeasurements()
	return &clientHashEncodingReport{mode, calls, failures}
}

func clientHashEncodingSince(start *clientHashEncodingReport) (*clientHashEncodingReport, error) {
	end := currentClientHashEncoding()
	if start == nil || end.Mode != start.Mode || end.CandidateAttempts < start.CandidateAttempts || end.EncodingErrors < start.EncodingErrors {
		return nil, errors.New("client hash encoding counter window differs")
	}
	end.CandidateAttempts -= start.CandidateAttempts
	end.EncodingErrors -= start.EncodingErrors
	return end, nil
}
