package aiproduct

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/aigateway"
)

// This exercises only the new receipt-consumption edge. Existing real official
// DAV and model-loop evidence is reused; PUBLIC local Source/data below do not
// become human approval, authorship or production qualification.
func TestP08WebDAVObservationCanCompleteOriginalWorkflow(t *testing.T) {
	f := newP08WebDAVRuntime(t)
	receipt, err := f.deliver()
	if err != nil {
		t.Fatal(err)
	}
	s := f.s
	s.taskModel = fakeUnusedModelService(t)
	s.taskModelAdmit = func(context.Context, ProductSession, TaskRecord, string, string, []byte) error { return nil }
	s.toolEffects = &p08EffectFixture{store: f.store}
	run, _, _, _, _, err := s.beginTaskRun(f.session, f.task.ID, taskRunRequest{RunID: "PUBLIC-dav-observation-run", TaskRevision: f.task.Revision, Generation: f.task.Generation, Prompt: "Return original observed content receipt."})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.recordTaskModelAdmission(context.Background(), run, taskModelAdmissionSnapshot{Session: f.session, Task: f.task, ProviderURL: "http://127.0.0.1:1", Model: "PUBLIC-no-provider-called", Body: []byte(`{"PUBLIC":"original-disclosure"}`)}); err != nil {
		t.Fatal(err)
	}
	_, needsReturn, err := s.persistTaskModelResult(f.session, run, []string{f.input.OperationID}, aigateway.ToolLoopResult{Status: aigateway.ToolCompleted, Content: "PUBLIC original receipt is an observation; authorship is unproven."}, nil)
	if err != nil || !needsReturn {
		t.Fatalf("receipt projection: %v", err)
	}
	result, err := s.authorizeTaskModelReturn(context.Background(), f.session, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	completed, err := s.store.CompleteTask(f.session.Account, f.task.ID, f.task.Revision, f.task.Generation, f.session.DeviceID, result.ID)
	if err != nil || completed.Status != "COMPLETED" {
		t.Fatalf("original observation workflow did not close: %+v %v", completed, err)
	}
	original, err := s.store.TaskWebDAVResult(f.session, f.task.ID, f.input.OperationID)
	if err != nil || original != receipt || original.AuthorshipProven || original.State != "CONTENT_PRESENT" || f.dav.requests() != "PUT,GET" {
		t.Fatal("local workflow completion promoted/replayed external observation")
	}
}
func fakeUnusedModelService(t *testing.T) *aigateway.Service {
	t.Helper()
	service, err := NewTaskModelService(TaskModelConfig{ChainURL: "http://127.0.0.1:1", ProviderURL: "http://127.0.0.1:1", ProviderAPIKey: "PUBLIC-unused", Model: "PUBLIC-unused", AccessAPIKey: "PUBLIC-unused", UpstreamKey: "PUBLIC-unused"})
	if err != nil {
		t.Fatal(err)
	}
	return service
}
func TestP08WebDAVUnknownBlocksNewSchedulingAndKeepsOriginalQuery(t *testing.T) {
	f := newP08WebDAVRuntime(t)
	f.dav.lostACK = true
	if _, err := f.deliver(); err == nil {
		t.Fatal("lost ACK was accepted")
	}
	f.s.taskModel = fakeUnusedModelService(t)
	if _, _, _, _, _, err := f.s.beginTaskRun(f.session, f.task.ID, taskRunRequest{RunID: "PUBLIC-must-not-bypass-dav", TaskRevision: f.task.Revision, Generation: f.task.Generation, Prompt: "New model work"}); !errors.Is(err, errTaskEffectUnresolved) {
		t.Fatalf("new run bypassed original DAV UNKNOWN: %v", err)
	}
	raw, _ := json.Marshal(conversationToolInput{ConversationID: f.task.ConversationID})
	if _, _, err := f.store.reserveToolStep(f.session, f.task.ID, toolStepRequest{OperationID: "PUBLIC-new-tool", TaskRevision: f.task.Revision, Generation: f.task.Generation, ToolID: "ai.conversation.read", ToolVersion: "1", Input: raw}); !errors.Is(err, errTaskEffectUnresolved) {
		t.Fatalf("new tool bypassed UNKNOWN: %v", err)
	}
	receipt, err := f.s.executeTaskWebDAV(context.Background(), f.session, f.task.ID, TaskWebDAVInput{OperationID: f.input.OperationID}, "PUBLIC-explicit-egress", true)
	if err != nil || receipt.State != "CONTENT_PRESENT" || f.dav.requests() != "PUT,GET" {
		t.Fatalf("original query was blocked or replayed: %+v %v", receipt, err)
	}
}
func TestP08WebDAVTamperedOrUnknownReceiptCannotComplete(t *testing.T) {
	for _, kind := range []string{"unknown", "tamper"} {
		t.Run(kind, func(t *testing.T) {
			f := newP08WebDAVRuntime(t)
			if kind == "unknown" {
				f.dav.lostACK = true
			}
			_, _ = f.deliver()
			f.store.mu.Lock()
			if kind == "tamper" {
				key := taskWebDAVKey(f.task.Account, f.task.ID, f.input.OperationID)
				r := f.store.state.WebDAVDeliveries[key]
				r.Receipt.AuthorshipProven = true
				f.store.state.WebDAVDeliveries[key] = r
			}
			// An authenticated ordinary result elsewhere cannot hide an outstanding or
			// tampered external delivery from task-level completion.
			blocked := f.store.taskHasUnresolvedEffectLocked(f.task.ID)
			f.store.mu.Unlock()
			if !blocked {
				t.Fatal("unresolved/tampered DAV receipt was ignored")
			}
		})
	}
}
