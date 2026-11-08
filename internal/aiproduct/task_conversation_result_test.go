package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

// These use the existing PUBLIC Auth/Source controls, actual local HTTP model,
// Unix resource receiver and encrypted Store. They do not establish admission.
func conversationResultRead(s *Server, session ProductSession, taskID, stepID string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodGet, "/api/tasks/"+taskID+"/tool-steps/"+stepID+"/result", nil)
	r.SetPathValue("id", taskID)
	r.SetPathValue("stepId", stepID)
	w := httptest.NewRecorder()
	s.handleTaskToolResult(w, r, session)
	return w
}

func TestP08ConversationUserResultLostACKColdRecovery(t *testing.T) {
	f, a, c := newP08ConversationLoop(t)
	c.lostACK = true
	request := f.request()
	request.AuthorizationRef = "PUBLIC_QUERY_REF"
	pending, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err != nil || len(pending.Steps) != 1 {
		t.Fatalf("proposal: %+v %v", pending, err)
	}
	stepID := pending.Steps[0]
	approveConversationLoop(t, f, pending)
	request.Resume, request.Prompt = true, ""
	unknown, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err == nil || unknown.Status != "UNKNOWN" {
		t.Fatalf("lost ACK: %+v %v", unknown, err)
	}
	checkRead := func(s *Server, status int) {
		t.Helper()
		before, err := os.ReadFile(s.store.path)
		if err != nil {
			t.Fatal(err)
		}
		w := conversationResultRead(s, f.session, f.task.ID, stepID)
		if w.Code != status {
			t.Fatalf("result status=%d want=%d body=%s", w.Code, status, w.Body.String())
		}
		if status == http.StatusOK {
			if !bytes.Equal(w.Body.Bytes(), []byte(c.last.Original)) || w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("user did not receive exact original private receipt")
			}
		} else if bytes.Contains(w.Body.Bytes(), []byte("actual selected source body")) {
			t.Fatal("unsettled private result leaked")
		}
		after, err := os.ReadFile(s.store.path)
		if err != nil || !bytes.Equal(before, after) {
			t.Fatal("result read mutated original durable image")
		}
	}
	checkRead(f.server, http.StatusConflict)
	cold, err := NewStore(f.server.store.path, f.key)
	if err != nil {
		t.Fatal(err)
	}
	resumed := &Server{store: cold}
	prepared := &PreparedOriginalTaskRuntime{model: f.provider, authority: a, broker: &originalTaskAuthorityBroker{client: c}}
	if err = prepared.install(resumed); err != nil {
		t.Fatal(err)
	}
	checkRead(resumed, http.StatusConflict)
	if c.effects != 1 || c.inputReads != 1 || c.queries != 0 || f.requests.Load() != 1 {
		t.Fatal("user read caused effect/query/model replay")
	}
	answer, err := resumed.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err != nil || answer.Status != "COMPLETED" {
		t.Fatalf("original recovery: %+v %v", answer, err)
	}
	checkRead(resumed, http.StatusOK)
	reopened, err := NewStore(cold.path, f.key)
	if err != nil {
		t.Fatal(err)
	}
	checkRead(&Server{store: reopened}, http.StatusOK)
	if c.effects != 1 || c.inputReads != 1 || c.queries != 1 || f.requests.Load() != 2 {
		t.Fatal("original recovery replayed effect or model")
	}
}

func TestP08ConversationUserResultRejectsCorruptOrForeign(t *testing.T) {
	f, _, c := newP08ConversationLoop(t)
	request := f.request()
	request.AuthorizationRef = "PUBLIC_QUERY_REF"
	pending, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err != nil {
		t.Fatal(err)
	}
	approveConversationLoop(t, f, pending)
	request.Resume, request.Prompt = true, ""
	if _, err = f.server.runTaskModel(context.Background(), f.session, f.task.ID, request); err != nil {
		t.Fatal(err)
	}
	id := pending.Steps[0]
	original := f.server.store.state.Actions[id]
	for _, kind := range []string{"missing-wire", "corrupt-wire", "missing-scope", "wrong-operation", "unknown-auth", "changed-binding", "wrong-account", "wrong-holder", "wrong-task"} {
		t.Run(kind, func(t *testing.T) {
			record := original
			binding := *original.ToolStep
			wireBinding := *binding.ResultWireBinding
			binding.ResultWireBinding = &wireBinding
			record.ToolStep = &binding
			session, taskID, status := f.session, f.task.ID, http.StatusConflict
			switch kind {
			case "missing-wire":
				binding.ResultWireCipher = ""
			case "corrupt-wire":
				binding.ResultWireCipher += "x"
			case "missing-scope":
				binding.ResultAuthScope = ""
			case "wrong-operation":
				binding.AuthorityOperationID = "invalid"
			case "unknown-auth":
				binding.AuthorityReferenceState = "UNKNOWN"
			case "changed-binding":
				wireBinding.Bytes++
			case "wrong-account":
				session.Account, status = "foreign-account", http.StatusNotFound
			case "wrong-holder":
				session.DeviceID, status = "foreign-holder", http.StatusNotFound
			case "wrong-task":
				taskID, status = "foreign-task", http.StatusNotFound
			}
			f.server.store.mu.Lock()
			f.server.store.state.Actions[id] = record
			f.server.store.mu.Unlock()
			w := conversationResultRead(f.server, session, taskID, id)
			if w.Code != status || bytes.Contains(w.Body.Bytes(), []byte("actual selected source body")) {
				t.Fatalf("unsafe result status=%d body=%s", w.Code, w.Body.String())
			}
		})
	}
	if c.effects != 1 || c.inputReads != 1 || c.queries != 0 || f.requests.Load() != 2 {
		t.Fatal("result rejection performed work")
	}
}

