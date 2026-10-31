package aiproduct

import (
	"bytes"
	"encoding/json"
	"testing"
)

func p08RuntimeBindingRequest(t *testing.T) OriginalTaskAuthorizationRequest {
	t.Helper()
	store, expected, _ := taskReadFixture(t)
	store.mu.Lock()
	task := store.state.Tasks[expected.TaskID]
	step := store.state.Actions[expected.StepID]
	raw, err := store.decrypt(step.Account, storedMessage{Message: Message{ID: step.ID, ConversationID: task.ID}, Nonce: step.ToolStep.InputNonce, Cipher: step.ToolStep.InputCipher})
	store.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	return OriginalTaskAuthorizationRequest{AuthorizationRef: "PUBLIC-proof-ref", Session: ProductSession{ID: "PUBLIC-original-session", Account: task.Account, DeviceID: task.Holder}, OriginalOperationID: step.ID, Task: task, Step: publicToolStep(step), Input: []byte(raw)}
}

func TestP08OriginalRuntimeRequestBinding(t *testing.T) {
	t.Run("exact-original-bytes", func(t *testing.T) {
		r := p08RuntimeBindingRequest(t)
		before := bytes.Clone(r.Input)
		bound, err := bindOriginalGrantRequest(r)
		if err != nil || bound.TaskID != r.Task.ID || bound.StepID != r.Step.ID || bound.Holder != r.Task.Holder || bound.SessionID != r.Session.ID || bound.Input.SHA512 != bindTaskBytes(before).SHA512 || !bytes.Equal(r.Input, before) {
			t.Fatalf("actual request binding changed: %+v %v", bound, err)
		}
	})
	t.Run("caller-cannot-switch-tenant-account", func(t *testing.T) {
		r := p08RuntimeBindingRequest(t)
		r.Session.Account = "another-account"
		if _, err := bindOriginalGrantRequest(r); err == nil {
			t.Fatal("foreign caller bound to original authority")
		}
	})
	t.Run("signed-input-is-not-normalized", func(t *testing.T) {
		r := p08RuntimeBindingRequest(t)
		var body map[string]any
		if err := json.Unmarshal(r.Input, &body); err != nil {
			t.Fatal(err)
		}
		r.Input = append([]byte(" \n"), r.Input...)
		before := bytes.Clone(r.Input)
		if _, err := bindOriginalGrantRequest(r); err == nil || !bytes.Equal(before, r.Input) {
			t.Fatal("signed input was silently normalized")
		}
	})
	t.Run("historical-query-keeps-original-intent", func(t *testing.T) {
		r := p08RuntimeBindingRequest(t)
		r.QueryOriginal = true
		r.Step.Status = "UNKNOWN"
		r.Step.ToolStep.RemoteOperationID = r.Step.ID
		r.Task.Revision++
		r.Task.Generation++
		r.Task.Holder = "new-current-device"
		r.Session.DeviceID = r.Task.Holder
		r.Input = []byte(`{"role":"buyer","legacy":"already-signed-input"}`)
		before := bytes.Clone(r.Input)
		bound, err := bindOriginalGrantRequest(r)
		if err != nil || bound.Generation != "2" || bound.OriginalGeneration != "1" || bound.TaskRevision != "2" || bound.OriginalTaskRevision != "1" || bound.Holder == r.Task.Holder || !bytes.Equal(before, r.Input) {
			t.Fatalf("query rekeyed original intent: %+v %v", bound, err)
		}
		r.QueryOriginal = false
		if _, err = bindOriginalGrantRequest(r); err == nil {
			t.Fatal("historical query became new execution")
		}
	})
	t.Run("query-needs-original-outbox-slot", func(t *testing.T) {
		r := p08RuntimeBindingRequest(t)
		r.QueryOriginal = true
		r.Step.Status = "UNKNOWN"
		r.Step.ToolStep.RemoteOperationID = "another-operation"
		if _, err := bindOriginalGrantRequest(r); err == nil {
			t.Fatal("query lost original operation")
		}
	})
}
