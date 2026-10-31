package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"reflect"

	authgrant "ynx.local/authgrantpolicy"
)

type taskShopOrderProjection struct {
	OrderID  string                     `json:"orderId"`
	Snapshot string                     `json:"snapshot"`
	Fields   []string                   `json:"fields"`
	Data     map[string]json.RawMessage `json:"data"`
}

// A protected caller's partial locator is recovery data, NOT authority or a
// committed receipt. Preserve it before examining its accompanying error.
func captureShopRemoteRef(store *Store, selected OriginalShopOrderCall, ref string) error {
	if ref == "" {
		return nil
	}
	if !validShopOrderRemoteRef(ref) {
		return errToolInvalid
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	record, exists := store.state.Actions[selected.OriginalOperationID]
	if !exists || record.Account != selected.Binding.Account || record.ToolStep == nil || record.ToolStep.TaskID != selected.Binding.Task.ID || record.ToolStep.RemoteOperationID != selected.OriginalOperationID {
		return errToolNotFound
	}
	if record.ToolStep.RemoteRef == ref {
		return nil
	}
	binding := *record.ToolStep
	record.ToolStep = &binding
	if binding.RemoteRef != "" {
		if binding.EffectFirstCause == "" {
			binding.EffectFirstCause = "REMOTE_REFERENCE_CONFLICT"
		}
		if record.Status != "COMPLETED" {
			record.Status = "UNKNOWN"
		}
		if err := store.saveToolEffectLocked(record, "shop_remote_reference_conflict"); err != nil {
			return errors.Join(errToolConflict, err)
		}
		return errToolConflict
	}
	binding.RemoteRef = ref
	return store.saveToolEffectLocked(record, "shop_original_remote_locator_retained_not_receipt")
}

func validateShopProjection(raw []byte, selected taskShopOrderInput) error {
	var projection taskShopOrderProjection
	if len(raw) == 0 || len(raw) > 1<<20 || rejectDuplicateShopJSON(raw) != nil || strictToolJSON(bytes.NewReader(raw), &projection) != nil || projection.OrderID != selected.OrderID || projection.Snapshot != selected.Snapshot || !reflect.DeepEqual(projection.Fields, selected.Fields) || len(projection.Data) != len(selected.Fields) {
		return errToolConflict
	}
	for _, field := range selected.Fields {
		value, exists := projection.Data[field]
		if !exists || !validShopOrderField(field) {
			return errToolConflict
		}
		// The actual Shop projection's nine approved values are strings (integer
		// atoms remain decimal strings; timestamps are original JSON strings).
		var text string
		trimmed := bytes.TrimSpace(value)
		if len(trimmed) == 0 || trimmed[0] != '"' || json.Unmarshal(value, &text) != nil || len(text) > 1<<20 {
			return errToolInvalid
		}
	}
	return nil
}

func (p *PreparedOriginalShopOrderTools) acceptResult(ctx context.Context, store *Store, call taskEffectCall, selected OriginalShopOrderCall, response OriginalShopOrderTransportResult) (taskReadReceipt, error) {
	if err := p.current(ctx); err != nil {
		return taskReadReceipt{}, err
	}
	if len(response.Body) == 0 || len(response.Body) > 1<<20 || response.ContentType != "application/json" {
		return taskReadReceipt{}, errToolInvalid
	}
	response.Body = bytes.Clone(response.Body)
	decoded, err := p.codec.DecodeShopOrderRead(ctx, cloneShopOrderCall(selected), response)
	if err != nil {
		return taskReadReceipt{}, err
	}
	return acceptOriginalShopDecodedResult(ctx, p.current, store, call, selected, response, decoded, selected.OriginalOperationID)
}

func acceptOriginalShopDecodedResult(ctx context.Context, current func(context.Context) error, store *Store, call taskEffectCall, selected OriginalShopOrderCall, response OriginalShopOrderTransportResult, decoded OriginalShopOrderDecodedResult, resourceOperationID string) (taskReadReceipt, error) {
	if current == nil || store == nil || len(selected.Binding.Sources) != 1 {
		return taskReadReceipt{}, errTaskEffectSourceUnavailable
	}
	decoded.ResultJSON, decoded.SourceBytes = bytes.Clone(decoded.ResultJSON), bytes.Clone(decoded.SourceBytes)
	selection, _, err := canonicalShopOrderInput(selected.Input)
	if err != nil {
		return taskReadReceipt{}, err
	}
	if resourceOperationID == "" || decoded.OriginalOperationID != resourceOperationID || !validShopOrderRemoteRef(decoded.RemoteRef) || (response.RemoteRef != "" && response.RemoteRef != decoded.RemoteRef) || (selected.RemoteRef != "" && selected.RemoteRef != decoded.RemoteRef) || !reflect.DeepEqual(decoded.Source, selected.Binding.Sources[0]) || len(decoded.SourceBytes) == 0 || len(decoded.SourceBytes) > 1<<20 || shopAuthBind(decoded.SourceBytes) != selected.Binding.Sources[0].Binding || (decoded.AuthScope != authgrant.EgressOnlyReadFence && decoded.AuthScope != authgrant.SameAuthorityResourceFence) {
		return taskReadReceipt{}, errToolConflict
	}
	if err := validateShopProjection(decoded.ResultJSON, selection); err != nil {
		return taskReadReceipt{}, err
	}
	if err := captureShopRemoteRef(store, selected, decoded.RemoteRef); err != nil {
		return taskReadReceipt{}, err
	}
	if err := current(ctx); err != nil {
		return taskReadReceipt{}, err
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	task, taskErr := store.ownedTaskLocked(call.Account, selected.Binding.Task.ID)
	record, exists := store.state.Actions[selected.OriginalOperationID]
	if taskErr != nil || !exists || record.Account != call.Account || record.ToolStep == nil || record.ToolStep.TaskID != task.ID {
		return taskReadReceipt{}, errToolNotFound
	}
	binding := *record.ToolStep
	if resourceOperationID != selected.OriginalOperationID && (binding.AuthorityOperationID != resourceOperationID || binding.AuthorityReferenceState != "COMMITTED") {
		return taskReadReceipt{}, errToolConflict
	}
	if binding.ToolID != shopOrderToolID || binding.RemoteOperationID != selected.OriginalOperationID || binding.RemoteRef != decoded.RemoteRef || binding.TaskRevision != call.OriginalStep.ToolStep.TaskRevision || binding.Generation != call.OriginalStep.ToolStep.Generation || binding.Holder != call.OriginalStep.ToolStep.Holder || !reflect.DeepEqual(binding.ApprovedFields, selection.Fields) || binding.TaskGrantRef != selected.Binding.GrantID {
		return taskReadReceipt{}, errToolConflict
	}
	if err := ctx.Err(); err != nil {
		return taskReadReceipt{}, err
	}
	if record.Status == "COMPLETED" {
		if binding.ResultBinding != bindTaskBytes(decoded.ResultJSON) {
			return taskReadReceipt{}, errToolConflict
		}
		return store.taskReadReceiptLocked(record)
	}
	if record.Status != "DISPATCHING" && record.Status != "UNKNOWN" && record.Status != "RECONCILING" {
		return taskReadReceipt{}, errToolConflict
	}
	// These are late facts for the ORIGINAL step, never new authority for the
	// current holder/generation. No independent Shop/Auth transaction is claimed.
	var encryptErr error
	binding.ResultNonce, binding.ResultCipher, encryptErr = store.encrypt(record.Account, task.ID, record.ID+":result", string(decoded.ResultJSON))
	if encryptErr != nil {
		return taskReadReceipt{}, encryptErr
	}
	binding.ResultWireNonce, binding.ResultWireCipher, encryptErr = store.encrypt(record.Account, task.ID, record.ID+":shop-wire", string(response.Body))
	if encryptErr != nil {
		return taskReadReceipt{}, encryptErr
	}
	binding.ResultBinding = bindTaskBytes(decoded.ResultJSON)
	wireBinding := bindTaskBytes(response.Body)
	binding.ResultWireBinding = &wireBinding
	binding.ResultFields = append([]string(nil), selection.Fields...)
	binding.ResultContentType = response.ContentType
	binding.ResultAuthScope = string(decoded.AuthScope)
	record.Status, record.ToolStep = "COMPLETED", &binding
	if err := store.saveToolEffectLocked(record, "shop_verified_original_result_committed"); err != nil {
		return taskReadReceipt{}, err
	}
	return store.taskReadReceiptLocked(record)
}

func (s *Store) shopOrderReceiptLocked(record ActionRecord, result []byte) (taskReadReceipt, error) {
	b := record.ToolStep
	if b.ToolID != shopOrderToolID || b.TaskGrantRef == "" || b.RemoteOperationID != record.ID || !validShopOrderRemoteRef(b.RemoteRef) || b.ResultWireBinding == nil || !reflect.DeepEqual(b.ResultFields, b.ApprovedFields) || (b.ResultAuthScope != string(authgrant.EgressOnlyReadFence) && b.ResultAuthScope != string(authgrant.SameAuthorityResourceFence)) {
		return taskReadReceipt{}, errToolConflict
	}
	input, err := s.decrypt(record.Account, storedMessage{Message: Message{ID: record.ID, ConversationID: b.TaskID}, Nonce: b.InputNonce, Cipher: b.InputCipher})
	if err != nil {
		return taskReadReceipt{}, err
	}
	selection, _, err := canonicalShopOrderInput([]byte(input))
	if err != nil || !reflect.DeepEqual(selection.Fields, b.ResultFields) || validateShopProjection(result, selection) != nil {
		return taskReadReceipt{}, errToolConflict
	}
	wire, err := s.decrypt(record.Account, storedMessage{Message: Message{ID: record.ID + ":shop-wire", ConversationID: b.TaskID}, Nonce: b.ResultWireNonce, Cipher: b.ResultWireCipher})
	if err != nil {
		return taskReadReceipt{}, err
	}
	if bindTaskBytes([]byte(wire)) != *b.ResultWireBinding {
		return taskReadReceipt{}, errToolConflict
	}
	wireBinding := *b.ResultWireBinding
	return taskReadReceipt{EffectRef: record.ID, OriginalOperationID: record.ID, AuthorityOperationID: b.AuthorityOperationID, RemoteRef: b.RemoteRef, State: "COMMITTED", Scope: "remote-verified-read", AuthScope: b.ResultAuthScope, Binding: b.ResultBinding, WireBinding: &wireBinding, Fields: append([]string(nil), b.ResultFields...), Result: bytes.Clone(result)}, nil
}
