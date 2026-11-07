package aiproduct

import "context"

// Persist the original run -> step association in the SAME proposal image,
// before any provider/effect work. A crash cannot strand an unlisted operation.
// This is local bookkeeping, not task approval or an Auth operation derivation.
func (s *Store) reserveModelToolStep(ctx context.Context, session ProductSession, run taskModelRun, input toolStepRequest) (ActionRecord, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if ctx == nil {
		return ActionRecord{}, false, errToolInvalid
	}
	if err := ctx.Err(); err != nil {
		return ActionRecord{}, false, err
	}
	original, exists := s.state.TaskRuns[run.ID]
	if !exists || original.Account != session.Account || original.TaskID != run.TaskID || original.Holder != session.DeviceID || original.SessionID != session.ID || original.RunID != run.RunID || original.RuntimeID != run.RuntimeID || original.Generation != run.Generation || original.TaskRevision != run.TaskRevision || !original.Active || original.Cancelled || original.Status != "WORKING" {
		return ActionRecord{}, false, errToolConflict
	}
	id := toolStepRecordID(session.Account, run.TaskID, input.OperationID)
	attached := original
	attached.Steps = append([]string(nil), original.Steps...)
	added := true
	for _, prior := range attached.Steps {
		if prior == id {
			added = false
			break
		}
	}
	if added {
		if len(attached.Steps) >= 128 {
			return ActionRecord{}, false, errToolInvalid
		}
		attached.Steps = append(attached.Steps, id)
	}
	s.state.TaskRuns[run.ID] = attached
	record, created, err := s.reserveToolStepLocked(session, run.TaskID, input)
	if err != nil {
		s.state.TaskRuns[run.ID] = original
		return ActionRecord{}, false, err
	}
	if added && !created {
		// An original existing step can be associated after an older-version crash.
		// It is never recreated or dispatched here, regardless of its old state.
		if err = s.saveTaskRunLocked(attached, "original_model_step_recovered"); err != nil {
			s.state.TaskRuns[run.ID] = original
			return ActionRecord{}, false, err
		}
	}
	return record, created, nil
}
