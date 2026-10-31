package aiproduct

import (
	"errors"
	"net/http"
	"os"
	"strings"
)

// CancelTask closes future scheduling rights without claiming a remote undo.
// Sent operations retain their exact status, operation ID and original evidence.
func (s *Store) CancelTask(account, id string, expectedRev, expectedGen uint64, holder string) (TaskRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	task, err := s.ownedTaskLocked(account, id)
	if err != nil {
		return TaskRecord{}, err
	}
	if strings.TrimSpace(holder) == "" || task.Holder != holder || task.Revision != expectedRev || task.Generation != expectedGen || task.Revision == ^uint64(0) {
		return TaskRecord{}, ErrTaskConflict
	}
	if !task.CancelledAt.IsZero() {
		return task, nil
	}
	switch task.Status {
	case "DRAFT", "READY", "WORKING", "NEEDS_APPROVAL", "RECONCILING":
	default:
		return TaskRecord{}, ErrTaskState
	}
	previous := make(map[string]ActionRecord)
	needsReconciliation := task.Status == "RECONCILING"
	for actionID, record := range s.state.Actions {
		if record.Account != account || record.ToolStep == nil || record.ToolStep.TaskID != id {
			continue
		}
		switch record.Status {
		case "NEEDS_APPROVAL", "approved_not_executed":
			previous[actionID] = record
			record.Status = "CANCELLED"
			s.state.Actions[actionID] = record
		case "DISPATCHING", "SENT", "UNKNOWN", "RECONCILING":
			needsReconciliation = true
		}
	}
	previousRuns := map[string]taskModelRun{}
	for runID, run := range s.state.TaskRuns {
		if run.Account != account || run.TaskID != id || run.Status == "COMPLETED" {
			continue
		}
		previousRuns[runID] = run
		run.Cancelled = true
		if needsReconciliation {
			run.Status = "UNKNOWN"
		} else {
			run.Status = "STOPPED"
		}
		s.state.TaskRuns[runID] = run
	}
	task.Revision++
	task.CancelledAt = s.now().UTC()
	task.UpdatedAt = task.CancelledAt
	task.Status = "CANCELLED"
	if needsReconciliation {
		task.Status = "RECONCILING"
	}
	if err := s.saveTaskLocked(task, "task_cancelled_future_dispatch_closed"); err != nil {
		for actionID, record := range previous {
			s.state.Actions[actionID] = record
		}
		for runID, run := range previousRuns {
			s.state.TaskRuns[runID] = run
		}
		return TaskRecord{}, err
	}
	return task, nil
}

func (s *Server) handleTaskCancel(w http.ResponseWriter, r *http.Request, session ProductSession) {
	var input struct {
		Revision   uint64 `json:"revision"`
		Generation uint64 `json:"generation"`
	}
	if !readToolJSON(w, r, &input) {
		return
	}
	task, err := s.store.CancelTask(session.Account, r.PathValue("id"), input.Revision, input.Generation, session.DeviceID)
	if err != nil {
		status := http.StatusInternalServerError
		switch {
		case errors.Is(err, os.ErrNotExist):
			status = http.StatusNotFound
		case errors.Is(err, ErrTaskConflict), errors.Is(err, ErrTaskState):
			status = http.StatusConflict
		}
		writeError(w, status, "task cancellation was not accepted")
		return
	}
	s.cancelTaskModelRuns(session.Account, task.ID)
	writeJSON(w, http.StatusOK, map[string]any{"task": task, "futureDispatchClosed": true, "remoteRollback": false})
}
