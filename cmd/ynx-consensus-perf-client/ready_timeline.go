package main

import (
	"math"
	"time"
)

// Fixed memory: enough one-second bins for an eventual bounded 15-minute run.
// This is measurement capacity, not authorization to raise any live run limit.
const readyTimelineSeconds = 1024

type readySecondCounts struct {
	Second                    int   `json:"second"`
	SpanNs                    int64 `json:"spanNs"`
	CompleteSecond            bool  `json:"completeSecond"`
	Offered                   int   `json:"offered"`
	Submitted                 int   `json:"submitted"`
	CheckTxAccepted           int   `json:"checkTxAccepted"`
	EffectiveBusinessIncluded int   `json:"effectiveBusinessIncluded"`
	FinalSubmitted            int   `json:"finalSubmitted"`
	TerminalHandedBack        int   `json:"terminalHandedBack"`
	Rejected                  int   `json:"rejected"`
	ExecutionFailed           int   `json:"executionFailed"`
	SubmissionUnknown         int   `json:"submissionUnknown"`
	TimedOut                  int   `json:"timedOut"`
	ObservationFailed         int   `json:"observationFailed"`
	AwaitingTerminal          int   `json:"awaitingTerminal"`
	OfferedNotYetFinal        int   `json:"offeredNotYetFinal"`
}

type readyTimelineReport struct {
	Valid          bool                `json:"valid"`
	InvalidRows    int                 `json:"invalidRows"`
	BucketNs       int64               `json:"bucketNs"`
	WindowNs       int64               `json:"windowNs"`
	Buckets        []readySecondCounts `json:"buckets,omitempty"`
	Interpretation string              `json:"interpretation"`
}

type readyTimeSeries struct {
	start   time.Time
	bins    [readyTimelineSeconds]readySecondCounts
	invalid int
	latest  int
}

func timelineDuration(ms *float64) (time.Duration, bool) {
	if ms == nil || math.IsNaN(*ms) || math.IsInf(*ms, 0) || *ms < 0 || *ms >= float64(math.MaxInt64)/float64(time.Millisecond) {
		return 0, false
	}
	ns := math.Round(*ms * float64(time.Millisecond))
	if ns >= float64(math.MaxInt64) {
		return 0, false
	}
	return time.Duration(ns), true
}

// Reconstruct stage events from the process-local submission clock plus its
// measured monotonic latency, never from serialized UTC timestamps. Process all
// events before mutating bins so an invalid row cannot contribute partial rates.
func (s *readyTimeSeries) add(r transactionResult, bound bool, handedBack time.Time) {
	type event struct {
		at   time.Time
		kind int
	}
	var storage [6]event
	events := storage[:0]
	add := func(at time.Time, kind int) { events = append(events, event{at, kind}) }
	invalid := func() { s.invalid++ }
	if s.start.IsZero() || handedBack.IsZero() {
		invalid()
		return
	}
	if r.OfferedAt == nil {
		if r.SubmittedAt != nil || r.CheckTxCode != nil || verifiedBusinessInclusion(r) || qualifiedBusinessFinal(r) {
			invalid()
		}
		return // Unoffered future inputs are not an in-flight backlog.
	}
	add(r.offerMonotonic, 0)
	if r.SubmittedAt != nil {
		if r.submitMonotonic.Before(r.offerMonotonic) {
			invalid()
			return
		}
		add(r.submitMonotonic, 1)
	}
	stage := func(ms *float64, kind int) bool {
		d, ok := timelineDuration(ms)
		if !ok || r.SubmittedAt == nil || r.submitMonotonic.IsZero() {
			return false
		}
		add(r.submitMonotonic.Add(d), kind)
		return true
	}
	if r.CheckTxCode != nil && r.CheckTxIdentityVerified {
		kind := 2
		if *r.CheckTxCode != 0 {
			kind = 6
		}
		if !stage(r.CheckTxMs, kind) {
			invalid()
			return
		}
	}
	if bound && verifiedBusinessInclusion(r) {
		if !stage(r.InclusionMs, 3) {
			invalid()
			return
		}
	}
	if bound && qualifiedBusinessFinal(r) {
		if !stage(r.ConfirmationMs, 4) {
			invalid()
			return
		}
		if r.InclusionMs == nil || *r.ConfirmationMs < *r.InclusionMs {
			invalid()
			return
		}
	}
	add(handedBack, 5)
	var positions [6]int
	for i, e := range events {
		if e.at.IsZero() || e.at.Before(s.start) || e.at.After(handedBack) {
			invalid()
			return
		}
		n := e.at.Sub(s.start) / time.Second
		if n < 0 || n >= readyTimelineSeconds {
			invalid()
			return
		}
		positions[i] = int(n)
	}
	for i, e := range events {
		n := positions[i]
		if n > s.latest {
			s.latest = n
		}
		b := &s.bins[n]
		switch e.kind {
		case 0:
			b.Offered++
		case 1:
			b.Submitted++
		case 2:
			b.CheckTxAccepted++
		case 3:
			b.EffectiveBusinessIncluded++
		case 4:
			b.FinalSubmitted++
		case 5:
			b.TerminalHandedBack++
			if r.ExecutionCode != nil && *r.ExecutionCode != 0 {
				b.ExecutionFailed++
			}
			switch r.Status {
			case "submission_unknown":
				b.SubmissionUnknown++
			case "timeout":
				b.TimedOut++
			case "observation_failed":
				b.ObservationFailed++
			}
		case 6:
			b.Rejected++
		}
	}
}

func (s *readyTimeSeries) snapshot(seconds float64) *readyTimelineReport {
	if s == nil {
		return nil
	}
	out := &readyTimelineReport{Valid: false, InvalidRows: s.invalid, BucketNs: int64(time.Second), Interpretation: "Process-local monotonic one-second event counts, reconstructed from submission plus actual measured latency. Inclusion/final require the existing business gates. Terminal time is controller hand-back after the evidence sink. AwaitingTerminal is offered minus hand-backs; OfferedNotYetFinal includes failed outcomes and is not a mempool size. Idle gaps and partial trailing seconds remain explicit. Any unavailable/invalid event withholds the entire series. This is client observation timing, not an internal consensus timer or proof of sustained capacity."}
	if s.invalid != 0 || math.IsNaN(seconds) || math.IsInf(seconds, 0) || seconds < 0 || seconds > readyTimelineSeconds {
		return out
	}
	elapsed := time.Duration(seconds * float64(time.Second))
	out.WindowNs = int64(elapsed)
	last := int(elapsed / time.Second)
	if elapsed%time.Second == 0 && last > 0 {
		last--
	}
	if s.latest > last {
		last = s.latest
	}
	if last >= readyTimelineSeconds {
		return out
	}
	out.Buckets = make([]readySecondCounts, last+1)
	offered, terminal, final := 0, 0, 0
	for i := range out.Buckets {
		b := s.bins[i]
		b.Second = i
		span := elapsed - time.Duration(i)*time.Second
		if span < 0 {
			out.Buckets = nil
			return out
		}
		if span > time.Second {
			span = time.Second
		}
		b.SpanNs = int64(span)
		b.CompleteSecond = span == time.Second
		offered += b.Offered
		terminal += b.TerminalHandedBack
		final += b.FinalSubmitted
		b.AwaitingTerminal = offered - terminal
		b.OfferedNotYetFinal = offered - final
		if b.AwaitingTerminal < 0 || b.OfferedNotYetFinal < 0 {
			out.Buckets = nil
			return out
		}
		out.Buckets[i] = b
	}
	out.Valid = true
	return out
}
