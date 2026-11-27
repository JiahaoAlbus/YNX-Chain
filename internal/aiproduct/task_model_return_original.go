package aiproduct

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
)

// Product-local dispatch label only, not a registered SDK/V6 action.
const taskReturnRecheckLocalAction = "model-return-recheck"

// Persist only closed, non-sensitive classes. The original error remains the
// returned cause; these classes are not a public SDK field or a receipt.
func taskReturnFirstCauseClass(err error) string {
	switch {
	case errors.Is(err, context.Canceled):
		return "INVOCATION_CANCELLED"
	case errors.Is(err, context.DeadlineExceeded):
		return "INVOCATION_DEADLINE"
	case errors.Is(err, ErrTaskStoreSnapshotStale):
		return "ORIGINAL_SNAPSHOT_STALE"
	case errors.Is(err, errTaskEffectUnresolved):
		return "ORIGINAL_EFFECT_UNRESOLVED"
	case errors.Is(err, errTaskEffectSourceUnavailable):
		return "ORIGINAL_SOURCE_UNAVAILABLE"
	default:
		return "ORIGINAL_CHECK_FAILED"
	}
}

func (s *Server) retainOriginalReturnFirstCause(p TaskStorePrincipal, call TaskActionCall, runID string, cause error) error {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	key := taskActionKey(p, call.OriginalOperationID)
	record, ok := s.store.state.TaskActionOutcomes[key]
	if !ok || !taskActionMatches(record.View, p, call) || record.View.RunRecordID != runID || record.View.State != "PENDING" || record.FirstCausePresent {
		return nil
	}
	record.FirstCausePresent = true
	record.FirstCauseClass = taskReturnFirstCauseClass(cause)
	s.store.state.TaskActionOutcomes[key] = record
	if err := s.store.persistStateLocked(); err != nil {
		// The original reservation remains UNKNOWN; no second operation is
		// allowed just because recording the first cause failed.
		s.store.authorityEpoch.Store(&taskStoreEpoch{})
		return errors.Join(ErrTaskActionOutcomeUnknown, err)
	}
	return nil
}

