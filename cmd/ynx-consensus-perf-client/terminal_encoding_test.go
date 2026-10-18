package main

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	cmttypes "github.com/cometbft/cometbft/types"
)

func TestTerminalGzipKeepsExactRowsWithinOriginalByteBudget(t *testing.T) {
	p := terminalFixture(t)
	var reports [2]terminalStreamReport
	for mode := 0; mode < 2; mode++ {
		s, err := newTerminalStream(filepath.Join(t.TempDir(), "terminal"), p)
		if err != nil {
			t.Fatal(err)
		}
		if mode == 1 {
			s.report.Encoding = "gzip"
		}
		for i := 0; i < 130; i++ {
			r := transactionResult{Index: i, Round: i/s.senders + 1, Status: "submission_unknown", Hash: strings.Repeat("A", 64), Errors: []errorObservation{}}
			if err = s.append(r); err != nil {
				t.Fatal(err)
			}
		}
		if err = s.close(); err != nil {
			t.Fatal(err)
		}
		reports[mode] = s.report
		d, err := newTerminalStreamDecoder(s.binding, s.senders)
		if err != nil {
			t.Fatal(err)
		}
		physical, count := 0, 0
		for segment := 0; segment < s.report.Segments; segment++ {
			name := filepath.Join(s.report.Directory, fmtTerminalName(segment))
			raw, err := os.ReadFile(name)
			if err != nil {
				t.Fatal(err)
			}
			physical += len(raw)
			if mode == 1 {
				bad := append([]byte(nil), raw...)
				bad[len(bad)-8] ^= 1
				if _, err = d.decodeStored(bad, "gzip"); err == nil || d.sequence != count || d.segment != segment {
					t.Fatal("corrupt compressed segment advanced prefix", d.sequence, d.segment, err)
				}
			}
			rows, err := d.decodeStored(raw, s.report.Encoding)
			if err != nil {
				t.Fatal(err)
			}
			for _, r := range rows {
				if r.Index != count || r.Status != "submission_unknown" || qualifiedBusinessFinal(r) {
					t.Fatal("compressed observation changed or upgraded", r.Index, r.Status)
				}
				count++
			}
		}
		if count != 130 || physical != s.report.Bytes {
			t.Fatal("physical byte/row accounting drift", physical, s.report)
		}
	}
	if reports[0].ChainSHA256 != reports[1].ChainSHA256 || reports[1].Bytes >= reports[0].Bytes || reports[1].CompressionNs <= 0 {
		t.Fatal("lossless compression/chain mismatch", reports)
	}
}

func fmtTerminalName(segment int) string { return fmt.Sprintf("terminal-%06d.jsonl", segment) }

func TestTerminalGzipRefusesBombTrailingMembersCorruptionAndLegacyMislabel(t *testing.T) {
	raw := []byte("exact original payload\n")
	encoded, err := encodeTerminalSegment(raw, "gzip")
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := decodeTerminalSegment(encoded, "gzip")
	if err != nil || !bytes.Equal(raw, decoded) {
		t.Fatal(err)
	}
	var bomb bytes.Buffer
	w := gzip.NewWriter(&bomb)
	_, _ = w.Write(bytes.Repeat([]byte{'X'}, terminalDecodedSegmentLimit+1))
	if err = w.Close(); err != nil {
		t.Fatal(err)
	}
	corrupt := append([]byte(nil), encoded...)
	corrupt[len(corrupt)-8] ^= 1
	for _, bad := range [][]byte{encoded[:len(encoded)-1], corrupt, append(append([]byte(nil), encoded...), encoded...), append(append([]byte(nil), encoded...), 0), bomb.Bytes()} {
		if _, err = decodeTerminalSegment(bad, "gzip"); err == nil {
			t.Fatal("unbounded/corrupt/trailing compression accepted")
		}
	}
	if _, err = decodeTerminalSegment(raw, "gzip"); err == nil {
		t.Fatal("plaintext accepted as gzip")
	}
	if _, err = decodeTerminalSegment(encoded, "other"); err == nil {
		t.Fatal("unknown encoding accepted")
	}
	if _, err = readCompletedTerminalResults("unused", terminalStreamReport{Encoding: "gzip"}, readySenderJournalHeader{}, 3, 6); err == nil {
		t.Fatal("legacy reader accepted explicit streaming encoding")
	}
}

func TestTerminalGzipFailedWritePoisonsEncodedReservationWithoutRetry(t *testing.T) {
	s, err := newTerminalStream(filepath.Join(t.TempDir(), "terminal"), terminalFixture(t))
	if err != nil {
		t.Fatal(err)
	}
	s.report.Encoding = "gzip"
	budget := &readyEvidenceBudgetReport{LimitBytes: 1 << 20}
	calls := 0
	sentinel := errors.New("actual partial encoded write then Sync failure")
	s.persist = budget.persist(func(name string, raw []byte) error {
		calls++
		if err := os.WriteFile(name, raw[:1], 0600); err != nil {
			return err
		}
		return sentinel
	})
	r := transactionResult{Index: 0, Round: 1, Status: "submission_unknown"}
	if err = s.append(r); err != nil {
		t.Fatal(err)
	}
	if err = s.close(); !errors.Is(err, sentinel) {
		t.Fatal(err)
	}
	attempted := budget.AttemptedBytes
	if !s.report.Poisoned || !budget.Poisoned || s.report.DurableRecords != 0 || s.report.Bytes != 0 || attempted <= 1 {
		t.Fatal("uncertain encoded write gained durable credit", s.report, budget)
	}
	if err = s.close(); err == nil || calls != 1 || budget.AttemptedBytes != attempted {
		t.Fatal("uncertain encoded write replayed/refunded")
	}
}

