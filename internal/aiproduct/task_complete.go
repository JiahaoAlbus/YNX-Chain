package aiproduct

import (
	"errors"
	"net/http"
	"os"
)

func (s *Store) taskHasUnresolvedEffectLocked(taskID string) bool {
	for _, record := range s.state.Actions {
		if record.ToolStep != nil && record.ToolStep.TaskID == taskID {
			switch record.Status {
			case "PENDING", "UNKNOWN", "DISPATCHING", "SENT", "RECONCILING":
				return true
			}
		}
	}
	return false
}

// CompleteTask closes an owned workflow only after a real model run has ended
// and every reported tool result is durably authenticated/decryptable. Model
// text alone is insufficient. Pending unsent proposals are closed, never sent.
func (s *Store) CompleteTask(account, id string, revision, generation uint64, holder, runID string) (TaskRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	task, err := s.ownedTaskLocked(account, id)
	if err != nil {
		return TaskRecord{}, err
	}
	if task.Holder != holder || holder == "" || task.Revision != revision || task.Generation != generation || task.Revision == ^uint64(0) || !task.CancelledAt.IsZero() {
		return TaskRecord{}, ErrTaskConflict
	}
	if task.Status != "READY" && task.Status != "WORKING" {
		return TaskRecord{}, ErrTaskState
	}
	run, ok := s.state.TaskRuns[runID]
	if !ok || run.Account != account || run.TaskID != id || run.Generation != generation || run.Holder != holder || run.Status != "COMPLETED" || run.Cancelled || run.Active || len(run.Steps) == 0 {
		return TaskRecord{}, ErrTaskState
	}
	if s.taskHasUnresolvedEffectLocked(id) {
		return TaskRecord{}, errTaskEffectUnresolved
	}
	for _, other := range s.state.TaskRuns {
		if other.TaskID == id && other.Active {
			return TaskRecord{}, errTaskEffectUnresolved
		}
	}
	for _, stepID := range run.Steps {
		record, ok := s.state.Actions[stepID]
		if !ok || record.Account != account || record.ToolStep == nil || record.ToolStep.TaskID != id {
			return TaskRecord{}, errToolNotFound
		}
		if _, err := s.taskReadReceiptLocked(record); err != nil {
			return TaskRecord{}, err
		}
	}
	previous := map[string]ActionRecord{}
	for stepID, record := range s.state.Actions {
		if record.Account == account && record.ToolStep != nil && record.ToolStep.TaskID == id && (record.Status == "NEEDS_APPROVAL" || record.Status == "approved_not_executed") {
			previous[stepID] = record
			record.Status = "CANCELLED"
			s.state.Actions[stepID] = record
		}
	}
	task.Status = "COMPLETED"
	task.Revision++
	task.UpdatedAt = s.now().UTC()
	if err := s.saveTaskLocked(task, "task_completed_with_verified_effects"); err != nil {
		for stepID, record := range previous {
			s.state.Actions[stepID] = record
		}
		return TaskRecord{}, err
	}
	return task, nil
}

func (s *Server) handleTaskComplete(w http.ResponseWriter, r *http.Request, session ProductSession) {
	var input struct {
		Revision   uint64 `json:"revision"`
		Generation uint64 `json:"generation"`
		RunID      string `json:"runId"`
	}
	if !readToolJSON(w, r, &input) {
		return
	}
	task, err := s.store.CompleteTask(session.Account, r.PathValue("id"), input.Revision, input.Generation, session.DeviceID, input.RunID)
	if err != nil {
		status := http.StatusConflict
		if errors.Is(err, os.ErrNotExist) {
			status = http.StatusNotFound
		}
		writeError(w, status, "owned current task with verified completed tool workflow required")
		return
	}
	s.cancelTaskModelRuns(session.Account, task.ID)
	writeJSON(w, http.StatusOK, map[string]any{"task": task, "effectsVerified": true, "newAuthorityGranted": false})
}
