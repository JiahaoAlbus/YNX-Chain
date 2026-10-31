package aiproduct

import (
	"crypto/sha256"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strconv"
)

// ToolStepBinding is the product's persisted binding, not a shared Auth Grant.
// Ciphertext is retained in the existing encrypted store; no model text grants
// authority, changes the tool directory or proves execution.
type ToolStepBinding struct {
	TaskID                  string            `json:"taskId"`
	TaskRevision            uint64            `json:"taskRevision"`
	Generation              uint64            `json:"generation"`
	Holder                  string            `json:"holder"`
	OperationID             string            `json:"operationId"`
	ToolID                  string            `json:"toolId"`
	ToolVersion             string            `json:"toolVersion"`
	InputDigest             string            `json:"inputDigest"`
	InputNonce              string            `json:"inputNonce,omitempty"`
	InputCipher             string            `json:"inputCipher,omitempty"`
	ResultNonce             string            `json:"resultNonce,omitempty"`
	ResultCipher            string            `json:"resultCipher,omitempty"`
	ResultBinding           taskBytesBinding  `json:"resultBinding,omitempty"`
	ResultFields            []string          `json:"resultFields,omitempty"`
	RemoteOperationID       string            `json:"remoteOperationId,omitempty"`
	AuthorityOperationID    string            `json:"authorityOperationId,omitempty"`
	AuthorityReferenceState string            `json:"authorityReferenceState,omitempty"`
	EffectFirstCause        string            `json:"effectFirstCause,omitempty"`
	TaskGrantRef            string            `json:"taskGrantRef,omitempty"`
	ApprovedFields          []string          `json:"approvedFields,omitempty"`
	RemoteRef               string            `json:"remoteRef,omitempty"`
	ResultWireNonce         string            `json:"resultWireNonce,omitempty"`
	ResultWireCipher        string            `json:"resultWireCipher,omitempty"`
	ResultWireBinding       *taskBytesBinding `json:"resultWireBinding,omitempty"`
	ResultContentType       string            `json:"resultContentType,omitempty"`
	ResultAuthScope         string            `json:"resultAuthScope,omitempty"`
}

type toolStepRequest struct {
	OperationID  string          `json:"operationId"`
	TaskRevision uint64          `json:"taskRevision"`
	Generation   uint64          `json:"generation"`
	ToolID       string          `json:"toolId"`
	ToolVersion  string          `json:"toolVersion"`
	Input        json.RawMessage `json:"input"`
}

type conversationToolInput struct {
	ConversationID string `json:"conversationId"`
}

type toolDirectoryEntry struct {
	id, version, scope, purpose, risk string
}

// This allowlist is service-owned. Caller supplied risk/scope/provider fields
// are never accepted. Add another service only with its real authority/handler.
func lookupTool(id string) (toolDirectoryEntry, bool) {
	if id == shopOrderToolID {
		return toolDirectoryEntry{id: id, version: "1", scope: "ai:permissions", purpose: "read the exact authorized Shop order projection", risk: "read"}, true
	}
	if id != "ai.conversation.read" {
		return toolDirectoryEntry{}, false
	}
	return toolDirectoryEntry{id: id, version: "1", scope: "ai:conversations", purpose: "read the selected task conversation", risk: "low"}, true
}

var toolOperationID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

var (
	errToolNotFound = errors.New("task or tool step not found")
	errToolConflict = errors.New("task generation, holder, or operation binding conflict")
	errToolInvalid  = errors.New("invalid tool request or unregistered tool")
)

func strictToolJSON(r io.Reader, into any) error {
	decoder := json.NewDecoder(r)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(into); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return errToolInvalid
	}
	return nil
}

func readToolJSON(w http.ResponseWriter, r *http.Request, into any) bool {
	if strictToolJSON(http.MaxBytesReader(w, r.Body, 32<<10), into) != nil {
		writeError(w, http.StatusBadRequest, "exact bounded tool request schema is required")
		return false
	}
	return true
}

func (s *Server) handleTaskCreate(w http.ResponseWriter, r *http.Request, session ProductSession) {
	var input struct {
		ConversationID string `json:"conversationId"`
	}
	if !readToolJSON(w, r, &input) {
		return
	}
	task, err := s.store.CreateTask(session.Account, input.ConversationID, session.DeviceID)
	if err != nil {
		writeError(w, http.StatusNotFound, "owned conversation is required")
		return
	}
	writeJSON(w, http.StatusCreated, task)
}

func (s *Server) handleTaskProjection(w http.ResponseWriter, r *http.Request, session ProductSession) {
	var cursor uint64
	if value := r.URL.Query().Get("afterCursor"); value != "" {
		var err error
		cursor, err = strconv.ParseUint(value, 10, 64)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid task cursor")
			return
		}
	}
	task, err := s.store.ReadTaskProjection(session.Account, r.PathValue("id"), cursor)
	if err != nil {
		writeError(w, http.StatusNotFound, "task not found")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, task)
}

