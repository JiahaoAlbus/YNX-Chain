package consensus

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
)

const blockJournalMagic = "YNX_ABCI_BLOCK_JOURNAL_V2\n"
const blockJournalMaxFrame = 512 << 20
const blockJournalMaxRequest = 8 << 20
const blockJournalCheckpointBlocks = 16
const blockJournalTailTarget = 4 << 20

type blockJournalRecord struct {
	Kind          string          `json:"kind"`
	Snapshot      *CommittedState `json:"snapshot,omitempty"`
	Request       []byte          `json:"request,omitempty"`
	BeforeAppHash string          `json:"beforeAppHash,omitempty"`
	AppHash       string          `json:"appHash,omitempty"`
	ResponseHash  string          `json:"responseHash,omitempty"`
}

type blockJournal struct {
	io                     *snapshotJournal // framing, fixed writer/read locks and owned fault hooks
	tailBytes              int64
	blocks                 int
	checkpointBytesWritten int64
	appHash                string
	replayedTxInputs       int
}

func finalizeResponseHash(response *abci.ResponseFinalizeBlock) (string, error) {
	raw, err := response.Marshal()
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}

func blockJournalFrame(payload []byte) []byte {
	header := make([]byte, snapshotJournalHeader)
	binary.BigEndian.PutUint64(header[:8], uint64(len(payload)))
	sum := sha256.Sum256(header[:8])
	copy(header[8:40], sum[:])
	sum = journalRecordDigest(header[:8], payload)
	copy(header[40:], sum[:])
	return header
}

func readBlockJournalFrame(r io.Reader) ([]byte, int64, bool, error) {
	return readBlockJournalFrameLimit(r, blockJournalMaxFrame)
}

func readBlockJournalFrameLimit(r io.Reader, limit uint64) ([]byte, int64, bool, error) {
	header := make([]byte, snapshotJournalHeader)
	n, err := io.ReadFull(r, header)
	if err == io.EOF || err == io.ErrUnexpectedEOF {
		return nil, 0, n != 0, nil
	}
	if err != nil {
		return nil, 0, false, err
	}
	sum := sha256.Sum256(header[:8])
	if !bytes.Equal(sum[:], header[8:40]) {
		return nil, 0, false, errors.New("block journal length checksum mismatch")
	}
	length := binary.BigEndian.Uint64(header[:8])
	if length == 0 || length > limit {
		return nil, 0, false, errors.New("block journal frame exceeds bounds")
	}
	// A valid length checksum is not permission to allocate absent tail bytes.
	// Both file recovery and pure byte readback provide a known remaining size.
	available := int64(-1)
	if bounded, ok := r.(interface{ Len() int }); ok {
		available = int64(bounded.Len())
	}
	if section, ok := r.(*io.SectionReader); ok {
		position, err := section.Seek(0, io.SeekCurrent)
		if err != nil {
			return nil, 0, false, err
		}
		available = section.Size() - position
	}
	if available >= 0 && uint64(available) < length {
		return nil, 0, true, nil
	}
	payload := make([]byte, int(length))
	if _, err := io.ReadFull(r, payload); err == io.EOF || err == io.ErrUnexpectedEOF {
		return nil, 0, true, nil
	} else if err != nil {
		return nil, 0, false, err
	}
	sum = journalRecordDigest(header[:8], payload)
	if !bytes.Equal(sum[:], header[40:]) {
		return nil, 0, false, errors.New("complete block journal checksum mismatch")
	}
	return payload, int64(snapshotJournalHeader) + int64(length), false, nil
}

