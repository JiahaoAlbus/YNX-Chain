package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strconv"

	originalclient "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-history-client/go"
	open "github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go"
	policy "ynx.local/authgrantpolicy"
)

// Uses the original registered Auth executor. This is not a second local effect
// path: only the receiver's genuine LocalCaller/capability can commit the read.
func (b *originalTaskAuthorityBroker) dispatchConversation(ctx context.Context, e *originalRuntimeToolEffects, call taskEffectCall, ref string, auth OriginalTaskGrantAuthorization) (taskReadReceipt, error) {
	request, err := e.originalBoundRequest(ctx, call, ref, false)
	if err != nil {
		return taskReadReceipt{}, err
	}
	grant, err := open.DecodeBoundGrant(auth.Grant.Payload)
	if err != nil {
		return taskReadReceipt{}, err
	}
	if err = b.effectCurrent(ctx); err != nil {
		return taskReadReceipt{}, err
	}
	result, effectErr := b.client.AuthorizeAtEffect(ctx, originalclient.TaskAuthorityCall{Grant: auth.Grant, Holder: auth.Holder, RawInput: bytes.Clone(request.Input), GrantRef: open.LegacyGrantRefV1{Realm: grant.Realm, Tenant: grant.Tenant, Kind: "grant", ID: grant.ID, Rev: grant.Rev}})
	// Preserve original-op metadata before any late error; it is never a receipt.
	retainErr := retainOriginalBrokerReference(e.store, request, result)
	if effectErr != nil || retainErr != nil {
		return taskReadReceipt{}, errors.Join(effectErr, retainErr)
	}
	return b.acceptConversation(ctx, e, call, auth.Binding, result)
}
func (b *originalTaskAuthorityBroker) reconcileConversation(ctx context.Context, e *originalRuntimeToolEffects, call taskEffectCall, ref string) (taskReadReceipt, error) {
	request, err := e.originalQueryRequest(ctx, call, ref)
	if err != nil {
		return taskReadReceipt{}, err
	}
	source, ok := e.runtime.authority.(originalTaskQueryMaterialAuthority)
	if !ok {
		return taskReadReceipt{}, errTaskEffectSourceUnavailable
	}
	material, err := source.queryOriginalTaskMaterial(ctx, request)
	if err != nil {
		return taskReadReceipt{}, err
	}
	if !originalBrokerOperation(material.Call.OriginalOperation) {
		return taskReadReceipt{}, errToolConflict
	}
	if request.Step.ToolStep.AuthorityOperationID != "" && request.Step.ToolStep.AuthorityOperationID != material.Call.OriginalOperation {
		return taskReadReceipt{}, errToolConflict
	}
	material.Call.RawInput = bytes.Clone(request.Input)
	result, queryErr := b.client.QueryOriginalEffect(ctx, material.Call)
	retainErr := retainOriginalBrokerReference(e.store, request, result)
	if queryErr != nil || retainErr != nil {
		return taskReadReceipt{}, errors.Join(queryErr, retainErr)
	}
	if result.OriginalOperation != material.Call.OriginalOperation {
		return taskReadReceipt{}, errToolConflict
	}
	return b.acceptConversation(ctx, e, call, material.Binding, result)
}

