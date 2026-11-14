package cloud

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"syscall"
)

// Private write-ahead DATA for the inherited single-writer snapshot, not an
// authorization registry. Its durable inode exists before any metadata rename.
type objectCommitIntent struct {
	Version   int    `json:"version"`
	State     string `json:"state"`
	Action    string `json:"action,omitempty"`
	Actor     string `json:"actor,omitempty"`
	ObjectID  string `json:"objectId,omitempty"`
	Previous  string `json:"previous,omitempty"`
	Integrity string `json:"integrity,omitempty"`
}
type objectPendingCommit struct {
	action, actor, objectID, path, integrity, previous string
	snapshot, candidate                                []byte
}
type ObjectCommitObservation struct {
	Action    string `json:"action"`
	ObjectID  string `json:"objectId"`
	Integrity string `json:"integrity"`
	Outcome   string `json:"outcome"`
}

func (s *Service) objectWriteFence() error  { s.mu.Lock(); defer s.mu.Unlock(); return s.objectWriteErr }
func (s *Service) objectIntentPath() string { return s.cfg.StatePath + ".object-commit" }
func openObjectIntent(path string, create bool) (*os.File, error) {
	flags := os.O_RDWR | syscall.O_NOFOLLOW | syscall.O_NONBLOCK
	if create {
		flags |= os.O_CREATE | os.O_EXCL
	}
	f, err := os.OpenFile(path, flags, 0600)
	if err != nil {
		return nil, err
	}
	held, e1 := f.Stat()
	named, e2 := os.Lstat(path)
	if e1 != nil || e2 != nil || !held.Mode().IsRegular() || held.Mode().Perm() != 0600 || !os.SameFile(held, named) {
		f.Close()
		return nil, ErrInvalid
	}
	st, ok := held.Sys().(*syscall.Stat_t)
	if !ok || st.Uid != uint32(os.Getuid()) || st.Nlink != 1 {
		f.Close()
		return nil, ErrDenied
	}
	return f, nil
}
func readObjectIntent(f *os.File) (objectCommitIntent, error) {
	var intent objectCommitIntent
	raw, err := io.ReadAll(io.LimitReader(io.NewSectionReader(f, 0, 8193), 8193))
	if err != nil || len(raw) == 0 || len(raw) > 8192 || json.Unmarshal(raw, &intent) != nil || intent.Version != 1 {
		return intent, errObjectCommitUnknown
	}
	if intent.State != "clear" && intent.State != "pending" {
		return intent, errObjectCommitUnknown
	}
	if intent.State == "pending" && (len(intent.Integrity) != 64 || len(intent.Previous) != 64 || intent.Action == "") {
		return intent, errObjectCommitUnknown
	}
	return intent, nil
}
func writeObjectIntent(f *os.File, intent objectCommitIntent) error {
	raw, err := json.Marshal(intent)
	if err != nil || len(raw) > 8192 {
		return ErrInvalid
	}
	if _, err = f.WriteAt(raw, 0); err != nil {
		return err
	}
	if err = f.Truncate(int64(len(raw))); err != nil {
		return err
	}
	return f.Sync()
}
func (s *Service) initializeObjectCommitJournal() error {
	s.objectCommittedIntegrity = s.state.IntegrityHash
	s.objectCommittedSnapshot, _ = json.Marshal(s.state)
	f, err := openObjectIntent(s.objectIntentPath(), true)
	if err == nil {
		if err = writeObjectIntent(f, objectCommitIntent{Version: 1, State: "clear"}); err != nil {
			f.Close()
			return err
		}
		if err = f.Close(); err != nil {
			return err
		}
		return syncObjectDirectory(filepath.Dir(s.cfg.StatePath))
	}
	if !errors.Is(err, os.ErrExist) {
		return err
	}
	f, err = openObjectIntent(s.objectIntentPath(), false)
	if err != nil {
		return err
	}
	defer f.Close()
	intent, err := readObjectIntent(f)
	if err != nil {
		return err
	}
	if intent.State == "pending" {
		s.objectPending = &objectPendingCommit{action: intent.Action, actor: intent.Actor, objectID: intent.ObjectID, path: s.cfg.StatePath, integrity: intent.Integrity, previous: intent.Previous, snapshot: append([]byte(nil), s.objectCommittedSnapshot...)}
		s.objectWriteErr = errObjectCommitUnknown
	}
	// Also recover an unfinished initial journal-directory publication.
	return syncObjectDirectory(filepath.Dir(s.cfg.StatePath))
}
func (s *Service) clearObjectIntentLocked() error {
	f, err := openObjectIntent(s.objectIntentPath(), false)
	if err != nil {
		return err
	}
	defer f.Close()
	return writeObjectIntent(f, objectCommitIntent{Version: 1, State: "clear"})
}
func (s *Service) saveObjectSnapshotLocked() error {
	syncDirectory := s.cfg.stateDirectorySync
	if syncDirectory == nil {
		syncDirectory = syncObjectDirectory
	}
	integrity, err := stateIntegrity(s.state)
	if err != nil {
		return err
	}
	var action, actor, id string
	if len(s.state.Audit) > 0 {
		last := s.state.Audit[len(s.state.Audit)-1]
		action, actor, id = last.Action, last.Actor, last.ObjectID
	}
	if action == "" {
		return ErrInvalid
	}
	candidate := s.state
	candidate.IntegrityHash = integrity
	raw, err := json.Marshal(candidate)
	if err != nil {
		return err
	}
	p := &objectPendingCommit{action: action, actor: actor, objectID: id, path: s.cfg.StatePath, integrity: integrity, previous: s.objectCommittedIntegrity, snapshot: append([]byte(nil), s.objectCommittedSnapshot...), candidate: raw}
	s.objectPending = p
	f, err := openObjectIntent(s.objectIntentPath(), false)
	if err != nil {
		return errors.Join(errObjectCommitUnknown, err)
	}
	prior, err := readObjectIntent(f)
	if err != nil || prior.State != "clear" {
		f.Close()
		return errors.Join(errObjectCommitUnknown, err)
	}
	err = writeObjectIntent(f, objectCommitIntent{Version: 1, State: "pending", Action: action, Actor: actor, ObjectID: id, Previous: p.previous, Integrity: integrity})
	closeErr := f.Close()
	if err != nil || closeErr != nil {
		return errors.Join(errObjectCommitUnknown, err, closeErr)
	}
	if err = saveStateWithDirectorySync(s.cfg.StatePath, &s.state, syncDirectory); err != nil {
		if errors.Is(err, errObjectCommitUnknown) {
			return err
		}
		if clearErr := s.clearObjectIntentLocked(); clearErr != nil {
			return errors.Join(errObjectCommitUnknown, err, clearErr)
		}
		s.objectPending = nil
		return err
	}
	s.objectCommittedIntegrity = integrity
	s.objectCommittedSnapshot = raw
	if err = s.clearObjectIntentLocked(); err != nil {
		return errors.Join(errObjectCommitUnknown, err)
	}
	s.objectPending = nil
	return nil
}
func (s *Service) freezeObjectCommitLocked(action, actor, id string, cause error) error {
	if s.objectWriteErr != nil {
		return s.objectWriteErr
	}
	s.objectWriteErr = cause
	p := s.objectPending
	if p == nil {
		return cause
	}
	if observed, err := loadState(p.path); err == nil && (observed.IntegrityHash == p.integrity || observed.IntegrityHash == p.previous) {
		p.snapshot, _ = json.Marshal(observed)
	}
	if len(p.snapshot) > 0 {
		var original persistentState
		if json.Unmarshal(p.snapshot, &original) == nil {
			s.state = original
		}
	}
	return cause
}
func (s *Service) unlockObjectState() {
	if s.objectWriteErr != nil && s.objectPending != nil {
		var original persistentState
		if err := json.Unmarshal(s.objectPending.snapshot, &original); err == nil {
			s.state = original
		} else {
			s.objectWriteErr = errors.Join(s.objectWriteErr, err)
		}
	}
	s.mu.Unlock()
}

