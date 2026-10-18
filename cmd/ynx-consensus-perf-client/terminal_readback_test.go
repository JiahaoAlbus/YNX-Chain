package main

import (
	"bytes"
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// Real fixture signatures, synthetic observation flags: not network evidence.
func terminalReadbackFixture(t *testing.T) (string, *terminalStream, []transactionResult, []byte, consensus.EphemeralNetworkManifest) {
	t.Helper()
	path, manifest, m, migration, initial := senderFixture(t)
	p, err := loadSenderPool(path, manifest, m, migration, initial, 2)
	if err != nil {
		t.Fatal(err)
	}
	work := t.TempDir()
	stream, err := newTerminalStream(filepath.Join(work, "transactions-result.json.terminal-stream"), p)
	if err != nil {
		t.Fatal(err)
	}
	results := make([]transactionResult, 0, len(initial)*2)
	for round := 0; round < 2; round++ {
		for sender := range initial {
			raw := p.pending[sender]
			if round > 0 {
				raw, err = p.nextForSender(sender, results[sender])
				if err != nil {
					t.Fatal(err)
				}
				tx, e := consensus.DecodeSignedTransaction(raw)
				if e != nil {
					t.Fatal(e)
				}
				p.pending[sender], p.templates[sender] = raw, tx
			}
			r := gateResult(raw, int64(round+3))
			r.Index, r.Round = round*len(initial)+sender, round+1
			r.SignedTransaction = base64.StdEncoding.EncodeToString(raw)
			r.Bytes = len(raw)
			at := time.Now().UTC()
			r.OfferedAt, r.SubmittedAt = &at, &at
			if err = stream.append(r); err != nil {
				t.Fatal(err)
			}
			results = append(results, r)
		}
	}
	if err = stream.close(); err != nil {
		t.Fatal(err)
	}
	return work, stream, results, manifest, m
}

func TestTerminalStreamReadbackRestoresCompleteReportWithoutChangingObservations(t *testing.T) {
	work, stream, rows, manifest, m := terminalReadbackFixture(t)
	r := report{SchemaVersion: 12, RetentionMode: "latest_per_account_slots", SenderMode: "ready-pool", RoundsRequested: 2, RoundsCompleted: 2, Transactions: append([]transactionResult(nil), rows[3:]...), TerminalStream: &stream.report, Summary: summary{Input: 6, FinalSubmitted: 6}, ReadySenders: readySenderStats{Completed: 6, BoundedSummary: &readyCumulativeReport{TerminalRecords: 6, Counts: summary{Input: 6, FinalSubmitted: 6}}}}
	if err := restoreCompletedSlotReport(work, manifest, m, &r, 3); err != nil {
		t.Fatal(err)
	}
	if len(r.Transactions) != len(rows) {
		t.Fatal("only latest slots recovered")
	}
	for i, row := range r.Transactions {
		if row.Index != rows[i].Index || row.Hash != rows[i].Hash || row.SignedTransaction != rows[i].SignedTransaction || row.Status != rows[i].Status || !row.ConfirmedObservedAt.Equal(*rows[i].ConfirmedObservedAt) {
			t.Fatal("original observation replaced or invented")
		}
	}
	// A second restoration of an already expanded report is rejected, not replayed.
	if restoreCompletedSlotReport(work, manifest, m, &r, 3) == nil {
		t.Fatal("expanded result misclassified as fresh latest slots")
	}
}

func TestTerminalStreamReadbackRejectsReceiptAndPathSubstitution(t *testing.T) {
	work, stream, _, _, _ := terminalReadbackFixture(t)
	file := filepath.Join(stream.report.Directory, "terminal-000000.jsonl")
	original, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*terminalStreamReport){func(r *terminalStreamReport) { r.Poisoned = true }, func(r *terminalStreamReport) { r.DurableRecords-- }, func(r *terminalStreamReport) { r.Bytes++ }, func(r *terminalStreamReport) { r.ChainSHA256 = "wrong" }, func(r *terminalStreamReport) { r.Directory = work }, func(r *terminalStreamReport) { r.Segments++ }} {
		r := stream.report
		mutate(&r)
		if _, err = readCompletedTerminalResults(stream.report.Directory, r, stream.binding, 3, 6); err == nil {
			t.Fatal("substituted receipt accepted")
		}
	}
	alias := filepath.Join(work, "alias")
	if err = os.Symlink(stream.report.Directory, alias); err != nil {
		t.Fatal(err)
	}
	r := stream.report
	r.Directory = alias
	if _, err = readCompletedTerminalResults(alias, r, stream.binding, 3, 6); err == nil {
		t.Fatal("symlink evidence accepted")
	}
	after, err := os.ReadFile(file)
	if err != nil || !bytes.Equal(original, after) {
		t.Fatal("readback changed original evidence", err)
	}
}

