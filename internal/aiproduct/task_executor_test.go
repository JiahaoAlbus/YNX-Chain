package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

func taskReadFixture(t *testing.T) (*Store, taskReadExpectation, []byte) {
	t.Helper()
	store, conversation, key := p08TaskStore(t)
	if _, err := store.AddMessage("tenant-a", conversation.ID, Message{Role: "user", Content: "actual selected source body", Status: "complete"}); err != nil {
		t.Fatal(err)
	}
	task, err := store.CreateTask("tenant-a", conversation.ID, "device")
	if err != nil {
		t.Fatal(err)
	}
	// Explicit isolated authorization fixture; not a production Grant.
	task.Status = "READY"
	store.mu.Lock()
	err = store.saveTaskLocked(task, "isolated_fixture_ready")
	store.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(conversationToolInput{ConversationID: conversation.ID})
	step, _, err := store.reserveToolStep(ProductSession{Account: "tenant-a", DeviceID: "device", Scopes: []string{"ai:conversations"}}, task.ID, toolStepRequest{OperationID: "original-read", TaskRevision: 1, Generation: 1, ToolID: "ai.conversation.read", ToolVersion: "1", Input: raw})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.commitTaskApprovalAtFence(context.Background(), taskReadExpectation{Account: "tenant-a", TaskID: task.ID, StepID: step.ID, Holder: "device", TaskRevision: 1, Generation: 1, Input: bindTaskBytes(raw), Fields: []string{"messages"}}, "isolated-grant-reference", func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	return store, taskReadExpectation{Account: "tenant-a", TaskID: task.ID, StepID: step.ID, Holder: "device", TaskRevision: 1, Generation: 1, Input: bindTaskBytes(raw), Fields: []string{"messages"}}, key
}

func TestP08RealTaskReadHandler(t *testing.T) {
	store, expected, key := taskReadFixture(t)
	checks := 0
	fence := func() error { checks++; return nil }
	receipt, err := store.commitTaskReadAtEffectFence(context.Background(), expected, fence)
	if err != nil || receipt.State != "COMMITTED" || receipt.EffectRef != expected.StepID || !bytes.Contains(receipt.Result, []byte("actual selected source body")) {
		t.Fatalf("actual result missing: %+v %v", receipt, err)
	}
	if bytes.Contains(receipt.Result, []byte(`"conversation":`)) {
		t.Fatal("unselected field disclosed")
	}
	sequence := store.state.AuditSequence
	replay, err := store.commitTaskReadAtEffectFence(context.Background(), expected, fence)
	if err != nil || !bytes.Equal(replay.Result, receipt.Result) || checks != 2 || store.state.AuditSequence != sequence {
		t.Fatalf("replay reran operation or bypassed fence: %+v %v", replay, err)
	}
	disk, err := os.ReadFile(store.path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(disk, []byte("actual selected source body")) {
		t.Fatal("result stored in plaintext")
	}
	restarted, err := NewStore(store.path, key)
	if err != nil {
		t.Fatal(err)
	}
	recovered, err := restarted.commitTaskReadAtEffectFence(context.Background(), expected, func() error { return nil })
	if err != nil || !bytes.Equal(recovered.Result, receipt.Result) {
		t.Fatalf("original result did not recover: %+v %v", recovered, err)
	}
	denied := errors.New("isolated revoked authority")
	if _, err := restarted.commitTaskReadAtEffectFence(context.Background(), expected, func() error { return denied }); !errors.Is(err, denied) {
		t.Fatalf("recovery bypassed revocation: %v", err)
	}
}

func TestP08TaskToolResultHTTP(t *testing.T) {
	gateway := newGatewayFixture(t, true)
	defer gateway.Close()
	store, product := testProduct(t, gateway.URL)
	defer product.Close()
	session := authenticate(t, product.URL, store, newTestIdentity(t))
	other := authenticate(t, product.URL, store, newTestIdentityFromSeed(t, 84, "other-device"))
	conversation, err := store.CreateConversation(session.Account, "Actual result source")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddMessage(session.Account, conversation.ID, Message{Role: "user", Content: "actual HTTP source body", Status: "complete"}); err != nil {
		t.Fatal(err)
	}
	task, err := store.CreateTask(session.Account, conversation.ID, session.DeviceID)
	if err != nil {
		t.Fatal(err)
	}
	task.Status = "READY"
	store.mu.Lock()
	err = store.saveTaskLocked(task, "isolated_ready")
	store.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(conversationToolInput{ConversationID: conversation.ID})
	step, _, err := store.reserveToolStep(ProductSession{Account: session.Account, DeviceID: session.DeviceID, Scopes: []string{"ai:conversations"}}, task.ID, toolStepRequest{OperationID: "http-result", TaskRevision: 1, Generation: 1, ToolID: "ai.conversation.read", ToolVersion: "1", Input: raw})
	if err != nil {
		t.Fatal(err)
	}
	base := product.URL + "/api/tasks/" + task.ID + "/tool-steps/" + step.ID
	// The normal HTTP entry cannot install a Source or use this ref as a Grant.
	authedJSON(t, http.MethodPost, base+"/dispatch", map[string]string{"authorizationRef": "not-a-Grant"}, session, http.StatusServiceUnavailable)
	authedJSON(t, http.MethodGet, base+"/result", nil, session, http.StatusConflict)

	expected := taskReadExpectation{Account: session.Account, TaskID: task.ID, StepID: step.ID, Holder: session.DeviceID, TaskRevision: 1, Generation: 1, Input: bindTaskBytes(raw), Fields: []string{"messages"}}
	// Controlled local Source fence; no production authorization is claimed.
	if _, err := store.commitTaskApprovalAtFence(context.Background(), expected, "isolated-grant-reference", func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	if _, err := store.commitTaskReadAtEffectFence(context.Background(), expected, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	result := authedJSON(t, http.MethodGet, base+"/result", nil, session, http.StatusOK)
	if !bytes.Contains(result, []byte("actual HTTP source body")) {
		t.Fatal("HTTP route did not return actual stored result")
	}
	authedJSON(t, http.MethodGet, base+"/result", nil, other, http.StatusNotFound)
}

func TestP08TaskReadEffectFenceFailures(t *testing.T) {
	for _, kind := range []string{"no-authority", "revoked", "stale-generation", "wrong-holder", "changed-input", "unknown-field", "cancelled", "persist-failure"} {
		t.Run(kind, func(t *testing.T) {
			store, expected, _ := taskReadFixture(t)
			fence := func() error { return nil }
			switch kind {
			case "no-authority":
				fence = nil
			case "revoked":
				fence = func() error { return errors.New("isolated revoked Grant") }
			case "stale-generation":
				expected.Generation++
			case "wrong-holder":
				expected.Holder = "old-holder"
			case "changed-input":
				expected.Input.SHA512 = "changed"
			case "unknown-field":
				expected.Fields = []string{"vault"}
			case "cancelled":
				if _, err := store.CancelTask(expected.Account, expected.TaskID, 1, 1, expected.Holder); err != nil {
					t.Fatal(err)
				}
			}
			original := store.path
			before, err := os.ReadFile(original)
			if err != nil {
				t.Fatal(err)
			}
			stateBefore, _ := json.Marshal(store.state)
			if kind == "persist-failure" {
				store.path = filepath.Join(original, "impossible.json")
			}
			receipt, err := store.commitTaskReadAtEffectFence(context.Background(), expected, fence)
			if err == nil || len(receipt.Result) != 0 || receipt.EffectRef != "" {
				t.Fatalf("failed effect leaked success: %+v %v", receipt, err)
			}
			stateAfter, _ := json.Marshal(store.state)
			after, err := os.ReadFile(original)
			if err != nil || !bytes.Equal(before, after) || !bytes.Equal(stateBefore, stateAfter) {
				t.Fatal("failed effect changed state or receipt")
			}
		})
	}
}
