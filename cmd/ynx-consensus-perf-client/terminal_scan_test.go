package main

import (
	"context"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// Real signatures and files, synthetic final-observation flags. Never TPS,
// inclusion or finality evidence. No server, public account or socket is used.
func largeTerminalScanFixture(t *testing.T) (*terminalStream, int) {
	t.Helper()
	p := terminalFixture(t)
	stream, err := newTerminalStream(filepath.Join(t.TempDir(), "terminal"), p)
	if err != nil {
		t.Fatal(err)
	}
	const rounds = 704
	for round := 1; round <= rounds; round++ {
		for sender, template := range p.templates {
			tx, err := consensus.NewSignedTransfer(p.keys[sender], template.ChainID, template.To, template.Amount, uint64(round))
			if err != nil {
				t.Fatal(err)
			}
			raw, err := consensus.EncodeSignedTransaction(tx)
			if err != nil {
				t.Fatal(err)
			}
			row := gateResult(raw, int64(round+2))
			row.Index = (round-1)*len(p.pending) + sender
			row.Round = round
			row.Bytes = len(raw)
			row.SignedTransaction = base64.StdEncoding.EncodeToString(raw)
			if err := stream.append(row); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := stream.close(); err != nil {
		t.Fatal(err)
	}
	return stream, len(p.pending) * rounds
}

func TestTerminalStreamReadbackStreamingBeyondLegacyLimitKeepsExactIdentities(t *testing.T) {
	stream, total := largeTerminalScanFixture(t)
	if total <= maxTransactions {
		t.Fatal("fixture did not cross existing limit")
	}
	if _, err := readCompletedTerminalResults(stream.report.Directory, stream.report, stream.binding, stream.senders, total); err == nil {
		t.Fatal("legacy completed-window limit changed")
	}
	next := make([]int, stream.senders)
	calls := 0
	result, err := scanCompletedTerminalResults(context.Background(), stream.report.Directory, stream.report, stream.binding, stream.senders, total, 16<<20, func(r transactionResult) error {
		sender := r.Index % stream.senders
		next[sender]++
		if r.Round != next[sender] {
			t.Fatal("streamed order differs")
		}
		signed, err := base64.StdEncoding.DecodeString(r.SignedTransaction)
		if err != nil {
			t.Fatal(err)
		}
		tx, err := consensus.DecodeSignedTransaction(signed)
		if err != nil || tx.Verify(6423) != nil || int(tx.Nonce) != r.Round {
			t.Fatal("original signed nonce changed", err)
		}
		calls++
		return nil
	})
	if err != nil || !result.Complete || calls != total || result.Records != total || result.Bytes != int64(stream.report.Bytes) || result.ChainSHA256 != stream.report.ChainSHA256 {
		t.Fatal("full stream differs", result, err)
	}
	t.Logf("real_signature_synthetic_observation_stream records=%d segments=%d bytes=%d; no business TPS claimed", result.Records, result.Segments, result.Bytes)
}

func TestTerminalStreamReadbackStreamingFailureNeverCompletesOrRepairs(t *testing.T) {
	work, stream, _, _, _ := terminalReadbackFixture(t)
	sentinel := errors.New("consumer stopped")
	calls := 0
	got, err := scanCompletedTerminalResults(context.Background(), stream.report.Directory, stream.report, stream.binding, 3, 6, 16<<20, func(transactionResult) error { calls++; return sentinel })
	if !errors.Is(err, sentinel) || got.Complete || calls != 1 || got.Records != 0 {
		t.Fatal("callback failure promoted", got, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	calls = 0
	got, err = scanCompletedTerminalResults(ctx, stream.report.Directory, stream.report, stream.binding, 3, 6, 16<<20, func(transactionResult) error { calls++; return nil })
	if !errors.Is(err, context.Canceled) || got.Complete || calls != 0 {
		t.Fatal("cancelled scan advanced", got, err)
	}
	file := filepath.Join(stream.report.Directory, "terminal-000000.jsonl")
	raw, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	bad := raw[:len(raw)-5]
	if err := os.WriteFile(file, bad, 0600); err != nil {
		t.Fatal(err)
	}
	got, err = scanCompletedTerminalResults(context.Background(), stream.report.Directory, stream.report, stream.binding, 3, 6, 16<<20, func(transactionResult) error { return nil })
	after, readErr := os.ReadFile(file)
	if err == nil || got.Complete || readErr != nil || string(after) != string(bad) {
		t.Fatal("corrupt seal accepted or repaired", got, err)
	}
	alias := filepath.Join(work, "alias")
	if err := os.Symlink(stream.report.Directory, alias); err != nil {
		t.Fatal(err)
	}
	receipt := stream.report
	receipt.Directory = alias
	if got, err = scanCompletedTerminalResults(context.Background(), alias, receipt, stream.binding, 3, 6, 16<<20, func(transactionResult) error { return nil }); err == nil || got.Complete {
		t.Fatal("symlink evidence accepted")
	}
}

func TestTerminalStreamReadbackStreamingLaterCorruptionRetainsPrefixOnly(t *testing.T) {
	stream, total := largeTerminalScanFixture(t)
	file := filepath.Join(stream.report.Directory, "terminal-000001.jsonl")
	raw, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	bad := raw[:len(raw)-5]
	if err := os.WriteFile(file, bad, 0600); err != nil {
		t.Fatal(err)
	}
	calls := 0
	got, err := scanCompletedTerminalResults(context.Background(), stream.report.Directory, stream.report, stream.binding, stream.senders, total, 16<<20, func(transactionResult) error { calls++; return nil })
	if err == nil || got.Complete || got.Records != terminalSegmentRecords || calls != terminalSegmentRecords || got.CapturedBytes <= got.Bytes {
		t.Fatal("later corruption promoted full stream", got, err)
	}
	after, readErr := os.ReadFile(file)
	if readErr != nil || string(after) != string(bad) {
		t.Fatal("reader changed corrupt evidence", readErr)
	}
}

func TestTerminalStreamReadbackStreamingInventoryMutationWithholdsCompletion(t *testing.T) {
	_, stream, _, _, _ := terminalReadbackFixture(t)
	changed := false
	got, err := scanCompletedTerminalResults(context.Background(), stream.report.Directory, stream.report, stream.binding, 3, 6, 16<<20, func(transactionResult) error {
		if !changed {
			changed = true
			return os.WriteFile(filepath.Join(stream.report.Directory, "unexpected-file"), []byte("retained"), 0600)
		}
		return nil
	})
	if err == nil || got.Complete || !changed {
		t.Fatal("changed evidence inventory accepted", got, err)
	}
	if _, err := os.Stat(filepath.Join(stream.report.Directory, "unexpected-file")); err != nil {
		t.Fatal("reader removed unexpected evidence", err)
	}
}
