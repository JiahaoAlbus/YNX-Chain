package main

import (
	"bytes"
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cmt "github.com/cometbft/cometbft/types"
)

// Local signatures and synthetic observation gates, not a network acceptance.
func terminalPrefixFixture(t *testing.T, change func(int, *transactionResult)) (*terminalStream, []cmt.Tx, []transactionResult) {
	t.Helper()
	path, manifest, m, migration, initial := senderFixture(t)
	p, err := loadSenderPool(path, manifest, m, migration, initial, 32)
	if err != nil {
		t.Fatal(err)
	}
	stream, err := newTerminalStream(filepath.Join(t.TempDir(), "terminal"), p)
	if err != nil {
		t.Fatal(err)
	}
	count := len(initial)
	intents := make([]cmt.Tx, 0, count*32)
	rows := make([]transactionResult, 0, count*32)
	for round := 0; round < 32; round++ {
		for sender := range initial {
			raw := p.pending[sender]
			if round > 0 {
				raw, err = p.nextForSender(sender, rows[(round-1)*count+sender])
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
			r.Index, r.Round = round*count+sender, round+1
			r.SignedTransaction = base64.StdEncoding.EncodeToString(raw)
			at := time.Now().UTC()
			r.SubmittedAt = &at
			intents = append(intents, raw)
			rows = append(rows, r)
			observation := r
			if change != nil {
				change(r.Index, &observation)
			}
			if err = stream.append(observation); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err = stream.close(); err != nil {
		t.Fatal(err)
	}
	return stream, intents, rows
}

func TestTerminalStreamPrefixStopsAtDamagedTailAndPreservesValidatedHistory(t *testing.T) {
	stream, intents, _ := terminalPrefixFixture(t, nil)
	tail := filepath.Join(stream.report.Directory, "terminal-000001.jsonl")
	original, err := os.ReadFile(tail)
	if err != nil {
		t.Fatal(err)
	}
	corrupt := original[:len(original)-5]
	if err = os.WriteFile(tail, corrupt, 0600); err != nil {
		t.Fatal(err)
	}
	prefix, err := readTerminalPrefix(stream.report.Directory, stream.binding, 3, intents)
	if err != nil || prefix.ValidatedSegments != 1 || prefix.ValidatedRecords != 64 || len(prefix.Rows) != 64 || prefix.Boundary == nil || prefix.Boundary.Segment != 1 || prefix.ReachedInventoryEnd {
		t.Fatal("bad tail skipped or whole prefix erased", prefix, err)
	}
	if prefix.ChainSHA256 == stream.report.ChainSHA256 || prefix.ValidatedBytes >= prefix.CapturedBytes {
		t.Fatal("unvalidated tail advanced watermarks", prefix)
	}
	after, err := os.ReadFile(tail)
	if err != nil || !bytes.Equal(after, corrupt) {
		t.Fatal("reader repaired original tail", err)
	}
}

func TestTerminalStreamPrefixDoesNotJumpAcrossMissingFirstSegment(t *testing.T) {
	stream, intents, _ := terminalPrefixFixture(t, nil)
	// Move only this private synthetic fixture file; real recovery never renames.
	first := filepath.Join(stream.report.Directory, "terminal-000000.jsonl")
	if err := os.Rename(first, filepath.Join(t.TempDir(), "preserved-first")); err != nil {
		t.Fatal(err)
	}
	prefix, err := readTerminalPrefix(stream.report.Directory, stream.binding, 3, intents)
	if err != nil || prefix.ValidatedRecords != 0 || prefix.Boundary == nil || prefix.Boundary.Kind != "segment_gap" {
		t.Fatal("missing prefix treated as complete", prefix, err)
	}
}

func TestTerminalStreamPrefixRejectsWholeSegmentOnUnboundIntent(t *testing.T) {
	stream, intents, _ := terminalPrefixFixture(t, nil)
	for i := 65; i < len(intents); i++ {
		intents[i] = nil
	}
	prefix, err := readTerminalPrefix(stream.report.Directory, stream.binding, 3, intents)
	if err != nil || prefix.ValidatedRecords != 64 || prefix.Boundary == nil || prefix.Boundary.Kind != "unbound_signed_intent" {
		t.Fatal("partial invalid segment published", prefix, err)
	}
}

func TestTerminalStreamPrefixCannotAdvanceQuarantinedSender(t *testing.T) {
	stream, intents, _ := terminalPrefixFixture(t, func(index int, r *transactionResult) {
		if index == 0 {
			r.Status = "submission_unknown"
		}
	})
	prefix, err := readTerminalPrefix(stream.report.Directory, stream.binding, 3, intents)
	if err != nil || prefix.ValidatedRecords != 0 || prefix.Boundary == nil || prefix.Boundary.Kind != "successor_after_nonfinal" {
		t.Fatal("UNKNOWN successor promoted or partial segment used", prefix, err)
	}
}

func TestTerminalStreamPrefixMissingDirectoryIsUnknownNotUnsubmitted(t *testing.T) {
	stream, intents, _ := terminalPrefixFixture(t, nil)
	prefix, err := readTerminalPrefix(filepath.Join(t.TempDir(), "absent"), stream.binding, 3, intents)
	if err != nil || len(prefix.Rows) != 0 || prefix.Boundary == nil || prefix.Boundary.Kind != "directory_absent" || prefix.ReachedInventoryEnd {
		t.Fatal("absence invented terminal outcomes", prefix, err)
	}
}

func TestTerminalStreamPrefixMergePreservesUnknownAndRejectsReplacement(t *testing.T) {
	_, intents, rows := terminalPrefixFixture(t, nil)
	unknown := rows[0]
	unknown.Status = "submission_unknown"
	latest := []transactionResult{unknown, rows[94], rows[95]}
	merged, err := mergeTerminalPrefixAndLatest([]transactionResult{unknown}, latest, 3, intents)
	if err != nil || len(merged) != 3 || merged[0].Result.Status != "submission_unknown" || merged[0].Source != "sealed_prefix+latest_slot" {
		t.Fatal("missing history filled or UNKNOWN lost", merged, err)
	}
	latest[0] = rows[0]
	if _, err = mergeTerminalPrefixAndLatest([]transactionResult{unknown}, latest, 3, intents); err == nil {
		t.Fatal("UNKNOWN replaced with confirmed")
	}
	if unknown.Status != "submission_unknown" {
		t.Fatal("input observation mutated")
	}
}

func TestTerminalStreamPrefixMergeRejectsLaterSlotAfterUnknown(t *testing.T) {
	_, intents, rows := terminalPrefixFixture(t, nil)
	unknown := rows[0]
	unknown.Status = "submission_unknown"
	latest := []transactionResult{rows[93], rows[94], rows[95]}
	if _, err := mergeTerminalPrefixAndLatest([]transactionResult{unknown}, latest, 3, intents); err == nil {
		t.Fatal("later slot advanced sender across an original UNKNOWN")
	}
}

func TestTerminalStreamPrefixReadsAllSealedSegments(t *testing.T) {
	stream, intents, _ := terminalPrefixFixture(t, nil)
	prefix, err := readTerminalPrefix(stream.report.Directory, stream.binding, 3, intents)
	if err != nil || prefix.Boundary != nil || !prefix.ReachedInventoryEnd || prefix.ValidatedRecords != len(intents) || prefix.ChainSHA256 != stream.report.ChainSHA256 {
		t.Fatal("valid sealed history lost", prefix, err)
	}
}