// ExecuteOriginalTaskModelReturnRecheck is a product-local port for an
// independently admitted original Auth action. It is not an HTTP route, SDK
// action registration, grant, or permission to start a model/tool operation.
// Auth must bind the same signed call to the held task, run and principal.
// The local test shape below is provisional, not a public SDK contract. The
// supplier must freeze and bind its actual action/path/body before exposure.
func (s *Server) ExecuteOriginalTaskModelReturnRecheck(ctx context.Context, held *TaskStoreSnapshot, call TaskActionCall) (receipt *TaskActionOutcomeReceipt, resultErr error) {
	if s == nil || held == nil || held.source == nil || held.source.store != s.store || ctx == nil {
		return nil, errTaskEffectSourceUnavailable
	}
	if len(call.Body) == 0 || len(call.Body) > 32<<10 {
		return nil, errToolInvalid
	}
	call.Body = bytes.Clone(call.Body)
	if !validTaskActionCall(call) || !boundedTaskActionOperand(call.Action) || !boundedTaskActionOperand(call.Path) {
		return nil, errToolInvalid
	}
	if call.Action != taskReturnRecheckLocalAction {
		return nil, errTaskEffectSourceUnavailable
	}
	var input struct {
		RunID        string `json:"runId"`
		TaskRevision uint64 `json:"taskRevision"`
		Generation   uint64 `json:"generation"`
	}
	var exact map[string]json.RawMessage
	if err := decodeTaskActionBody(call.Body, &input); err != nil || json.Unmarshal(call.Body, &exact) != nil || len(exact) != 3 || exact["runId"] == nil || exact["taskRevision"] == nil || exact["generation"] == nil || !toolOperationID.MatchString(input.RunID) || input.TaskRevision == 0 || input.Generation == 0 || input.TaskRevision != held.view.Task.Revision || input.Generation != held.view.Task.Generation || call.Path != "/api/tasks/"+held.view.Task.ID+"/runs/"+input.RunID+"/return-recheck" {
		return nil, errToolConflict
	}
	source, p := held.source, held.view.Principal
	if err := source.begin(ctx, p); err != nil {
		return nil, err
	}
	store := s.store
	store.mu.Lock()
	key := taskActionKey(p, call.OriginalOperationID)
	if record, exists := store.state.TaskActionOutcomes[key]; exists {
		if !taskActionMatches(record.View, p, call) || record.View.RunRecordID != held.view.Operation.ID {
			store.mu.Unlock()
			return nil, ErrTaskConflict
		}
		receipt, err := source.queryTaskActionLocked(ctx, p, call)
		store.mu.Unlock()
		return receipt, err
	}
	if err := held.Current(); err != nil {
		store.mu.Unlock()
		return nil, err
	}
	task := held.view.Task
	run, ok := store.state.TaskRuns[held.view.Operation.ID]
	session := ProductSession{ID: p.SessionID, Account: p.Account, DeviceID: p.DeviceID}
	if !ok || run.ID == "" || run.RunID != input.RunID || run.TaskID != task.ID || run.Account != p.Account || run.SessionID != p.SessionID || run.Holder != p.DeviceID || run.Cancelled || run.Active || !taskRunHasUndeliveredAnswer(run) || (run.ReturnState != taskModelReturnBlocked && run.ReturnState != taskModelReturnPending) {
		store.mu.Unlock()
		return nil, errToolConflict
	}
	if err := s.taskModelReturnFenceLocked(session, run); err != nil {
		store.mu.Unlock()
		return nil, err
	}
	for _, prior := range store.state.TaskActionOutcomes {
		if prior.View.Principal.Account == p.Account && prior.View.TaskID == task.ID && prior.View.RunRecordID == run.ID && prior.View.State == "PENDING" {
			store.mu.Unlock()
			return nil, ErrTaskActionOutcomeUnknown
		}
	}
	var admitted taskModelAdmissionSnapshot
	nonce, err := base64.RawStdEncoding.DecodeString(run.AdmissionNonce)
	if err != nil || len(nonce) != store.aead.NonceSize() || run.AdmissionCipher == "" {
		store.mu.Unlock()
		return nil, errTaskEffectSourceUnavailable
	}
	plaintext, err := store.decrypt(run.Account, storedMessage{Message: Message{ID: run.ID + ":model-admission", ConversationID: run.TaskID}, Nonce: run.AdmissionNonce, Cipher: run.AdmissionCipher})
	if err == nil {
		err = strictToolJSON(strings.NewReader(plaintext), &admitted)
	}
	if err != nil || len(admitted.Body) == 0 || len(admitted.Body) > 2<<20 || !json.Valid(admitted.Body) || admitted.ProviderURL == "" || admitted.Model == "" || admitted.Session.ID != run.SessionID || admitted.Session.Account != run.Account || admitted.Session.DeviceID != run.Holder || admitted.Task.ID != run.TaskID || admitted.Task.Account != run.Account || admitted.Task.Revision != run.TaskRevision || admitted.Task.Generation != run.Generation || admitted.Task.Holder != run.Holder {
		store.mu.Unlock()
		return nil, errToolConflict
	}
	view := TaskActionOutcomeView{OriginalOperationID: call.OriginalOperationID, RequestRef: call.RequestRef, OriginalRef: key, ConversationID: held.view.ConversationID, RequestDigest: call.RequestDigest, Action: call.Action, Method: call.Method, Path: call.Path, Principal: p, RequestBody: bindTaskBytes(call.Body), RequestBodySHA256: call.BodyDigest, TaskID: task.ID, RunRecordID: run.ID, HolderBefore: task.Holder, RevisionBefore: task.Revision, GenerationBefore: task.Generation, State: "PENDING", Scope: "PRODUCT_LOCAL_COMMIT_ONLY"}
	store.state.TaskActionOutcomes = cloneTaskActionOutcomes(store.state.TaskActionOutcomes)
	store.state.TaskActionOutcomes[key] = storedTaskActionOutcome{View: view}
	if err = store.persistStateLocked(); err != nil {
		store.authorityEpoch.Store(&taskStoreEpoch{})
		store.mu.Unlock()
		return nil, errors.Join(ErrTaskActionOutcomeUnknown, err)
	}
	store.mu.Unlock()
	commitAttempted := false
	defer func() {
		if resultErr != nil && !commitAttempted {
			if retainErr := s.retainOriginalReturnFirstCause(p, call, run.ID, resultErr); retainErr != nil {
				resultErr = errors.Join(resultErr, retainErr)
			}
		}
	}()

	// These checks consult only the retained original answer/admission. The
	// provider, executor and old checkpoint are never called by this port.
	if err = s.checkTaskRunPages(ctx, admitted.Session, run, ""); err == nil {
		if s.taskModelAdmit == nil {
			err = errTaskEffectSourceUnavailable
		} else {
			err = s.taskModelAdmit(ctx, cloneTaskModelSession(admitted.Session), admitted.Task, admitted.ProviderURL, admitted.Model, bytes.Clone(admitted.Body))
		}
	}
	if err == nil {
		err = s.checkTaskRunPages(ctx, admitted.Session, run, "")
	}
	if err == nil {
		err = ctx.Err()
	}
	if err != nil {
		return nil, errors.Join(ErrTaskActionOutcomeUnknown, err)
	}

	store.mu.Lock()
	defer store.mu.Unlock()
	record, exists := store.state.TaskActionOutcomes[key]
	current, runExists := store.state.TaskRuns[run.ID]
	if !exists || !taskActionMatches(record.View, p, call) || record.View.State != "PENDING" || record.View.RunRecordID != run.ID || !runExists || current.AnswerCipher != run.AnswerCipher || current.AnswerNonce != run.AnswerNonce || current.AdmissionCipher != run.AdmissionCipher || current.AdmissionNonce != run.AdmissionNonce || current.ReturnState != run.ReturnState || current.Active || current.Cancelled {
		return nil, ErrTaskActionOutcomeUnknown
	}
	if err = held.Current(); err != nil {
		return nil, errors.Join(ErrTaskActionOutcomeUnknown, err)
	}
	if err = s.taskModelReturnFenceLocked(session, current); err != nil {
		return nil, errors.Join(ErrTaskActionOutcomeUnknown, err)
	}
	current.Status, current.ReturnState, current.UpdatedAt = "COMPLETED", taskModelReturnVerified, store.now().UTC()
	result, err := store.taskRunViewLocked(current)
	if err != nil || result.Content == "" {
		return nil, errors.Join(ErrTaskActionOutcomeUnknown, err)
	}
	body, err := taskActionResponse(200, result)
	if err != nil {
		return nil, errors.Join(ErrTaskActionOutcomeUnknown, err)
	}
	view.HolderAfter, view.RevisionAfter, view.GenerationAfter = task.Holder, task.Revision, task.Generation
	view.State, view.HTTPStatus, view.BodyDigest, view.CommittedAt = "COMMITTED", 200, bindTaskBytes(body), store.now().UTC()
	payload, err := json.Marshal(taskActionStoredPayload{View: view, Body: body})
	if err != nil {
		return nil, errors.Join(ErrTaskActionOutcomeUnknown, err)
	}
	resultNonce, resultCipher, err := store.encrypt(p.Account, task.ID, call.OriginalOperationID+":task-action-result", string(payload))
	if err != nil {
		return nil, errors.Join(ErrTaskActionOutcomeUnknown, err)
	}
	// held.Current checks the capture's context, which need not be this call's
	// context. Recheck the actual invocation under the commit lock as well.
	if err = held.Current(); err != nil {
		return nil, errors.Join(ErrTaskActionOutcomeUnknown, err)
	}
	if err = ctx.Err(); err != nil {
		return nil, errors.Join(ErrTaskActionOutcomeUnknown, err)
	}
	store.state.TaskRuns[run.ID] = current
	store.state.TaskActionOutcomes[key] = storedTaskActionOutcome{View: view, BodyNonce: resultNonce, BodyCipher: resultCipher}
	commitAttempted = true // a failed fsync/rename can have committed; never overwrite it
	if err = store.saveLocked(); err != nil {
		store.state.TaskRuns[run.ID] = run
		store.state.TaskActionOutcomes[key] = record
		return nil, errors.Join(ErrTaskActionOutcomeUnknown, err)
	}
	return source.queryTaskActionLocked(ctx, p, call)
}
