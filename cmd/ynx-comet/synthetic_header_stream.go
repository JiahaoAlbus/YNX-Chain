package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"syscall"
	"time"
)

// This is only the original Application's local Commit-return upper-bound
// observation. It is not a vote, complete BlockID, or finality proof.
type syntheticHeaderEvent struct {
	Height                int64
	HeaderHash, AppHash   [32]byte
	CaptureEpoch, Attempt uint64
	MonotonicNs           string
}

const (
	syntheticHeaderQueueCapacity            = 256
	syntheticHeaderStreamMaxBytes     int64 = 16 << 20
	syntheticHeaderFinishTimeout            = 2 * time.Second
	syntheticHeaderFirstCauseMaxBytes       = 8192
)

type syntheticHeaderStreamReport struct {
	Status                               string
	Enqueued, Written                    uint64
	Bytes                                int64
	SHA256                               string
	FirstError                           string
	CleanupDebt, Durable                 bool
	ReceiptPublished, ReceiptCleanupDebt bool
}

type syntheticHeaderStream struct {
	mu                                               sync.Mutex
	queue                                            chan syntheticHeaderEvent
	done                                             chan struct{}
	closed                                           bool
	first                                            error
	enqueued, written                                uint64
	bytes                                            int64
	digest                                           string
	retired, durable                                 bool
	cleanupDebt                                      bool
	receiptStarted, receiptRetired, receiptPublished bool
	receiptErr                                       error
	receiptDone                                      chan struct{}
	receiptPath                                      string
	parent                                           os.FileInfo
	output                                           *commitObservationOutput
	file                                             *os.File
	original                                         os.FileInfo
	streamHandles, receiptHandles                    *syntheticHeaderOwnedHandles
	closeFileHook                                    func(*os.File) error
	streamVerifiedHook                               func(*os.File) error // test-only; nil in normal execution
	receiptVerifiedHook                              func(*os.File) error // test-only; nil in normal execution
}

// A failed close can leave kernel ownership unknowable. Keep the original Go
// handles reachable for the life of the process; never retry a close by fd.
type syntheticHeaderOwnedHandles struct {
	output                                           *commitObservationOutput
	file                                             *os.File
	fileAttempted, rootAttempted, directoryAttempted bool
	fileErr, rootErr, directoryErr                   error
}

var syntheticHeaderCustody = struct {
	sync.Mutex
	streams map[*syntheticHeaderStream]struct{}
}{streams: make(map[*syntheticHeaderStream]struct{})}

func retainSyntheticHeaderStream(s *syntheticHeaderStream) error {
	syntheticHeaderCustody.Lock()
	defer syntheticHeaderCustody.Unlock()
	if len(syntheticHeaderCustody.streams) != 0 {
		return errors.New("prior synthetic header stream has unretired or unknown custody")
	}
	syntheticHeaderCustody.streams[s] = struct{}{}
	return nil
}

func (s *syntheticHeaderStream) releaseIfRetired() {
	s.mu.Lock()
	release := s.retired && s.receiptRetired && !s.cleanupDebt
	s.mu.Unlock()
	if release {
		syntheticHeaderCustody.Lock()
		delete(syntheticHeaderCustody.streams, s)
		syntheticHeaderCustody.Unlock()
	}
}

func (s *syntheticHeaderStream) closeOwned(c *syntheticHeaderOwnedHandles) error {
	if c == nil {
		return nil
	}
	var err error
	if c.file != nil && !c.fileAttempted {
		c.fileAttempted = true
		if s.closeFileHook != nil {
			c.fileErr = s.closeFileHook(c.file)
		} else {
			c.fileErr = c.file.Close()
		}
	}
	err = errors.Join(err, c.fileErr)
	if c.output != nil && c.output.root != nil && !c.rootAttempted {
		c.rootAttempted = true
		c.rootErr = c.output.root.Close()
	}
	err = errors.Join(err, c.rootErr)
	if c.output != nil && c.output.directory != nil && !c.directoryAttempted {
		c.directoryAttempted = true
		c.directoryErr = c.output.directory.Close()
	}
	err = errors.Join(err, c.directoryErr)
	if err != nil {
		s.mu.Lock()
		s.cleanupDebt = true
		s.mu.Unlock()
		s.fail(err)
	}
	return err
}

