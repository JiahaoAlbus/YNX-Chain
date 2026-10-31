package aiproduct

import (
	"context"
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Maps the original runtime's query-only reference, NOT a resource receipt.
// The concrete native adapter implements this using QueryOriginalTaskRequest;
// it must never use ResolveTaskGrant/OpenCheck for a historical lookup.
type originalTaskOperationReference struct{ State, OperationID string }
type originalTaskOperationQueryAuthority interface {
	queryOriginalTaskOperation(context.Context, OriginalTaskAuthorizationRequest) (originalTaskOperationReference, error)
}

func (e *originalRuntimeToolEffects) originalQueryRequest(ctx context.Context, call taskEffectCall, ref string) (OriginalTaskAuthorizationRequest, error) {
	return e.originalBoundRequest(ctx, call, ref, true)
}

func (e *originalRuntimeToolEffects) originalBoundRequest(ctx context.Context, call taskEffectCall, ref string, query bool) (OriginalTaskAuthorizationRequest, error) {
	var zero OriginalTaskAuthorizationRequest
	if e == nil || e.store == nil {
		return zero, errTaskEffectSourceUnavailable
	}
	check := e.runtime.current
	if query {
		check = e.runtime.queryCurrent
	}
	if err := check(ctx); err != nil {
		return zero, err
	}
	e.store.mu.Lock()
	defer e.store.mu.Unlock()
	task, err := e.store.ownedTaskLocked(call.Account, call.CurrentTask.ID)
	if err != nil {
		return zero, err
	}
	if !query && (task.Revision != call.CurrentTask.Revision || task.Generation != call.CurrentTask.Generation || task.Holder != call.CurrentTask.Holder) {
		return zero, errToolConflict
	}
	step, exists := e.store.state.Actions[call.OriginalStep.ID]
	if !exists || step.ToolStep == nil || step.Account != call.Account || step.ToolStep.TaskID != task.ID || call.OriginalOperationID != step.ID {
		return zero, errToolNotFound
	}
	input, err := e.store.decrypt(step.Account, storedMessage{Message: Message{ID: step.ID, ConversationID: task.ID}, Nonce: step.ToolStep.InputNonce, Cipher: step.ToolStep.InputCipher})
	if err != nil {
		return zero, err
	}
	request := OriginalTaskAuthorizationRequest{AuthorizationRef: ref, Session: call.Session, QueryOriginal: query, OriginalOperationID: step.ID, Task: task, Step: publicToolStep(step), Input: []byte(input)}
	request.Session.Scopes = append([]string(nil), call.Session.Scopes...)
	if _, err := bindOriginalGrantRequest(request); err != nil {
		return zero, err
	}
	return request, nil
}

func (s *Store) retainOriginalAuthorityReference(request OriginalTaskAuthorizationRequest, reference originalTaskOperationReference) error {
	if reference.OperationID == "" && reference.State == "" {
		return nil
	}
	if reference.State != "UNKNOWN" && reference.State != "COMMITTED" && reference.State != "FAILED" {
		return errToolConflict
	}
	if reference.OperationID == "" || len(reference.OperationID) > 256 || !utf8.ValidString(reference.OperationID) || strings.IndexFunc(reference.OperationID, unicode.IsControl) >= 0 {
		return errToolConflict
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	record, exists := s.state.Actions[request.OriginalOperationID]
	if !exists || record.Account != request.Task.Account || record.ToolStep == nil || record.ToolStep.TaskID != request.Task.ID || record.ToolStep.RemoteOperationID != record.ID || request.Step.ToolStep == nil || record.ToolStep.InputDigest != request.Step.ToolStep.InputDigest {
		return errToolNotFound
	}
	b := *record.ToolStep
	record.ToolStep = &b
	if b.AuthorityOperationID != "" && b.AuthorityOperationID != reference.OperationID {
		return errToolConflict
	}
	if (b.AuthorityReferenceState == "COMMITTED" || b.AuthorityReferenceState == "FAILED") && b.AuthorityReferenceState != reference.State {
		return errToolConflict
	}
	if b.AuthorityOperationID == reference.OperationID && b.AuthorityReferenceState == reference.State {
		return nil
	}
	b.AuthorityOperationID, b.AuthorityReferenceState = reference.OperationID, reference.State
	// Neither Action.Status nor result bytes are changed by an authority reference.
	return s.saveToolEffectLocked(record, "original_authority_reference_retained_not_resource_receipt")
}

func (e *originalRuntimeToolEffects) queryOriginalAuthorityReference(ctx context.Context, call taskEffectCall, ref string, source originalTaskOperationQueryAuthority) (taskReadReceipt, error) {
	request, err := e.originalQueryRequest(ctx, call, ref)
	if err != nil {
		return taskReadReceipt{}, err
	}
	reference, queryErr := source.queryOriginalTaskOperation(ctx, request)
	// Retain a nonzero partial before inspecting its accompanying late error.
	retainErr := e.store.retainOriginalAuthorityReference(request, reference)
	// A COMMITTED authority row alone contains no verified resource outcome.
	// The actual Source resource-query/receipt contract is still required.
	return taskReadReceipt{}, errors.Join(errTaskEffectUnresolved, queryErr, retainErr)
}
