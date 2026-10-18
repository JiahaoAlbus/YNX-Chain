package main

import (
	"errors"
	"math"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/loadmetrics"
)

type readyCumulativeReport struct {
	TimeSeries            *readyTimelineReport                `json:"timeSeries,omitempty"`
	TerminalRecords       int                                 `json:"terminalRecords"`
	InvalidLatencyRecords int                                 `json:"invalidLatencyRecords"`
	Counts                summary                             `json:"counts"`
	LatencyIntervalsNs    map[string]loadmetrics.Distribution `json:"latencyIntervalsNs"`
	Interpretation        string                              `json:"interpretation"`
}

type readyEventSpan struct {
	count       int
	missing     bool
	first, last time.Time
}

func (s *readyEventSpan) add(at time.Time) {
	s.count++
	if at.IsZero() {
		s.missing = true
		return
	}
	if s.first.IsZero() || at.Before(s.first) {
		s.first = at
	}
	if s.last.IsZero() || at.After(s.last) {
		s.last = at
	}
}
func (s readyEventSpan) rate() (float64, *float64) {
	if s.missing || s.count < 2 {
		return 0, nil
	}
	seconds := s.last.Sub(s.first).Seconds()
	if seconds <= 0 {
		return 0, nil
	}
	rate := float64(s.count-1) / seconds
	return seconds, &rate
}

// Single controller owner; no raw result, signed payload or lifetime-sized list
// is retained. Exact per-transaction evidence belongs to the terminal stream.
type readyCumulativeSummary struct {
	timeline              *readyTimeSeries
	planned, records      int
	invalidLatencyRecords int
	counts                summary
	offered, submitted    readyEventSpan
	latency               [6]*loadmetrics.Histogram
}

func newReadyCumulativeSummary(planned int) (*readyCumulativeSummary, error) {
	if planned < 1 || uint64(planned) > loadmetrics.MaxSamples {
		return nil, errors.New("cumulative summary input bound")
	}
	out := &readyCumulativeSummary{planned: planned}
	for i := range out.latency {
		out.latency[i] = new(loadmetrics.Histogram)
	}
	return out, nil
}

func (s *readyCumulativeSummary) add(r transactionResult, identityBound bool) error {
	if s.records >= s.planned {
		return errors.New("cumulative terminal record bound")
	}
	business := identityBound && verifiedBusinessInclusion(r)
	final := identityBound && qualifiedBusinessFinal(r)
	values := [6]*float64{r.QueueDelayMs, r.CheckTxMs, nil, nil, nil, nil}
	if r.TransactionProofVerified {
		values[2] = r.InclusionMs
	}
	if business {
		values[3] = r.InclusionMs
	}
	if final {
		values[4] = r.ConfirmationMs
		if r.QueueDelayMs != nil && r.ConfirmationMs != nil {
			sum := *r.QueueDelayMs + *r.ConfirmationMs
			values[5] = &sum
		}
	}
	var durations [6]time.Duration
	var latencyErr error
	// Validate every eligible measurement before changing any histogram. Invalid
	// timing stops the run but must not relabel an actual submission unsubmitted.
	for i, value := range values {
		if value == nil {
			continue
		}
		if math.IsNaN(*value) || math.IsInf(*value, 0) || *value < 0 || *value >= float64(math.MaxInt64)/float64(time.Millisecond) {
			latencyErr = errors.New("invalid cumulative monotonic latency")
			break
		}
		ns := math.Round(*value * float64(time.Millisecond))
		if ns >= float64(math.MaxInt64) {
			latencyErr = errors.New("cumulative latency duration overflow")
			break
		}
		durations[i] = time.Duration(ns)
	}
	if latencyErr != nil {
		s.invalidLatencyRecords++
	} else {
		for i, value := range values {
			if value != nil {
				if err := s.latency[i].Add(durations[i]); err != nil {
					return err
				}
			}
		}
	}
	s.records++
	c := &s.counts
	if r.OfferedAt != nil {
		c.Offered++
		s.offered.add(r.offerMonotonic)
	}
	if r.SubmittedAt != nil {
		c.Submitted++
		s.submitted.add(r.submitMonotonic)
	}
	if r.CheckTxCode != nil {
		c.CheckTxResponses++
		if !r.CheckTxIdentityVerified {
			c.CheckTxUnverified++
		} else if *r.CheckTxCode == 0 {
			c.CheckTxAccepted++
		} else {
			c.CheckTxRejected++
		}
	}
	if r.IncludedObservedAt != nil && r.ExecutionCode != nil && *r.ExecutionCode == 0 && r.TransactionProofVerified {
		c.IncludedCodeZero++
	}
	if business {
		c.EffectiveBusinessIncluded++
	}
	if r.ExecutionCode != nil && *r.ExecutionCode != 0 {
		c.ExecutionFailed++
	}
	if r.QuorumVerified && r.TransactionProofVerified {
		c.QuorumConfirmed++
	}
	if final {
		c.FinalSubmitted++
	}
	switch r.Status {
	case "submission_unknown":
		c.SubmissionUnknown++
	case "timeout":
		c.TimedOut++
	case "observation_failed":
		c.ObservationFailed++
	case "not_submitted":
		c.NotSubmitted++
	}
	for _, e := range r.Errors {
		c.ErrorOccurrences += e.Count
	}
	if s.timeline != nil {
		s.timeline.add(r, identityBound, time.Now())
	}
	return latencyErr
}

