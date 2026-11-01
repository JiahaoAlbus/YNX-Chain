package ownednode

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"unicode/utf8"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/localipc"
)

// Captures are bounded local observations, never parsed as a sync/proof/grant
// protocol. All run files are retained; a full retention budget blocks a new run.
const MaxLogStreamBytes = 32 << 10
const LogWireTailBytes = 512
const MaxRetainedLogRuns = 64

type logStreamRecord struct {
	Identity FileIdentity `json:"identity"`
	Observed string       `json:"observed"`
	Dropped  string       `json:"dropped"`
	SHA256   string       `json:"sha256,omitempty"`
}
type runLogRecord struct {
	RunID     string          `json:"runId"`
	Directory FileIdentity    `json:"directory"`
	Stdout    logStreamRecord `json:"stdout"`
	Stderr    logStreamRecord `json:"stderr"`
	Limit     uint64          `json:"limit,string"`
	Complete  bool            `json:"complete"`
}

type LogStream struct {
	Text          string  `json:"text"`
	Encoding      string  `json:"encoding"`
	CapturedBytes string  `json:"capturedBytes"`
	ObservedBytes *string `json:"observedBytes"`
	DroppedBytes  *string `json:"droppedBytes"`
	Truncated     *bool   `json:"truncated"`
	WireTruncated bool    `json:"wireTruncated"`
	Complete      bool    `json:"complete"`
	SHA256        string  `json:"sha256,omitempty"`
}
type LogReadback struct {
	Code      string     `json:"code"`
	RunID     string     `json:"runId"`
	Authority bool       `json:"authority"`
	Stdout    *LogStream `json:"stdout"`
	Stderr    *LogStream `json:"stderr"`
}

type capturedLog struct {
	mu       sync.Mutex
	file     *os.File
	path     string
	identity FileIdentity
	limit    uint64
	observed uint64
	captured uint64
	fault    error
	closed   bool
}
type runLogs struct {
	stdout, stderr *capturedLog
	record         runLogRecord
}

func logFileIdentity(i FileIdentity) FileIdentity { i.Bytes = ""; return i }

func (m *Manager) initializeLogs() (bool, error) {
	if len(m.state.Logs) > MaxRetainedLogRuns {
		return false, ErrUnsafePath
	}
	path := filepath.Join(m.directory, "logs")
	migrated := m.state.LogsIdentity == nil
	if migrated {
		// Only a new empty directory may be introduced by this migration. Never
		// adopt a pre-existing directory or retained unknown run as manager data.
		if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
			return false, ErrUnsafePath
		}
		if len(m.state.Logs) != 0 {
			return false, ErrUnsafePath
		}
	}
	info, err := privateDir(path, m.uid, migrated)
	if err != nil {
		return false, err
	}
	current := identity(info)
	if migrated {
		m.state.LogsIdentity = &current
	} else if *m.state.LogsIdentity != current {
		return false, ErrUnsafePath
	}
	seen := make(map[string]bool)
	for _, record := range m.state.Logs {
		raw, err := hex.DecodeString(record.RunID)
		if err != nil || len(raw) != 24 || hex.EncodeToString(raw) != record.RunID || seen[record.RunID] || record.Limit == 0 || record.Limit > MaxLogStreamBytes {
			return false, ErrUnsafePath
		}
		seen[record.RunID] = true
	}
	return migrated, nil
}

func (m *Manager) logBudget(artifactBytes uint64, capacity Capacity) (uint64, error) {
	if len(m.state.Logs) >= MaxRetainedLogRuns || artifactBytes > m.quotaBytes || capacity.UsedBytes > m.quotaBytes-artifactBytes {
		return 0, ErrCapacity
	}
	available := m.quotaBytes - artifactBytes - capacity.UsedBytes
	// Reserve journal growth and the fixed runtime capture before any child.
	if available <= 4096 {
		return 0, ErrCapacity
	}
	limit := (available - 4096) / 2
	if limit > MaxLogStreamBytes {
		limit = MaxLogStreamBytes
	}
	if _, err := m.capacity(artifactBytes + 4096 + 2*limit); err != nil {
		return 0, err
	}
	return limit, nil
}

