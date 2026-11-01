package aiproduct

import (
	"context"
	"errors"
	"os"
	"sync/atomic"
)

// Nonzero size is intentional: distinct epochs must have distinct addresses.
type taskStoreEpoch struct{ value byte }

var ErrTaskStoreSnapshotStale = errors.New("original task Store snapshot is stale or retired")

// Principal operands must come from original Auth's verified session. Store
// checks actual resource ownership; it does not certify a tenant, policy
// revision, session issuer/current, registered device or a Grant.
type TaskStorePrincipal struct{ Account, DeviceID, SessionID string }
type TaskStoreCapture struct {
	Principal             TaskStorePrincipal
	TaskID, StepID, RunID string
}
type TaskStoreOperation struct {
	ID, Holder, Status, ToolID, ToolVersion, InputDigest string
	Revision, Generation                                 uint64
}
type TaskStoreView struct {
	Principal      TaskStorePrincipal
	ConversationID string
	Task           TaskRecord
	Operation      TaskStoreOperation
}

// Concrete in-process read source. No JSON/callback/current setter or issuer.
type TaskStoreSource struct {
	store   *Store
	retired atomic.Bool
}
type TaskStoreSnapshot struct {
	source   *TaskStoreSource
	epoch    *taskStoreEpoch
	ctx      context.Context
	view     TaskStoreView
	released atomic.Bool
}

func NewTaskStoreSource(store *Store) (*TaskStoreSource, error) {
	if store == nil {
		return nil, ErrTaskStoreSnapshotStale
	}
	return &TaskStoreSource{store: store}, nil
}
func (s *TaskStoreSource) Retire() {
	if s != nil {
		s.retired.Store(true)
	}
}
func (s *TaskStoreSource) Close() error { s.Retire(); return nil }

// Current is synchronous, lock-free and has no IO, including under Store.mu.
// An unrelated write conservatively invalidates a capture; re-capture does
// not replay an operation. Auth independently checks its own current/once.
func (s *TaskStoreSnapshot) Current() error {
	if s == nil || s.released.Load() || s.source == nil || s.source.store == nil || s.source.retired.Load() || s.epoch == nil || s.source.store.authorityEpoch.Load() != s.epoch {
		return ErrTaskStoreSnapshotStale
	}
	return s.ctx.Err()
}
func (s *TaskStoreSnapshot) Release() {
	if s != nil {
		s.released.Store(true)
	}
}
func (s *TaskStoreSnapshot) Close() error { s.Release(); return nil }
func (s *TaskStoreSnapshot) View() (TaskStoreView, error) {
	if err := s.Current(); err != nil {
		return TaskStoreView{}, err
	}
	return s.view, nil
}
func (s *TaskStoreSource) begin(ctx context.Context, p TaskStorePrincipal) error {
	if s == nil || s.store == nil || s.retired.Load() || ctx == nil {
		return ErrTaskStoreSnapshotStale
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if p.Account == "" || p.DeviceID == "" || p.SessionID == "" {
		return os.ErrNotExist
	}
	return nil
}
func (s *TaskStoreSource) snapshot(ctx context.Context, v TaskStoreView) (*TaskStoreSnapshot, error) {
	snapshot := &TaskStoreSnapshot{source: s, epoch: s.store.authorityEpoch.Load(), ctx: ctx, view: v}
	if err := snapshot.Current(); err != nil {
		return nil, err
	}
	return snapshot, nil
}
func (s *TaskStoreSource) CaptureConversation(ctx context.Context, p TaskStorePrincipal, id string) (*TaskStoreSnapshot, error) {
	if err := s.begin(ctx, p); err != nil {
		return nil, err
	}
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	c, ok := s.store.state.Conversations[id]
	if !ok || c.Account != p.Account {
		return nil, os.ErrNotExist
	}
	return s.snapshot(ctx, TaskStoreView{Principal: p, ConversationID: c.ID})
}
func (s *TaskStoreSource) Capture(ctx context.Context, input TaskStoreCapture) (*TaskStoreSnapshot, error) {
	if err := s.begin(ctx, input.Principal); err != nil {
		return nil, err
	}
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	task, err := s.store.ownedTaskLocked(input.Principal.Account, input.TaskID)
	if err != nil {
		return nil, err
	}
	if input.StepID != "" && input.RunID != "" {
		return nil, ErrTaskConflict
	}
	v := TaskStoreView{Principal: input.Principal, ConversationID: task.ConversationID, Task: task}
	switch {
	case input.StepID != "":
		r, ok := s.store.state.Actions[input.StepID]
		if !ok || r.Account != task.Account || r.ToolStep == nil || r.ToolStep.TaskID != task.ID || (task.Holder != input.Principal.DeviceID && r.ToolStep.Holder != input.Principal.DeviceID) {
			return nil, os.ErrNotExist
		}
		b := r.ToolStep
		v.Operation = TaskStoreOperation{ID: r.ID, Holder: b.Holder, Status: r.Status, ToolID: b.ToolID, ToolVersion: b.ToolVersion, InputDigest: b.InputDigest, Revision: b.TaskRevision, Generation: b.Generation}
	case input.RunID != "":
		r, ok := s.store.state.TaskRuns[input.RunID]
		if !ok {
			r, ok = s.store.state.TaskRuns[modelRunKey(task.Account, task.ID, input.RunID)]
			if r.RunID != input.RunID {
				ok = false
			}
		}
		if !ok || r.Account != task.Account || r.TaskID != task.ID || (task.Holder != input.Principal.DeviceID && r.Holder != input.Principal.DeviceID) {
			return nil, os.ErrNotExist
		}
		v.Operation = TaskStoreOperation{ID: r.ID, Holder: r.Holder, Status: r.Status, Revision: r.TaskRevision, Generation: r.Generation}
	default:
		if task.Holder != input.Principal.DeviceID {
			return nil, os.ErrNotExist
		}
	}
	return s.snapshot(ctx, v)
}
