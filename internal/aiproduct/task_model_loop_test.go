package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/aigateway"
)

type p08ModelFixture struct {
	server     *Server
	session    ProductSession
	task       TaskRecord
	expected   taskReadExpectation
	key        []byte
	provider   *aigateway.Service
	requests   atomic.Int32
	admissions atomic.Int32
}

func newP08ModelFixture(t *testing.T, modelHook ...http.HandlerFunc) *p08ModelFixture {
	t.Helper()
	store, expected, key := taskReadFixture(t)
	f := &p08ModelFixture{expected: expected, key: key, session: ProductSession{ID: "isolated-session", Account: expected.Account, DeviceID: expected.Holder, Scopes: []string{"ai:conversations", "ai:permissions", "ai:generate"}}}
	f.task = store.state.Tasks[expected.TaskID]
	httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/status" {
			_, _ = w.Write([]byte(`{"chainId":6423,"height":23,"network":"isolated","nativeCurrencySymbol":"YNXT"}`))
			return
		}
		if r.URL.Path != "/chat/completions" || r.Method != http.MethodPost || r.Header.Get("Authorization") != "Bearer isolated-provider-key" {
			t.Error("original provider transport changed")
			http.Error(w, "invalid", 400)
			return
		}
		var body struct {
			Model    string `json:"model"`
			Messages []struct {
				Role, Content string
				ToolCallID    string `json:"tool_call_id"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		if body.Model != "isolated-fixed-model" {
			t.Error("model changed")
		}
		round := f.requests.Add(1)
		if len(modelHook) > 0 {
			modelHook[0](w, r)
			return
		}
		if round == 1 {
			args, _ := json.Marshal(conversationToolInput{ConversationID: f.task.ConversationID})
			_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"finish_reason": "tool_calls", "message": map[string]any{"role": "assistant", "content": "", "tool_calls": []any{map[string]any{"id": "original-model-call", "type": "function", "function": map[string]any{"name": "ynx_conversation_read_v1", "arguments": string(args)}}}}}}})
			return
		}
		last := body.Messages[len(body.Messages)-1]
		if last.Role != "tool" || last.ToolCallID != "original-model-call" || !bytes.Contains([]byte(last.Content), []byte("actual selected source body")) {
			t.Errorf("model did not get original call and real result: %+v", last)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]string{"role": "assistant", "content": "Final answer from the isolated HTTP provider."}}}})
	}))
	t.Cleanup(httpServer.Close)
	provider, err := aigateway.New(aigateway.Config{ChainURL: httpServer.URL, ProviderURL: httpServer.URL, Model: "isolated-fixed-model", ProviderAPIKey: "isolated-provider-key", AccessAPIKey: "isolated-access", UpstreamKey: "isolated-upstream"})
	if err != nil {
		t.Fatal(err)
	}
	f.provider = provider
	f.server = &Server{store: store, taskModel: provider, toolEffects: &p08EffectFixture{store: store, expected: expected}, taskModelAdmit: func(context.Context, ProductSession, TaskRecord, string, string, []byte) error {
		f.admissions.Add(1)
		return nil
	}}
	return f
}

func (f *p08ModelFixture) request() taskRunRequest {
	return taskRunRequest{RunID: "stable-user-run", TaskRevision: f.task.Revision, Generation: f.task.Generation, Prompt: "Read the selected source and answer.", AuthorizationRef: "isolated-approved-reference"}
}

func TestP08ModelToolFlowCheckpointRestore(t *testing.T) {
	f := newP08ModelFixture(t)
	request := f.request()
	pending, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err != nil || pending.Status != "NEEDS_APPROVAL" || len(pending.Steps) != 1 || pending.Content != "" || f.requests.Load() != 1 {
		t.Fatalf("initial flow must pause without executing: %+v %v requests=%d", pending, err, f.requests.Load())
	}
	step, ok := f.server.store.Action(f.session.Account, pending.Steps[0])
	if !ok || step.Status != "NEEDS_APPROVAL" {
		t.Fatal("original proposal missing")
	}
	f.approveStep(t, step.ID)
	f.expected.StepID = step.ID
	backup := filepath.Join(t.TempDir(), "pending-run.ynxbackup")
	if _, err := f.server.store.CreateBackup(backup); err != nil {
		t.Fatal(err)
	}
	restored, err := NewStore(filepath.Join(t.TempDir(), "restored.json"), f.key)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := restored.RestoreBackup(backup); err != nil {
		t.Fatal(err)
	}
	reopened, err := NewStore(restored.path, f.key)
	if err != nil {
		t.Fatal(err)
	}
	source := &p08EffectFixture{store: reopened, expected: f.expected}
	resumed := &Server{store: reopened, taskModel: f.provider, toolEffects: source, taskModelAdmit: f.server.taskModelAdmit}
	request.Prompt = ""
	request.Resume = true
	result, err := resumed.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err != nil || result.Status != "COMPLETED" || result.Content != "Final answer from the isolated HTTP provider." || source.dispatches != 1 || f.requests.Load() != 2 || f.admissions.Load() != 3 {
		t.Fatalf("restored actual tool loop failed: %+v %v dispatch=%d requests=%d admissions=%d", result, err, source.dispatches, f.requests.Load(), f.admissions.Load())
	}
	if _, err := resumed.runTaskModel(context.Background(), f.session, f.task.ID, request); err != nil || f.requests.Load() != 2 || source.dispatches != 1 {
		t.Fatalf("completed run replayed model/effect: %v", err)
	}
	disk, err := os.ReadFile(reopened.path)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"Read the selected source and answer.", "actual selected source body", "Final answer from the isolated HTTP provider."} {
		if bytes.Contains(disk, []byte(secret)) {
			t.Fatalf("run checkpoint/result exposed plaintext %q", secret)
		}
	}
}

func TestP08ModelToolUnknownIsQueryOnly(t *testing.T) {
	f := newP08ModelFixture(t)
	request := f.request()
	pending, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err != nil {
		t.Fatal(err)
	}
	step, _ := f.server.store.Action(f.session.Account, pending.Steps[0])
	f.approveStep(t, step.ID)
	f.expected.StepID = step.ID
	source := &p08EffectFixture{store: f.server.store, expected: f.expected, mode: "unknown"}
	f.server.toolEffects = source
	request.Prompt = ""
	request.Resume = true
	if result, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request); err == nil || result.Status != "UNKNOWN" {
		t.Fatalf("unknown effect claimed success: %+v %v", result, err)
	}
	_, _ = f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if source.dispatches != 1 || source.queries != 1 || f.requests.Load() != 1 {
		t.Fatalf("UNKNOWN replayed instead of original query: dispatch=%d query=%d model=%d", source.dispatches, source.queries, f.requests.Load())
	}
}

func TestP08ModelToolCancelAndDisclosure(t *testing.T) {
	t.Run("cancelled_checkpoint_cannot_resume", func(t *testing.T) {
		f := newP08ModelFixture(t)
		request := f.request()
		if _, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request); err != nil {
			t.Fatal(err)
		}
		if _, err := f.server.store.CancelTask(f.session.Account, f.task.ID, 1, 1, f.session.DeviceID); err != nil {
			t.Fatal(err)
		}
		request.Resume = true
		request.Prompt = ""
		if _, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request); err == nil || f.requests.Load() != 1 {
			t.Fatalf("cancelled task resumed provider: %v calls=%d", err, f.requests.Load())
		}
	})
	t.Run("result_disclosure_denied_before_second_model_call", func(t *testing.T) {
		f := newP08ModelFixture(t)
		request := f.request()
		pending, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
		if err != nil {
			t.Fatal(err)
		}
		step, _ := f.server.store.Action(f.session.Account, pending.Steps[0])
		f.approveStep(t, step.ID)
		f.expected.StepID = step.ID
		f.server.toolEffects = &p08EffectFixture{store: f.server.store, expected: f.expected}
		f.server.taskModelAdmit = func(_ context.Context, _ ProductSession, _ TaskRecord, _, _ string, body []byte) error {
			if bytes.Contains(body, []byte("actual selected source body")) {
				return errors.New("isolated disclosure revoked")
			}
			return nil
		}
		request.Resume = true
		request.Prompt = ""
		if result, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request); err == nil || result.Content != "" || f.requests.Load() != 1 {
			t.Fatalf("private result sent without disclosure: %+v %v calls=%d", result, err, f.requests.Load())
		}
	})
}

func TestP08ModelActiveCancellationAndHandoff(t *testing.T) {
	t.Run("cancel_closes_actual_inflight_HTTP", func(t *testing.T) {
		entered, ended := make(chan struct{}), make(chan struct{})
		f := newP08ModelFixture(t, func(_ http.ResponseWriter, r *http.Request) { close(entered); <-r.Context().Done(); close(ended) })
		done := make(chan taskRunView, 1)
		go func() {
			view, _ := f.server.runTaskModel(context.Background(), f.session, f.task.ID, f.request())
			done <- view
		}()
		select {
		case <-entered:
		case <-time.After(3 * time.Second):
			t.Fatal("model HTTP not entered")
		}
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/api/tasks/"+f.task.ID+"/cancel", strings.NewReader(`{"revision":1,"generation":1}`))
		request.SetPathValue("id", f.task.ID)
		f.server.handleTaskCancel(recorder, request, f.session)
		if recorder.Code != http.StatusOK {
			t.Fatalf("cancel rejected: %d %s", recorder.Code, recorder.Body.String())
		}
		select {
		case <-ended:
		case <-time.After(3 * time.Second):
			t.Fatal("inflight model HTTP did not stop")
		}
		select {
		case view := <-done:
			if view.Content != "" || !view.Cancelled || view.Status == "COMPLETED" {
				t.Fatalf("cancel claimed completion: %+v", view)
			}
		case <-time.After(3 * time.Second):
			t.Fatal("run did not drain")
		}
		if f.requests.Load() != 1 {
			t.Fatal("cancel retried model")
		}
	})
	t.Run("late_old_holder_answer_not_returned", func(t *testing.T) {
		entered, release := make(chan struct{}), make(chan struct{})
		f := newP08ModelFixture(t, func(w http.ResponseWriter, _ *http.Request) {
			close(entered)
			<-release
			_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]string{"role": "assistant", "content": "late old-holder answer"}}}})
		})
		done := make(chan taskRunView, 1)
		go func() {
			view, _ := f.server.runTaskModel(context.Background(), f.session, f.task.ID, f.request())
			done <- view
		}()
		select {
		case <-entered:
		case <-time.After(3 * time.Second):
			t.Fatal("model HTTP not entered")
		}
		if _, err := f.server.store.HandoffTask(f.session.Account, f.task.ID, 1, 1, f.session.DeviceID, "new-holder"); err != nil {
			close(release)
			t.Fatal(err)
		}
		close(release)
		select {
		case view := <-done:
			if view.Status != "STOPPED" || view.Content != "" {
				t.Fatalf("old holder result promoted: %+v", view)
			}
		case <-time.After(3 * time.Second):
			t.Fatal("late run did not drain")
		}
	})
}

func TestP08ConfiguredAgentPauseStopsInflightModel(t *testing.T) {
	entered, ended := make(chan struct{}), make(chan struct{})
	f := newP08ModelFixture(t, func(_ http.ResponseWriter, r *http.Request) { close(entered); <-r.Context().Done(); close(ended) })
	config, err := f.server.store.ConfigureAgent(f.session.Account, "", 0, "Task helper", "gateway.configured", []string{"ai.conversation.read"}, "enabled")
	if err != nil {
		t.Fatal(err)
	}
	f.task, err = f.server.store.BindAgentConfiguration(f.session.Account, f.task.ID, 1, 1, f.session.DeviceID, config.ID)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan taskRunView, 1)
	go func() {
		view, _ := f.server.runTaskModel(context.Background(), f.session, f.task.ID, f.request())
		done <- view
	}()
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("configured model request not entered")
	}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPatch, "/api/agents/"+config.ID, strings.NewReader(`{"expectedRevision":1,"name":"Task helper","modelRef":"gateway.configured","toolIds":["ai.conversation.read"],"state":"paused"}`))
	request.SetPathValue("agentId", config.ID)
	f.server.handleAgentConfigurationWrite(recorder, request, f.session)
	if recorder.Code != http.StatusOK {
		t.Fatalf("pause rejected: %d %s", recorder.Code, recorder.Body.String())
	}
	select {
	case <-ended:
	case <-time.After(3 * time.Second):
		t.Fatal("pause did not stop model HTTP")
	}
	select {
	case view := <-done:
		if view.Status != "STOPPED" || view.Content != "" {
			t.Fatalf("paused config promoted answer: %+v", view)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("paused run did not drain")
	}
	if f.requests.Load() != 1 {
		t.Fatal("pause started another model request")
	}
}

func TestP08InterruptedModelRunIsRecoveryOnly(t *testing.T) {
	f := newP08ModelFixture(t)
	request := f.request()
	pending, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err != nil {
		t.Fatal(err)
	}
	run := f.server.store.state.TaskRuns[pending.ID]
	run.Active = true
	run.Status = "WORKING"
	run.RuntimeID = "isolated-retired-process"
	f.server.store.mu.Lock()
	err = f.server.store.saveTaskRunLocked(run, "isolated_interrupted_claim")
	f.server.store.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	reopened, err := NewStore(f.server.store.path, f.key)
	if err != nil {
		t.Fatal(err)
	}
	restarted := &Server{store: reopened, taskModel: f.provider, toolEffects: f.server.toolEffects, taskModelAdmit: f.server.taskModelAdmit}
	request.Resume = true
	request.Prompt = ""
	if _, err := restarted.runTaskModel(context.Background(), f.session, f.task.ID, request); !errors.Is(err, errTaskEffectUnresolved) {
		t.Fatalf("interrupted claim restarted model: %v", err)
	}
	recorder := httptest.NewRecorder()
	read := httptest.NewRequest(http.MethodGet, "/api/tasks/"+f.task.ID+"/runs/"+pending.ID, nil)
	read.SetPathValue("id", f.task.ID)
	read.SetPathValue("runId", pending.ID)
	restarted.handleTaskModelRunRead(recorder, read, f.session)
	var view taskRunView
	if err := json.Unmarshal(recorder.Body.Bytes(), &view); err != nil {
		t.Fatal(err)
	}
	if recorder.Code != http.StatusOK || view.Status != "UNKNOWN" || !view.RecoveryOnly || view.Content != "" || view.FirstCause != "MODEL_RESPONSE_UNCONFIRMED_AFTER_RESTART" || f.requests.Load() != 1 {
		t.Fatalf("interrupted model state is not truthful: %+v calls=%d", view, f.requests.Load())
	}
}

// An isolated human-proof stand-in, never a production Grant.
func (f *p08ModelFixture) approveStep(t *testing.T, id string) {
	t.Helper()
	expected := f.expected
	expected.StepID = id
	if _, err := f.server.store.commitTaskApprovalAtFence(context.Background(), expected, "isolated-grant-reference", func() error { return nil }); err != nil {
		t.Fatal(err)
	}
}
