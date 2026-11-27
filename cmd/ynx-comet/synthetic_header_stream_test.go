package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"
	"weak"
)

func headerStreamEvent(height int64) syntheticHeaderEvent {
	var h, a [32]byte
	for i := range h {
		h[i] = byte(height)
		a[i] = byte(height + 1)
	}
	return syntheticHeaderEvent{Height: height, HeaderHash: h, AppHash: a, CaptureEpoch: 1, Attempt: uint64(height), MonotonicNs: "12345"}
}

func TestSyntheticHeaderStreamCloseFailuresRetainCustody(t *testing.T) {
	t.Run("constructor", func(t *testing.T) {
		path := filepath.Join(headerStreamPrivateDir(t), "constructor.jsonl")
		var ref weak.Pointer[syntheticHeaderStream]
		var closes atomic.Int32
		var physicallyClosed atomic.Bool
		first := errors.New("original constructor failure")
		closeFailure := errors.New("simulated close error after physical close")
		stream, err := newSyntheticHeaderStreamWithHooks(path, func(f *os.File) error {
			closes.Add(1)
			closeErr := f.Close()
			physicallyClosed.Store(closeErr == nil)
			return errors.Join(closeErr, closeFailure)
		}, func(s *syntheticHeaderStream) error {
			ref = weak.Make(s)
			return first
		})
		if stream != nil || !errors.Is(err, first) || !errors.Is(err, closeFailure) || closes.Load() != 1 {
			t.Fatal("constructor did not preserve both errors", err)
		}
		runtime.GC()
		held := ref.Value()
		if held == nil || held.streamHandles == nil || !held.streamHandles.fileAttempted || held.streamHandles.file != held.file || !held.cleanupDebt || held.first != first {
			t.Fatal("constructor lost original strong custody")
		}
		syntheticHeaderCustody.Lock()
		_, retained := syntheticHeaderCustody.streams[held]
		syntheticHeaderCustody.Unlock()
		if !retained {
			t.Fatal("unknown constructor close lost process custody")
		}
		assertSyntheticHeaderCustodyRejectsNext(t, held, physicallyClosed.Load())
	})
	t.Run("worker", func(t *testing.T) {
		path := filepath.Join(headerStreamPrivateDir(t), "worker.jsonl")
		s, err := newSyntheticHeaderStream(path)
		if err != nil {
			t.Fatal(err)
		}
		original := s.file
		var closes atomic.Int32
		var physicallyClosed atomic.Bool
		s.closeFileHook = func(f *os.File) error {
			if f == original {
				closes.Add(1)
				err := f.Close()
				physicallyClosed.Store(err == nil)
				return errors.Join(err, errors.New("simulated close error after physical close"))
			}
			return f.Close()
		}
		if !s.tryAppend(headerStreamEvent(1)) || s.finish(false) == nil {
			t.Fatal("ambiguous close accepted")
		}
		if s.report().Status != "UNKNOWN" || !s.report().CleanupDebt || closes.Load() != 1 {
			t.Fatal("close debt was lost")
		}
		if s.finish(false) == nil || closes.Load() != 1 {
			t.Fatal("original close retried")
		}
		ref := weak.Make(s)
		s = nil
		runtime.GC()
		held := ref.Value()
		if held == nil || held.streamHandles == nil || held.streamHandles.file != original || !held.streamHandles.fileAttempted || !held.cleanupDebt {
			t.Fatal("worker handle custody was lost")
		}
		syntheticHeaderCustody.Lock()
		_, retained := syntheticHeaderCustody.streams[held]
		syntheticHeaderCustody.Unlock()
		if !retained {
			t.Fatal("unknown worker close lost process custody")
		}
		assertSyntheticHeaderCustodyRejectsNext(t, held, physicallyClosed.Load())
	})
}

