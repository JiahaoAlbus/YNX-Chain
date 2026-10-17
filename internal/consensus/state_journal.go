package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

const snapshotJournalMagic = "YNX_ABCI_SNAPSHOT_JOURNAL_V1\n"
const snapshotJournalHeader = 8 + 2*sha256.Size
const snapshotJournalMaxPayload = 32 * 1024 * 1024
const snapshotJournalCompactRecords = 16

// This opt-in backend keeps the exact full snapshot JSON, not transaction
// deltas. Append+file Sync amortizes directory Sync over atomic compactions.
// It does not solve full-history encoding or the long-run state-size ceiling.
type snapshotJournal struct {
	path         string
	header       []byte
	identity     os.FileInfo
	observedSize int64
	end          int64
	lastOffset   int64
	lastBytes    int64
	records      int
	height       int64
	poisoned     bool
	compactions  int
	fault        func(string) error // nil in normal operation; owned fault-injection tests only
}

func (j *snapshotJournal) checkpoint(stage string) error {
	if j.fault != nil {
		return j.fault(stage)
	}
	return nil
}

func journalRegularFile(path string, flags int) (*os.File, error) {
	before, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !before.Mode().IsRegular() || before.Mode().Perm() != 0o600 {
		return nil, errors.New("journal file must be regular and 0600")
	}
	f, err := os.OpenFile(path, flags, 0o600)
	if err != nil {
		return nil, err
	}
	after, err := f.Stat()
	if err != nil || !os.SameFile(before, after) {
		_ = f.Close()
		return nil, errors.New("journal identity changed while opening")
	}
	return f, nil
}

func syncJournalDirectory(path string) error {
	d, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	return errors.Join(d.Sync(), d.Close())
}

func (j *snapshotJournal) lock() (*os.File, error) {
	lockPath := j.path + ".lock"
	// Creation does not replace an existing lock inode. The lock file is never
	// deleted, including on failures; the kernel releases only our own flock.
	created, err := os.OpenFile(lockPath, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0o600)
	if err == nil {
		err = errors.Join(created.Sync(), created.Close(), syncJournalDirectory(lockPath))
		if err != nil {
			return nil, err
		}
	} else if !errors.Is(err, os.ErrExist) {
		return nil, err
	}
	f, err := journalRegularFile(lockPath, os.O_RDWR)
	if err != nil {
		return nil, err
	}
	if err := lockSnapshotJournal(f); err != nil {
		_ = f.Close()
		return nil, fmt.Errorf("snapshot journal writer already active or lock unavailable: %w", err)
	}
	return f, nil
}

func releaseJournalLock(f *os.File) { unlockSnapshotJournal(f); _ = f.Close() }

func openSnapshotJournal(path string, migration chain.ConsensusMigrationState) (*snapshotJournal, CommittedState, error) {
	j := &snapshotJournal{path: path, header: []byte(snapshotJournalMagic + migration.StateHash + "\n"), height: int64(migration.Height)}
	initial := initialCommittedState(migration)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, CommittedState{}, err
	}
	lock, err := j.lock()
	if err != nil {
		return nil, CommittedState{}, err
	}
	defer releaseJournalLock(lock)
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err == nil {
		n, writeErr := f.Write(j.header)
		if n != len(j.header) && writeErr == nil {
			writeErr = io.ErrShortWrite
		}
		err = errors.Join(writeErr, f.Sync(), f.Close(), syncJournalDirectory(path))
		if err != nil {
			return nil, CommittedState{}, err
		}
	} else if !errors.Is(err, os.ErrExist) {
		return nil, CommittedState{}, err
	}
	f, err = journalRegularFile(path, os.O_RDONLY)
	if err != nil {
		return nil, CommittedState{}, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, CommittedState{}, err
	}
	if info.Size() > int64((snapshotJournalMaxPayload+snapshotJournalHeader)*snapshotJournalCompactRecords+len(j.header)) {
		return nil, CommittedState{}, errors.New("snapshot journal exceeds bounded record capacity")
	}
	got := make([]byte, len(j.header))
	if _, err := io.ReadFull(f, got); err != nil || !bytes.Equal(got, j.header) {
		return nil, CommittedState{}, errors.New("snapshot journal header or migration mismatch")
	}
	j.identity, j.observedSize, j.end = info, info.Size(), int64(len(j.header))
	var latest []byte
	for {
		offset := j.end
		header := make([]byte, snapshotJournalHeader)
		_, err := io.ReadFull(f, header)
		if err == io.EOF || err == io.ErrUnexpectedEOF {
			break
		}
		if err != nil {
			return nil, CommittedState{}, err
		}
		headerSum := sha256.Sum256(header[:8])
		if !bytes.Equal(headerSum[:], header[8:40]) {
			return nil, CommittedState{}, errors.New("journal record header checksum mismatch")
		}
		length := binary.BigEndian.Uint64(header[:8])
		if length == 0 || length > snapshotJournalMaxPayload {
			return nil, CommittedState{}, errors.New("invalid journal record length")
		}
		payload := make([]byte, int(length))
		if _, err := io.ReadFull(f, payload); err == io.EOF || err == io.ErrUnexpectedEOF {
			break
		} else if err != nil {
			return nil, CommittedState{}, err
		}
		sum := journalRecordDigest(header[:8], payload)
		if !bytes.Equal(sum[:], header[40:]) {
			return nil, CommittedState{}, errors.New("complete journal record checksum mismatch")
		}
		var identity struct {
			Height int64 `json:"height"`
		}
		// Full state validation follows for the newest complete snapshot. Earlier
		// complete records still require valid framing/checksum and monotonicity.
		if err := decodeJournalIdentity(payload, &identity.Height); err != nil || identity.Height <= j.height {
			return nil, CommittedState{}, errors.New("invalid journal height sequence")
		}
		j.height = identity.Height
		j.records++
		if j.records > snapshotJournalCompactRecords {
			return nil, CommittedState{}, errors.New("too many snapshot journal records")
		}
		j.lastOffset, j.lastBytes = offset, int64(snapshotJournalHeader)+int64(length)
		j.end += j.lastBytes
		latest = payload
	}
	if latest == nil {
		return j, initial, nil
	}
	var state CommittedState
	if err := decodeStrictJSON(latest, &state); err != nil {
		return nil, CommittedState{}, err
	}
	if err := state.Validate(migration); err != nil {
		return nil, CommittedState{}, fmt.Errorf("validate journal state: %w", err)
	}
	return j, state, nil
}