// Recovery observes and syncs the SAME original file. No replay, new approval,
// arbitrary reset or unauthenticated HTTP endpoint can clear this fence.
func (s *Service) ReconcileObjectCommit(ctx context.Context) (ObjectCommitObservation, error) {
	if ctx == nil {
		return ObjectCommitObservation{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.objectPending
	if s.objectWriteErr == nil || p == nil {
		return ObjectCommitObservation{}, errObjectCommitUnknown
	}
	if err := ctx.Err(); err != nil {
		return ObjectCommitObservation{}, errors.Join(s.objectWriteErr, err)
	}
	if p.path != s.cfg.StatePath {
		return ObjectCommitObservation{}, s.objectWriteErr
	}
	observed, err := loadState(p.path)
	if err != nil || (observed.IntegrityHash != p.integrity && observed.IntegrityHash != p.previous) {
		return ObjectCommitObservation{}, errors.Join(s.objectWriteErr, err)
	}
	syncDirectory := s.cfg.stateDirectorySync
	if syncDirectory == nil {
		syncDirectory = syncObjectDirectory
	}
	if err = syncDirectory(filepath.Dir(p.path)); err != nil {
		return ObjectCommitObservation{}, errors.Join(s.objectWriteErr, err)
	}
	if err = ctx.Err(); err != nil {
		return ObjectCommitObservation{}, errors.Join(s.objectWriteErr, err)
	}
	confirmed, err := loadState(p.path)
	if err != nil || confirmed.IntegrityHash != observed.IntegrityHash || s.cfg.StatePath != p.path {
		return ObjectCommitObservation{}, errors.Join(s.objectWriteErr, err)
	}
	if err = s.clearObjectIntentLocked(); err != nil {
		return ObjectCommitObservation{}, errors.Join(s.objectWriteErr, err)
	}
	outcome := "NOT_APPLIED"
	if confirmed.IntegrityHash == p.integrity {
		outcome = "COMMITTED"
	}
	result := ObjectCommitObservation{p.action, p.objectID, confirmed.IntegrityHash, outcome}
	s.state = confirmed
	s.objectCommittedIntegrity = confirmed.IntegrityHash
	s.objectCommittedSnapshot, _ = json.Marshal(confirmed)
	s.objectPending = nil
	s.objectWriteErr = nil
	return result, nil
}