// Full FinalizeBlock requests are stored as owned protobuf bytes, including
// failed transactions and metadata; replay compares the entire response hash.
func replayBlockJournal(ctx context.Context, r io.Reader, migration chain.ConsensusMigrationState, j *blockJournal) (CommittedState, error) {
	header := make([]byte, len(j.io.header))
	if _, err := io.ReadFull(r, header); err != nil || !bytes.Equal(header, j.io.header) {
		return CommittedState{}, errors.New("block journal format/migration mismatch")
	}
	replay, err := NewApplication(migration)
	if err != nil {
		return CommittedState{}, err
	}
	j.io.end = int64(len(header))
	for {
		if err := ctx.Err(); err != nil {
			return CommittedState{}, err
		}
		limit := uint64(blockJournalMaxFrame)
		if j.io.records > 0 {
			limit = 2 * blockJournalMaxRequest
		}
		payload, frameBytes, _, err := readBlockJournalFrameLimit(r, limit)
		if err != nil {
			return CommittedState{}, err
		}
		if payload == nil {
			break
		}
		var record blockJournalRecord
		if err := decodeStrictJSON(payload, &record); err != nil {
			return CommittedState{}, err
		}
		if j.io.records == 0 {
			if record.Kind != "checkpoint" || record.Snapshot == nil || len(record.Request) != 0 || record.BeforeAppHash != "" || record.AppHash != "" || record.ResponseHash != "" {
				return CommittedState{}, errors.New("block journal must begin with one canonical checkpoint")
			}
			if err := record.Snapshot.Validate(migration); err != nil {
				return CommittedState{}, err
			}
			replay.committed = *record.Snapshot
		} else {
			if record.Kind != "block" || record.Snapshot != nil || len(record.Request) == 0 || len(record.Request) > blockJournalMaxRequest || record.BeforeAppHash != replay.committed.AppHash {
				return CommittedState{}, errors.New("invalid block journal delta or prior AppHash")
			}
			if j.blocks >= blockJournalCheckpointBlocks {
				return CommittedState{}, errors.New("block journal replay exceeds checkpoint interval")
			}
			var req abci.RequestFinalizeBlock
			if err := req.Unmarshal(record.Request); err != nil {
				return CommittedState{}, err
			}
			j.replayedTxInputs += len(req.Txs)
			response, err := replay.FinalizeBlock(ctx, &req)
			if err != nil {
				return CommittedState{}, err
			}
			hash, err := finalizeResponseHash(response)
			if err != nil {
				return CommittedState{}, err
			}
			if hex.EncodeToString(response.AppHash) != record.AppHash || hash != record.ResponseHash {
				return CommittedState{}, errors.New("block journal replay state/transaction response mismatch")
			}
			if _, err := replay.Commit(ctx, &abci.RequestCommit{}); err != nil {
				return CommittedState{}, err
			}
			j.blocks++
			j.tailBytes += frameBytes
		}
		j.io.records++
		j.io.end += frameBytes
	}
	if j.io.records == 0 {
		return CommittedState{}, errors.New("block journal missing complete checkpoint")
	}
	if err := replay.committed.Validate(migration); err != nil {
		return CommittedState{}, err
	}
	j.io.height = replay.committed.Height
	j.appHash = replay.committed.AppHash
	return replay.committed, nil
}

func encodeBlockCheckpoint(state CommittedState) ([]byte, error) {
	return json.Marshal(blockJournalRecord{Kind: "checkpoint", Snapshot: &state})
}

