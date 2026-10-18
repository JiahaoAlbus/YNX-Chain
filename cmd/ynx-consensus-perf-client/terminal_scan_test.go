package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// Real signatures and files, synthetic final-observation flags. Never TPS,
// inclusion or finality evidence. No server, public account or socket is used.
func largeTerminalScanFixture(t *testing.T) (*terminalStream, int) {
	return terminalScanFixtureRounds(t, 704)
}

func terminalScanFixtureRounds(t *testing.T, rounds int) (*terminalStream, int) {
	t.Helper()
	p := terminalFixture(t)
	stream, err := newTerminalStream(filepath.Join(t.TempDir(), "terminal"), p)
	if err != nil {
		t.Fatal(err)
	}
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

// Matched read-only evidence processing, not business throughput. The old entry
// retains every exact row; the streaming consumer retains only its count/digest.
func TestTerminalStreamReadbackStreamingAllocationComparison(t *testing.T) {
	stream, total := terminalScanFixtureRounds(t, 682)
	if _, err := readCompletedTerminalResults(stream.report.Directory, stream.report, stream.binding, stream.senders, total); err != nil {
		t.Fatal(err)
	}
	if result, err := scanCompletedTerminalResults(context.Background(), stream.report.Directory, stream.report, stream.binding, stream.senders, total, 16<<20, func(transactionResult) error { return nil }); err != nil || !result.Complete {
		t.Fatal(result, err)
	}
	type sample struct {
		Mode                   string `json:"mode"`
		Records                int    `json:"records"`
		Digest                 string `json:"digest"`
		ElapsedNs              int64  `json:"elapsedNs"`
		AllocatedBytes         uint64 `json:"allocatedBytes"`
		RetainedHeapDeltaBytes int64  `json:"retainedHeapDeltaBytes"`
	}
	measure := func(streaming bool) sample {
		runtime.GC()
		var before, after runtime.MemStats
		runtime.ReadMemStats(&before)
		started := time.Now()
		hash := sha256.New()
		count := 0
		consume := func(row transactionResult) error {
			var index [8]byte
			binary.LittleEndian.PutUint64(index[:], uint64(row.Index))
			hash.Write(index[:])
			hash.Write([]byte(row.Hash))
			hash.Write([]byte(row.SignedTransaction))
			count++
			return nil
		}
		var held any
		mode := "legacy_full_retention"
		if streaming {
			mode = "streaming_count_and_digest"
			result, err := scanCompletedTerminalResults(context.Background(), stream.report.Directory, stream.report, stream.binding, stream.senders, total, 16<<20, consume)
			if err != nil || !result.Complete {
				t.Fatal(result, err)
			}
			held = result
		} else {
			rows, err := readCompletedTerminalResults(stream.report.Directory, stream.report, stream.binding, stream.senders, total)
			if err != nil {
				t.Fatal(err)
			}
			for _, row := range rows {
				if err := consume(row); err != nil {
					t.Fatal(err)
				}
			}
			held = rows
		}
		elapsed := time.Since(started).Nanoseconds()
		runtime.GC()
		runtime.ReadMemStats(&after)
		runtime.KeepAlive(held)
		return sample{mode, count, fmt.Sprintf("%x", hash.Sum(nil)), elapsed, after.TotalAlloc - before.TotalAlloc, int64(after.HeapAlloc) - int64(before.HeapAlloc)}
	}
	before, after := measure(false), measure(true)
	if before.Records != total || after.Records != total || before.Digest != after.Digest {
		t.Fatal("matched scanner observations differ", before, after)
	}
	raw, err := json.Marshal(struct{ Before, After sample }{before, after})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("matched_terminal_evidence_processing_not_business_tps=%s; one elapsed/heap sample, runtime noise included, not peak RSS", raw)
}
