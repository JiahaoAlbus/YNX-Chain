package main

import (
	"strconv"
	"time"
)

// Optional data projection of the original client's actual observation points.
// This is neither a new verifier nor a generic run identity. Original signed
// journal/manifest identities and existing qualifiedBusinessFinal remain required.
const monotonicObservationSchema = "YNX-PERF-MONOTONIC-OBSERVATIONS/v1"

// The following flags describe this point-only projection. An opt-in
// declaredCohort separately owns its source demand, releases and fixed window.
type monotonicObservationReport struct {
	Schema                    string                    `json:"schema"`
	Clock                     string                    `json:"clock"`
	ObservationCutoffNs       string                    `json:"observationCutoffNs"`
	Rows                      []monotonicObservationRow `json:"rows"`
	MissingClockPoints        int                       `json:"missingClockPoints"`
	InvalidClockPoints        int                       `json:"invalidClockPoints"`
	UnqualifiedFinalSlots     int                       `json:"unqualifiedFinalSlots"`
	LogicalGenerationMeasured bool                      `json:"logicalGenerationMeasured"`
	FixedWindowConfigured     bool                      `json:"fixedWindowConfigured"`
	PhysicalCommitMeasured    bool                      `json:"physicalCommitMeasured"`
}
type monotonicObservationRow struct {
	Slot        int     `json:"slot"`
	Index       int     `json:"index"`
	Round       int     `json:"round"`
	Hash        string  `json:"hash"`
	ScheduledNs *string `json:"scheduledOffsetNs,omitempty"`
	OfferedNs   *string `json:"offeredOffsetNs,omitempty"`
	SubmittedNs *string `json:"submittedOffsetNs,omitempty"`
	CheckTxNs   *string `json:"checkTxObservedOffsetNs,omitempty"`
	IncludedNs  *string `json:"includedObservedOffsetNs,omitempty"`
	FinalNs     *string `json:"qualifiedFinalObservedOffsetNs,omitempty"`
}

func hasMonotonic(t time.Time) bool { return !t.IsZero() && t != t.Round(0) }
func captureMonotonicReport(origin, cutoff time.Time, results []transactionResult) *monotonicObservationReport {
	if !hasMonotonic(origin) || !hasMonotonic(cutoff) || cutoff.Before(origin) || len(results) > maxTransactions {
		return nil
	}
	out := &monotonicObservationReport{Schema: monotonicObservationSchema, Clock: "original client Go monotonic since private measurement origin; final event is verified observation upper bound, not physical Commit", ObservationCutoffNs: strconv.FormatInt(cutoff.Sub(origin).Nanoseconds(), 10), Rows: make([]monotonicObservationRow, 0, len(results))}
	point := func(at time.Time, reported bool) *string {
		if at.IsZero() {
			if reported {
				out.MissingClockPoints++
			}
			return nil
		}
		if !hasMonotonic(at) || at.Before(origin) || at.After(cutoff) {
			out.InvalidClockPoints++
			return nil
		}
		n := strconv.FormatInt(at.Sub(origin).Nanoseconds(), 10)
		return &n
	}
	for slot, r := range results {
		var last time.Time
		orderedPoint := func(at time.Time, reported bool) *string {
			result := point(at, reported)
			if result != nil {
				if !last.IsZero() && at.Before(last) {
					out.InvalidClockPoints++
					return nil
				}
				last = at
			}
			return result
		}
		row := monotonicObservationRow{Slot: slot, Index: r.Index, Round: r.Round, Hash: r.Hash}
		row.ScheduledNs = orderedPoint(r.scheduledMonotonic, r.ScheduledAt != nil)
		row.OfferedNs = orderedPoint(r.offerMonotonic, r.OfferedAt != nil)
		row.SubmittedNs = orderedPoint(r.submitMonotonic, r.SubmittedAt != nil)
		row.CheckTxNs = orderedPoint(r.checkTxMonotonic, r.CheckTxObservedAt != nil)
		row.IncludedNs = orderedPoint(r.includedMonotonic, r.IncludedObservedAt != nil)
		if qualifiedBusinessFinal(r) {
			row.FinalNs = orderedPoint(r.finalMonotonic, true)
		} else if !r.finalMonotonic.IsZero() {
			out.UnqualifiedFinalSlots++
		}
		out.Rows = append(out.Rows, row)
	}
	return out
}