// requestToolStep (P08-04) records a proposal only. A legacy approval cannot be
// upgraded into a new task/gen-bound execution grant, even for the same input.
func (s *Server) requestToolStep(w http.ResponseWriter, r *http.Request, session ProductSession) {
	var input toolStepRequest
	if !readToolJSON(w, r, &input) {
		return
	}
	record, created, err := s.store.reserveToolStep(session, r.PathValue("id"), input)
	if err != nil {
		status := http.StatusInternalServerError
		switch {
		case errors.Is(err, errToolNotFound):
			status = http.StatusNotFound
		case errors.Is(err, errToolConflict):
			status = http.StatusConflict
		case errors.Is(err, errToolInvalid):
			status = http.StatusBadRequest
		}
		writeError(w, status, err.Error())
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	writeJSON(w, status, map[string]any{"step": publicToolStep(record), "executed": false, "approvalRequired": true})
}

func publicToolStep(record ActionRecord) ActionRecord {
	if record.ToolStep != nil {
		binding := *record.ToolStep
		binding.InputNonce, binding.InputCipher = "", ""
		binding.ResultNonce, binding.ResultCipher = "", ""
		binding.ResultWireNonce, binding.ResultWireCipher = "", ""
		binding.ResultFields = append([]string(nil), binding.ResultFields...)
		binding.ApprovedFields = append([]string(nil), binding.ApprovedFields...)
		if binding.ResultWireBinding != nil {
			v := *binding.ResultWireBinding
			binding.ResultWireBinding = &v
		}
		record.ToolStep = &binding
	}
	return record
}

func (s *Store) reserveToolStep(session ProductSession, taskID string, input toolStepRequest) (ActionRecord, bool, error) {
	tool, found := lookupTool(input.ToolID)
	if !found || input.ToolVersion != tool.version || !toolOperationID.MatchString(input.OperationID) || !hasScope(session.Scopes, tool.scope) {
		return ActionRecord{}, false, errToolInvalid
	}
	canonical, selectedConversation, err := canonicalTaskToolInput(tool.id, input.Input)
	if err != nil {
		return ActionRecord{}, false, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	task, exists := s.state.Tasks[taskID]
	conversation, owns := s.state.Conversations[task.ConversationID]
	if !exists || task.Account != session.Account || !owns || conversation.Account != session.Account {
		return ActionRecord{}, false, errToolNotFound
	}
	if err := s.assertTaskAgentConfigurationLocked(task, tool.id); err != nil {
		return ActionRecord{}, false, err
	}
	if session.Account == "" || session.DeviceID == "" || task.Holder != session.DeviceID || task.Generation == 0 || task.Revision == 0 || task.Generation != input.Generation || task.Revision != input.TaskRevision || (selectedConversation != "" && task.ConversationID != selectedConversation) || task.Status == "CANCELLED" || task.Status == "COMPLETED" {
		return ActionRecord{}, false, errToolConflict
	}
	// Only active task states may propose new work. Reconciliation must query
	// the original operation instead of creating another tool step.
	switch task.Status {
	case "DRAFT", "READY", "WORKING", "NEEDS_APPROVAL":
	default:
		return ActionRecord{}, false, errToolConflict
	}
	binding := ToolStepBinding{TaskID: task.ID, TaskRevision: task.Revision, Generation: task.Generation, Holder: task.Holder, OperationID: input.OperationID, ToolID: tool.id, ToolVersion: tool.version}
	digestInput, err := json.Marshal(struct {
		Binding ToolStepBinding `json:"binding"`
		Input   json.RawMessage `json:"input"`
	}{binding, canonical})
	if err != nil {
		return ActionRecord{}, false, err
	}
	digest := sha512.Sum512(digestInput)
	binding.InputDigest = hex.EncodeToString(digest[:])
	slot := sha256.Sum256([]byte(session.Account + "\x00" + taskID + "\x00" + input.OperationID))
	id := "toolstep_" + hex.EncodeToString(slot[:])
	if old, exists := s.state.Actions[id]; exists {
		if old.Account != session.Account || old.ToolStep == nil || old.ToolStep.InputDigest != binding.InputDigest {
			return ActionRecord{}, false, errToolConflict
		}
		return old, false, nil
	}
	if s.taskHasUnresolvedEffectLocked(taskID) {
		return ActionRecord{}, false, errTaskEffectUnresolved
	}
	binding.InputNonce, binding.InputCipher, err = s.encrypt(session.Account, taskID, id, string(canonical))
	if err != nil {
		return ActionRecord{}, false, err
	}
	record := ActionRecord{ID: id, Account: session.Account, ConversationID: task.ConversationID, Kind: "tool", Scope: tool.scope, Description: tool.purpose, PayloadPreview: "input-sha512:" + binding.InputDigest, Target: task.ConversationID, Risk: tool.risk, Provider: "YNX AI task tool directory", Status: "NEEDS_APPROVAL", CreatedAt: s.now().UTC(), ToolStep: &binding}
	previousEvents, eventsExisted := s.state.TaskEvents[task.ID]
	eventsWereNil := s.state.TaskEvents == nil
	if task.Revision == ^uint64(0) {
		return ActionRecord{}, false, errToolConflict
	}
	if err := s.appendTaskEventLocked(task.ID, task.Revision+1, "tool_step_requested", id); err != nil {
		return ActionRecord{}, false, err
	}
	oldAudits, oldSequence := s.state.Audits, s.state.AuditSequence
	originalTask := task
	task.Status = "NEEDS_APPROVAL"
	s.state.Tasks[task.ID] = task
	s.state.Actions[id] = record
	s.auditLocked(session.Account, "tool_step_requested", id, "NEEDS_APPROVAL; no external request sent")
	if err := s.saveLocked(); err != nil {
		delete(s.state.Actions, id)
		s.state.Tasks[task.ID] = originalTask
		s.restoreTaskEventsLocked(task.ID, previousEvents, eventsExisted, eventsWereNil)
		s.state.Audits, s.state.AuditSequence = oldAudits, oldSequence
		return ActionRecord{}, false, err
	}
	return record, true, nil
}