func (m *Manager) createRunLogs(runID string, limit uint64) (*runLogs, error) {
	if err := m.rootUnchanged(); err != nil {
		return nil, err
	}
	dir := filepath.Join(m.directory, "logs", runID)
	if err := os.Mkdir(dir, 0700); err != nil {
		return nil, err
	}
	info, err := privateDir(dir, m.uid, false)
	if err != nil {
		return nil, err
	}
	r := &runLogs{record: runLogRecord{RunID: runID, Directory: identity(info), Limit: limit}}
	for _, name := range []string{"stdout", "stderr"} {
		path := filepath.Join(dir, name+".log")
		file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
		if err != nil {
			r.close()
			return nil, err // Preserve partial/unknown files; never recursive cleanup.
		}
		fi, err := file.Stat()
		if err != nil {
			file.Close()
			r.close()
			return nil, err
		}
		stream := &capturedLog{file: file, path: path, identity: identity(fi), limit: limit}
		record := logStreamRecord{Identity: stream.identity, Observed: "0", Dropped: "0"}
		if name == "stdout" {
			r.stdout, r.record.Stdout = stream, record
		} else {
			r.stderr, r.record.Stderr = stream, record
		}
	}
	for _, s := range []*capturedLog{r.stdout, r.stderr} {
		if err := s.file.Sync(); err != nil {
			r.close()
			return nil, err
		}
	}
	for _, path := range []string{dir, filepath.Join(m.directory, "logs")} {
		f, err := os.Open(path)
		if err != nil {
			r.close()
			return nil, err
		}
		err = f.Sync()
		_ = f.Close()
		if err != nil {
			r.close()
			return nil, err
		}
	}
	if err := m.rootUnchanged(); err != nil {
		r.close()
		return nil, err
	}
	m.state.Logs = append(m.state.Logs, r.record)
	if err := m.save(); err != nil {
		r.close()
		return nil, err
	}
	return r, nil
}

func (s *capturedLog) unchanged() error {
	if s.closed {
		return ErrClosed
	}
	info, err := s.file.Stat()
	if err != nil || logFileIdentity(identity(info)) != logFileIdentity(s.identity) || info.Size() < 0 || uint64(info.Size()) != s.captured {
		return ErrUnsafePath
	}
	named, err := os.Lstat(s.path)
	if err != nil || !os.SameFile(info, named) || info.Mode() != named.Mode() || info.Size() != named.Size() {
		return ErrUnsafePath
	}
	return nil
}
func (s *capturedLog) Write(raw []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if uint64(len(raw)) > math.MaxUint64-s.observed {
		s.observed = math.MaxUint64
		s.fault = ErrCapacity
	} else {
		s.observed += uint64(len(raw))
	}
	if s.fault == nil {
		s.fault = s.unchanged()
	}
	if s.fault == nil && s.captured < s.limit {
		keep := uint64(len(raw))
		if keep > s.limit-s.captured {
			keep = s.limit - s.captured
		}
		n, err := s.file.Write(raw[:int(keep)])
		s.captured += uint64(n)
		if err != nil {
			s.fault = err
		} else if n != int(keep) {
			s.fault = io.ErrShortWrite
		}
	}
	// A full capture is an observation limit, not permission to block stdout
	// forever or grow disk. The caller always drains until original child Wait.
	return len(raw), nil
}
func (r *runLogs) close() {
	for _, s := range []*capturedLog{r.stdout, r.stderr} {
		if s != nil {
			s.mu.Lock()
			if !s.closed {
				_ = s.file.Close()
				s.closed = true
			}
			s.mu.Unlock()
		}
	}
}
func (m *Manager) logFilesUnchanged(r *runLogs) error {
	if r == nil {
		return ErrUnsafePath
	}
	info, err := privateDir(filepath.Join(m.directory, "logs", r.record.RunID), m.uid, false)
	if err != nil || identity(info) != r.record.Directory {
		return ErrUnsafePath
	}
	for _, s := range []*capturedLog{r.stdout, r.stderr} {
		s.mu.Lock()
		err = s.unchanged()
		if s.fault != nil {
			err = s.fault
		}
		s.mu.Unlock()
		if err != nil {
			return err
		}
	}
	return nil
}
func (m *Manager) finishRunLogs(r *runLogs) error {
	if r == nil {
		return nil
	}
	defer r.close()
	if err := m.rootUnchanged(); err != nil {
		return err
	}
	if err := m.logFilesUnchanged(r); err != nil {
		return err
	}
	for index, s := range []*capturedLog{r.stdout, r.stderr} {
		s.mu.Lock()
		err := s.file.Sync()
		raw, info, readErr := readOwnedFile(s.path, m.uid, int64(s.limit))
		if err == nil {
			err = readErr
		}
		if err != nil {
			s.mu.Unlock()
			return err
		}
		sum := sha256.Sum256(raw)
		record := logStreamRecord{Identity: identity(info), Observed: strconv.FormatUint(s.observed, 10), Dropped: strconv.FormatUint(s.observed-s.captured, 10), SHA256: hex.EncodeToString(sum[:])}
		s.mu.Unlock()
		if index == 0 {
			r.record.Stdout = record
		} else {
			r.record.Stderr = record
		}
	}
	r.record.Complete = true
	for i := range m.state.Logs {
		if m.state.Logs[i].RunID == r.record.RunID {
			m.state.Logs[i] = r.record
			return nil
		}
	}
	return ErrUnsafePath
}

