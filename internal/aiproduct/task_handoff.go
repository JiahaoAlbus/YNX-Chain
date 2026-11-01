package aiproduct

import (
	"net/http"
	"strings"
)

// This is the product request, not a Grant or an authority proof. The original
// Auth Source must bind both routes to one business operation before activation.
type taskHandoffRequest struct {
	Revision         uint64 `json:"revision"`
	Generation       uint64 `json:"generation"`
	NewHolder        string `json:"newHolder"`
	AuthorizationRef string `json:"authorizationRef"`
}

func (s *Server) handleTaskHandoff(w http.ResponseWriter, r *http.Request, session ProductSession) {
	var input taskHandoffRequest
	if !readToolJSON(w, r, &input) {
		return
	}
	if input.Revision == 0 || input.Generation == 0 || input.NewHolder == session.DeviceID || strings.TrimSpace(input.NewHolder) != input.NewHolder || input.NewHolder == "" || len(input.NewHolder) > 256 || input.AuthorizationRef == "" || len(input.AuthorizationRef) > 256 {
		writeError(w, http.StatusBadRequest, "exact task version, distinct registered holder and original authorization reference required")
		return
	}
	s.store.mu.Lock()
	task, err := s.store.ownedTaskLocked(session.Account, r.PathValue("id"))
	s.store.mu.Unlock()
	if err != nil {
		writeError(w, http.StatusNotFound, "task not found")
		return
	}
	if task.Holder != session.DeviceID || task.Revision != input.Revision || task.Generation != input.Generation {
		writeError(w, http.StatusConflict, "current holder and exact task version required")
		return
	}
	// Deliberately no Store.HandoffTask call on session-only authority. Source
	// acquisition, minimum new Grant and atomic original once/revocation must
	// come from the matching Auth-owned implementation, not a caller boolean.
	writeJSON(w, http.StatusServiceUnavailable, map[string]any{"code": "AI_TASK_HANDOFF_UNREGISTERED", "error": "matching original handoff Source and action registration unavailable", "executed": false})
}