func openBlockJournal(path string, migration chain.ConsensusMigrationState) (*blockJournal, CommittedState, error) {
	j := &blockJournal{io: &snapshotJournal{path: path, header: []byte(blockJournalMagic + migration.StateHash + "\n")}}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, CommittedState{}, err
	}
	lock, err := j.io.lock()
	if err != nil {
		return nil, CommittedState{}, err
	}
	defer releaseJournalLock(lock)
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0o600)
	if err == nil {
		initial := initialCommittedState(migration)
		if err := initial.Validate(migration); err != nil {
			_ = f.Close()
			return nil, CommittedState{}, err
		}
		payload, err := encodeBlockCheckpoint(initial)
		if err != nil {
			_ = f.Close()
			return nil, CommittedState{}, err
		}
		if len(payload) > blockJournalMaxFrame {
			_ = f.Close()
			return nil, CommittedState{}, errors.New("initial checkpoint exceeds block journal frame bound")
		}
		if n, err := f.Write(j.io.header); err != nil || n != len(j.io.header) {
			_ = f.Close()
			return nil, CommittedState{}, errors.Join(err, io.ErrShortWrite)
		}
		if err := j.writeFrame(f, payload, false); err != nil {
			_ = f.Close()
			return nil, CommittedState{}, err
		}
		if err := errors.Join(f.Sync(), f.Close(), syncJournalDirectory(path)); err != nil {
			return nil, CommittedState{}, err
		}
	} else if !errors.Is(err, os.ErrExist) {
		return nil, CommittedState{}, err
	}
	f, err = journalRegularFile(path, os.O_RDWR)
	if err != nil {
		return nil, CommittedState{}, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, CommittedState{}, err
	}
	if info.Size() > int64(blockJournalMaxFrame+blockJournalCheckpointBlocks*(2*blockJournalMaxRequest+snapshotJournalHeader)+len(j.io.header)) {
		return nil, CommittedState{}, errors.New("block journal file exceeds bounded checkpoint/tail capacity")
	}
	state, err := replayBlockJournal(context.Background(), io.NewSectionReader(f, 0, info.Size()), migration, j)
	if err != nil {
		return nil, CommittedState{}, err
	}
	if err := f.Sync(); err != nil {
		return nil, CommittedState{}, err
	}
	j.io.identity, j.io.observedSize = info, info.Size()
	return j, state, nil
}

func (j *blockJournal) writeFrame(f *os.File, payload []byte, hooks bool) error {
	header := blockJournalFrame(payload)
	if n, err := f.Write(header); err != nil || n != len(header) {
		return errors.Join(err, io.ErrShortWrite)
	}
	if hooks {
		if err := j.io.checkpoint("append_header_written"); err != nil {
			return err
		}
	}
	if n, err := f.Write(payload); err != nil || n != len(payload) {
		return errors.Join(err, io.ErrShortWrite)
	}
	if hooks {
		return j.io.checkpoint("append_payload_written")
	}
	return nil
}

func (j *blockJournal) checkCurrentFile() (*os.File, error) {
	f, err := journalRegularFile(j.io.path, os.O_RDWR)
	if err != nil {
		return nil, err
	}
	info, err := f.Stat()
	if err != nil || !os.SameFile(info, j.io.identity) || info.Size() != j.io.observedSize {
		_ = f.Close()
		return nil, errors.New("block journal changed since load or prior save")
	}
	return f, nil
}

func (j *blockJournal) replaceCheckpointLocked(state CommittedState) error {
	payload, err := encodeBlockCheckpoint(state)
	if err != nil {
		return err
	}
	if len(payload) > blockJournalMaxFrame {
		return errors.New("checkpoint exceeds block journal frame bound")
	}
	temp, err := os.CreateTemp(filepath.Dir(j.io.path), ".ynx-block-checkpoint-*")
	if err != nil {
		return err
	}
	defer temp.Close()
	defer os.Remove(temp.Name())
	if err := temp.Chmod(0o600); err != nil {
		return err
	}
	if n, err := temp.Write(j.io.header); err != nil || n != len(j.io.header) {
		return errors.Join(err, io.ErrShortWrite)
	}
	if err := j.writeFrame(temp, payload, false); err != nil {
		return err
	}
	if err := errors.Join(temp.Sync(), temp.Close()); err != nil {
		return err
	}
	if err := j.io.checkpoint("compaction_synced"); err != nil {
		return err
	}
	if err := os.Rename(temp.Name(), j.io.path); err != nil {
		return err
	}
	if err := j.io.checkpoint("compaction_renamed"); err != nil {
		return err
	}
	if err := syncJournalDirectory(j.io.path); err != nil {
		return err
	}
	j.io.identity, err = os.Stat(j.io.path)
	if err != nil {
		return err
	}
	j.io.end = int64(len(j.io.header) + snapshotJournalHeader + len(payload))
	j.io.observedSize = j.io.end
	j.io.height = state.Height
	j.appHash = state.AppHash
	j.io.records = 1
	j.io.compactions++
	j.blocks = 0
	j.tailBytes = 0
	j.checkpointBytesWritten += int64(len(payload))
	return nil
}

