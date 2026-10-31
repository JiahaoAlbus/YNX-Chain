package aiproduct

import (
	"context"
	"encoding/json"
	"testing"
)

func TestP08CompleteWholeToolWorkflow(t *testing.T) {
	f := newP08ModelFixture(t)
	request := f.request()
	pending, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err != nil {
		t.Fatal(err)
	}
	f.approveStep(t, pending.Steps[0])
	f.expected.StepID = pending.Steps[0]
	source := &p08EffectFixture{store: f.server.store, expected: f.expected}
	f.server.toolEffects = source
	request.Prompt = ""
	request.Resume = true
	result, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err != nil {
		t.Fatal(err)
	}
	completed, err := f.server.store.CompleteTask(f.session.Account, f.task.ID, f.task.Revision, f.task.Generation, f.session.DeviceID, result.ID)
	if err != nil || completed.Status != "COMPLETED" || completed.Revision != f.task.Revision+1 {
		t.Fatalf("verified workflow not completed: %+v %v", completed, err)
	}
	if replay, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request); err != nil || replay.Content != result.Content || source.dispatches != 1 || f.requests.Load() != 2 {
		t.Fatalf("completed workflow replayed: %+v %v", replay, err)
	}
	input, _ := json.Marshal(conversationToolInput{ConversationID: f.task.ConversationID})
	if _, _, err := f.server.store.reserveToolStep(f.session, f.task.ID, toolStepRequest{OperationID: "after-finish", TaskRevision: completed.Revision, Generation: completed.Generation, ToolID: "ai.conversation.read", ToolVersion: "1", Input: input}); err == nil {
		t.Fatal("completed task accepted new effect")
	}
}

func TestP08UnknownCannotBeRekeyedIntoNewWork(t *testing.T) {
	f := newP08ModelFixture(t)
	request := f.request()
	pending, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err != nil {
		t.Fatal(err)
	}
	f.approveStep(t, pending.Steps[0])
	f.expected.StepID = pending.Steps[0]
	source := &p08EffectFixture{store: f.server.store, expected: f.expected, mode: "unknown"}
	f.server.toolEffects = source
	request.Resume = true
	request.Prompt = ""
	_, _ = f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	request.Resume = false
	request.RunID = "new-key-must-not-bypass"
	request.Prompt = "New prompt must not bypass unknown"
	if _, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request); err != errTaskEffectUnresolved {
		t.Fatalf("new run key bypassed UNKNOWN: %v", err)
	}
	input, _ := json.Marshal(conversationToolInput{ConversationID: f.task.ConversationID})
	if _, _, err := f.server.store.reserveToolStep(f.session, f.task.ID, toolStepRequest{OperationID: "different-operation", TaskRevision: f.task.Revision, Generation: f.task.Generation, ToolID: "ai.conversation.read", ToolVersion: "1", Input: input}); err != errTaskEffectUnresolved {
		t.Fatalf("new operation bypassed UNKNOWN: %v", err)
	}
	if source.dispatches != 1 || f.requests.Load() != 1 {
		t.Fatal("unknown work was replayed")
	}
}
