package aiproduct

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestP08HandoffQueueAndOriginalRecovery(t *testing.T) {
	for _, status := range []string{"PENDING", "SENT", "DISPATCHING", "UNKNOWN", "RECONCILING"} {
		t.Run(status, func(t *testing.T) {
			s, c, key := p08TaskStore(t)
			task, err := s.CreateTask("tenant-a", c.ID, "holder-a")
			if err != nil {
				t.Fatal(err)
			}
			original := ActionRecord{ID: "original", Account: "tenant-a", Status: status, Description: "first cause", ToolStep: &ToolStepBinding{TaskID: task.ID, TaskRevision: 1, Generation: 1, Holder: "holder-a", OperationID: "original-op", AuthorityOperationID: "original-node-op"}}
			pending := original
			pending.ID = "pending"
			pending.Status = "approved_not_executed"
			s.state.Actions[original.ID] = original
			s.state.Actions[pending.ID] = pending
			run := taskModelRun{ID: "original-run", Account: "tenant-a", TaskID: task.ID, Holder: "holder-a", Generation: 1, Status: "NEEDS_APPROVAL", FirstCause: "original first cause"}
			s.state.TaskRuns = map[string]taskModelRun{run.ID: run}
			handed, err := s.HandoffTask("tenant-a", task.ID, 1, 1, "holder-a", "holder-b")
			if err != nil {
				t.Fatal(err)
			}
			if handed.Holder != "holder-b" || handed.Revision != 2 || handed.Generation != 2 || handed.Status != "DRAFT" {
				t.Fatalf("bad CAS %+v", handed)
			}
			if !reflect.DeepEqual(s.state.Actions[original.ID], original) || s.state.Actions[pending.ID].Status != "CANCELLED" || !s.state.TaskRuns[run.ID].Cancelled || s.state.TaskRuns[run.ID].Status != "UNKNOWN" {
				t.Fatal("lost original outcome or old queue survived")
			}
			old := ProductSession{Account: "tenant-a", DeviceID: "holder-a", Scopes: []string{"ai:conversations"}}
			next := old
			next.DeviceID = "holder-b"
			s.mu.Lock()
			_, err = s.effectCallLocked(old, task.ID, original.ID, true)
			s.mu.Unlock()
			if err == nil {
				t.Fatal("old holder dispatched")
			}
			if _, err = s.PrepareTask("tenant-a", task.ID, 2, 2, "holder-a"); !errors.Is(err, ErrTaskConflict) {
				t.Fatal("old holder prepared")
			}
			raw, _ := json.Marshal(conversationToolInput{ConversationID: c.ID})
			_, _, err = s.reserveToolStep(next, task.ID, toolStepRequest{OperationID: "replacement", TaskRevision: 2, Generation: 2, ToolID: "ai.conversation.read", ToolVersion: "1", Input: raw})
			if !errors.Is(err, errTaskEffectUnresolved) {
				t.Fatalf("rekey bypassed %s: %v", status, err)
			}
			restored, err := NewStore(s.path, key)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(restored.state.Actions[original.ID], original) || restored.state.Tasks[task.ID].Holder != "holder-b" {
				t.Fatal("restart lost handoff/original")
			}
		})
	}
}

