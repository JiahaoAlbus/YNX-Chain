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
	page, err := s.store.ListTasksForSession(session, r.URL.Query().Get("afterId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid original task cursor")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, page)
}

func (s *Store) taskSessionHasHistoryLocked(account, device, id string) bool {
	for _, record := range s.state.Actions {
		if record.Account == account && record.ToolStep != nil && record.ToolStep.TaskID == id && record.ToolStep.Holder == device {
			return true
		}
	}
	for _, run := range s.state.TaskRuns {
		if run.Account == account && run.TaskID == id && run.Holder == device {
			return true
		}
	}
	for _, outcome := range s.state.TaskActionOutcomes {
		if outcome.View.Principal.Account == account && outcome.View.Principal.DeviceID == device && outcome.View.TaskID == id {
			return true
		}
	}
	return false
}

// Fixed source-owned filtering occurs before pagination. Old holders cannot
// discover a new holder's unrelated tasks merely through an account-wide list.
func (s *Store) ListTasksForSession(session ProductSession, after string) (TaskPage, error) {
	page := TaskPage{Tasks: []TaskRecord{}}
	if session.Account == "" || session.DeviceID == "" || len(after) > 128 || (after != "" && !toolOperationID.MatchString(after)) {
		return page, ErrTaskCursor
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// Gather the caller's history once. Scanning all actions and runs once per
	// task holds the store lock quadratically as a user's task history grows.
	history := make(map[string]bool)
	for _, record := range s.state.Actions {
		if record.Account == session.Account && record.ToolStep != nil && record.ToolStep.Holder == session.DeviceID {
			history[record.ToolStep.TaskID] = true
		}
	}
	for _, run := range s.state.TaskRuns {
		if run.Account == session.Account && run.Holder == session.DeviceID {
			history[run.TaskID] = true
		}
	}
	for _, outcome := range s.state.TaskActionOutcomes {
		if outcome.View.Principal.Account == session.Account && outcome.View.Principal.DeviceID == session.DeviceID {
			history[outcome.View.TaskID] = true
		}
	}
	ids := []string{}
	for id, task := range s.state.Tasks {
		if id <= after || task.Account != session.Account {
			continue
		}
		if _, err := s.ownedTaskLocked(session.Account, id); err != nil {
			continue
		}
		if task.Holder == session.DeviceID || history[id] {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	if len(ids) > 100 {
		ids = ids[:100]
		page.HasMore = true
	}
	for _, id := range ids {
		task := s.state.Tasks[id]
		if task.Holder != session.DeviceID {
			task.AgentConfigurationID = ""
			task.AgentConfigurationRevision = 0
		}
		page.Tasks = append(page.Tasks, task)
		page.NextID = id
	}
	return page, nil
}
