package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// The retired receipt supplies only a bounded plan, never transaction outcomes.
type partialWindowPlan struct {
	Count            int
	Rounds           int
	SenderMode       string
	TerminalStream   bool
	ReuseResultSlots bool
}

func readPartialObservation(file string, plan partialWindowPlan, senders int) (report, []byte, bool, error) {
	var observed report
	info, err := os.Lstat(file)
	if os.IsNotExist(err) {
		if plan.Count != senders || senders < 1 || plan.Rounds < 2 || plan.Rounds > 32 || senders > maxTransactions/plan.Rounds || plan.SenderMode != "ready-pool" || !plan.TerminalStream || !plan.ReuseResultSlots {
			return observed, nil, false, errors.New("missing report requires explicit bounded ready-slot receipt plan")
		}
		return observed, nil, false, nil
	}
	if err != nil {
		return observed, nil, false, err
	}
	if !info.Mode().IsRegular() {
		return observed, nil, false, errors.New("partial observation report is not regular")
	}
	raw, err := readBounded(file, 16<<20)
	if err != nil {
		return observed, nil, false, err
	}
	after, err := os.Lstat(file)
	if err != nil || !os.SameFile(info, after) || info.Size() != int64(len(raw)) || after.Size() != int64(len(raw)) {
		return observed, nil, false, errors.New("partial observation report changed during capture")
	}
	if err = json.Unmarshal(raw, &observed); err != nil {
		return observed, nil, false, err
	}
	if observed.SenderMode != "ready-pool" {
		return observed, nil, false, errors.New("requires ready-pool observation report")
	}
	return observed, raw, true, nil
}

func TestTerminalStreamMissingReportUsesOnlyExplicitBoundedPlan(t *testing.T) {
	plan := partialWindowPlan{3, 32, "ready-pool", true, true}
	file := filepath.Join(t.TempDir(), "missing.json")
	observed, raw, present, err := readPartialObservation(file, plan, 3)
	if err != nil || present || raw != nil || len(observed.Transactions) != 0 || observed.RoundsRequested != 0 {
		t.Fatal("absence manufactured original observations", observed, present, err)
	}
	for _, invalid := range []partialWindowPlan{{3, 0, "ready-pool", true, true}, {3, 33, "ready-pool", true, true}, {2048, 32, "ready-pool", true, true}, {4, 32, "ready-pool", true, true}, {3, 32, "rounds", true, true}, {3, 32, "ready-pool", false, true}, {3, 32, "ready-pool", true, false}} {
		if _, _, _, err := readPartialObservation(file, invalid, 3); err == nil {
			t.Fatal("invalid missing-report plan accepted", invalid)
		}
	}
}

func TestTerminalStreamMissingReportDoesNotHideCorruptOrNonregularReport(t *testing.T) {
	plan := partialWindowPlan{3, 32, "ready-pool", true, true}
	file := filepath.Join(t.TempDir(), "report.json")
	if err := os.WriteFile(file, []byte("{"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := readPartialObservation(file, plan, 3); err == nil {
		t.Fatal("corrupt original report treated as absent")
	}
	link := filepath.Join(t.TempDir(), "report.json")
	if err := os.Symlink(file, link); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := readPartialObservation(link, plan, 3); err == nil {
		t.Fatal("symlink accepted")
	}
	if _, _, _, err := readPartialObservation(t.TempDir(), plan, 3); err == nil {
		t.Fatal("directory accepted")
	}
}

func TestTerminalStreamMissingReportPreservesExistingObservation(t *testing.T) {
	file := filepath.Join(t.TempDir(), "report.json")
	original := []byte(`{"senderMode":"ready-pool","roundsRequested":4}`)
	if err := os.WriteFile(file, original, 0600); err != nil {
		t.Fatal(err)
	}
	observed, raw, present, err := readPartialObservation(file, partialWindowPlan{}, 3)
	if err != nil || !present || string(raw) != string(original) || observed.RoundsRequested != 4 {
		t.Fatal("existing observation changed", observed, present, err)
	}
}

func TestTerminalStreamMissingReportReceiptPlanDecodes(t *testing.T) {
	var receipt struct {
		AllGroupsGone bool
		partialWindowPlan
	}
	if err := json.Unmarshal([]byte(`{"allGroupsGone":true,"count":3,"rounds":32,"senderMode":"ready-pool","terminalStream":true,"reuseResultSlots":true}`), &receipt); err != nil {
		t.Fatal(err)
	}
	if !receipt.AllGroupsGone || receipt.Count != 3 || receipt.Rounds != 32 || receipt.SenderMode != "ready-pool" || !receipt.TerminalStream || !receipt.ReuseResultSlots {
		t.Fatal("retired receipt lost its explicit plan", receipt)
	}
}

func TestTerminalStreamMissingReportStillRecoversSealedObservations(t *testing.T) {
	stream, intents, _ := terminalPrefixFixture(t, nil)
	observed, _, present, err := readPartialObservation(filepath.Join(t.TempDir(), "missing.json"), partialWindowPlan{3, 32, "ready-pool", true, true}, 3)
	if err != nil || present || len(observed.Transactions) != 0 {
		t.Fatal("unexpected original observations", err)
	}
	prefix, err := readTerminalPrefix(stream.report.Directory, stream.binding, 3, intents)
	if err != nil {
		t.Fatal(err)
	}
	merged, err := mergeTerminalPrefixAndLatest(prefix.Rows, make([]transactionResult, 3), 3, intents)
	if err != nil || len(merged) != len(intents) {
		t.Fatal("sealed observations lost without final report", len(merged), err)
	}
	for _, row := range merged {
		if row.Source != "sealed_prefix" {
			t.Fatal("invented latest observation", row.Source)
		}
	}
}