// Unlike openCommitObservationOutput, this retains all partially acquired
// original handles before any error path can attempt to close them.
func (s *syntheticHeaderStream) openOwnedOutput(path string, c *syntheticHeaderOwnedHandles) (*commitObservationOutput, error) {
	dir := filepath.Dir(path)
	if err := commitObservationPrivateParent(dir); err != nil {
		return nil, err
	}
	o := &commitObservationOutput{path: path}
	c.output = o
	var err error
	if o.root, err = os.OpenRoot(dir); err != nil {
		return nil, err
	}
	if o.directory, err = os.Open(dir); err != nil {
		return nil, err
	}
	if o.parent, err = o.directory.Stat(); err != nil {
		return nil, err
	}
	if err = o.parentCurrent(); err != nil {
		return nil, err
	}
	if _, err = o.root.Lstat(filepath.Base(path)); !errors.Is(err, os.ErrNotExist) {
		return nil, errors.New("synthetic header output appeared; retain original/UNKNOWN")
	}
	return o, nil
}

// Opens exactly one new 0600 file in the already validated private directory.
// The worker alone owns its FD, including the one and only Close attempt.
func newSyntheticHeaderStream(path string) (*syntheticHeaderStream, error) {
	return newSyntheticHeaderStreamWithHooks(path, nil, nil)
}

// Hooks are nil in normal execution. Tests use them only to exercise a
// partially opened constructor and a physically closed FD reporting error.
func newSyntheticHeaderStreamWithHooks(path string, closeFile func(*os.File) error, opened func(*syntheticHeaderStream) error) (*syntheticHeaderStream, error) {
	s := &syntheticHeaderStream{queue: make(chan syntheticHeaderEvent, syntheticHeaderQueueCapacity), done: make(chan struct{}), receiptDone: make(chan struct{}), receiptPath: path + ".receipt.json", streamHandles: &syntheticHeaderOwnedHandles{}, closeFileHook: closeFile}
	// The registry lock is acquired before any filesystem object is opened.
	// All registered streams are pending or have unresolved close ownership.
	if err := retainSyntheticHeaderStream(s); err != nil {
		return nil, err
	}
	fail := func(err error) (*syntheticHeaderStream, error) {
		s.fail(err)
		closeErr := s.closeOwned(s.streamHandles)
		s.mu.Lock()
		s.retired, s.receiptRetired = true, true
		s.mu.Unlock()
		s.releaseIfRetired()
		return nil, errors.Join(err, closeErr)
	}
	o, err := s.openOwnedOutput(path, s.streamHandles)
	if err != nil {
		return fail(err)
	}
	s.output, s.parent = o, o.parent
	s.file, err = o.root.OpenFile(filepath.Base(path), os.O_RDWR|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return fail(err)
	}
	s.streamHandles.file = s.file
	if opened != nil {
		if err := opened(s); err != nil {
			return fail(err)
		}
	}
	s.original, err = s.file.Stat()
	if err == nil {
		err = s.checkIdentity()
	}
	if err != nil {
		return fail(err)
	}
	go s.run()
	return s, nil
}

