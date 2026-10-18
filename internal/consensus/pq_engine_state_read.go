package consensus

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// These are independent inputs to read-only reconstruction, not authority
// recovered from a journal checkpoint. Replay uses the existing memory-only
// application with no path, writer lease, persistence backend or runtime cursor.
type blockJournalReplayAuthority struct {
	bootstrap *ConsensusBootstrap
	engine    *PQEngineAuthorization
	runtime   *RuntimeUpgradeAuthorization
}

func (a *blockJournalReplayAuthority) validateCheckpoint(state CommittedState) error {
	if a.bootstrap == nil {
		return errors.New("journal authority requires independent bootstrap")
	}
	if err := a.engine.ValidateCommittedSchedule(state.PQEngineSchedule, state.Height); err != nil {
		return err
	}
	_, err := runtimeStateApplicationVersion(state, a.runtime)
	return err
}

func (a *blockJournalReplayAuthority) validateDelta(state CommittedState, height int64) error {
	if err := a.validateCheckpoint(state); err != nil {
		return err
	}
	if a.runtime != nil {
		plan, err := a.runtime.Plan()
		if err != nil {
			return err
		}
		// saveBlock writes a complete NEW checkpoint whenever Version changes.
		// A purported old-domain delta crossing U is therefore not a legitimate
		// persisted transition. Do not manufacture a live engine confirmation
		// or silently run it under today's domain to make it replay.
		if state.Version <= 13 && height >= plan.UpgradeHeight {
			return errors.New("runtime upgrade requires the original new-domain journal checkpoint")
		}
	}
	return nil
}

type pqEngineStateRead struct {
	path     string
	info     os.FileInfo
	lockInfo os.FileInfo
	layout   string
	data     []byte
}

func pqStateLayout(prefix []byte) string {
	if IsSnapshotJournal(prefix) {
		return "snapshot-journal"
	}
	if IsBlockJournal(prefix) {
		return "block-journal"
	}
	return "atomic-json"
}

func samePQStateFile(a, b os.FileInfo) bool {
	return a != nil && b != nil && os.SameFile(a, b) && a.Mode() == b.Mode() && a.Size() == b.Size() && a.ModTime() == b.ModTime()
}

// unchanged is also called after expensive decoding. A reader that copied an
// old checkpoint while the writer advanced must not publish it as fresh signing
// authority. No retry and no fallback to the cached or last complete record.
func (r *pqEngineStateRead) unchanged() error {
	if r.layout != "atomic-json" {
		release, err := LockSnapshotJournalRead(r.path)
		if err != nil {
			return err
		}
		defer release()
		lock, err := os.Lstat(r.path + ".read.lock")
		if err != nil || !samePQStateFile(r.lockInfo, lock) {
			return errors.New("journal read lock changed during read-only reconstruction")
		}
	}
	current, err := os.Lstat(r.path)
	if err != nil || !samePQStateFile(r.info, current) {
		return errors.New("committed source changed during read-only reconstruction")
	}
	return nil
}

// Capture only a stable existing file. The shared journal lock is opened
// O_RDONLY, never created, and released before potentially long full replay.
// It coordinates with the existing writer/compactor's exclusive read lock.
func capturePQEngineState(path string) (_ *pqEngineStateRead, result error) {
	probe, err := journalRegularFile(path, os.O_RDONLY)
	if err != nil {
		return nil, err
	}
	prefix := make([]byte, len(snapshotJournalMagic)+len(blockJournalMagic))
	n, readErr := probe.Read(prefix)
	closeErr := probe.Close()
	if readErr != nil && readErr != io.EOF {
		return nil, readErr
	}
	if closeErr != nil {
		return nil, closeErr
	}
	r := &pqEngineStateRead{path: path, layout: pqStateLayout(prefix[:n])}
	if r.layout != "atomic-json" {
		release, err := LockSnapshotJournalRead(path)
		if err != nil {
			return nil, err
		}
		defer release()
		r.lockInfo, err = os.Lstat(path + ".read.lock")
		if err != nil {
			return nil, err
		}
	}
	// Reopen after the lock, so a completed compaction can never leave us
	// reading its superseded inode. The format itself must remain unchanged.
	f, err := journalRegularFile(path, os.O_RDONLY)
	if err != nil {
		return nil, err
	}
	defer func() { result = errors.Join(result, f.Close()) }()
	r.info, err = f.Stat()
	if err != nil {
		return nil, err
	}
	capacity := int64(0)
	switch r.layout {
	case "snapshot-journal":
		capacity = int64(len(snapshotJournalMagic) + 65 + (snapshotJournalHeader+snapshotJournalMaxPayload)*snapshotJournalCompactRecords)
	case "block-journal":
		capacity = int64(len(blockJournalMagic) + 65 + blockJournalMaxFrame + blockJournalCheckpointBlocks*(2*blockJournalMaxRequest+snapshotJournalHeader))
	}
	if r.info.Size() <= 0 || (capacity != 0 && r.info.Size() > capacity) {
		return nil, errors.New("empty committed source or existing journal capacity exceeded")
	}
	// The known-size limit detects growth without an unbounded read. Atomic
	// JSON keeps its existing layout's size policy; journal caps are unchanged.
	r.data, err = io.ReadAll(io.LimitReader(f, r.info.Size()+1))
	if err != nil {
		return nil, err
	}
	after, err := f.Stat()
	if err != nil || !samePQStateFile(r.info, after) || int64(len(r.data)) != r.info.Size() || pqStateLayout(r.data) != r.layout {
		return nil, errors.New("committed source changed during read")
	}
	current, err := os.Lstat(path)
	if err != nil || !samePQStateFile(r.info, current) {
		return nil, errors.New("committed source was replaced during read")
	}
	return r, nil
}

func readPQEngineCommittedState(path string, migration chain.ConsensusMigrationState, bootstrap *ConsensusBootstrap, engine *PQEngineAuthorization, runtime *RuntimeUpgradeAuthorization) (CommittedState, error) {
	r, err := capturePQEngineState(path)
	if err != nil {
		return CommittedState{}, err
	}
	var state CommittedState
	switch r.layout {
	case "snapshot-journal":
		decoded, err := decodeSnapshotJournalWithBootstrap(context.Background(), r.data, migration, bootstrap)
		if err != nil {
			return CommittedState{}, err
		}
		if decoded.IncompleteTail || decoded.CompleteBytes != len(r.data) {
			return CommittedState{}, errors.New("incomplete snapshot journal cannot authorize signing")
		}
		state = decoded.State
	case "block-journal":
		authority := &blockJournalReplayAuthority{bootstrap: bootstrap, engine: engine, runtime: runtime}
		decoded, err := decodeBlockJournalWithAuthority(context.Background(), r.data, migration, nil, authority)
		if err != nil {
			return CommittedState{}, err
		}
		if decoded.IncompleteTail || decoded.CompleteBytes != len(r.data) {
			return CommittedState{}, errors.New("incomplete block journal cannot authorize signing")
		}
		state = decoded.State
	default:
		if err := decodeStrictJSON(r.data, &state); err != nil {
			return CommittedState{}, err
		}
		state.bootstrap = bootstrap
	}
	if err := validateHistoricalStateFields(state, migration); err != nil {
		return CommittedState{}, err
	}
	if err := state.Validate(migration); err != nil {
		return CommittedState{}, fmt.Errorf("validate read-only committed source: %w", err)
	}
	if err := r.unchanged(); err != nil {
		return CommittedState{}, err
	}
	// Caller still binds the independently supplied engine height/full AppHash,
	// runtime plan and schedule. Decoding a complete frame proves no durability.
	return state, nil
}