func (j *blockJournal) replaceCheckpoint(state CommittedState, migration chain.ConsensusMigrationState) (err error) {
	if j.io.poisoned {
		return errors.New("block journal write outcome uncertain; reopen for recovery")
	}
	defer func() {
		if err != nil {
			j.io.poisoned = true
		}
	}()
	if err := state.Validate(migration); err != nil {
		return err
	}
	if state.Height < j.io.height {
		return errors.New("block journal checkpoint cannot roll back height")
	}
	if state.Height == j.io.height && state.AppHash != j.appHash {
		return errors.New("block journal cannot replace same-height state with another AppHash")
	}
	lock, err := j.io.lock()
	if err != nil {
		return err
	}
	defer releaseJournalLock(lock)
	f, err := j.checkCurrentFile()
	if err != nil {
		return err
	}
	defer f.Close()
	return j.replaceCheckpointLocked(state)
}

func (j *blockJournal) saveBlock(previous, next CommittedState, request []byte, responseHash string, migration chain.ConsensusMigrationState, timings *commitTimings) (err error) {
	if j.io.poisoned {
		return errors.New("block journal write outcome uncertain; reopen for recovery")
	}
	defer func() {
		if err != nil {
			j.io.poisoned = true
		}
	}()
	started := timings.start()
	if err := next.Validate(migration); err != nil {
		return err
	}
	if previous.Height != j.io.height || previous.AppHash != j.appHash || next.Height != previous.Height+1 || len(request) == 0 || len(request) > blockJournalMaxRequest {
		return errors.New("invalid block journal pending request/height")
	}
	if value, err := hex.DecodeString(responseHash); err != nil || len(value) != sha256.Size {
		return errors.New("invalid pending block response hash")
	}
	var req abci.RequestFinalizeBlock
	if err := req.Unmarshal(request); err != nil || req.Height != next.Height {
		return errors.New("block journal request differs from pending height")
	}
	started = timings.mark("validate", started)
	payload, err := json.Marshal(blockJournalRecord{Kind: "block", Request: request, BeforeAppHash: previous.AppHash, AppHash: next.AppHash, ResponseHash: responseHash})
	if err != nil {
		return err
	}
	if len(payload) > 2*blockJournalMaxRequest {
		return errors.New("block journal delta exceeds encoding bound")
	}
	if timings != nil {
		timings.bytes = len(payload)
	}
	started = timings.mark("delta_encode", started)
	lock, err := j.io.lock()
	if err != nil {
		return err
	}
	defer releaseJournalLock(lock)
	f, err := j.checkCurrentFile()
	if err != nil {
		return err
	}
	defer func() {
		if f != nil {
			_ = f.Close()
		}
	}()
	if j.blocks >= blockJournalCheckpointBlocks || (j.blocks > 0 && j.tailBytes+int64(snapshotJournalHeader+len(payload)) > blockJournalTailTarget) {
		if err := j.replaceCheckpointLocked(previous); err != nil {
			return err
		}
		if err := f.Close(); err != nil {
			return err
		}
		f = nil
		f, err = journalRegularFile(j.io.path, os.O_RDWR)
		if err != nil {
			return err
		}
	}
	started = timings.mark("journal_maintenance", started)
	if err := f.Truncate(j.io.end); err != nil {
		return err
	}
	if _, err := f.Seek(j.io.end, io.SeekStart); err != nil {
		return err
	}
	started = timings.mark("prepare_file", started)
	if err := j.writeFrame(f, payload, true); err != nil {
		return err
	}
	started = timings.mark("write", started)
	if err := f.Sync(); err != nil {
		return err
	}
	if err := j.io.checkpoint("append_synced"); err != nil {
		return err
	}
	started = timings.mark("file_sync", started)
	if err := f.Close(); err != nil {
		f = nil
		return err
	}
	f = nil
	timings.mark("close_file", started)
	frameBytes := int64(snapshotJournalHeader + len(payload))
	j.io.end += frameBytes
	j.io.observedSize = j.io.end
	j.io.height = next.Height
	j.appHash = next.AppHash
	j.io.records++
	j.blocks++
	j.tailBytes += frameBytes
	return nil
}
