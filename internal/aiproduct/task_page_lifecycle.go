package aiproduct

import (
	"context"
	"time"
)

const taskPageReadTimeout = 30 * time.Second

type taskActivePageRead struct {
	account, taskID string
	cancel          context.CancelFunc
}

// Register before checking the Store. A committed cancellation either finds
// this exact read or is seen by the subsequent Store fence. Concurrent reads
// never share a map key, even if two callers selected the same original run.
func (s *Server) beginTaskPageRead(ctx context.Context, session ProductSession, task TaskRecord) (context.Context, func(), error) {
	if ctx == nil {
		return nil, nil, errToolInvalid
	}
	callCtx, cancel := context.WithTimeout(ctx, taskPageReadTimeout)
	read := &taskActivePageRead{account: session.Account, taskID: task.ID, cancel: cancel}
	s.mu.Lock()
	if s.taskPageReads == nil {
		s.taskPageReads = map[*taskActivePageRead]struct{}{}
	}
	s.taskPageReads[read] = struct{}{}
	s.mu.Unlock()
	finish := func() { cancel(); s.mu.Lock(); delete(s.taskPageReads, read); s.mu.Unlock() }
	if err := s.taskPageReadFence(callCtx, session, task); err != nil {
		finish()
		return nil, nil, err
	}
	return callCtx, finish, nil
}
func (s *Server) taskPageReadFence(ctx context.Context, session ProductSession, task TaskRecord) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	live, err := s.store.ownedTaskLocked(session.Account, task.ID)
	if err != nil {
		return err
	}
	if live.Account != task.Account || live.Holder != session.DeviceID || live.Holder != task.Holder || live.Revision != task.Revision || live.Generation != task.Generation || !live.CancelledAt.IsZero() || live.Status != "READY" && live.Status != "WORKING" {
		return errToolConflict
	}
	if err := s.store.assertTaskAgentConfigurationLocked(live, ""); err != nil {
		return err
	}
	return ctx.Err()
}