func readySummaryRates(s *summary, seconds float64) {
	s.MeasurementWindowSeconds = seconds
	s.SubmissionRate, s.AcceptanceRate, s.InclusionRate, s.EffectiveInclusionRate, s.ConfirmationRate, s.FinalSubmissionRate = 0, 0, 0, 0, 0, 0
	if seconds > 0 {
		s.SubmissionRate = float64(s.Submitted) / seconds
		s.AcceptanceRate = float64(s.CheckTxAccepted) / seconds
		s.InclusionRate = float64(s.IncludedCodeZero) / seconds
		s.EffectiveInclusionRate = float64(s.EffectiveBusinessIncluded) / seconds
		s.ConfirmationRate = float64(s.QuorumConfirmed) / seconds
		s.FinalSubmissionRate = float64(s.FinalSubmitted) / seconds
	}
}

func (s *readyCumulativeSummary) snapshot(seconds float64) *readyCumulativeReport {
	c := s.counts
	c.Input = s.planned
	// Unoffered future cycles and prepared-but-undispatched rows remain explicit.
	c.NotSubmitted += s.planned - s.records
	readySummaryRates(&c, seconds)
	c.OfferedEventSpanSeconds, c.OfferedEventSpanRate = s.offered.rate()
	c.SubmissionEventSpanSeconds, c.SubmissionEventSpanRate = s.submitted.rate()
	c.InclusionBlocks.Interpretation = "Slot retention does not retain a lifetime block list. Exact block coverage is in terminal evidence; no interior/steady TPS is inferred."
	names := [6]string{"queue", "checkTx", "authenticatedInclusion", "effectiveBusinessInclusion", "final", "offerToFinal"}
	distributions := make(map[string]loadmetrics.Distribution, 6)
	for i, name := range names {
		distributions[name] = s.latency[i].Summary()
	}
	// Old point-percentile fields are deliberately null. Schema12 reports closed
	// interval quantiles here, and raw terminal rows permit exact offline sorting.
	c.QueueDelay.Samples = int(distributions["queue"].Samples)
	c.CheckTxLatency.Samples = int(distributions["checkTx"].Samples)
	c.InclusionLatency.Samples = int(distributions["authenticatedInclusion"].Samples)
	c.EffectiveInclusionLatency.Samples = int(distributions["effectiveBusinessInclusion"].Samples)
	c.ConfirmationLatency.Samples = int(distributions["final"].Samples)
	return &readyCumulativeReport{TimeSeries: s.timeline.snapshot(seconds), TerminalRecords: s.records, InvalidLatencyRecords: s.invalidLatencyRecords, Counts: c, LatencyIntervalsNs: distributions, Interpretation: "Counts cover every handed-back terminal result plus explicit unsubmitted inputs. Final business counts require code-zero authenticated inclusion, fee/nonce durable state and publication gates; raw quorum/ACK counts are separate. Invalid latency records retain stage counts, omit the entire row from histograms and stop the run. Durations are bounded histogram intervals in ns, not exact point percentiles. Per-transaction queue+final spans are added before quantiles. Missing monotonic event times withhold interarrival rates. No sustained-capacity inference."}
}
