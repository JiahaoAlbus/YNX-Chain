package aiproduct

import (
	"context"
	"errors"
	"net/http"
)

type originalTaskApprovalSource interface {
	approveTaskStep(context.Context, taskEffectCall, string) error
}

// commitTaskApprovalAtFence is for the original Auth bridge only. It does not
// verify or manufacture signatures. The synchronous check must validate the
// actual human/organization proof and exact current task/tool/source binding.
// Runtime phases do not change the definition revision; edits/handoffs do.
func (s *Store) commitTaskApprovalAtFence(ctx context.Context, expected taskReadExpectation, grantRef string, checkOriginalApproval func() error) (ActionRecord, error) {
	if checkOriginalApproval == nil {
		return ActionRecord{}, errTaskEffectFenceUnavailable
	}
	if grantRef == "" || len(grantRef) > 256 {
		return ActionRecord{}, errToolInvalid
	}
	if err := ctx.Err(); err != nil {
		return ActionRecord{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	task, err := s.ownedTaskLocked(expected.Account, expected.TaskID)
	if err != nil {
		return ActionRecord{}, err
	}
	if task.Revision != expected.TaskRevision || task.Generation != expected.Generation || task.Holder != expected.Holder || !task.CancelledAt.IsZero() || (task.Status != "NEEDS_APPROVAL" && task.Status != "READY") {
		return ActionRecord{}, errToolConflict
	}
	record, ok := s.state.Actions[expected.StepID]
	if !ok || record.Account != expected.Account || record.ToolStep == nil || record.ToolStep.TaskID != task.ID {
		return ActionRecord{}, errToolNotFound
	}
	binding := *record.ToolStep
	tool, known := lookupTool(binding.ToolID)
	if !known || record.Status != "NEEDS_APPROVAL" || binding.Holder != task.Holder || binding.Generation != task.Generation || binding.TaskRevision != task.Revision || binding.ToolVersion != tool.version {
		return ActionRecord{}, errToolConflict
	}
	if err := s.assertTaskAgentConfigurationLocked(task, binding.ToolID); err != nil {
		return ActionRecord{}, err
	}
	input, err := s.decrypt(record.Account, storedMessage{Message: Message{ID: record.ID, ConversationID: task.ID}, Nonce: binding.InputNonce, Cipher: binding.InputCipher})
	if err != nil {
		return ActionRecord{}, err
	}
	if bindTaskBytes([]byte(input)) != expected.Input {
		return ActionRecord{}, errToolConflict
	}
	if err := validateTaskToolApprovalFields(binding.ToolID, []byte(input), task, expected.Fields); err != nil {
		return ActionRecord{}, err
	}
	if err := checkOriginalApproval(); err != nil {
		return ActionRecord{}, err
	}
	if err := ctx.Err(); err != nil {
		return ActionRecord{}, err
	}
	originalTask := task
	task.Status = "READY"
	task.UpdatedAt = s.now().UTC()
	s.state.Tasks[task.ID] = task
	record.Status = "approved_not_executed"
	record.ReviewedAt = s.now().UTC()
	binding.TaskGrantRef = grantRef
	binding.ApprovedFields = append([]string(nil), expected.Fields...)
	record.ToolStep = &binding
	if err := s.saveToolEffectLocked(record, "task_step_approved_by_original_authority"); err != nil {
		s.state.Tasks[task.ID] = originalTask
		return ActionRecord{}, err
	}
	return publicToolStep(record), nil
}

func (s *Server) handleBoundTaskStepApproval(w http.ResponseWriter, r *http.Request, session ProductSession) {
	var input struct {
		AuthorizationRef string `json:"authorizationRef"`
	}
	if !readToolJSON(w, r, &input) {
		return
	}
	source, available := s.toolEffects.(originalTaskApprovalSource)
	if !available || source == nil {
		writeError(w, http.StatusServiceUnavailable, "original task approval Source is not admitted")
		return
	}
	if input.AuthorizationRef == "" || len(input.AuthorizationRef) > 256 {
		writeError(w, http.StatusBadRequest, "original approval reference required")
		return
	}
	s.store.mu.Lock()
	call, err := s.store.effectCallLocked(session, r.PathValue("id"), r.PathValue("stepId"), false)
	s.store.mu.Unlock()
	if err != nil {
		writeError(w, http.StatusNotFound, "task step not found")
		return
	}
	if err := source.approveTaskStep(r.Context(), call, input.AuthorizationRef); err != nil {
		status := http.StatusConflict
		if errors.Is(err, errTaskEffectSourceUnavailable) {
			status = http.StatusServiceUnavailable
		}
		writeError(w, status, "original task approval was not accepted")
		return
	}
	s.store.mu.Lock()
	record, ok := s.store.state.Actions[call.OriginalStep.ID]
	s.store.mu.Unlock()
	if !ok || record.ToolStep == nil || record.Status != "approved_not_executed" || record.ToolStep.TaskGrantRef == "" {
		writeError(w, http.StatusConflict, "no committed original approval available")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"step": publicToolStep(record), "executed": false})
}
