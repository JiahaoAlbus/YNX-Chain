package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cmt "github.com/cometbft/cometbft/types"
)

// This bounded completed-window reader recovers observations, never sends or
// signs. BFT/state verification remains the responsibility of offline replay.
func readCompletedTerminalResults(directory string, expected terminalStreamReport, binding readySenderJournalHeader, senders, total int) ([]transactionResult, error) {
	if senders < 1 || total < senders || total > maxTransactions || total%senders != 0 || expected.Poisoned || expected.Records != total || expected.DurableRecords != total || expected.Segments < 1 || expected.Segments > (total+terminalSegmentRecords-1)/terminalSegmentRecords || expected.Bytes < 1 || expected.Bytes > 16<<20 {
		return nil, errors.New("incomplete or unbounded terminal stream receipt")
	}
	absolute, err := filepath.Abs(directory)
	if err != nil {
		return nil, err
	}
	reported, err := filepath.Abs(expected.Directory)
	if err != nil || reported != absolute {
		return nil, errors.New("terminal evidence directory escaped expected output")
	}
	info, err := os.Lstat(absolute)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("terminal evidence must be an owned directory, not a symlink")
	}
	directoryFile, err := os.Open(absolute)
	if err != nil {
		return nil, err
	}
	entries, readErr := directoryFile.ReadDir(expected.Segments + 1)
	closeErr := directoryFile.Close()
	if readErr != nil && !errors.Is(readErr, io.EOF) {
		return nil, readErr
	}
	if closeErr != nil {
		return nil, closeErr
	}
	if len(entries) != expected.Segments {
		return nil, errors.New("terminal segment inventory differs from receipt")
	}
	decoder, err := newTerminalStreamDecoder(binding, senders)
	if err != nil {
		return nil, err
	}
	results := make([]transactionResult, total)
	seen := make([]bool, total)
	capturedBytes := 0
	for segment := 0; segment < expected.Segments; segment++ {
		name := filepath.Join(absolute, fmt.Sprintf("terminal-%06d.jsonl", segment))
		raw, err := captureTerminalSegment(name, int64((16<<20)-capturedBytes))
		if err != nil {
			return nil, err
		}
		capturedBytes += len(raw)
		if capturedBytes > 16<<20 {
			return nil, errors.New("terminal readback total byte bound")
		}
		rows, err := decoder.decode(raw)
		if err != nil {
			return nil, err
		}
		for _, r := range rows {
			if r.Index < 0 || r.Index >= total || seen[r.Index] {
				return nil, errors.New("terminal result duplicate/outside bounded workload")
			}
			raw, err := base64.StdEncoding.DecodeString(r.SignedTransaction)
			if err != nil || len(raw) == 0 {
				return nil, errors.New("terminal signed identity missing or invalid")
			}
			if err = verifySenderRound([]cmt.Tx{raw}, []transactionResult{r}); err != nil {
				return nil, fmt.Errorf("terminal row is not a reported complete final observation: %w", err)
			}
			seen[r.Index] = true
			results[r.Index] = r
		}
	}
	if decoder.sequence != total || capturedBytes != expected.Bytes || hex.EncodeToString(decoder.chain[:]) != expected.ChainSHA256 {
		return nil, errors.New("terminal stream count/bytes/final chain mismatch")
	}
	for _, present := range seen {
		if !present {
			return nil, errors.New("terminal result missing")
		}
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
