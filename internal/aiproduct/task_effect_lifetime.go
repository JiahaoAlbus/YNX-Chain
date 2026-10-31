package aiproduct

import "context"

type taskActiveEffectRun struct {
	account, taskID string
	cancel          context.CancelFunc
}

// Manual dispatch has an HTTP lifetime as well as a task lifetime. Register
// before the last local check so a committed task/config cancellation cannot
// miss a broker request that is still acquiring its actual Source/channel.
// Already sent work remains UNKNOWN; cancelling transport never proves undo.
func (s *Server) beginTaskEffect(ctx context.Context, call taskEffectCall) (context.Context, func(), error) {
	effectCtx, cancel := context.WithCancel(ctx)
	lease := &taskActiveEffectRun{account: call.Account, taskID: call.CurrentTask.ID, cancel: cancel}
	s.mu.Lock()
	if s.taskActiveEffects == nil {
		s.taskActiveEffects = map[string]*taskActiveEffectRun{}
	}
	if s.taskActiveEffects[call.OriginalOperationID] != nil {
		s.mu.Unlock()
		cancel()
		return effectCtx, func() {}, errToolConflict
	}
	s.taskActiveEffects[call.OriginalOperationID] = lease
	s.mu.Unlock()
	finish := func() {
		cancel()
		s.mu.Lock()
		if s.taskActiveEffects[call.OriginalOperationID] == lease {
			delete(s.taskActiveEffects, call.OriginalOperationID)
		}
		s.mu.Unlock()
	}
	s.store.mu.Lock()
	task, err := s.store.ownedTaskLocked(call.Account, call.CurrentTask.ID)
	if err == nil && (task.Revision != call.CurrentTask.Revision || task.Generation != call.CurrentTask.Generation || task.Holder != call.CurrentTask.Holder || !task.CancelledAt.IsZero() || (task.Status != "READY" && task.Status != "WORKING")) {
		err = errToolConflict
	}
	if err == nil {
		err = s.store.assertTaskAgentConfigurationLocked(task, call.OriginalStep.ToolStep.ToolID)
	}
	s.store.mu.Unlock()
	if err == nil {
		err = effectCtx.Err()
	}
	if err != nil {
		cancel()
	}
	return effectCtx, finish, err
}
