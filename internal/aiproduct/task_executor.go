package aiproduct

import (
	"context"
	"crypto/sha3"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"reflect"
	"strings"
)

// These are private resource-adapter types, not the SDK's public Grant wire.
// Only the original admitted Auth Source may supply the synchronous final
// check. There is deliberately no HTTP/caller-provider setter for this fence.
type taskBytesBinding struct {
	Bytes    int    `json:"bytes"`
	SHA3_512 string `json:"sha3_512"`
	SHA512   string `json:"sha512"`
}

type taskReadExpectation struct {
	Account, TaskID, StepID, Holder string
	TaskRevision, Generation        uint64
	Input                           taskBytesBinding
	Fields                          []string
	SourceBinding                   *taskBytesBinding
	AuthorityOperationID, GrantRef  string
	ConversationID                  string
}

type taskReadReceipt struct {
	EffectRef            string            `json:"effectRef"`
	State                string            `json:"state"`
	Scope                string            `json:"scope"`
	Binding              taskBytesBinding  `json:"binding"`
	Result               json.RawMessage   `json:"result"`
	OriginalOperationID  string            `json:"originalOperationId,omitempty"`
	AuthorityOperationID string            `json:"authorityOperationId,omitempty"`
	RemoteRef            string            `json:"remoteRef,omitempty"`
	Fields               []string          `json:"fields,omitempty"`
	WireBinding          *taskBytesBinding `json:"wireBinding,omitempty"`
	AuthScope            string            `json:"authScope,omitempty"`
}

var errTaskEffectFenceUnavailable = errors.New("original admitted Auth resource effect fence is required")

func bindTaskBytes(raw []byte) taskBytesBinding {
	a, b := sha3.Sum512(raw), sha512.Sum512(raw)
	return taskBytesBinding{Bytes: len(raw), SHA3_512: hex.EncodeToString(a[:]), SHA512: hex.EncodeToString(b[:])}
}

