package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// This bounded completed-window reader recovers observations, never sends or
// signs. BFT/state verification remains the responsibility of offline replay.
func readCompletedTerminalResults(directory string, expected terminalStreamReport, binding readySenderJournalHeader, senders, total int) ([]transactionResult, error) {
	if senders < 1 || total < senders || total > maxTransactions || total%senders != 0 || expected.Poisoned || expected.Records != total || expected.DurableRecords != total || expected.Segments < 1 || expected.Segments > (total+terminalSegmentRecords-1)/terminalSegmentRecords || expected.Bytes < 1 || expected.Bytes > 16<<20 {
		return nil, errors.New("incomplete or unbounded terminal stream receipt")
	}
	results := make([]transactionResult, total)
	_, err := scanCompletedTerminalResults(context.Background(), directory, expected, binding, senders, total, 16<<20, func(r transactionResult) error { results[r.Index] = r; return nil })
	if err != nil {
		return nil, err
	}
	return results, nil
}

// Only complete schema12/13 slot reports use this path. It does not relax old
// complete-window gates or promote partial/UNKNOWN outcomes after recovery.
func restoreCompletedSlotReport(work string, manifestRaw []byte, m consensus.EphemeralNetworkManifest, r *report, senders int) error {
	if r.RetentionMode == "" {
		return nil
	}
	if (r.SchemaVersion != 12 && r.SchemaVersion != 13) || r.RetentionMode != "latest_per_account_slots" || r.SenderMode != "ready-pool" || r.RoundsRequested < 2 || r.RoundsRequested > 32 || senders < 1 || senders > maxTransactions/r.RoundsRequested || r.RoundsCompleted != r.RoundsRequested || r.ReadySenders.Quarantined != 0 || len(r.Transactions) != senders || r.TerminalStream == nil || r.ReadySenders.BoundedSummary == nil {
		return errors.New("not a complete bounded slot report")
	}
	total := senders * r.RoundsRequested
	cumulative := r.ReadySenders.BoundedSummary
	if r.Summary.Input != total || r.Summary.FinalSubmitted != total || cumulative.TerminalRecords != total || cumulative.InvalidLatencyRecords != 0 || cumulative.Counts.Input != total || cumulative.Counts.FinalSubmitted != total || r.ReadySenders.Completed != total {
		return errors.New("slot report lacks complete cumulative finality")
	}
	sum := sha256.Sum256(manifestRaw)
	binding := readySenderJournalHeader{"YNX_LOCAL_READY_SENDER_V1", hex.EncodeToString(sum[:]), m.MigrationStateHash, m.GenesisHash}
	rows, err := readCompletedTerminalResults(filepath.Join(work, "transactions-result.json.terminal-stream"), *r.TerminalStream, binding, senders, total)
	if err != nil {
		return err
	}
	// The last slots must exactly match the corresponding original terminal rows;
	// no status, proof, signed payload or recorded latency is replaced or invented.
	for sender, latest := range r.Transactions {
		index := (r.RoundsRequested-1)*senders + sender
		expected, err := json.Marshal(rows[index])
		if err != nil {
			return err
		}
		actual, err := json.Marshal(latest)
		if err != nil || !bytes.Equal(actual, expected) {
			return errors.New("latest slot differs from terminal history")
		}
	}
	r.Transactions = rows
	return nil
}

func captureTerminalSegment(name string, budget int64) ([]byte, error) {
	limit := int64(terminalSegmentRecords*(terminalRowLimit+1) + 8192)
	if budget < limit {
		limit = budget
	}
	if limit <= 0 {
		return nil, errors.New("terminal readback byte budget exhausted")
	}
	before, err := os.Lstat(name)
	if err != nil {
		return nil, err
	}
	if !before.Mode().IsRegular() {
		return nil, errors.New("terminal segment is not a regular file")
	}
	raw, err := readBounded(name, limit)
	if err != nil {
		return nil, err
	}
	after, err := os.Lstat(name)
	if err != nil || !os.SameFile(before, after) || before.Size() != int64(len(raw)) || after.Size() != int64(len(raw)) {
		return nil, errors.New("terminal segment changed while captured")
	}
	return raw, nil
}
