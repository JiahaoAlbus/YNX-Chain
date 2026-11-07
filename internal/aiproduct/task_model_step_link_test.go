package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
)

func TestP08ConversationRunStepAtomicBeforeModelReturn(t *testing.T) {
	f := newP08ModelFixture(t)
	request := f.request()
	run, _, _, _, _, err := f.server.beginTaskRun(f.session, f.task.ID, request)
	if err != nil {
		t.Fatal(err)
	}
	input, _ := json.Marshal(conversationToolInput{ConversationID: f.task.ConversationID})
	step, created, err := f.server.store.reserveModelToolStep(context.Background(), f.session, run, toolStepRequest{OperationID: modelToolOperation(run.TaskID, run.RunID, "PUBLIC-before-model-return"), TaskRevision: run.TaskRevision, Generation: run.Generation, ToolID: "ai.conversation.read", ToolVersion: "1", Input: input})
	if err != nil || !created {
		t.Fatal(err)
	}
	// Simulate termination BEFORE persistTaskModelResult; run and original step
	// must already be in one real encrypted image, with no effect/model request.
	cold, err := NewStore(f.server.store.path, f.key)
	if err != nil {
		t.Fatal(err)
	}
	saved := cold.state.TaskRuns[run.ID]
	if len(saved.Steps) != 1 || saved.Steps[0] != step.ID || cold.state.Actions[step.ID].Status != "NEEDS_APPROVAL" || f.requests.Load() != 0 {
		t.Fatal("crash stranded original step or dispatched work")
	}
}
func TestP08ConversationRunStepSaveFailureRollsBack(t *testing.T) {
	f := newP08ModelFixture(t)
	run, _, _, _, _, err := f.server.beginTaskRun(f.session, f.task.ID, f.request())
	if err != nil {
		t.Fatal(err)
	}
	before, _ := json.Marshal(f.server.store.state)
	originalPath := f.server.store.path
	f.server.store.path = filepath.Dir(originalPath)
	input, _ := json.Marshal(conversationToolInput{ConversationID: f.task.ConversationID})
	_, _, err = f.server.store.reserveModelToolStep(context.Background(), f.session, run, toolStepRequest{OperationID: modelToolOperation(run.TaskID, run.RunID, "PUBLIC-failed-proposal-save"), TaskRevision: run.TaskRevision, Generation: run.Generation, ToolID: "ai.conversation.read", ToolVersion: "1", Input: input})
	f.server.store.path = originalPath
	after, _ := json.Marshal(f.server.store.state)
	if err == nil || !bytes.Equal(before, after) || f.requests.Load() != 0 {
		t.Fatal("failed atomic run/step save leaked state or work")
	}
}