// ReadLogs reads a known managed run. It never follows a supplied filename,
// clears UNKNOWN, starts a process, or treats stored PIDs as control handles.
func (m *Manager) ReadLogs(peer localipc.Peer, runID string) (LogReadback, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.peerAllowed(peer); err != nil {
		return LogReadback{}, err
	}
	if m.closed {
		return LogReadback{}, ErrClosed
	}
	if err := m.rootUnchanged(); err != nil {
		return LogReadback{}, err
	}
	return m.readLogs(runID)
}
func (m *Manager) readLogs(runID string) (LogReadback, error) {
	if runID == "" {
		runID = m.state.RunID
	}
	out := LogReadback{Code: "NOT_SUPPLIED", RunID: runID}
	for _, record := range m.state.Logs {
		if record.RunID != runID {
			continue
		}
		info, err := privateDir(filepath.Join(m.directory, "logs", runID), m.uid, false)
		if err != nil || identity(info) != record.Directory {
			return out, ErrUnsafePath
		}
		out.Code = "INCOMPLETE"
		if record.Complete {
			out.Code = "CAPTURED"
		}
		for i, name := range []string{"stdout", "stderr"} {
			stored := record.Stdout
			if i == 1 {
				stored = record.Stderr
			}
			var active *capturedLog
			if m.process != nil && m.process.runID == runID {
				active = m.process.logs.stdout
				if i == 1 {
					active = m.process.logs.stderr
				}
				active.mu.Lock()
			}
			stream, err := m.readLogStream(filepath.Join(m.directory, "logs", runID, name+".log"), stored, record, active)
			if active != nil {
				active.mu.Unlock()
				out.Code = "CAPTURING"
			}
			if err != nil {
				return LogReadback{Code: "UNAVAILABLE", RunID: runID}, err
			}
			if i == 0 {
				out.Stdout = &stream
			} else {
				out.Stderr = &stream
			}
		}
		return out, nil
	}
	return out, nil
}
func (m *Manager) readLogStream(path string, stored logStreamRecord, record runLogRecord, active *capturedLog) (LogStream, error) {
	out := LogStream{Encoding: "utf-8-with-replacement", Complete: record.Complete}
	raw, info, err := readOwnedFile(path, m.uid, int64(record.Limit))
	if err != nil || logFileIdentity(identity(info)) != logFileIdentity(stored.Identity) {
		return out, ErrUnsafePath
	}
	if record.Complete && identity(info) != stored.Identity {
		return out, ErrUnsafePath
	}
	sum := sha256.Sum256(raw)
	out.SHA256 = hex.EncodeToString(sum[:])
	if record.Complete && out.SHA256 != stored.SHA256 {
		return out, ErrUnsafePath
	}
	out.CapturedBytes = strconv.Itoa(len(raw))
	if record.Complete || active != nil {
		observed, dropped := stored.Observed, stored.Dropped
		if active != nil {
			if err := active.unchanged(); err != nil || active.fault != nil {
				return out, ErrUnsafePath
			}
			observed = strconv.FormatUint(active.observed, 10)
			dropped = strconv.FormatUint(active.observed-active.captured, 10)
		}
		n, e1 := strconv.ParseUint(observed, 10, 64)
		d, e2 := strconv.ParseUint(dropped, 10, 64)
		if e1 != nil || e2 != nil || strconv.FormatUint(n, 10) != observed || strconv.FormatUint(d, 10) != dropped || n < uint64(len(raw)) || n-uint64(len(raw)) != d {
			return out, ErrUnsafePath
		}
		truncated := d != 0
		out.ObservedBytes, out.DroppedBytes, out.Truncated = &observed, &dropped, &truncated
	}
	if len(raw) > LogWireTailBytes {
		raw = raw[len(raw)-LogWireTailBytes:]
		out.WireTruncated = true
	}
	// JSON serialization escapes control characters; the viewer must use text.
	// Replacing invalid UTF-8 affects display only. SHA/capture refer to raw bytes.
	if utf8.Valid(raw) {
		out.Text = string(raw)
	} else {
		out.Text = string([]rune(string(raw)))
	}
	return out, nil
}
