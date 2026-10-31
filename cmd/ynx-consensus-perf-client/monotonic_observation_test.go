package main

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

// Controlled timestamps and synthetic result flags test the exporter only;
// weighted quorum and durable evidence remain the original observer's job.
func monotonicUnitResult(origin time.Time) transactionResult {
	zero := uint32(0)
	offer, submit, ack, included, final := origin.Add(10), origin.Add(20), origin.Add(30), origin.Add(40), origin.Add(50)
	offeredUTC, submittedUTC, ackUTC, includedUTC, finalUTC := offer.UTC(), submit.UTC(), ack.UTC(), included.UTC(), final.UTC()
	return transactionResult{Index: 7, Round: 2, Hash: "clock-fixture-not-proof", Status: "confirmed", offerMonotonic: offer, submitMonotonic: submit, checkTxMonotonic: ack, includedMonotonic: included, finalMonotonic: final, OfferedAt: &offeredUTC, SubmittedAt: &submittedUTC, CheckTxObservedAt: &ackUTC, IncludedObservedAt: &includedUTC, ConfirmedObservedAt: &finalUTC, CheckTxCode: &zero, CheckTxIdentityVerified: true, ExecutionCode: &zero, QuorumVerified: true, TransactionProofVerified: true, DurableStateVerified: true, DurableStateHeight: 1, Height: 1, DurableSnapshotSHA256: "unit-clock-fixture"}
}
func TestMonotonicObservationExportUsesActualClockAndOriginalFinalGate(t *testing.T) {
	origin := time.Now()
	row := monotonicUnitResult(origin)
	before := row
	out := captureMonotonicReport(origin, origin.Add(time.Second), []transactionResult{row})
	if out == nil || len(out.Rows) != 1 || *out.Rows[0].OfferedNs != "10" || *out.Rows[0].FinalNs != "50" || out.PhysicalCommitMeasured || out.LogicalGenerationMeasured || out.FixedWindowConfigured {
		t.Fatal("wrong actual observation projection", out)
	}
	if !reflect.DeepEqual(row, before) {
		t.Fatal("export mutated result")
	}
	row.QuorumVerified = false
	bad := captureMonotonicReport(origin, origin.Add(time.Second), []transactionResult{row})
	if bad.Rows[0].FinalNs != nil || bad.UnqualifiedFinalSlots != 1 {
		t.Fatal("clock point bypassed original finality gate")
	}
}
func TestMonotonicObservationExportNeverReconstructsUTCOrDropsMissingSlots(t *testing.T) {
	origin := time.Now()
	row := monotonicUnitResult(origin)
	row.offerMonotonic = time.Time{}
	row.submitMonotonic = row.submitMonotonic.UTC()
	row.finalMonotonic = origin.Add(2 * time.Second)
	out := captureMonotonicReport(origin, origin.Add(time.Second), []transactionResult{row, {}})
	if out == nil || len(out.Rows) != 2 || out.Rows[0].OfferedNs != nil || out.Rows[0].SubmittedNs != nil || out.Rows[0].FinalNs != nil || out.MissingClockPoints != 1 || out.InvalidClockPoints != 2 {
		t.Fatal("missing or wall clock invented monotonic sample", out)
	}
	if captureMonotonicReport(origin.UTC(), origin.Add(time.Second), []transactionResult{row}) != nil || captureMonotonicReport(origin, origin.Add(-1), nil) != nil {
		t.Fatal("invalid origin/cutoff accepted")
	}
	if captureMonotonicReport(origin, origin.Add(time.Second), make([]transactionResult, maxTransactions+1)) != nil {
		t.Fatal("export expanded original input cap")
	}
}
func TestMonotonicObservationExportKeepsExactNsAndPrivateOrigin(t *testing.T) {
	origin := time.Now()
	offset := time.Duration(9007199254740993)
	row := transactionResult{offerMonotonic: origin.Add(offset)}
	out := captureMonotonicReport(origin, origin.Add(offset+time.Second), []transactionResult{row})
	if *out.Rows[0].OfferedNs != "9007199254740993" {
		t.Fatal("ns rounded through floating point")
	}
	raw, err := json.Marshal(report{measurementOrigin: origin, MonotonicObservations: out})
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err = json.Unmarshal(raw, &fields); err != nil {
		t.Fatal(err)
	}
	if _, ok := fields["measurementOrigin"]; ok {
		t.Fatal("private Go origin exported as UTC authority")
	}
	if _, ok := fields["monotonicObservations"]; !ok {
		t.Fatal("normal report path omitted observation data")
	}
}

func TestMonotonicObservationCaptureOnGroupedObserver(t *testing.T) {
	g, _, jobs := groupedObservationFixture(t)
	if pending := g.step(context.Background(), jobs); len(pending) != 0 {
		t.Fatal("original signed-block observation stayed pending")
	}
	for _, job := range jobs {
		r := g.results[job.index]
		if !hasMonotonic(r.includedMonotonic) || !hasMonotonic(r.finalMonotonic) || r.finalMonotonic.Before(r.includedMonotonic) || !r.finalMonotonic.UTC().Equal(*r.ConfirmedObservedAt) {
			t.Fatal("actual grouped hook missing or backdated")
		}
	}
}
func TestMonotonicObservationCaptureOnPacedScheduler(t *testing.T) {
	origin := time.Now()
	rows := make([]transactionResult, 2)
	runPacedTransactions(context.Background(), options{concurrency: 1, observers: 1, offeredRate: 1000}, origin, rows, func(i int) (time.Time, bool) { return time.Now(), false }, func(int, time.Time) { t.Fatal("unaccepted fixture was observed") })
	for i, r := range rows {
		want := origin.Add(time.Duration(i) * time.Millisecond)
		if !hasMonotonic(r.scheduledMonotonic) || !r.scheduledMonotonic.Equal(want) || !hasMonotonic(r.offerMonotonic) {
			t.Fatal("actual pacing clock lost", i)
		}
	}
}
func TestMonotonicObservationExportWithholdsReversedPoint(t *testing.T) {
	origin := time.Now()
	row := monotonicUnitResult(origin)
	row.finalMonotonic = origin.Add(15)
	out := captureMonotonicReport(origin, origin.Add(time.Second), []transactionResult{row})
	if out.Rows[0].FinalNs != nil || out.InvalidClockPoints != 1 {
		t.Fatal("reversed final observation exported")
	}
}