func TestTerminalGzipRequiresExplicitStreamingAndKeepsOriginalLimits(t *testing.T) {
	o := streamingOptions()
	o.terminalGzip = true
	limits, err := workloadLimits(o)
	if err != nil || limits.terminalBytes != 1<<30 || o.evidenceByteBudget > 2<<30 {
		t.Fatal("streaming budgets widened", limits, err)
	}
	if err = validateOptions(o); err != nil {
		t.Fatal(err)
	}
	o.streamingWorkload = false
	if err = validateOptions(o); err == nil {
		t.Fatal("implicit compression accepted")
	}
	if _, err = workloadLimits(o); err == nil {
		t.Fatal("direct controller bypass accepted")
	}
}

func TestTerminalGzipCapFailureDoesNotWriteOrChargeSharedBudget(t *testing.T) {
	s, err := newTerminalStream(filepath.Join(t.TempDir(), "terminal"), terminalFixture(t))
	if err != nil {
		t.Fatal(err)
	}
	s.report.Encoding = "gzip"
	s.maxBytes = 1
	budget := &readyEvidenceBudgetReport{LimitBytes: 1 << 20}
	s.persist = budget.persist(func(string, []byte) error { t.Fatal("over-cap encoded write started"); return nil })
	if err = s.append(transactionResult{Index: 0, Round: 1, Status: "submission_unknown"}); err != nil {
		t.Fatal(err)
	}
	if err = s.close(); err == nil || !s.report.Poisoned || s.report.DurableRecords != 0 || s.report.Bytes != 0 || budget.AttemptedBytes != 0 {
		t.Fatal("cap failure credited/replayed evidence", s.report, budget, err)
	}
}

// Explicit offline measurement over previously recorded public results. No
// signing, RPC, application execution or new consensus/finality is performed.
func TestTerminalGzipActualRecordedRowsEncoding(t *testing.T) {
	path := os.Getenv("YNX_TERMINAL_ENCODING_RECORDED_INPUT")
	if path == "" {
		t.Skip("explicit original finite result required; no new network measurement")
	}
	raw, err := readBounded(path, 16<<20)
	if err != nil {
		t.Fatal(err)
	}
	digest := fmt.Sprintf("%x", sha256.Sum256(raw))
	if digest != "5d4fa2c4745cbaf7512e468b4d458bcc0b11c397db0dc47e7a89e12d1d79a0f9" {
		t.Fatal("original run39154351784 input pin differs")
	}
	var input struct {
		Transactions  []json.RawMessage `json:"transactions"`
		GenesisSHA256 string            `json:"genesisSha256"`
	}
	if err = json.Unmarshal(raw, &input); err != nil || len(input.Transactions) != 1024 {
		t.Fatal("original1024 rows required", err)
	}
	results := make([]transactionResult, 1024)
	for i, b := range input.Transactions {
		if err = json.Unmarshal(b, &results[i]); err != nil {
			t.Fatal(err)
		}
		encoded, err := json.Marshal(results[i])
		if err != nil {
			t.Fatal(err)
		}
		var original, restored any
		if json.Unmarshal(b, &original) != nil || json.Unmarshal(encoded, &restored) != nil || !reflect.DeepEqual(original, restored) {
			t.Fatal("original row field lost during Go reencoding", i)
		}
	}
	// Encoding-only public binding uses the input digest, not an asserted
	// original manifest/migration authority. Ordering follows retained indices,
	// not unrecorded original terminal hand-back order.
	p := &ephemeralSenderPool{pending: make([]cmttypes.Tx, 512), manifestSHA256: digest, migrationHash: digest, genesisHash: input.GenesisSHA256}
	var reports [2]terminalStreamReport
	for mode := 0; mode < 2; mode++ {
		s, err := newTerminalStream(filepath.Join(t.TempDir(), "terminal"), p)
		if err != nil {
			t.Fatal(err)
		}
		if mode == 1 {
			s.report.Encoding = "gzip"
		}
		for _, r := range results {
			if err = s.append(r); err != nil {
				t.Fatal(err)
			}
		}
		if err = s.close(); err != nil {
			t.Fatal(err)
		}
		reports[mode] = s.report
		d, err := newTerminalStreamDecoder(s.binding, 512)
		if err != nil {
			t.Fatal(err)
		}
		index, physical := 0, 0
		for segment := 0; segment < s.report.Segments; segment++ {
			b, err := os.ReadFile(filepath.Join(s.report.Directory, fmtTerminalName(segment)))
			if err != nil {
				t.Fatal(err)
			}
			physical += len(b)
			rows, err := d.decodeStored(b, s.report.Encoding)
			if err != nil {
				t.Fatal(err)
			}
			for _, r := range rows {
				want, _ := json.Marshal(results[index])
				got, _ := json.Marshal(r)
				if !bytes.Equal(want, got) {
					t.Fatal("original recorded result changed", index)
				}
				index++
			}
		}
		if index != 1024 || physical != s.report.Bytes {
			t.Fatal("actual physical byte/row accounting differs", index, physical, s.report)
		}
	}
	if reports[0].ChainSHA256 != reports[1].ChainSHA256 {
		t.Fatal("original row hash chains differ")
	}
	t.Logf("YNX_TERMINAL_ENCODING_ACTUAL_V1 inputSHA256=%s rows=1024 segments=%d plainBytes=%d gzipBytes=%d compressionNs=%d sameRowChain=%s scope=offline-Go-writer-readback-not-new-business-throughput-or-future-history-bound", digest, reports[1].Segments, reports[0].Bytes, reports[1].Bytes, reports[1].CompressionNs, reports[0].ChainSHA256)
}
