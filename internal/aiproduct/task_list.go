package aiproduct

import (
	"net/http"
	"sort"
)

// Bounded owned metadata discovery supports a client that lost a create
// response. It never guesses the original operation or retries creation.
type TaskPage struct {
	Tasks   []TaskRecord `json:"tasks"`
	NextID  string       `json:"nextId,omitempty"`
	HasMore bool         `json:"hasMore"`
}

func (s *Store) ListOwnedTasks(account, after string) (TaskPage, error) {
	out := TaskPage{Tasks: []TaskRecord{}}
	if account == "" || len(after) > 128 {
		return out, ErrTaskCursor
	}
	if after != "" && !toolOperationID.MatchString(after) {
		return out, ErrTaskCursor
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	ids := make([]string, 0)
	for id, task := range s.state.Tasks {
		if task.Account != account || id <= after {
			continue
		}
		if _, err := s.ownedTaskLocked(account, id); err == nil {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	if len(ids) > 100 {
		ids = ids[:100]
		out.HasMore = true
	}
	for _, id := range ids {
		out.Tasks = append(out.Tasks, s.state.Tasks[id])
		out.NextID = id
	}
	return out, nil
}
func (s *Server) handleTaskList(w http.ResponseWriter, r *http.Request, session ProductSession) {
	page, err := s.store.ListOwnedTasks(session.Account, r.URL.Query().Get("afterId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid original task cursor")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, page)
}