// The test's hook alone knows it actually closed the fixture FD. Production
// has no mechanism for removing an ambiguous-close entry from the registry.
func assertSyntheticHeaderCustodyRejectsNext(t *testing.T, held *syntheticHeaderStream, physicallyClosed bool) {
	t.Helper()
	path := filepath.Join(headerStreamPrivateDir(t), "must-not-create.jsonl")
	if _, err := newSyntheticHeaderStream(path); err == nil {
		t.Fatal("unknown custody allowed another stream")
	}
	if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("rejected stream created an output", err)
	}
	c := held.streamHandles
	if !physicallyClosed || c == nil || !c.rootAttempted || c.rootErr != nil || !c.directoryAttempted || c.directoryErr != nil {
		t.Fatal("test cannot prove its original fixture closed")
	}
	if held.receiptHandles != nil {
		r := held.receiptHandles
		if !r.fileAttempted || r.fileErr != nil || !r.rootAttempted || r.rootErr != nil || !r.directoryAttempted || r.directoryErr != nil {
			t.Fatal("test cannot prove receipt fixture closed")
		}
	}
	syntheticHeaderCustody.Lock()
	delete(syntheticHeaderCustody.streams, held)
	syntheticHeaderCustody.Unlock()
}

func headerStreamPrivateDir(t *testing.T) string {
	t.Helper()
	dir := wireObservationTestDir(t)
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	return dir
}

// A caller may explicitly request a private, deterministic DATA_ONLY fixture
// for cross-reader tests. The directory is supplied fresh and is never made,
// overwritten, uploaded, or used as a source of authority by this test.
func TestSyntheticHeaderPortableSyntheticFixture(t *testing.T) {
	dir, requested := os.LookupEnv("YNX_SYNTHETIC_HEADER_FIXTURE_DIR")
	if !requested {
		return
	}
	if dir == "" || !filepath.IsAbs(dir) || filepath.Clean(dir) != dir || commitObservationPrivateParent(dir) != nil {
		t.Fatal("synthetic fixture requires a canonical existing private directory")
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 0 {
		t.Fatal("synthetic fixture directory must be empty")
	}
	path := filepath.Join(dir, "synthetic-header-fixture.jsonl")
	s, err := newSyntheticHeaderStream(path)
	if err != nil {
		t.Fatal("synthetic fixture stream creation failed")
	}
	attempted := false
	t.Cleanup(func() {
		if !attempted {
			_ = s.finish(true)
		}
	})
	first, second := headerStreamEvent(1), headerStreamEvent(2)
	first.MonotonicNs, second.MonotonicNs = "1000000", "2000000"
	if !s.tryAppend(first) || !s.tryAppend(second) {
		t.Fatal("synthetic fixture event rejected")
	}
	attempted = true
	if err := s.finish(false); err != nil {
		t.Fatal("synthetic fixture stream did not complete")
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal("synthetic fixture stream unavailable")
	}
	receipt, err := os.ReadFile(path + ".receipt.json")
	if err != nil {
		t.Fatal("synthetic fixture receipt unavailable")
	}
	if _, err := newSyntheticHeaderStream(path); err == nil {
		t.Fatal("synthetic fixture output allowed reuse")
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("synthetic fixture output changed after refusal")
	}
	again, err := os.ReadFile(path + ".receipt.json")
	if err != nil || !bytes.Equal(receipt, again) {
		t.Fatal("synthetic fixture receipt changed after refusal")
	}
}

func TestSyntheticHeaderStreamActualPrivateFile(t *testing.T) {
	dir := headerStreamPrivateDir(t)
	path := filepath.Join(dir, "header.jsonl")
	s, err := newSyntheticHeaderStream(path)
	if err != nil {
		t.Fatal(err)
	}
	blocked := filepath.Join(dir, "blocked-while-live.jsonl")
	if _, err := newSyntheticHeaderStream(blocked); err == nil {
		t.Fatal("active original allowed another stream")
	}
	if _, err := os.Lstat(blocked); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("active-stream rejection touched output", err)
	}
	if !s.tryAppend(headerStreamEvent(1)) || !s.tryAppend(headerStreamEvent(2)) {
		t.Fatal("valid events rejected")
	}
	if err := s.finish(false); err != nil {
		t.Fatal(err)
	}
	r := s.report()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	h := sha256.Sum256(raw)
	if r.Status != "OBSERVED_DATA" || !r.Durable || r.CleanupDebt || r.Enqueued != 2 || r.Written != 2 || r.Bytes != int64(len(raw)) || r.SHA256 != hex.EncodeToString(h[:]) || strings.Count(string(raw), "\n") != 3 || !strings.Contains(string(raw), "DATA_ONLY") {
		t.Fatal("original stream receipt differs", r)
	}
	receipt, err := os.ReadFile(path + ".receipt.json")
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]interface{}
	if json.Unmarshal(receipt, &fields) != nil || fields["status"] != "UNKNOWN" || fields["streamStatus"] != "OBSERVED_DATA" || fields["sha256"] != r.SHA256 || fields["startupCoverageComplete"] != false || fields["walReplayExcluded"] != false || fields["nodeBindingVerified"] != false || fields["runtimeAuthorized"] != false || fields["independentFinality"] != false || fields["receiptPublicationVerified"] != false {
		t.Fatal("receipt overstated stream evidence", string(receipt))
	}
	if !r.ReceiptPublished || r.ReceiptCleanupDebt {
		t.Fatal("receipt retirement was not observed", r)
	}
	if err := s.finish(false); err != nil {
		t.Fatal(err)
	}
	again, err := os.ReadFile(path + ".receipt.json")
	if err != nil || string(receipt) != string(again) {
		t.Fatal("repeat finish rewrote original receipt", err)
	}
	if _, err := newSyntheticHeaderStream(path); err == nil {
		t.Fatal("existing output overwritten")
	}
	next, err := newSyntheticHeaderStream(blocked)
	if err != nil {
		t.Fatal("confirmed clean retirement did not release admission", err)
	}
	if !next.tryAppend(headerStreamEvent(1)) || next.finish(false) != nil {
		t.Fatal("next clean stream did not complete")
	}
}

