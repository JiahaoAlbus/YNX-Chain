package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func p08UnknownConversationForCancel(t *testing.T) (*p08ModelFixture, *p08ConversationAuthority, *p08ConversationClient, taskRunView) {
	t.Helper()
	f, a, c := newP08ConversationLoop(t)
	c.lostACK = true
	r := f.request()
	r.AuthorizationRef = "PUBLIC_QUERY_REF"
	pending, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, r)
	if err != nil || len(pending.Steps) != 1 {
		t.Fatalf("proposal: %+v %v", pending, err)
	}
	approveConversationLoop(t, f, pending)
	r.Resume, r.Prompt = true, ""
	unknown, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, r)
	if err == nil || unknown.Status != "UNKNOWN" {
		t.Fatalf("lost ACK: %+v %v", unknown, err)
	}
	return f, a, c, unknown
}

func TestP08CancelledOriginalSettlementWaitsForOtherDebt(t *testing.T) {
	f, _, c, unknown := p08UnknownConversationForCancel(t)
	// Explicit PUBLIC unrelated UNKNOWN metadata, never an effect receipt.
	other := ActionRecord{ID: "PUBLIC-other-unresolved", Account: f.session.Account, Status: "UNKNOWN", ToolStep: &ToolStepBinding{TaskID: f.task.ID, ToolID: "ai.conversation.read", RemoteOperationID: "PUBLIC-other-original"}}
	if err := f.server.store.SaveAction(other); err != nil {
		t.Fatal(err)
	}
	task := f.server.store.state.Tasks[f.task.ID]
	cancelled, err := f.server.store.CancelTask(f.session.Account, task.ID, task.Revision, task.Generation, task.Holder)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.server.reconcileStep(context.Background(), f.session, task.ID, unknown.Steps[0], "PUBLIC_QUERY_REF"); err != nil {
		t.Fatal(err)
	}
	got := f.server.store.state.Tasks[task.ID]
	before, _ := json.Marshal(other)
	after, _ := json.Marshal(f.server.store.state.Actions[other.ID])
	if got.Status != "RECONCILING" || got.Revision != cancelled.Revision || !bytes.Equal(before, after) || c.effects != 1 || c.queries != 1 || f.requests.Load() != 1 {
		t.Fatal("one original settlement erased another operation's debt")
	}
	// A corrupt COMPLETED metadata label without any encrypted receipt must
	// not make that other original operation look settled either.
	other.Status = "COMPLETED"
	if err := f.server.store.SaveAction(other); err != nil {
		t.Fatal(err)
	}
	if _, err = f.server.reconcileStep(context.Background(), f.session, task.ID, unknown.Steps[0], "PUBLIC_QUERY_REF"); err != nil {
		t.Fatal(err)
	}
	got = f.server.store.state.Tasks[task.ID]
	if got.Status != "RECONCILING" || got.Revision != cancelled.Revision || c.queries != 1 || c.effects != 1 {
		t.Fatal("corrupt completed metadata cleared original reconciliation debt")
	}
}

func TestP08CancelledOriginalSettlementSaveFailureColdRetry(t *testing.T) {
	f, a, c, unknown := p08UnknownConversationForCancel(t)
	s := f.server.store
	task := s.state.Tasks[f.task.ID]
	cancelled, err := s.CancelTask(f.session.Account, task.ID, task.Revision, task.Generation, task.Holder)
	if err != nil {
		t.Fatal(err)
	}
	id := unknown.Steps[0]
	s.mu.Lock()
	call, err := s.effectCallLocked(f.session, task.ID, id, false)
	s.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	// Persist the real original resource wire through the existing broker before
	// injecting ONLY the subsequent task-marker save failure. Auth is PUBLIC.
	effects := f.server.toolEffects.(*originalRuntimeToolEffects)
	if _, err = effects.runtime.broker.acceptConversation(context.Background(), effects, call, a.latest.Binding, c.last); err != nil {
		t.Fatal(err)
	}
	path := s.path
	disk, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	before, _ := json.Marshal(s.state)
	s.path = filepath.Dir(path)
	_, err = f.server.reconcileStep(context.Background(), f.session, task.ID, id, "PUBLIC_QUERY_REF")
	s.path = path
	after, _ := json.Marshal(s.state)
	diskAfter, readErr := os.ReadFile(path)
	if err == nil || readErr != nil || !bytes.Equal(before, after) || !bytes.Equal(disk, diskAfter) {
		t.Fatal("failed task settlement changed state/events/audit or discarded receipt")
	}
	cold, err := NewStore(path, f.key)
	if err != nil {
		t.Fatal(err)
	}
	resumed := &Server{store: cold}
	if _, err = resumed.reconcileStep(context.Background(), f.session, task.ID, id, "PUBLIC_QUERY_REF"); err != nil {
		t.Fatal("cold stored-receipt retry needed a new Source", err)
	}
	finished := cold.state.Tasks[task.ID]
	run := cold.state.TaskRuns[unknown.ID]
	if finished.Status != "CANCELLED" || finished.Revision != cancelled.Revision+1 || finished.CancelledAt != cancelled.CancelledAt || !run.Cancelled || run.Status != "UNKNOWN" || run.FirstCause != unknown.FirstCause {
		t.Fatal("settlement lost cancellation/original model uncertainty")
	}
	durable, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = resumed.reconcileStep(context.Background(), f.session, task.ID, id, "PUBLIC_QUERY_REF"); err != nil {
		t.Fatal(err)
	}
	repeated, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(durable, repeated) || c.effects != 1 || c.inputReads != 1 || c.queries != 0 || f.requests.Load() != 1 {
		t.Fatal("cold settlement replayed effect/model/query or duplicate audit")
	}
}