func TestP08HandoffRollbackAndRestrictedHistory(t *testing.T) {
	s, c, _ := p08TaskStore(t)
	task, _ := s.CreateTask("tenant-a", c.ID, "holder-a")
	for _, holder := range []string{"holder-a", "holder-b"} {
		id := holder + "-step"
		s.state.Actions[id] = ActionRecord{ID: id, Account: "tenant-a", Status: "NEEDS_APPROVAL", ToolStep: &ToolStepBinding{TaskID: task.ID, TaskRevision: 1, Generation: 1, Holder: holder, TaskGrantRef: "PRIVATE grant ref"}}
		if err := s.appendTaskEventLocked(task.ID, 1, "step", id); err != nil {
			t.Fatal(err)
		}
	}
	before, _ := json.Marshal(s.state)
	oldPath := s.path
	s.path = filepath.Join(oldPath, "impossible.json")
	if _, err := s.HandoffTask("tenant-a", task.ID, 1, 1, "holder-a", "holder-b"); err == nil {
		t.Fatal("failed save accepted")
	}
	after, _ := json.Marshal(s.state)
	if !bytes.Equal(before, after) {
		t.Fatal("failed handoff altered queue/state")
	}
	s.path = oldPath
	if _, err := s.HandoffTask("tenant-a", task.ID, 1, 1, "holder-a", "holder-a"); !errors.Is(err, ErrTaskConflict) {
		t.Fatal("same holder admitted")
	}
	if _, err := s.HandoffTask("tenant-a", task.ID, 1, 1, "holder-a", "holder-b"); err != nil {
		t.Fatal(err)
	}
	projection, err := s.readTaskProjectionForSession(ProductSession{Account: "tenant-a", DeviceID: "holder-a"}, task.ID, 0)
	if err != nil || !projection.RecoveryOnly || len(projection.Steps) != 1 || projection.Steps[0].ID != "holder-a-step" || projection.Steps[0].ToolStep.TaskGrantRef != "" {
		t.Fatalf("history escaped old holder boundary %+v %v", projection, err)
	}
	if _, err = s.readTaskProjectionForSession(ProductSession{Account: "tenant-a", DeviceID: "unrelated-device"}, task.ID, 0); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("unrelated device saw history")
	}
}

func TestP08HandoffRejectsOldAnswerPOSTAndRestrictsGET(t *testing.T) {
	f := newP08ModelFixture(t)
	input := f.request()
	key := modelRunKey(f.session.Account, f.task.ID, input.RunID)
	f.server.store.state.TaskRuns = map[string]taskModelRun{}
	f.server.store.state.TaskRuns[key] = taskModelRun{ID: key, RunID: input.RunID, TaskID: f.task.ID, Account: f.session.Account, Holder: f.session.DeviceID, SessionID: f.session.ID, TaskRevision: 1, Generation: 1, Status: "NEEDS_APPROVAL", AnswerCipher: "not decrypted", ReturnState: taskModelReturnPending}
	if _, err := f.server.store.HandoffTask(f.session.Account, f.task.ID, 1, 1, f.session.DeviceID, "holder-b"); err != nil {
		t.Fatal(err)
	}
	if _, _, _, _, _, err := f.server.beginTaskRun(f.session, f.task.ID, input); !errors.Is(err, errToolConflict) {
		t.Fatalf("old answer POST acquired: %v", err)
	}
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.SetPathValue("id", f.task.ID)
	r.SetPathValue("runId", input.RunID)
	w := httptest.NewRecorder()
	f.server.handleTaskModelRunRead(w, r, f.session)
	var view taskRunView
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &view) != nil || !view.RecoveryOnly || view.Content != "" {
		t.Fatalf("old answer disclosed %d %s", w.Code, w.Body.String())
	}
	if f.requests.Load() != 0 {
		t.Fatal("history replayed provider")
	}
}

func TestP08HandoffNormalRoutesRemainUnregistered(t *testing.T) {
	gateway := newGatewayFixture(t, true)
	defer gateway.Close()
	store, product := testProduct(t, gateway.URL)
	defer product.Close()
	session := authenticate(t, product.URL, store, newTestIdentity(t))
	c, err := store.CreateConversation(session.Account, "handoff")
	if err != nil {
		t.Fatal(err)
	}
	task, err := store.CreateTask(session.Account, c.ID, session.DeviceID)
	if err != nil {
		t.Fatal(err)
	}
	for _, prefix := range []string{"/open/v1/tasks/", "/api/tasks/"} {
		raw := authedJSON(t, http.MethodPost, product.URL+prefix+task.ID+"/handoffs", taskHandoffRequest{Revision: 1, Generation: 1, NewHolder: "registered-holder-required", AuthorizationRef: "PUBLIC reference"}, session, 503)
		if !bytes.Contains(raw, []byte("AI_TASK_HANDOFF_UNREGISTERED")) {
			t.Fatalf("false activation %s", raw)
		}
	}
	got, err := store.ReadTaskProjection(session.Account, task.ID, 0)
	if err != nil || got.TaskRecord != task {
		t.Fatal("unregistered route mutated task")
	}
}