func TestSyntheticHeaderStreamRejectsLossAndWrongOrder(t *testing.T) {
	t.Run("first-cause-bytes", func(t *testing.T) {
		for _, original := range []string{string([]byte{'x', 0xff, 'y'}), strings.Repeat("z", syntheticHeaderFirstCauseMaxBytes+3)} {
			path := filepath.Join(headerStreamPrivateDir(t), "first.jsonl")
			s, err := newSyntheticHeaderStream(path)
			if err != nil {
				t.Fatal(err)
			}
			s.fail(errors.New(original))
			s.fail(errors.New("later error must not replace first"))
			if s.finish(false) == nil {
				t.Fatal("failure became successful")
			}
			raw, err := os.ReadFile(path + ".receipt.json")
			if err != nil {
				t.Fatal(err)
			}
			var receipt struct {
				Status    string `json:"status"`
				Cause     string `json:"firstCauseBase64"`
				Digest    string `json:"firstCauseSha256"`
				Length    int    `json:"firstCauseBytes"`
				Truncated bool   `json:"firstCauseTruncated"`
			}
			if err := json.Unmarshal(raw, &receipt); err != nil {
				t.Fatal(err)
			}
			decoded, err := base64.StdEncoding.DecodeString(receipt.Cause)
			expected := []byte(original)
			truncated := len(expected) > syntheticHeaderFirstCauseMaxBytes
			if truncated {
				expected = expected[:syntheticHeaderFirstCauseMaxBytes]
			}
			sum := sha256.Sum256([]byte(original))
			if err != nil || !bytes.Equal(decoded, expected) || receipt.Length != len([]byte(original)) || receipt.Truncated != truncated || receipt.Digest != hex.EncodeToString(sum[:]) || receipt.Status != "UNKNOWN" {
				t.Fatal("first cause bytes not retained")
			}
		}
	})
	t.Run("queue-full", func(t *testing.T) {
		s := &syntheticHeaderStream{queue: make(chan syntheticHeaderEvent, 1), done: make(chan struct{})}
		if !s.tryAppend(headerStreamEvent(1)) || s.tryAppend(headerStreamEvent(2)) || s.report().Status != "UNKNOWN" {
			t.Fatal("full queue did not retain loss")
		}
	})
	t.Run("byte-limit", func(t *testing.T) {
		s := &syntheticHeaderStream{bytes: syntheticHeaderStreamMaxBytes}
		if err := s.writeLine([]byte("x"), sha256.New()); err == nil {
			t.Fatal("stream byte bound exceeded")
		}
	})
	t.Run("invalid", func(t *testing.T) {
		path := filepath.Join(headerStreamPrivateDir(t), "invalid.jsonl")
		s, err := newSyntheticHeaderStream(path)
		if err != nil {
			t.Fatal(err)
		}
		e := headerStreamEvent(1)
		e.MonotonicNs = "01"
		if s.tryAppend(e) || s.finish(false) == nil || s.report().Status != "UNKNOWN" {
			t.Fatal("invalid clock admitted")
		}
	})
	t.Run("gap", func(t *testing.T) {
		path := filepath.Join(headerStreamPrivateDir(t), "gap.jsonl")
		s, err := newSyntheticHeaderStream(path)
		if err != nil {
			t.Fatal(err)
		}
		if !s.tryAppend(headerStreamEvent(1)) || !s.tryAppend(headerStreamEvent(3)) {
			t.Fatal("queue unexpectedly rejected")
		}
		if s.finish(false) == nil || s.report().Status != "UNKNOWN" {
			t.Fatal("height gap accepted")
		}
	})
	t.Run("capture-loss", func(t *testing.T) {
		path := filepath.Join(headerStreamPrivateDir(t), "lost.jsonl")
		s, err := newSyntheticHeaderStream(path)
		if err != nil {
			t.Fatal(err)
		}
		if !s.tryAppend(headerStreamEvent(1)) || s.finish(true) == nil || s.report().Status != "UNKNOWN" {
			t.Fatal("capture loss cleared")
		}
		raw, err := os.ReadFile(path + ".receipt.json")
		if err != nil {
			t.Fatal(err)
		}
		var receipt map[string]interface{}
		if json.Unmarshal(raw, &receipt) != nil || receipt["status"] != "UNKNOWN" || receipt["streamStatus"] != "UNKNOWN" || receipt["firstCauseSha256"] == nil {
			t.Fatal("loss not preserved in receipt", string(raw))
		}
	})
	t.Run("receipt-exists", func(t *testing.T) {
		path := filepath.Join(headerStreamPrivateDir(t), "existing.jsonl")
		if err := os.WriteFile(path+".receipt.json", []byte("original"), 0600); err != nil {
			t.Fatal(err)
		}
		s, err := newSyntheticHeaderStream(path)
		if err != nil {
			t.Fatal(err)
		}
		if !s.tryAppend(headerStreamEvent(1)) || s.finish(false) == nil || s.report().Status != "UNKNOWN" {
			t.Fatal("existing receipt admitted")
		}
		raw, err := os.ReadFile(path + ".receipt.json")
		if err != nil || string(raw) != "original" {
			t.Fatal("original receipt changed", err)
		}
	})
}

