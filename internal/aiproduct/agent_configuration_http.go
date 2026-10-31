package aiproduct

import (
	"errors"
	"net/http"
	"os"
)

func (s *Server) handleAgentConfigurationList(w http.ResponseWriter, r *http.Request, session ProductSession) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"agents": s.store.AgentConfigurations(session.Account), "kind": "local-agent-configurations", "authorityGranted": false})
}

func (s *Server) handleAgentConfigurationWrite(w http.ResponseWriter, r *http.Request, session ProductSession) {
	var input struct {
		ExpectedRevision uint64   `json:"expectedRevision"`
		Name             string   `json:"name"`
		ModelRef         string   `json:"modelRef"`
		ToolIDs          []string `json:"toolIds"`
		State            string   `json:"state"`
	}
	if !readToolJSON(w, r, &input) {
		return
	}
	config, err := s.store.ConfigureAgent(session.Account, r.PathValue("agentId"), input.ExpectedRevision, input.Name, input.ModelRef, input.ToolIDs, input.State)
	if err != nil {
		status := http.StatusConflict
		if errors.Is(err, os.ErrNotExist) {
			status = http.StatusNotFound
		}
		writeError(w, status, "owned current configuration and service-listed model/tools are required")
		return
	}
	// New revision invalidates old task configuration snapshots. Interrupt only
	// this account's affected in-flight model work, not other products/services.
	s.store.mu.Lock()
	var tasks []string
	for _, task := range s.store.state.Tasks {
		if task.Account == session.Account && task.AgentConfigurationID == config.ID {
			tasks = append(tasks, task.ID)
		}
	}
	s.store.mu.Unlock()
	for _, taskID := range tasks {
		s.cancelTaskModelRuns(session.Account, taskID)
	}
	status := http.StatusOK
	if r.Method == http.MethodPost {
		status = http.StatusCreated
	}
	writeJSON(w, status, map[string]any{"agent": config, "authorityGranted": false, "existingTaskSnapshotsRequireExplicitRebind": true})
}

func (s *Store) BindAgentConfiguration(account, taskID string, revision, generation uint64, holder, configID string) (TaskRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	task, err := s.ownedTaskLocked(account, taskID)
	if err != nil {
		return TaskRecord{}, err
	}
	config, ok := s.state.AgentConfigurations[configID]
	if !ok || config.Account != account {
		return TaskRecord{}, os.ErrNotExist
	}
	if holder == "" || task.Holder != holder || task.Revision != revision || task.Generation != generation || task.Revision == ^uint64(0) || !task.CancelledAt.IsZero() || config.State != "enabled" {
		return TaskRecord{}, ErrTaskConflict
	}
	switch task.Status {
	case "DRAFT", "READY", "NEEDS_APPROVAL":
	default:
		return TaskRecord{}, ErrTaskState
	}
	task.AgentConfigurationID = config.ID
	task.AgentConfigurationRevision = config.Revision
	task.Revision++
	task.UpdatedAt = s.now().UTC()
	if err := s.saveTaskLocked(task, "task_agent_configuration_bound_without_grant"); err != nil {
		return TaskRecord{}, err
	}
	return task, nil
}

func (s *Server) handleTaskAgentConfiguration(w http.ResponseWriter, r *http.Request, session ProductSession) {
	var input struct {
		Revision             uint64 `json:"revision"`
		Generation           uint64 `json:"generation"`
		AgentConfigurationID string `json:"agentConfigurationId"`
	}
	if !readToolJSON(w, r, &input) {
		return
	}
	task, err := s.store.BindAgentConfiguration(session.Account, r.PathValue("id"), input.Revision, input.Generation, session.DeviceID, input.AgentConfigurationID)
	if err != nil {
		status := http.StatusConflict
		if errors.Is(err, os.ErrNotExist) {
			status = http.StatusNotFound
		}
		writeError(w, status, "owned current task and enabled configuration required")
		return
	}
	s.cancelTaskModelRuns(session.Account, task.ID)
	writeJSON(w, http.StatusOK, map[string]any{"task": task, "authorityGranted": false, "holderUnchanged": true})
}