func TestP08CompleteNeverClosesPendingHandoffEffects(t *testing.T) {
	for _, status := range []string{"PENDING", "SENT", "UNKNOWN", "DISPATCHING", "RECONCILING"} {
		t.Run(status, func(t *testing.T) {
			s, c, _ := p08TaskStore(t)
			task, err := s.CreateTask("tenant-a", c.ID, "holder-b")
			if err != nil {
				t.Fatal(err)
			}
			task.Status = "READY"
			s.state.Tasks[task.ID] = task
			s.state.TaskRuns = map[string]taskModelRun{"run": {ID: "run", Account: task.Account, TaskID: task.ID, Holder: task.Holder, Generation: 1, Status: "COMPLETED", Steps: []string{"original"}}}
			s.state.Actions["original"] = ActionRecord{ID: "original", Account: task.Account, Status: status, ToolStep: &ToolStepBinding{TaskID: task.ID, Holder: "holder-a", Generation: 1}}
			if _, err := s.CompleteTask(task.Account, task.ID, 1, 1, task.Holder, "run"); !errors.Is(err, errTaskEffectUnresolved) {
				t.Fatalf("completed over %s: %v", status, err)
			}
			if s.state.Tasks[task.ID] != task || s.state.Actions["original"].Status != status {
				t.Fatal("failed complete rewrote original")
			}
		})
	}
}

func TestP08HandoffTwoClientsCompeteWithOldQueue(t *testing.T) {
	for attempt := 0; attempt < 8; attempt++ {
		s, c, _ := p08TaskStore(t)
		task, err := s.CreateTask("tenant-a", c.ID, "holder-a")
		if err != nil {
			t.Fatal(err)
		}
		old := ProductSession{Account: task.Account, DeviceID: "holder-a", Scopes: []string{"ai:conversations"}}
		next := old
		next.DeviceID = "holder-b"
		raw, _ := json.Marshal(conversationToolInput{ConversationID: c.ID})
		start := make(chan struct{})
		handoffDone := make(chan error, 1)
		proposalDone := make(chan error, 1)
		go func() {
			<-start
			_, err := s.HandoffTask(task.Account, task.ID, 1, 1, old.DeviceID, next.DeviceID)
			handoffDone <- err
		}()
		go func() {
			<-start
			_, _, err := s.reserveToolStep(old, task.ID, toolStepRequest{OperationID: "old-queued", TaskRevision: 1, Generation: 1, ToolID: "ai.conversation.read", ToolVersion: "1", Input: raw})
			proposalDone <- err
		}()
		close(start)
		if err := <-handoffDone; err != nil {
			t.Fatal(err)
		}
		if err := <-proposalDone; err != nil && !errors.Is(err, errToolConflict) {
			t.Fatal(err)
		}
		projection, err := s.ReadTaskProjection(task.Account, task.ID, 0)
		if err != nil {
			t.Fatal(err)
		}
		for _, record := range s.state.Actions {
			if record.ToolStep != nil && record.ToolStep.Holder == old.DeviceID && record.Status != "CANCELLED" {
				t.Fatal("racing old queue survived holder CAS")
			}
		}
		if _, _, err := s.reserveToolStep(old, task.ID, toolStepRequest{OperationID: "old-after", TaskRevision: projection.Revision, Generation: projection.Generation, ToolID: "ai.conversation.read", ToolVersion: "1", Input: raw}); !errors.Is(err, errToolConflict) {
			t.Fatal("old client borrowed new generation")
		}
		record, _, err := s.reserveToolStep(next, task.ID, toolStepRequest{OperationID: "new-queue", TaskRevision: projection.Revision, Generation: projection.Generation, ToolID: "ai.conversation.read", ToolVersion: "1", Input: raw})
		if err != nil || record.ToolStep.Holder != next.DeviceID || record.Status != "NEEDS_APPROVAL" {
			t.Fatalf("new proposal invalid %+v %v", record, err)
		}
	}
}