func TestSyntheticHeaderStreamOriginalIdentityAndBoundedRetirement(t *testing.T) {
	checkStreamFailureReceipt := func(t *testing.T, path string) {
		t.Helper()
		raw, err := os.ReadFile(path + ".receipt.json")
		if err != nil {
			t.Fatal(err)
		}
		var receipt map[string]interface{}
		if json.Unmarshal(raw, &receipt) != nil || receipt["status"] != "UNKNOWN" || receipt["streamStatus"] != "UNKNOWN" || receipt["streamDurable"] != false || receipt["firstCauseSha256"] == nil {
			t.Fatal("stream failure was not retained in the original receipt", string(raw))
		}
	}
	t.Run("stream-same-size-write-after-readback", func(t *testing.T) {
		dir := headerStreamPrivateDir(t)
		path := filepath.Join(dir, "stream.jsonl")
		s, err := newSyntheticHeaderStream(path)
		if err != nil {
			t.Fatal(err)
		}
		var observed os.FileInfo
		var before byte
		s.streamVerifiedHook = func(f *os.File) error {
			var err error
			observed, err = f.Stat()
			if err != nil {
				return err
			}
			one := []byte{0}
			if _, err = f.ReadAt(one, 0); err != nil {
				return err
			}
			before = one[0]
			one[0] ^= 1
			_, err = f.WriteAt(one, 0)
			return err
		}
		if !s.tryAppend(headerStreamEvent(1)) {
			t.Fatal("valid event rejected")
		}
		if err := s.finish(false); err == nil || s.report().Status != "UNKNOWN" || !strings.Contains(s.report().FirstError, "stream readback differs") {
			t.Fatal("same-size stream mutation was accepted", err)
		}
		checkStreamFailureReceipt(t, path)
		current, err := os.Stat(path)
		if err != nil || observed == nil || !os.SameFile(observed, current) || observed.Size() != current.Size() {
			t.Fatal("control changed original inode or size", err)
		}
		raw, err := os.ReadFile(path)
		if err != nil || len(raw) == 0 || raw[0] != before^1 {
			t.Fatal("controlled stream mutation not retained", err)
		}
	})
	t.Run("stream-hardlink-after-readback", func(t *testing.T) {
		dir := headerStreamPrivateDir(t)
		path := filepath.Join(dir, "stream.jsonl")
		alias := filepath.Join(dir, "stream-hardlink")
		s, err := newSyntheticHeaderStream(path)
		if err != nil {
			t.Fatal(err)
		}
		s.streamVerifiedHook = func(*os.File) error { return os.Link(path, alias) }
		if !s.tryAppend(headerStreamEvent(1)) {
			t.Fatal("valid event rejected")
		}
		if err := s.finish(false); err == nil || s.report().Status != "UNKNOWN" || !strings.Contains(s.report().FirstError, "output identity changed") {
			t.Fatal("stream hardlink after readback was accepted", err)
		}
		checkStreamFailureReceipt(t, path)
		original, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		linked, err := os.Stat(alias)
		if err != nil || !os.SameFile(original, linked) {
			t.Fatal("real stream hardlink was not created", err)
		}
	})
	t.Run("receipt-same-size-write-after-readback", func(t *testing.T) {
		dir := headerStreamPrivateDir(t)
		path := filepath.Join(dir, "stream.jsonl")
		s, err := newSyntheticHeaderStream(path)
		if err != nil {
			t.Fatal(err)
		}
		originalStream := s.file
		var receiptCloses atomic.Int32
		s.closeFileHook = func(f *os.File) error {
			if f != originalStream {
				receiptCloses.Add(1)
			}
			return f.Close()
		}
		var observed os.FileInfo
		var before byte
		s.receiptVerifiedHook = func(f *os.File) error {
			var err error
			observed, err = f.Stat()
			if err != nil {
				return err
			}
			one := []byte{0}
			if _, err := f.ReadAt(one, 0); err != nil {
				return err
			}
			before = one[0]
			one[0] ^= 1
			_, err = f.WriteAt(one, 0)
			return err
		}
		if !s.tryAppend(headerStreamEvent(1)) {
			t.Fatal("valid event rejected")
		}
		if err := s.finish(false); err == nil || !strings.Contains(err.Error(), "exact original output readback failed") || s.report().Status != "UNKNOWN" || !strings.Contains(s.report().FirstError, "exact original output readback failed") {
			t.Fatal("same-size mutation was accepted", err)
		}
		pathInfo, err := os.Stat(path + ".receipt.json")
		if err != nil || observed == nil || !os.SameFile(observed, pathInfo) || pathInfo.Size() != observed.Size() {
			t.Fatal("control changed inode or size", err)
		}
		raw, err := os.ReadFile(path + ".receipt.json")
		if err != nil || len(raw) == 0 || raw[0] != before^1 || receiptCloses.Load() != 1 {
			t.Fatal("same-size mutation or one-time close not observed", err)
		}
		if err := s.finish(false); err == nil || receiptCloses.Load() != 1 {
			t.Fatal("receipt close was retried")
		}
	})
	t.Run("receipt-hardlink-after-readback", func(t *testing.T) {
		dir := headerStreamPrivateDir(t)
		path := filepath.Join(dir, "stream.jsonl")
		alias := filepath.Join(dir, "receipt-hardlink")
		s, err := newSyntheticHeaderStream(path)
		if err != nil {
			t.Fatal(err)
		}
		s.receiptVerifiedHook = func(*os.File) error { return os.Link(path+".receipt.json", alias) }
		if !s.tryAppend(headerStreamEvent(1)) {
			t.Fatal("valid event rejected")
		}
		if err := s.finish(false); err == nil || s.report().Status != "UNKNOWN" || !strings.Contains(s.report().FirstError, "protection changed after readback") {
			t.Fatal("hardlink at the controlled post-readback observation was accepted", err)
		}
		receipt, err := os.Stat(path + ".receipt.json")
		if err != nil {
			t.Fatal(err)
		}
		linked, err := os.Stat(alias)
		if err != nil || !os.SameFile(receipt, linked) {
			t.Fatal("real hardlink control was not created", err)
		}
	})
	t.Run("replaced-path", func(t *testing.T) {
		dir := headerStreamPrivateDir(t)
		path := filepath.Join(dir, "original.jsonl")
		s, err := newSyntheticHeaderStream(path)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.Rename(path, filepath.Join(dir, "retained-original")); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("replacement"), 0600); err != nil {
			t.Fatal(err)
		}
		s.tryAppend(headerStreamEvent(1))
		if s.finish(false) == nil || s.report().Status != "UNKNOWN" {
			t.Fatal("changed inode accepted")
		}
	})
	t.Run("timeout-preserves-debt", func(t *testing.T) {
		dir := headerStreamPrivateDir(t)
		path := filepath.Join(dir, "unretired.jsonl")
		f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
		if err != nil {
			t.Fatal(err)
		}
		defer f.Close() // test owns this fixture; production never closes a timed-out worker's FD
		parent, err := os.Stat(dir)
		if err != nil {
			t.Fatal(err)
		}
		s := &syntheticHeaderStream{queue: make(chan syntheticHeaderEvent), done: make(chan struct{}), file: f, receiptPath: path + ".receipt.json", parent: parent}
		started := time.Now()
		if s.finish(false) == nil {
			t.Fatal("unretired worker accepted")
		}
		r := s.report()
		if !r.CleanupDebt || r.Status != "UNKNOWN" || time.Since(started) > syntheticHeaderFinishTimeout+time.Second {
			t.Fatal("unbounded or lost cleanup debt", r)
		}
		if _, err := f.Stat(); err != nil {
			t.Fatal("timed out finish closed original FD", err)
		}
		raw, err := os.ReadFile(path + ".receipt.json")
		if err != nil {
			t.Fatal(err)
		}
		var receipt map[string]interface{}
		if json.Unmarshal(raw, &receipt) != nil || receipt["status"] != "UNKNOWN" || receipt["streamStatus"] != "UNKNOWN" || receipt["streamCleanupDebt"] != true {
			t.Fatal("unretired worker receipt overstated cleanup", string(raw))
		}
	})
}