func TestP08ConversationCancelPreservesAuthUnknownColdOriginalQuery(t *testing.T) {
	f, a, c := newP08ConversationLoop(t)
	c.lostACK = true
	request := f.request()
	request.AuthorizationRef = "PUBLIC_QUERY_REF"
	pending, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err != nil || len(pending.Steps) != 1 {
		t.Fatalf("proposal: %+v %v", pending, err)
	}
	approveConversationLoop(t, f, pending)
	request.Resume, request.Prompt = true, ""
	unknown, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err == nil || unknown.Status != "UNKNOWN" {
		t.Fatalf("lost ACK: %+v %v", unknown, err)
	}
	id := pending.Steps[0]
	before, _ := json.Marshal(f.server.store.state.Actions[id])
	task := f.server.store.state.Tasks[f.task.ID]
	body, _ := json.Marshal(map[string]uint64{"revision": task.Revision, "generation": task.Generation})
	r := httptest.NewRequest(http.MethodPost, "/api/tasks/"+task.ID+"/cancel", bytes.NewReader(body))
	r.SetPathValue("id", task.ID)
	w := httptest.NewRecorder()
	f.server.handleTaskCancel(w, r, f.session)
	if w.Code != http.StatusOK {
		t.Fatalf("normal cancel: %d %s", w.Code, w.Body.String())
	}
	cancelled := f.server.store.state.Tasks[task.ID]
	run := f.server.store.state.TaskRuns[unknown.ID]
	after, _ := json.Marshal(f.server.store.state.Actions[id])
	if cancelled.Status != "RECONCILING" || cancelled.CancelledAt.IsZero() || !run.Cancelled || run.Status != "UNKNOWN" || run.FirstCause != unknown.FirstCause || !bytes.Equal(before, after) {
		t.Fatalf("cancel lost original uncertainty: task=%+v run=%+v", cancelled, run)
	}
	cold, err := NewStore(f.server.store.path, f.key)
	if err != nil {
		t.Fatal(err)
	}
	resumed := &Server{store: cold}
	prepared := &PreparedOriginalTaskRuntime{model: f.provider, authority: a, broker: &originalTaskAuthorityBroker{client: c}}
	if err = prepared.install(resumed); err != nil {
		t.Fatal(err)
	}
	if w := conversationResultRead(resumed, f.session, task.ID, id); w.Code != http.StatusConflict {
		t.Fatal("cancel exposed unsettled result")
	}
	if _, err = resumed.runTaskModel(context.Background(), f.session, task.ID, request); err == nil {
		t.Fatal("cancelled model resumed")
	}
	if _, err = resumed.dispatchApprovedStep(context.Background(), f.session, task.ID, id, request.AuthorizationRef); err == nil {
		t.Fatal("cancelled effect dispatched")
	}
	if _, err = resumed.reconcileStep(context.Background(), f.session, task.ID, id, request.AuthorizationRef); err != nil {
		t.Fatal("cancel blocked original recovery", err)
	}
	w = conversationResultRead(resumed, f.session, task.ID, id)
	if w.Code != http.StatusOK || !bytes.Equal(w.Body.Bytes(), []byte(c.last.Original)) {
		t.Fatal("original recovered receipt unavailable after cancel")
	}
	step := cold.state.Actions[id]
	if step.ToolStep.AuthorityOperationID != a.operation || step.ToolStep.AuthorityReferenceState != "COMMITTED" || !cold.state.TaskRuns[unknown.ID].Cancelled || c.effects != 1 || c.inputReads != 1 || c.queries != 1 || f.requests.Load() != 1 {
		t.Fatal("cancel recovery changed original operation or replayed effect/model")
	}
}
