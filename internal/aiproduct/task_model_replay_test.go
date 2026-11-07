package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/aigateway"
)

// PUBLIC controlled provider and Store only: this targets a newly reproduced
// retry defect, not the previously accepted real-model or Source lifecycle.
func TestP08ColdModelFailureAfterToolRejectsProviderReplay(t *testing.T) {
	var f *p08ModelFixture
	f = newP08ModelFixture(t, func(w http.ResponseWriter, r *http.Request) {
		if f.requests.Load() == 1 {
			args, _ := json.Marshal(conversationToolInput{ConversationID: f.task.ConversationID})
			_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"finish_reason": "tool_calls", "message": map[string]any{"role": "assistant", "content": "", "tool_calls": []any{map[string]any{"id": "original-model-call", "type": "function", "function": map[string]any{"name": "ynx_conversation_read_v1", "arguments": string(args)}}}}}}})
			return
		}
		http.Error(w, "PUBLIC original provider failure", http.StatusServiceUnavailable)
	})
	request := f.request()
	pending, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err != nil || pending.Status != "NEEDS_APPROVAL" || len(pending.Steps) != 1 {
		t.Fatalf("original pause missing: %+v %v", pending, err)
	}
	step, _ := f.server.store.Action(f.session.Account, pending.Steps[0])
	f.approveStep(t, step.ID)
	f.expected.StepID = step.ID
	source := &p08EffectFixture{store: f.server.store, expected: f.expected}
	f.server.toolEffects = source
	request.Resume = true
	request.Prompt = ""
	failed, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err == nil || failed.Status != "UNKNOWN" || failed.FirstCause != "MODEL_PROVIDER_SERVICE_REJECTED" || f.requests.Load() != 2 || source.dispatches != 1 {
		t.Fatalf("new failure not reproduced: %+v %v", failed, err)
	}
	original := f.server.store.state.TaskRuns[pending.ID]
	reopened, err := NewStore(f.server.store.path, f.key)
	if err != nil {
		t.Fatal(err)
	}
	source.store = reopened
	restarted := &Server{store: reopened, taskModel: f.provider, toolEffects: source, taskModelAdmit: f.server.taskModelAdmit}
	admissions := f.admissions.Load()
	recovered, err := restarted.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if !errors.Is(err, aigateway.ErrToolModelResponseUnconfirmed) || recovered.Status != "UNKNOWN" || recovered.Content != "" || f.requests.Load() != 2 || source.dispatches != 1 || source.queries != 0 || f.admissions.Load() != admissions {
		t.Fatalf("cold failure replayed model/tool: %+v %v model=%d dispatch=%d query=%d", recovered, err, f.requests.Load(), source.dispatches, source.queries)
	}
	retained := reopened.state.TaskRuns[pending.ID]
	if retained.FirstCause != original.FirstCause || retained.CheckpointNonce != original.CheckpointNonce || retained.CheckpointCipher != original.CheckpointCipher || len(retained.Steps) != 1 || retained.Steps[0] != step.ID {
		t.Fatal("rejection replaced original failure/checkpoint/operation")
	}
	// The normal task POST must also refuse a direct Resume=true caller;
	// the mobile guard alone cannot protect this recovery boundary.
	body, _ := json.Marshal(request)
	post := httptest.NewRequest(http.MethodPost, "/api/tasks/"+f.task.ID+"/runs", bytes.NewReader(body))
	post.SetPathValue("id", f.task.ID)
	refusal := httptest.NewRecorder()
	restarted.handleTaskModelRun(refusal, post, f.session)
	var response struct {
		Run taskRunView `json:"run"`
	}
	if json.Unmarshal(refusal.Body.Bytes(), &response) != nil || refusal.Code != http.StatusConflict || response.Run.Status != "UNKNOWN" || response.Run.FirstCause != original.FirstCause || f.requests.Load() != 2 || source.dispatches != 1 || source.queries != 0 || f.admissions.Load() != admissions {
		t.Fatal("normal HTTP resume accepted/replayed an unconfirmed model checkpoint")
	}
	read := httptest.NewRequest(http.MethodGet, "/api/tasks/"+f.task.ID+"/runs/"+request.RunID, nil)
	read.SetPathValue("id", f.task.ID)
	read.SetPathValue("runId", request.RunID)
	w := httptest.NewRecorder()
	restarted.handleTaskModelRunRead(w, read, f.session)
	var view taskRunView
	if json.Unmarshal(w.Body.Bytes(), &view) != nil || w.Code != http.StatusOK || view.Status != "UNKNOWN" || view.Content != "" || view.FirstCause != original.FirstCause || f.requests.Load() != 2 {
		t.Fatal("original user read lost failure or resent provider")
	}
}
