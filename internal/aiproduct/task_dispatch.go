package aiproduct

import (
	"context"
	"errors"
	"net/http"
)

// Private Source bridge, not a public provider registry or an Auth verifier.
// The original admitted Auth adapter must verify its real Grant and run the
// resource's final-check/commit fence. No application/HTTP setter installs it.
// Production remains unavailable until that original bridge is supplied.
type originalToolEffectSource interface {
	dispatchTaskTool(context.Context, taskEffectCall, string) (taskReadReceipt, error)
	reconcileTaskTool(context.Context, taskEffectCall, string) (taskReadReceipt, error)
}

type taskEffectCall struct {
	Session             ProductSession
	Account             string
	CurrentTask         TaskRecord
	OriginalStep        ActionRecord
	OriginalOperationID string
}

var errTaskEffectSourceUnavailable = errors.New("EFFECT_SOURCE_NOT_ADMITTED")
var errTaskEffectUnresolved = errors.New("original tool effect unresolved; reconcile the original operation")

type taskEffectFailure struct{ cause error }

func (e *taskEffectFailure) Error() string   { return errTaskEffectUnresolved.Error() }
func (e *taskEffectFailure) Unwrap() []error { return []error{errTaskEffectUnresolved, e.cause} }

func (s *Store) effectCallLocked(session ProductSession, taskID, stepID string, dispatch bool) (taskEffectCall, error) {
	task, err := s.ownedTaskLocked(session.Account, taskID)
	if err != nil {
		return taskEffectCall{}, err
	}
	record, ok := s.state.Actions[stepID]
	if !ok || record.Account != session.Account || record.ToolStep == nil || record.ToolStep.TaskID != task.ID {
		return taskEffectCall{}, errToolNotFound
	}
	binding := *record.ToolStep
	if !dispatch && task.Holder != session.DeviceID && binding.Holder != session.DeviceID {
		return taskEffectCall{}, errToolNotFound
	}
	if dispatch {
		if err := s.assertTaskAgentConfigurationLocked(task, binding.ToolID); err != nil {
			return taskEffectCall{}, err
		}
		if task.Holder != session.DeviceID || !task.CancelledAt.IsZero() || (task.Status != "READY" && task.Status != "WORKING") || binding.Holder != task.Holder || binding.Generation != task.Generation {
			return taskEffectCall{}, errToolConflict
		}
		if record.Status != "approved_not_executed" {
			return taskEffectCall{}, errToolConflict
		}
		tool, known := lookupTool(binding.ToolID)
		if !known || binding.ToolVersion != tool.version || binding.TaskRevision != task.Revision {
			return taskEffectCall{}, errToolInvalid
		}
	}
	record.ToolStep = &binding
	return taskEffectCall{Session: session, Account: session.Account, CurrentTask: task, OriginalStep: record, OriginalOperationID: record.ID}, nil
}

func (s *Store) saveToolEffectLocked(record ActionRecord, event string) error {
	previous := s.state.Actions[record.ID]
	id := record.ToolStep.TaskID
	oldEvents, exists := s.state.TaskEvents[id]
	wasNil := s.state.TaskEvents == nil
	if err := s.appendTaskEventLocked(id, 1, event, record.ID); err != nil {
		return err
	}
	audits, sequence := s.state.Audits, s.state.AuditSequence
	s.state.Actions[record.ID] = record
	s.auditLocked(record.Account, event, record.ID, record.Status)
	if err := s.saveLocked(); err != nil {
		s.state.Actions[record.ID] = previous
		s.state.Audits, s.state.AuditSequence = audits, sequence
		s.restoreTaskEventsLocked(id, oldEvents, exists, wasNil)
		return err
	}
	return nil
}

func (s *Server) dispatchApprovedStep(ctx context.Context, session ProductSession, taskID, stepID, authorizationRef string) (taskReadReceipt, error) {
	if s.toolEffects == nil {
		return taskReadReceipt{}, errTaskEffectSourceUnavailable
	}
	if err := ctx.Err(); err != nil {
		return taskReadReceipt{}, err
	}
	s.store.mu.Lock()
	call, err := s.store.effectCallLocked(session, taskID, stepID, true)
	s.store.mu.Unlock()
	if err == nil {
		if available, ok := s.toolEffects.(interface {
			taskToolAvailable(context.Context, string) error
		}); ok {
			err = available.taskToolAvailable(ctx, call.OriginalStep.ToolStep.ToolID)
		}
	}
	if err != nil {
		return taskReadReceipt{}, err
	}
	s.store.mu.Lock()
	// The external readiness check runs without mu; compare fresh task/step
	// fences again before claiming the original operation.
	call, err = s.store.effectCallLocked(session, taskID, stepID, true)
	if err == nil {
		record := call.OriginalStep
		record.Status = "DISPATCHING"
		record.ToolStep.RemoteOperationID = call.OriginalOperationID
		err = s.store.saveToolEffectLocked(record, "tool_effect_reserved")
		call.OriginalStep = record
	}
	s.store.mu.Unlock()
	if err != nil {
		return taskReadReceipt{}, err
	}
	// Only the original Source can execute; model content is never a receipt.
	effectCtx, finish, effectErr := s.beginTaskEffect(ctx, call)
	defer finish()
	var receipt taskReadReceipt
	if effectErr == nil {
		receipt, effectErr = s.toolEffects.dispatchTaskTool(effectCtx, call, authorizationRef)
	}
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	current, exists := s.store.state.Actions[stepID]
	liveTask, liveErr := s.store.ownedTaskLocked(session.Account, taskID)
	if liveErr != nil || !exists || current.ToolStep == nil || current.Account != session.Account || current.ToolStep.TaskID != taskID {
		return taskReadReceipt{}, errToolNotFound
	}
	if liveTask.Generation != call.CurrentTask.Generation || liveTask.Holder != call.CurrentTask.Holder || current.ToolStep.RemoteOperationID != call.OriginalOperationID {
		return taskReadReceipt{}, errToolConflict
	}
	if effectErr == nil {
		stored, readErr := s.store.taskReadReceiptLocked(current)
		if readErr == nil && receipt.EffectRef == call.OriginalOperationID && receipt.State == "COMMITTED" && receipt.Scope == stored.Scope && receipt.Binding == stored.Binding {
			return stored, nil
		}
	}
	// Already committed exact facts survive response loss. Otherwise the
	// durable reservation is UNKNOWN, never reset to runnable/approved.
	binding := *current.ToolStep
	current.ToolStep = &binding
	if binding.EffectFirstCause == "" {
		binding.EffectFirstCause = "EFFECT_RESULT_UNRESOLVED"
	}
	if current.Status != "COMPLETED" {
		current.Status = "UNKNOWN"
	}
	if err := s.store.saveToolEffectLocked(current, "tool_effect_unresolved"); err != nil {
		return taskReadReceipt{}, err
	}
	if effectErr != nil {
		return taskReadReceipt{}, &taskEffectFailure{cause: effectErr}
	}
	return taskReadReceipt{}, errTaskEffectUnresolved
}