func (s *syntheticHeaderStream) checkIdentity() error {
	if err := s.output.parentCurrent(); err != nil {
		return err
	}
	info, err := s.file.Stat()
	if err != nil {
		return err
	}
	pathInfo, err := s.output.root.Lstat(filepath.Base(s.output.path))
	if err != nil {
		return err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || stat.Nlink != 1 || stat.Uid != uint32(os.Geteuid()) || !os.SameFile(s.original, info) || !os.SameFile(s.original, pathInfo) {
		return errors.New("synthetic header original output identity changed")
	}
	return nil
}

func (s *syntheticHeaderStream) fail(err error) {
	if err == nil {
		return
	}
	s.mu.Lock()
	if s.first == nil {
		s.first = err
	}
	s.mu.Unlock()
}

func validSyntheticHeaderEvent(e syntheticHeaderEvent) bool {
	if e.Height <= 0 || e.HeaderHash == [32]byte{} || e.AppHash == [32]byte{} || e.CaptureEpoch == 0 || e.Attempt == 0 || e.MonotonicNs == "" || len(e.MonotonicNs) > 19 {
		return false
	}
	n, err := strconv.ParseUint(e.MonotonicNs, 10, 63)
	return err == nil && n > 0 && strconv.FormatUint(n, 10) == e.MonotonicNs
}

// Called synchronously at the original Commit callback: no disk or network I/O,
// and no waiting for queue capacity. Loss remains sticky even if later drained.
func (s *syntheticHeaderStream) tryAppend(e syntheticHeaderEvent) bool {
	if s == nil {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.first != nil || !validSyntheticHeaderEvent(e) {
		if s.first == nil {
			s.first = errors.New("synthetic header event unavailable or stream closed")
		}
		return false
	}
	select {
	case s.queue <- e:
		s.enqueued++
		return true
	default:
		s.first = errors.New("synthetic header queue full; records lost")
		return false
	}
}

func (s *syntheticHeaderStream) writeLine(raw []byte, h hash.Hash) error {
	s.mu.Lock()
	written := s.bytes
	s.mu.Unlock()
	if len(raw) == 0 || int64(len(raw)) > syntheticHeaderStreamMaxBytes-written {
		return errors.New("synthetic header stream byte limit exceeded")
	}
	if err := s.checkIdentity(); err != nil {
		return err
	}
	n, err := s.file.Write(raw)
	if n > 0 {
		_, _ = h.Write(raw[:n])
		s.mu.Lock()
		s.bytes += int64(n)
		s.mu.Unlock()
	}
	if err == nil && n != len(raw) {
		err = io.ErrShortWrite
	}
	return err
}

// Recheck the original held file and the complete bounded bytes. A successful
// read is a point-in-time observation; the independent reader must verify the
// retained file again before consuming it.
func (s *syntheticHeaderStream) verifyReadback(size int64, expected []byte) error {
	if err := s.checkIdentity(); err != nil {
		return err
	}
	info, err := s.file.Stat()
	if err != nil {
		return err
	}
	if info.Size() != size {
		return errors.New("synthetic header stream size changed")
	}
	readback := sha256.New()
	n, err := io.Copy(readback, io.NewSectionReader(s.file, 0, size))
	if err != nil {
		return err
	}
	if n != size || !bytes.Equal(readback.Sum(nil), expected) {
		return errors.New("synthetic header stream readback differs")
	}
	if err := s.checkIdentity(); err != nil {
		return err
	}
	info, err = s.file.Stat()
	if err != nil {
		return err
	}
	if info.Size() != size {
		return errors.New("synthetic header stream size changed")
	}
	return nil
}

func (s *syntheticHeaderStream) run() {
	defer close(s.done)
	h := sha256.New()
	err := s.writeLine([]byte("{\"version\":\"YNX-SYNTHETIC-HEADER-STREAM/v1\",\"classification\":\"DATA_ONLY\"}\n"), h)
	s.fail(err)
	var previous syntheticHeaderEvent
	for e := range s.queue {
		s.mu.Lock()
		failed := s.first != nil
		s.mu.Unlock()
		if failed {
			continue
		}
		if previous.Height != 0 {
			oldNs, _ := strconv.ParseUint(previous.MonotonicNs, 10, 63)
			newNs, _ := strconv.ParseUint(e.MonotonicNs, 10, 63)
			if previous.Height == int64(^uint64(0)>>1) || e.Height != previous.Height+1 || e.CaptureEpoch != previous.CaptureEpoch || e.Attempt <= previous.Attempt || newNs < oldNs {
				s.fail(errors.New("synthetic header stream sequence changed or has a gap"))
				continue
			}
		}
		line, marshalErr := json.Marshal(struct {
			Height       int64  `json:"height"`
			HeaderHash   string `json:"headerHash"`
			AppHash      string `json:"appHash"`
			CaptureEpoch uint64 `json:"captureEpoch"`
			Attempt      uint64 `json:"attempt"`
			MonotonicNs  string `json:"monotonicNs"`
		}{e.Height, hex.EncodeToString(e.HeaderHash[:]), hex.EncodeToString(e.AppHash[:]), e.CaptureEpoch, e.Attempt, e.MonotonicNs})
		if marshalErr == nil {
			marshalErr = s.writeLine(append(line, '\n'), h)
		}
		s.fail(marshalErr)
		if marshalErr == nil {
			previous = e
			s.mu.Lock()
			s.written++
			s.mu.Unlock()
		}
	}
	// Every possibly blocking syscall remains on this owning goroutine. A
	// timed-out caller must not close or signal using the raw descriptor.
	if err := s.checkIdentity(); err != nil {
		s.fail(err)
	}
	if err := s.file.Sync(); err != nil {
		s.fail(err)
	}
	if err := s.checkIdentity(); err != nil {
		s.fail(err)
	}
	s.mu.Lock()
	size := s.bytes
	s.mu.Unlock()
	readbackErr := s.verifyReadback(size, h.Sum(nil))
	s.fail(readbackErr)
	if readbackErr == nil && s.streamVerifiedHook != nil {
		s.fail(s.streamVerifiedHook(s.file))
	}
	if err := s.output.directory.Sync(); err != nil {
		s.fail(err)
	}
	// The first successful readback alone does not detect a later same-size
	// write or a new hardlink. Do not label this observation durable without
	// rechecking the same original FD, path and full digest after directory sync.
	if err := s.verifyReadback(size, h.Sum(nil)); err != nil {
		s.fail(err)
	}
	_ = s.closeOwned(s.streamHandles)
	s.mu.Lock()
	s.digest = hex.EncodeToString(h.Sum(nil))
	if s.enqueued == 0 && s.first == nil {
		s.first = errors.New("no synthetic header events observed")
	}
	s.durable = s.first == nil && s.enqueued == s.written
	s.retired = true
	s.mu.Unlock()
	s.releaseIfRetired()
}

// Lost is supplied by the observer's own sticky failure state. No retry or
// second close is performed, including after a timed-out finish.
func (s *syntheticHeaderStream) finish(lost bool) error {
	if s == nil {
		return errors.New("synthetic header stream unavailable")
	}
	s.mu.Lock()
	if lost && s.first == nil {
		s.first = errors.New("synthetic header capture incomplete")
	}
	if !s.closed {
		s.closed = true
		close(s.queue)
	}
	s.mu.Unlock()
	timer := time.NewTimer(syntheticHeaderFinishTimeout)
	defer timer.Stop()
	var outcome error
	select {
	case <-s.done:
		r := s.report()
		if !r.Durable || r.CleanupDebt || r.FirstError != "" {
			outcome = fmt.Errorf("synthetic header stream UNKNOWN: %s", r.FirstError)
		}
	case <-timer.C:
		s.fail(errors.New("synthetic header worker not retired before deadline"))
		outcome = errors.New("synthetic header stream UNKNOWN: worker cleanup debt")
	}
	return errors.Join(outcome, s.publishReceipt())
}

// The receipt describes only the bytes accepted by this stream. It explicitly
// leaves the startup/WAL interval, source binding, and finality unqualified.
// A timed-out worker retains its original FD; the receipt is a separate,
// one-shot UNKNOWN snapshot and never claims that worker has retired.
func (s *syntheticHeaderStream) publishReceipt() error {
	s.mu.Lock()
	if s.receiptDone == nil {
		s.receiptDone = make(chan struct{})
	}
	if !s.receiptStarted {
		s.receiptStarted = true
		go s.writeReceipt()
	}
	done := s.receiptDone
	s.mu.Unlock()
	timer := time.NewTimer(syntheticHeaderFinishTimeout)
	defer timer.Stop()
	select {
	case <-done:
		s.mu.Lock()
		published := s.receiptPublished
		receiptErr := s.receiptErr
		s.mu.Unlock()
		if !published {
			if receiptErr != nil {
				return fmt.Errorf("synthetic header receipt UNKNOWN: %w", receiptErr)
			}
			return errors.New("synthetic header receipt UNKNOWN")
		}
		return nil
	case <-timer.C:
		s.fail(errors.New("synthetic header receipt worker not retired before deadline"))
		return errors.New("synthetic header receipt UNKNOWN: worker cleanup debt")
	}
}

func (s *syntheticHeaderStream) writeReceipt() {
	defer close(s.receiptDone)
	r := s.report()
	payloadStatus := "UNKNOWN"
	if r.Durable && !r.CleanupDebt && r.FirstError == "" {
		payloadStatus = "OBSERVED_DATA"
	}
	var causeHash, causeBase64 string
	causeLen := len([]byte(r.FirstError))
	causeTruncated := causeLen > syntheticHeaderFirstCauseMaxBytes
	if r.FirstError != "" {
		sum := sha256.Sum256([]byte(r.FirstError))
		causeHash = hex.EncodeToString(sum[:])
		cause := []byte(r.FirstError)
		if causeTruncated {
			cause = cause[:syntheticHeaderFirstCauseMaxBytes]
		}
		causeBase64 = base64.StdEncoding.EncodeToString(cause)
	}
	raw, err := json.Marshal(struct {
		Version                    string `json:"version"`
		Classification             string `json:"classification"`
		Status                     string `json:"status"`
		StreamStatus               string `json:"streamStatus"`
		Enqueued                   uint64 `json:"enqueued"`
		Written                    uint64 `json:"written"`
		Bytes                      int64  `json:"bytes"`
		SHA256                     string `json:"sha256,omitempty"`
		StreamDurable              bool   `json:"streamDurable"`
		StreamCleanupDebt          bool   `json:"streamCleanupDebt"`
		FirstCauseSHA256           string `json:"firstCauseSha256,omitempty"`
		FirstCauseBase64           string `json:"firstCauseBase64,omitempty"`
		FirstCauseBytes            int    `json:"firstCauseBytes"`
		FirstCauseTruncated        bool   `json:"firstCauseTruncated"`
		StartupCoverageComplete    bool   `json:"startupCoverageComplete"`
		WALReplayExcluded          bool   `json:"walReplayExcluded"`
		NodeBindingVerified        bool   `json:"nodeBindingVerified"`
		RuntimeAuthorized          bool   `json:"runtimeAuthorized"`
		IndependentFinality        bool   `json:"independentFinality"`
		ReceiptPublicationVerified bool   `json:"receiptPublicationVerified"`
	}{"YNX-SYNTHETIC-HEADER-STREAM-RECEIPT/v1", "DATA_ONLY", "UNKNOWN", payloadStatus, r.Enqueued, r.Written, r.Bytes, r.SHA256, r.Durable, r.CleanupDebt, causeHash, causeBase64, causeLen, causeTruncated, false, false, false, false, false, false})
	if err == nil && (len(raw) == 0 || len(raw)+1 > 512<<10) {
		err = errors.New("synthetic header receipt exceeds fixed bound")
	}
	if err == nil && (s.receiptPath == "" || s.parent == nil) {
		err = errors.New("synthetic header original receipt parent unavailable")
	}
	if err == nil {
		c := &syntheticHeaderOwnedHandles{}
		s.receiptHandles = c // registered stream strongly owns this before any open/close
		var out *commitObservationOutput
		out, err = s.openOwnedOutput(s.receiptPath, c)
		if err == nil && !os.SameFile(s.parent, out.parent) {
			err = errors.New("synthetic header receipt parent changed")
		}
		if err == nil {
			c.file, err = out.root.OpenFile(filepath.Base(s.receiptPath), os.O_RDWR|os.O_CREATE|os.O_EXCL, 0600)
		}
		if err == nil {
			data := append(raw, '\n')
			var n int
			n, err = c.file.Write(data)
			if err == nil && n != len(data) {
				err = io.ErrShortWrite
			}
			if err == nil {
				err = c.file.Sync()
			}
			if err == nil {
				var info os.FileInfo
				info, err = c.file.Stat()
				if err == nil {
					stat, ok := info.Sys().(*syscall.Stat_t)
					if !ok || stat.Nlink != 1 || stat.Uid != uint32(os.Geteuid()) {
						err = errors.New("synthetic header receipt protection changed")
					}
				}
			}
			if err == nil {
				err = verifyWireObservationFile(out.root, filepath.Base(s.receiptPath), c.file, data)
			}
			if err == nil && s.receiptVerifiedHook != nil {
				err = s.receiptVerifiedHook(c.file)
			}
			if err == nil {
				held, heldErr := c.file.Stat()
				current, pathErr := out.root.Lstat(filepath.Base(s.receiptPath))
				if heldErr != nil || pathErr != nil {
					err = errors.Join(heldErr, pathErr)
				} else {
					stat, ok := held.Sys().(*syscall.Stat_t)
					if !ok || !held.Mode().IsRegular() || held.Mode().Perm() != 0600 || stat.Nlink != 1 || stat.Uid != uint32(os.Geteuid()) || held.Size() != int64(len(data)) || !os.SameFile(held, current) {
						err = errors.New("synthetic header receipt protection changed after readback")
					}
				}
			}
			// Re-read the same held FD after the second identity check. Size and
			// inode alone do not detect a same-length write after the first read.
			if err == nil {
				err = verifyWireObservationFile(out.root, filepath.Base(s.receiptPath), c.file, data)
			}
			if err == nil {
				err = out.directory.Sync()
			}
			if err == nil {
				err = out.parentCurrent()
			}
		}
		if err != nil {
			s.fail(err)
		}
		err = errors.Join(err, s.closeOwned(c))
	}
	if err != nil {
		s.fail(err)
	}
	s.mu.Lock()
	s.receiptPublished = err == nil
	s.receiptErr = err
	s.receiptRetired = true
	s.mu.Unlock()
	s.releaseIfRetired()
}

func (s *syntheticHeaderStream) report() syntheticHeaderStreamReport {
	if s == nil {
		return syntheticHeaderStreamReport{Status: "UNKNOWN", CleanupDebt: true, FirstError: "stream unavailable"}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	r := syntheticHeaderStreamReport{Status: "UNKNOWN", Enqueued: s.enqueued, Written: s.written, Bytes: s.bytes, SHA256: s.digest, CleanupDebt: !s.retired || s.cleanupDebt, Durable: s.durable, ReceiptPublished: s.receiptPublished, ReceiptCleanupDebt: s.receiptStarted && !s.receiptRetired}
	if s.first != nil {
		r.FirstError = s.first.Error()
	}
	if s.retired && s.first == nil && s.durable && s.receiptRetired && s.receiptPublished && !s.cleanupDebt {
		r.Status = "OBSERVED_DATA"
	}
	return r
}
