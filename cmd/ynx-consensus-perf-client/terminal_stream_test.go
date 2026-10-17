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
	"strings"
	"sync/atomic"
	"testing"
	"time"

	cmt "github.com/cometbft/cometbft/types"
)

func terminalFixture(t *testing.T) *ephemeralSenderPool {
	t.Helper()
	path, manifest, m, migration, initial := senderFixture(t)
	p, err := loadSenderPool(path, manifest, m, migration, initial, 2)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestTerminalStreamSealedSegmentsRetainExactResultsAndChain(t *testing.T) {
	p := terminalFixture(t)
	stream, err := newTerminalStream(filepath.Join(t.TempDir(), "terminal"), p)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = newTerminalStream(stream.report.Directory, p); err == nil {
		t.Fatal("existing evidence directory reused")
	}
	const count = 130
	originals := make([]transactionResult, count)
	for i := range originals {
		originals[i] = transactionResult{Index: i, Round: i/stream.senders + 1, Status: "submission_unknown", Hash: strings.Repeat("A", 64), Errors: []errorObservation{}}
		if err = stream.append(originals[i]); err != nil {
			t.Fatal(err)
		}
		if len(stream.pending) >= terminalSegmentRecords {
			t.Fatal("unbounded pending rows")
		}
	}
	if stream.report.DurableRecords != 128 || stream.report.Records != 130 {
		t.Fatal("durable watermark claims unflushed records", stream.report)
	}
	if err = stream.close(); err != nil {
		t.Fatal(err)
	}
	if stream.report.Segments != 3 || stream.report.DurableRecords != count || stream.report.Poisoned {
		t.Fatal(stream.report)
	}
	var chain [32]byte
	sequence := 0
	files, err := filepath.Glob(filepath.Join(stream.report.Directory, "*.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	for segment, file := range files {
		raw, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		lines := bytes.Split(bytes.TrimSuffix(raw, []byte{'\n'}), []byte{'\n'})
		var header terminalStreamHeader
		if err = json.Unmarshal(lines[0], &header); err != nil {
			t.Fatal(err)
		}
		if header.Segment != segment || header.FirstSequence != sequence || header.PreviousSHA256 != hex.EncodeToString(chain[:]) || header.Fixture.ManifestSHA256 != p.manifestSHA256 || header.Fixture.GenesisHash != p.genesisHash || header.Fixture.MigrationHash != p.migrationHash {
			t.Fatal("segment detached from exact fixture/prefix")
		}
		for _, line := range lines[1 : len(lines)-1] {
			var row terminalStreamRow
			if err = json.Unmarshal(line, &row); err != nil {
				t.Fatal(err)
			}
			want, err := json.Marshal(originals[sequence])
			if err != nil {
				t.Fatal(err)
			}
			if row.Sequence != sequence || row.PreviousSHA256 != hex.EncodeToString(chain[:]) || !bytes.Equal(want, row.Result) {
				t.Fatal("result changed, reordered or chain broken")
			}
			chain = sha256.Sum256(line)
			sequence++
		}
		var seal struct {
			Kind        string
			Records     int
			ChainSHA256 string
		}
		if err = json.Unmarshal(lines[len(lines)-1], &seal); err != nil {
			t.Fatal(err)
		}
		if seal.Kind != "YNX_LOCAL_TERMINAL_SEAL_V1" || seal.Records != len(lines)-2 || seal.ChainSHA256 != hex.EncodeToString(chain[:]) {
			t.Fatal("invalid segment seal")
		}
		info, err := os.Stat(file)
		if err != nil || info.Mode().Perm() != 0600 {
			t.Fatal("terminal evidence permissions", err)
		}
	}
	if sequence != count || stream.report.ChainSHA256 != hex.EncodeToString(chain[:]) {
		t.Fatal("lost terminal records")
	}
	if err = stream.append(originals[0]); err == nil {
		t.Fatal("closed stream accepted another result")
	}
}

func TestTerminalStreamPoisonedWritesNeverAdvanceDurableWatermark(t *testing.T) {
	for _, kind := range []string{"write", "sync", "duplicate", "oversize"} {
		t.Run(kind, func(t *testing.T) {
			stream, err := newTerminalStream(filepath.Join(t.TempDir(), "terminal"), terminalFixture(t))
			if err != nil {
				t.Fatal(err)
			}
			writes := 0
			stream.persist = func(name string, raw []byte) error { writes++; return errors.New("injected " + kind + " failure") }
			row := transactionResult{Index: 0, Round: 1, Status: "timeout"}
			if kind == "oversize" {
				row.CheckTxLog = strings.Repeat("x", terminalRowLimit)
			}
			err = stream.append(row)
			if kind == "duplicate" && err == nil {
				err = stream.append(row)
			}
			if (kind == "write" || kind == "sync") && err == nil {
				err = stream.close()
			}
			if err == nil || !stream.report.Poisoned || stream.report.DurableRecords != 0 || stream.report.Segments != 0 {
				t.Fatal("failed I/O promoted as durable", stream.report, err)
			}
			before := writes
			if stream.append(transactionResult{Index: 1, Round: 1}) == nil {
				t.Fatal("poisoned stream resumed")
			}
			if writes != before {
				t.Fatal("automatic write retry")
			}
		})
	}
}

// Synthetic confirmation flags exercise controller ownership only. They do not
// claim actual network consensus or replace existing real execution tests.
func TestReadySenderTerminalStreamFailureStopsSuccessorSigning(t *testing.T) {
	p := terminalFixture(t)
	count := len(p.pending)
	results := readyResults(count)
	txs := make([]cmt.Tx, len(results))
	var submits atomic.Int64
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, err := runReadySenderPool(ctx, options{rounds: 2, offeredRate: 2048, concurrency: 4, observers: 4, terminalSink: func(transactionResult) error { return errors.New("terminal disk sync failed") }}, p, txs, results,
		func(index int) (time.Time, bool) {
			submits.Add(1)
			if index >= count {
				t.Error("successor dispatched after terminal evidence failed")
			}
			return time.Now(), true
		},
		func(_ int, queue <-chan acceptedObservation, terminal func(int)) {
			for job := range queue {
				gate := gateResult(txs[job.index], 10)
				gate.Index, gate.Round = job.index, 1
				results[job.index] = gate
				terminal(job.index)
			}
		})
	if err == nil || !strings.Contains(err.Error(), "terminal disk sync failed") || submits.Load() > int64(count) {
		t.Fatal("sink failure ignored", err, submits.Load())
	}
	for _, tx := range p.templates {
		if tx.Nonce != 1 {
			t.Fatal("signed successor after sink failure")
		}
	}
}

func TestTerminalStreamExclusiveSegmentFailurePreservesExistingEvidence(t *testing.T) {
	stream, err := newTerminalStream(filepath.Join(t.TempDir(), "terminal"), terminalFixture(t))
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(stream.report.Directory, "terminal-000000.jsonl")
	original := []byte("preserve uncertain existing evidence\n")
	if err = os.WriteFile(file, original, 0600); err != nil {
		t.Fatal(err)
	}
	if err = stream.append(transactionResult{Index: 0, Round: 1, Status: "submission_unknown"}); err != nil {
		t.Fatal(err)
	}
	if err = stream.close(); err == nil || !stream.report.Poisoned || stream.report.DurableRecords != 0 {
		t.Fatal("existing segment replaced", err)
	}
	actual, err := os.ReadFile(file)
	if err != nil || !bytes.Equal(original, actual) {
		t.Fatal("existing evidence changed", err)
	}
}

func TestTerminalStreamDecoderRejectsCorruptionWithoutAdvancingPrefix(t *testing.T) {
	stream, err := newTerminalStream(filepath.Join(t.TempDir(), "terminal"), terminalFixture(t))
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 65; i++ {
		if err = stream.append(transactionResult{Index: i, Round: i/stream.senders + 1, Status: "submission_unknown"}); err != nil {
			t.Fatal(err)
		}
	}
	if err = stream.close(); err != nil {
		t.Fatal(err)
	}
	first, err := os.ReadFile(filepath.Join(stream.report.Directory, "terminal-000000.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	second, err := os.ReadFile(filepath.Join(stream.report.Directory, "terminal-000001.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	decoder, err := newTerminalStreamDecoder(stream.binding, stream.senders)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = decoder.decode(second); err == nil || decoder.sequence != 0 {
		t.Fatal("out of order segment accepted")
	}
	lines := bytes.Split(first, []byte{'\n'})
	wrongStatus := bytes.Replace(first, []byte("submission_unknown"), []byte("confirmed"), 1)
	wrongBinding := bytes.Replace(first, []byte(stream.binding.ManifestSHA256), []byte(strings.Repeat("0", len(stream.binding.ManifestSHA256))), 1)
	duplicate := append([][]byte(nil), lines...)
	duplicate[2] = duplicate[1]
	dropped := append([][]byte{lines[0]}, lines[2:]...)
	cases := [][]byte{first[:len(first)-1], bytes.Join(lines[:len(lines)-2], []byte{'\n'}), wrongStatus, wrongBinding, bytes.Join(duplicate, []byte{'\n'}), bytes.Join(dropped, []byte{'\n'})}
	for _, raw := range cases {
		if _, err = decoder.decode(raw); err == nil || decoder.sequence != 0 || decoder.segment != 0 {
			t.Fatal("corruption accepted or invalid prefix retained", err)
		}
	}
	rows, err := decoder.decode(first)
	if err != nil || len(rows) != 64 {
		t.Fatal("valid original prefix rejected", err)
	}
	if _, err = decoder.decode(first); err == nil || decoder.sequence != 64 {
		t.Fatal("segment replay advanced prefix")
	}
	rows, err = decoder.decode(second)
	if err != nil || len(rows) != 1 || decoder.sequence != 65 || hex.EncodeToString(decoder.chain[:]) != stream.report.ChainSHA256 {
		t.Fatal("final prefix differs", err)
	}
}