func TestTerminalStreamReadbackRejectsIncompleteTailWithoutRepair(t *testing.T) {
	_, stream, _, _, _ := terminalReadbackFixture(t)
	file := filepath.Join(stream.report.Directory, "terminal-000000.jsonl")
	original, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	corrupt := original[:len(original)-5]
	if err = os.WriteFile(file, corrupt, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = readCompletedTerminalResults(stream.report.Directory, stream.report, stream.binding, 3, 6); err == nil {
		t.Fatal("truncated terminal evidence accepted")
	}
	after, err := os.ReadFile(file)
	if err != nil || !bytes.Equal(corrupt, after) {
		t.Fatal("reader repaired or removed uncertain tail", err)
	}
}

func TestTerminalStreamReadbackRejectsChangedLatestSlot(t *testing.T) {
	work, stream, rows, manifest, m := terminalReadbackFixture(t)
	r := report{SchemaVersion: 12, RetentionMode: "latest_per_account_slots", SenderMode: "ready-pool", RoundsRequested: 2, RoundsCompleted: 2, Transactions: append([]transactionResult(nil), rows[3:]...), TerminalStream: &stream.report, Summary: summary{Input: 6, FinalSubmitted: 6}, ReadySenders: readySenderStats{Completed: 6, BoundedSummary: &readyCumulativeReport{TerminalRecords: 6, Counts: summary{Input: 6, FinalSubmitted: 6}}}}
	r.Transactions[0].Status = "submission_unknown"
	if err := restoreCompletedSlotReport(work, manifest, m, &r, 3); err == nil || len(r.Transactions) != 3 || r.Transactions[0].Status != "submission_unknown" {
		t.Fatal("latest slot changed or uncertain status promoted", err)
	}
}

func TestTerminalStreamReadbackRelativeOutputSurvivesWorkingDirectoryChange(t *testing.T) {
	p := terminalFixture(t)
	t.Chdir(t.TempDir())
	stream, err := newTerminalStream("relative-terminal", p)
	if err != nil {
		t.Fatal(err)
	}
	for i, raw := range p.pending {
		r := gateResult(raw, 3)
		r.Index, r.Round = i, 1
		r.SignedTransaction = base64.StdEncoding.EncodeToString(raw)
		if err = stream.append(r); err != nil {
			t.Fatal(err)
		}
	}
	if err = stream.close(); err != nil {
		t.Fatal(err)
	}
	if !filepath.IsAbs(stream.report.Directory) {
		t.Fatal("receipt depends on original working directory")
	}
	t.Chdir(t.TempDir())
	rows, err := readCompletedTerminalResults(stream.report.Directory, stream.report, stream.binding, len(p.pending), len(p.pending))
	if err != nil || len(rows) != len(p.pending) {
		t.Fatal("offline reader cannot resolve original evidence", err)
	}
}

func TestTerminalStreamReadbackKeepsSchema13TimingQualificationAndRejectsUnknownSchema(t *testing.T) {
	work, stream, rows, manifest, m := terminalReadbackFixture(t)
	makeReport := func(version int) report {
		return report{SchemaVersion: version, RetentionMode: "latest_per_account_slots", SenderMode: "ready-pool", RoundsRequested: 2, RoundsCompleted: 2, Transactions: append([]transactionResult(nil), rows[3:]...), TerminalStream: &stream.report, Summary: summary{Input: 6, FinalSubmitted: 6}, ReadySenders: readySenderStats{Completed: 6, BoundedSummary: &readyCumulativeReport{TerminalRecords: 6, Counts: summary{Input: 6, FinalSubmitted: 6}, TimeSeries: &readyTimelineReport{Valid: false, InvalidRows: 1}}}}
	}
	r := makeReport(13)
	if err := restoreCompletedSlotReport(work, manifest, m, &r, 3); err != nil {
		t.Fatal(err)
	}
	if len(r.Transactions) != 6 || r.ReadySenders.BoundedSummary.TimeSeries.Valid || r.ReadySenders.BoundedSummary.TimeSeries.InvalidRows != 1 {
		t.Fatal("readback invented a timing qualification")
	}
	unknown := makeReport(14)
	if restoreCompletedSlotReport(work, manifest, m, &unknown, 3) == nil {
		t.Fatal("unknown future schema accepted")
	}
}