func (b *originalTaskAuthorityBroker) acceptConversation(ctx context.Context, e *originalRuntimeToolEffects, call taskEffectCall, selected policy.TaskEffectBinding, result originalclient.TaskAuthorityResult) (taskReadReceipt, error) {
	if result.State != "COMMITTED" || !originalBrokerOperation(result.OriginalOperation) || len(result.Original) == 0 || len(result.Original) > 1<<20 {
		return taskReadReceipt{}, errTaskEffectUnresolved
	}
	e.store.mu.Lock()
	defer e.store.mu.Unlock()
	task, err := e.store.ownedTaskLocked(call.Account, call.CurrentTask.ID)
	if err != nil {
		return taskReadReceipt{}, err
	}
	record, ok := e.store.state.Actions[call.OriginalStep.ID]
	if !ok || record.Account != call.Account || record.ToolStep == nil || record.ToolStep.TaskID != task.ID || record.Status != "COMPLETED" {
		return taskReadReceipt{}, errTaskEffectUnresolved
	}
	binding := *record.ToolStep
	if binding.ToolID != "ai.conversation.read" || binding.AuthorityOperationID != result.OriginalOperation || binding.RemoteOperationID != record.ID || binding.TaskGrantRef != selected.GrantID || binding.Holder != call.CurrentTask.Holder || binding.Generation != call.CurrentTask.Generation || selected.Account != record.Account || selected.Task.ID != task.ID || selected.StepID != record.ID || selected.Tool.ID != binding.ToolID || len(selected.Sources) != 1 || len(selected.Resources) != 1 || selected.Sources[0].Resource != selected.Resources[0] || selected.Resources[0].ID != record.ConversationID || !reflect.DeepEqual(selected.Fields, binding.ResultFields) || !reflect.DeepEqual(selected.Sources[0].Fields, binding.ResultFields) || binding.ResultAuthScope != string(policy.EgressOnlyReadFence) {
		return taskReadReceipt{}, errToolConflict
	}
	input, inputErr := e.store.decrypt(record.Account, storedMessage{Message: Message{ID: record.ID, ConversationID: task.ID}, Nonce: binding.InputNonce, Cipher: binding.InputCipher})
	schema := shopAuthBind(taskModelTools()[0].Parameters)
	if inputErr != nil || selected.Task.Kind != "task" || selected.Task.Revision != strconv.FormatUint(binding.TaskRevision, 10) || selected.Generation != strconv.FormatUint(binding.Generation, 10) || selected.Holder.ID != binding.Holder || selected.Tool.Version != "1" || selected.Tool.Operation != binding.ToolID || selected.Tool.Risk != "read" || selected.Tool.Schema != schema || selected.Input != shopAuthBind([]byte(input)) || selected.Resources[0].Kind != "conversation" {
		return taskReadReceipt{}, errToolConflict
	}
	local, err := e.store.taskReadReceiptLocked(record)
	if err != nil {
		return taskReadReceipt{}, err
	}
	if shopAuthBind(local.Result) != selected.Sources[0].Binding {
		return taskReadReceipt{}, errToolConflict
	}
	original, err := marshalOriginalTaskResourceReceipt(local, result.OriginalOperation)
	if err != nil || !bytes.Equal(original, []byte(result.Original)) {
		return taskReadReceipt{}, errToolConflict
	}
	if r := result.Resource; r != nil && (r.OperationID != result.OriginalOperation || r.AuthScope != binding.ResultAuthScope || !bytes.Equal(r.ResponseOriginal, original) || r.ResponseBinding != shopAuthBind(original) || !bytes.Equal(r.SourceBytes, local.Result) || !reflect.DeepEqual(r.Source, selected.Sources[0])) {
		return taskReadReceipt{}, errToolConflict
	}
	// This final original source check is followed by only the local encrypted
	// receipt association/save under the same mutex; no new effect or reservation.
	if err = e.runtime.queryCurrent(ctx); err != nil {
		return taskReadReceipt{}, err
	}
	if binding.ResultWireCipher != "" {
		return e.store.taskFeedbackReceiptLocked(record)
	}
	binding.ResultWireNonce, binding.ResultWireCipher, err = e.store.encrypt(record.Account, task.ID, record.ID+":conversation-wire", string(original))
	if err != nil {
		return taskReadReceipt{}, err
	}
	wireBind := bindTaskBytes(original)
	binding.ResultWireBinding = &wireBind
	binding.ResultContentType = "application/json"
	binding.AuthorityReferenceState = "COMMITTED"
	record.ToolStep = &binding
	if err = e.store.saveToolEffectLocked(record, "original_conversation_receipt_verified"); err != nil {
		return taskReadReceipt{}, err
	}
	return e.store.taskFeedbackReceiptLocked(record)
}

func originalConversationReceiptPending(record ActionRecord) bool {
	return record.ToolStep != nil && record.ToolStep.ToolID == "ai.conversation.read" && (record.ToolStep.AuthorityOperationID != "" || record.ToolStep.ResultAuthScope != "" || record.ToolStep.ResultWireCipher != "")
}

// Resource-local COMMITTED is distinct from Auth's verified original outcome.
// Only the original broker acceptance writes the authenticated encrypted wire.
func (s *Store) taskFeedbackReceiptLocked(record ActionRecord) (taskReadReceipt, error) {
	receipt, err := s.taskReadReceiptLocked(record)
	if err != nil {
		return taskReadReceipt{}, err
	}
	if !originalConversationReceiptPending(record) {
		return receipt, nil
	}
	binding := record.ToolStep
	if !originalBrokerOperation(binding.AuthorityOperationID) || binding.ResultAuthScope != string(policy.EgressOnlyReadFence) || binding.AuthorityReferenceState != "COMMITTED" || binding.ResultWireBinding == nil || binding.ResultWireCipher == "" || binding.ResultContentType != "application/json" {
		return taskReadReceipt{}, errTaskEffectUnresolved
	}
	wire, err := s.decrypt(record.Account, storedMessage{Message: Message{ID: record.ID + ":conversation-wire", ConversationID: binding.TaskID}, Nonce: binding.ResultWireNonce, Cipher: binding.ResultWireCipher})
	if err != nil {
		return taskReadReceipt{}, err
	}
	expected, err := marshalOriginalTaskResourceReceipt(receipt, binding.AuthorityOperationID)
	if err != nil || !bytes.Equal([]byte(wire), expected) || bindTaskBytes([]byte(wire)) != *binding.ResultWireBinding {
		return taskReadReceipt{}, errToolConflict
	}
	var original taskReadReceipt
	if strictToolJSON(bytes.NewReader([]byte(wire)), &original) != nil {
		return taskReadReceipt{}, errToolConflict
	}
	return original, nil
}
func (s *Store) taskModelFeedbackContent(account, taskID, stepID string, receipt taskReadReceipt) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.state.Actions[stepID]
	if !ok || record.Account != account || record.ToolStep == nil || record.ToolStep.TaskID != taskID {
		return nil, errToolNotFound
	}
	stored, err := s.taskFeedbackReceiptLocked(record)
	if err != nil || stored.Binding != receipt.Binding || stored.EffectRef != receipt.EffectRef {
		return nil, errTaskEffectUnresolved
	}
	if originalConversationReceiptPending(record) {
		wire, err := s.decrypt(account, storedMessage{Message: Message{ID: record.ID + ":conversation-wire", ConversationID: taskID}, Nonce: record.ToolStep.ResultWireNonce, Cipher: record.ToolStep.ResultWireCipher})
		return []byte(wire), err
	}
	return json.Marshal(stored)
}