func (s *Server) reconcileStep(ctx context.Context, session ProductSession, taskID, stepID, authorizationRef string) (taskReadReceipt, error) {
	if err := ctx.Err(); err != nil {
		return taskReadReceipt{}, err
	}
	s.store.mu.Lock()
	call, err := s.store.effectCallLocked(session, taskID, stepID, false)
	if err == nil && call.OriginalStep.Status == "COMPLETED" {
		receipt, readErr := s.store.taskReadReceiptLocked(call.OriginalStep)
		s.store.mu.Unlock()
		return receipt, readErr
	}
	s.store.mu.Unlock()
	if err != nil {
		return taskReadReceipt{}, err
	}
	if call.OriginalStep.Status != "UNKNOWN" && call.OriginalStep.Status != "DISPATCHING" && call.OriginalStep.Status != "RECONCILING" {
		return taskReadReceipt{}, errToolConflict
	}
	if call.OriginalStep.ToolStep.RemoteOperationID == "" || call.OriginalStep.ToolStep.RemoteOperationID != call.OriginalOperationID {
		return taskReadReceipt{}, errToolConflict
	}
	if s.toolEffects == nil {
		return taskReadReceipt{}, errTaskEffectSourceUnavailable
	}
	// This method has no call to dispatchTaskTool: query original only.
	receipt, err := s.toolEffects.reconcileTaskTool(ctx, call, authorizationRef)
	if err != nil {
		return taskReadReceipt{}, &taskEffectFailure{cause: err}
	}
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	stored, err := s.store.taskReadReceiptLocked(s.store.state.Actions[stepID])
	if err != nil || receipt.EffectRef != call.OriginalOperationID || receipt.State != "COMMITTED" || receipt.Binding != stored.Binding {
		return taskReadReceipt{}, errTaskEffectUnresolved
	}
	return stored, nil
}

func (s *Server) taskEffectHTTP(w http.ResponseWriter, r *http.Request, session ProductSession, reconcile bool) {
	var input struct {
		AuthorizationRef string `json:"authorizationRef"`
	}
	if !readToolJSON(w, r, &input) {
		return
	}
	if input.AuthorizationRef == "" || len(input.AuthorizationRef) > 256 {
		writeError(w, http.StatusBadRequest, "bounded original authorization reference required")
		return
	}
	var receipt taskReadReceipt
	var err error
	if reconcile {
		receipt, err = s.reconcileStep(r.Context(), session, r.PathValue("id"), r.PathValue("stepId"), input.AuthorizationRef)
	} else {
		receipt, err = s.dispatchApprovedStep(r.Context(), session, r.PathValue("id"), r.PathValue("stepId"), input.AuthorizationRef)
	}
	if err != nil {
		status := http.StatusConflict
		if errors.Is(err, errTaskEffectSourceUnavailable) {
			status = http.StatusServiceUnavailable
		}
		writeError(w, status, err.Error())
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	if reconcile {
		s.store.mu.Lock()
		task, taskErr := s.store.ownedTaskLocked(session.Account, r.PathValue("id"))
		s.store.mu.Unlock()
		if taskErr != nil {
			writeError(w, http.StatusNotFound, "original task not found")
			return
		}
		if task.Holder != session.DeviceID {
			writeJSON(w, http.StatusOK, map[string]any{"state": receipt.State, "effectRef": receipt.EffectRef, "recoveryOnly": true})
			return
		}
	}
	writeJSON(w, http.StatusOK, receipt)
}

func (s *Server) handleTaskToolDispatch(w http.ResponseWriter, r *http.Request, session ProductSession) {
	s.taskEffectHTTP(w, r, session, false)
}
func (s *Server) handleTaskToolReconcile(w http.ResponseWriter, r *http.Request, session ProductSession) {
	s.taskEffectHTTP(w, r, session, true)
}