func journalRecordDigest(length, payload []byte) [sha256.Size]byte {
	h := sha256.New()
	_, _ = h.Write(length)
	_, _ = h.Write(payload)
	var sum [sha256.Size]byte
	copy(sum[:], h.Sum(nil))
	return sum
}

func (j *snapshotJournal) compact(old *os.File) error {
	temp, err := os.CreateTemp(filepath.Dir(j.path), ".ynx-journal-compact-*")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer temp.Close()
	defer os.Remove(tempPath)
	if err := temp.Chmod(0o600); err != nil {
		_ = temp.Close()
		return err
	}
	if _, err := temp.Write(j.header); err != nil {
		_ = temp.Close()
		return err
	}
	if _, err := io.CopyN(temp, io.NewSectionReader(old, j.lastOffset, j.lastBytes), j.lastBytes); err != nil {
		_ = temp.Close()
		return err
	}
	if err := errors.Join(temp.Sync(), temp.Close()); err != nil {
		return err
	}
	if err := j.checkpoint("compaction_synced"); err != nil {
		return err
	}
	if err := os.Rename(tempPath, j.path); err != nil {
		return err
	}
	if err := j.checkpoint("compaction_renamed"); err != nil {
		return err
	}
	if err := syncJournalDirectory(j.path); err != nil {
		return err
	}
	j.compactions++
	j.records = 1
	j.lastOffset = int64(len(j.header))
	j.end = int64(len(j.header)) + j.lastBytes
	j.observedSize = j.end
	j.identity, err = os.Stat(j.path)
	return err
}

func (j *snapshotJournal) save(state CommittedState, migration chain.ConsensusMigrationState, timings *commitTimings) (err error) {
	if j.poisoned {
		return errors.New("snapshot journal write outcome uncertain; reopen for recovery")
	}
	defer func() {
		if err != nil {
			j.poisoned = true
		}
	}()
	started := timings.start()
	if err := state.Validate(migration); err != nil {
		return err
	}
	if state.Height <= j.height {
		return errors.New("journal state height must advance")
	}
	started = timings.mark("validate", started)
	payload, err := encodeCommittedStateJSON(state)
	if err != nil {
		return err
	}
	if len(payload) > snapshotJournalMaxPayload {
		return errors.New("snapshot exceeds journal payload ceiling")
	}
	if timings != nil {
		timings.bytes = len(payload)
	}
	started = timings.mark("json_encode", started)
	lock, err := j.lock()
	if err != nil {
		return err
	}
	defer releaseJournalLock(lock)
	f, err := journalRegularFile(j.path, os.O_RDWR)
	if err != nil {
		return err
	}
	defer func() {
		if f != nil {
			_ = f.Close()
		}
	}()
	info, err := f.Stat()
	if err != nil {
		return err
	}
	if !os.SameFile(info, j.identity) || info.Size() != j.observedSize {
		return errors.New("journal changed since load or previous commit")
	}
	if j.records >= snapshotJournalCompactRecords {
		if err := j.compact(f); err != nil {
			return err
		}
		if err := f.Close(); err != nil {
			return err
		}
		f = nil
		f, err = journalRegularFile(j.path, os.O_RDWR)
		if err != nil {
			return err
		}
	}
	started = timings.mark("journal_maintenance", started)
	if err := f.Truncate(j.end); err != nil {
		return err
	}
	if _, err := f.Seek(j.end, io.SeekStart); err != nil {
		return err
	}
	started = timings.mark("prepare_file", started)
	header := make([]byte, snapshotJournalHeader)
	binary.BigEndian.PutUint64(header[:8], uint64(len(payload)))
	sum := journalRecordDigest(header[:8], payload)
	headerSum := sha256.Sum256(header[:8])
	copy(header[8:40], headerSum[:])
	copy(header[40:], sum[:])
	if n, err := f.Write(header); err != nil || n != len(header) {
		return errors.Join(err, io.ErrShortWrite)
	}
	if err := j.checkpoint("append_header_written"); err != nil {
		return err
	}
	if n, err := f.Write(payload); err != nil || n != len(payload) {
		return errors.Join(err, io.ErrShortWrite)
	}
	if err := j.checkpoint("append_payload_written"); err != nil {
		return err
	}
	started = timings.mark("write", started)
	if err := f.Sync(); err != nil {
		return err
	}
	if err := j.checkpoint("append_synced"); err != nil {
		return err
	}
	started = timings.mark("file_sync", started)
	if err := f.Close(); err != nil {
		f = nil
		return err
	}
	f = nil
	timings.mark("close_file", started)
	j.lastOffset, j.lastBytes = j.end, int64(len(header)+len(payload))
	j.end += j.lastBytes
	j.observedSize = j.end
	j.records++
	j.height = state.Height
	return nil
}

func decodeJournalIdentity(payload []byte, height *int64) error {
	var identity struct {
		Height int64 `json:"height"`
	}
	if err := json.Unmarshal(payload, &identity); err != nil {
		return err
	}
	*height = identity.Height
	return nil
}