// commitTaskReadAtEffectFence is a real same-resource read/receipt transaction.
// It is NOT exposed as an authorization shortcut. Auth's original resource
// adapter must call it from authorizeAtEffect with its final snapshot check.
func (s *Store) commitTaskReadAtEffectFence(ctx context.Context, expected taskReadExpectation, finalSnapshotCheck func() error) (taskReadReceipt, error) {
	if finalSnapshotCheck == nil {
		return taskReadReceipt{}, errTaskEffectFenceUnavailable
	}
	if err := ctx.Err(); err != nil {
		return taskReadReceipt{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	task, err := s.ownedTaskLocked(expected.Account, expected.TaskID)
	if err != nil {
		return taskReadReceipt{}, err
	}
	if err := s.assertTaskAgentConfigurationLocked(task, "ai.conversation.read"); err != nil {
		return taskReadReceipt{}, err
	}
	if expected.ConversationID != "" && expected.ConversationID != task.ConversationID {
		return taskReadReceipt{}, errToolConflict
	}
	if task.Revision != expected.TaskRevision || task.Generation != expected.Generation || task.Holder != expected.Holder || !task.CancelledAt.IsZero() || (task.Status != "READY" && task.Status != "WORKING") {
		return taskReadReceipt{}, ErrTaskConflict
	}
	record, exists := s.state.Actions[expected.StepID]
	if !exists || record.Account != expected.Account || record.ToolStep == nil || record.ToolStep.TaskID != task.ID {
		return taskReadReceipt{}, errToolNotFound
	}
	binding := *record.ToolStep
	if expected.GrantRef != "" && binding.TaskGrantRef != expected.GrantRef {
		return taskReadReceipt{}, errToolConflict
	}
	if expected.AuthorityOperationID != "" && binding.AuthorityOperationID != "" && binding.AuthorityOperationID != expected.AuthorityOperationID {
		return taskReadReceipt{}, errToolConflict
	}
	if binding.ToolID != "ai.conversation.read" || binding.ToolVersion != "1" || binding.Holder != task.Holder || binding.Generation != task.Generation || record.ConversationID != task.ConversationID {
		return taskReadReceipt{}, errToolConflict
	}
	if record.Status != "approved_not_executed" && record.Status != "DISPATCHING" && record.Status != "COMPLETED" {
		return taskReadReceipt{}, errToolConflict
	}
	if len(expected.Fields) == 0 || len(expected.Fields) > 2 {
		return taskReadReceipt{}, errToolInvalid
	}
	if len(binding.ApprovedFields) > 0 && !reflect.DeepEqual(binding.ApprovedFields, expected.Fields) {
		return taskReadReceipt{}, errToolConflict
	}
	fields := map[string]bool{}
	for _, field := range expected.Fields {
		if fields[field] || (field != "conversation" && field != "messages") {
			return taskReadReceipt{}, errToolInvalid
		}
		fields[field] = true
	}
	input, err := s.decrypt(record.Account, storedMessage{Message: Message{ID: record.ID, ConversationID: task.ID}, Nonce: binding.InputNonce, Cipher: binding.InputCipher})
	if err != nil {
		return taskReadReceipt{}, err
	}
	if bindTaskBytes([]byte(input)) != expected.Input {
		return taskReadReceipt{}, errToolConflict
	}
	var selected conversationToolInput
	if strictToolJSON(strings.NewReader(input), &selected) != nil || selected.ConversationID != task.ConversationID {
		return taskReadReceipt{}, errToolConflict
	}
	// No async yield or resource mutation separates final Auth check from read.
	if err := finalSnapshotCheck(); err != nil {
		return taskReadReceipt{}, err
	}
	if err := ctx.Err(); err != nil {
		return taskReadReceipt{}, err
	}
	if record.Status == "COMPLETED" {
		if expected.AuthorityOperationID != "" && binding.AuthorityOperationID != expected.AuthorityOperationID {
			return taskReadReceipt{}, errToolConflict
		}
		if expected.SourceBinding != nil && binding.ResultBinding != *expected.SourceBinding {
			return taskReadReceipt{}, errToolConflict
		}
		if !reflect.DeepEqual(binding.ResultFields, expected.Fields) {
			return taskReadReceipt{}, errToolConflict
		}
		return s.taskReadReceiptLocked(record)
	}
	result := map[string]any{}
	if fields["conversation"] {
		result["conversation"] = s.state.Conversations[task.ConversationID]
	}
	if fields["messages"] {
		messages := []Message{}
		for _, stored := range s.state.Messages[task.ConversationID] {
			content, err := s.decrypt(expected.Account, stored)
			if err != nil {
				return taskReadReceipt{}, err
			}
			message := stored.Message
			message.Content = content
			messages = append(messages, message)
		}
		result["messages"] = messages
	}
	raw, err := json.Marshal(result)
	if err != nil {
		return taskReadReceipt{}, err
	}
	if len(raw) > 1<<20 {
		return taskReadReceipt{}, errors.New("tool result exceeds bounded result limit")
	}
	if expected.SourceBinding != nil && bindTaskBytes(raw) != *expected.SourceBinding {
		return taskReadReceipt{}, errToolConflict
	}
	binding.ResultNonce, binding.ResultCipher, err = s.encrypt(expected.Account, task.ID, record.ID+":result", string(raw))
	if err != nil {
		return taskReadReceipt{}, err
	}
	binding.ResultBinding = bindTaskBytes(raw)
	if expected.AuthorityOperationID != "" {
		binding.AuthorityOperationID = expected.AuthorityOperationID
		if binding.RemoteOperationID == "" {
			binding.RemoteOperationID = record.ID
		}
		binding.ResultAuthScope = "egress-only-read-fence"
	}
	binding.ResultFields = append([]string(nil), expected.Fields...)
	previous := record
	record.ToolStep = &binding
	record.Status = "COMPLETED"
	oldEvents, eventsExisted := s.state.TaskEvents[task.ID]
	eventsWereNil := s.state.TaskEvents == nil
	if err := s.appendTaskEventLocked(task.ID, task.Revision, "tool_result_committed", record.ID); err != nil {
		return taskReadReceipt{}, err
	}
	audits, sequence := s.state.Audits, s.state.AuditSequence
	s.state.Actions[record.ID] = record
	s.auditLocked(expected.Account, "tool_result_committed", record.ID, "same-resource read; encrypted result retained")
	if err := s.saveLocked(); err != nil {
		s.state.Actions[record.ID] = previous
		s.state.Audits, s.state.AuditSequence = audits, sequence
		s.restoreTaskEventsLocked(task.ID, oldEvents, eventsExisted, eventsWereNil)
		return taskReadReceipt{}, err
	}
	return taskReadReceipt{EffectRef: record.ID, State: "COMMITTED", Scope: "same-resource-transaction", Binding: binding.ResultBinding, Result: raw}, nil
}

func (s *Store) taskReadReceiptLocked(record ActionRecord) (taskReadReceipt, error) {
	if record.ToolStep == nil || record.Status != "COMPLETED" {
		return taskReadReceipt{}, errToolConflict
	}
	binding := record.ToolStep
	result, err := s.decrypt(record.Account, storedMessage{Message: Message{ID: record.ID + ":result", ConversationID: binding.TaskID}, Nonce: binding.ResultNonce, Cipher: binding.ResultCipher})
	if err != nil {
		return taskReadReceipt{}, err
	}
	if bindTaskBytes([]byte(result)) != binding.ResultBinding {
		return taskReadReceipt{}, errors.New("stored tool result binding mismatch")
	}
	if binding.ToolID == shopOrderToolID {
		return s.shopOrderReceiptLocked(record, []byte(result))
	}
	return taskReadReceipt{EffectRef: record.ID, State: "COMMITTED", Scope: "same-resource-transaction", Binding: binding.ResultBinding, Result: json.RawMessage(result)}, nil
}

func (s *Server) handleTaskToolResult(w http.ResponseWriter, r *http.Request, session ProductSession) {
	s.store.mu.Lock()
	task, err := s.store.ownedTaskLocked(session.Account, r.PathValue("id"))
	if err != nil {
		s.store.mu.Unlock()
		writeError(w, http.StatusNotFound, "task result not found")
		return
	}
	record, exists := s.store.state.Actions[r.PathValue("stepId")]
	// Model runs retain the original WebDAV operation ID as a step reference.
	// Read the SAME existing authenticated observation, never convert it into a
	// same-resource COMMITTED receipt or query/write the remote object again.
	delivery, external := s.store.state.WebDAVDeliveries[taskWebDAVKey(session.Account, task.ID, r.PathValue("stepId"))]
	if external {
		if exists || task.Holder != session.DeviceID || delivery.Holder != session.DeviceID || delivery.Account != session.Account || delivery.TaskID != task.ID || delivery.Input.OperationID != r.PathValue("stepId") {
			s.store.mu.Unlock()
			writeError(w, http.StatusNotFound, "task result not found")
			return
		}
		if err := s.store.verifyWebDAVRecord(delivery); err != nil {
			s.store.mu.Unlock()
			writeError(w, http.StatusConflict, "original external observation is unavailable")
			return
		}
		receipt := delivery.Receipt
		s.store.mu.Unlock()
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, receipt)
		return
	}
	if !exists || record.Account != session.Account || record.ToolStep == nil || record.ToolStep.TaskID != task.ID || task.Holder != session.DeviceID {
		s.store.mu.Unlock()
		writeError(w, http.StatusNotFound, "task result not found")
		return
	}
	receipt, err := s.store.taskReadReceiptLocked(record)
	s.store.mu.Unlock()
	if err != nil {
		writeError(w, http.StatusConflict, "no verified committed tool result is available")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, receipt)
}
