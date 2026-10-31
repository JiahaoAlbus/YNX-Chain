package aiproduct

import (
	"errors"
	"net/http"
	"os"
)

// PrepareTask only makes owned draft orchestration ready for an actual Grant
// request. It grants no tool permission and performs no model/effect call.
func (s *Store) PrepareTask(account, id string, revision, generation uint64, holder string) (TaskRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	task, err := s.ownedTaskLocked(account, id)
	if err != nil {
		return TaskRecord{}, err
	}
	if holder == "" || task.Holder != holder || task.Revision != revision || task.Generation != generation || task.Revision == ^uint64(0) || !task.CancelledAt.IsZero() {
		return TaskRecord{}, ErrTaskConflict
	}
	if task.Status != "DRAFT" {
		return TaskRecord{}, ErrTaskState
	}
	task.Status = "READY"
	task.Revision++
	task.UpdatedAt = s.now().UTC()
	if err := s.saveTaskLocked(task, "task_prepared_without_grant"); err != nil {
		return TaskRecord{}, err
	}
	return task, nil
}

func (s *Server) handleTaskPrepare(w http.ResponseWriter, r *http.Request, session ProductSession) {
	var input struct {
		Revision   uint64 `json:"revision"`
		Generation uint64 `json:"generation"`
	}
	if !readToolJSON(w, r, &input) {
		return
	}
	task, err := s.store.PrepareTask(session.Account, r.PathValue("id"), input.Revision, input.Generation, session.DeviceID)
	if err != nil {
		status := http.StatusConflict
		if errors.Is(err, os.ErrNotExist) {
			status = http.StatusNotFound
		}
		writeError(w, status, "owned current draft is required for task preparation")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"task": task, "authorityGranted": false, "executed": false})
}
