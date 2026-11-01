package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
)

func p08ReadExecutionReview(t *testing.T, snapshot *TaskStoreSnapshot) (TaskExecutionReviewDATA, []byte) {
	t.Helper()
	raw, err := snapshot.ReadOriginalTaskReviewDATA()
	if err != nil {
		t.Fatal(err)
	}
	var out TaskExecutionReviewDATA
	if json.Unmarshal(raw, &out) != nil {
		t.Fatal("invalid review DATA")
	}
	if !out.DataOnly || out.AuthorityGranted {
		t.Fatal("review DATA granted authority")
	}
	return out, raw
}
func TestP08WalletReviewOriginalStepResourcesNoPrivateContent(t *testing.T) {
	store, task, configuration, expected := p08AgentConfiguredReadFixture(t)
	source, _ := NewTaskStoreSource(store)
	principal := TaskStorePrincipal{Account: task.Account, DeviceID: task.Holder, SessionID: "PUBLIC-session"}
	snapshot, err := source.Capture(context.Background(), TaskStoreCapture{Principal: principal, TaskID: task.ID, StepID: expected.StepID})
	if err != nil {
		t.Fatal(err)
	}
	defer snapshot.Close()
	before, _ := os.ReadFile(store.path)
	out, raw := p08ReadExecutionReview(t, snapshot)
	if out.Task.ID != task.ID || out.Operation.ID != expected.StepID || out.Input == nil || *out.Input != expected.Input || out.Historical || len(out.Resources) != 1 || out.Resources[0].ResourceID != task.ConversationID || out.LocalConfiguration.ID != configuration.ID {
		t.Fatal("review changed original task/input/resource binding")
	}
	if out.AuthAgentIdentityState != "ORIGINAL_AUTH_AGENT_SOURCE_REQUIRED" || out.AuthBudgetAndExpiryState != "ORIGINAL_AUTH_GRANT_SOURCE_REQUIRED" {
		t.Fatal("configuration masqueraded as agent or budget")
	}
	for _, secret := range []string{"actual configured source body", "isolated-grant-reference", "inputCipher", "inputNonce", "taskGrantRef", "TokenHash"} {
		if bytes.Contains(raw, []byte(secret)) {
			t.Fatalf("private review material released: %s", secret)
		}
	}
	after, _ := os.ReadFile(store.path)
	if !bytes.Equal(before, after) {
		t.Fatal("review changed task/approval/once/budget state")
	}
	if _, err = store.ConfigureAgent(task.Account, configuration.ID, configuration.Revision, configuration.Name, configuration.ModelRef, configuration.ToolIDs, "paused"); err != nil {
		t.Fatal(err)
	}
	if raw, err = snapshot.ReadOriginalTaskReviewDATA(); raw != nil || !errors.Is(err, ErrTaskStoreSnapshotStale) {
		t.Fatal("same held review survived pause")
	}
	fresh, err := source.Capture(context.Background(), TaskStoreCapture{Principal: principal, TaskID: task.ID, StepID: expected.StepID})
	if err != nil {
		t.Fatal(err)
	}
	defer fresh.Close()
	paused, _ := p08ReadExecutionReview(t, fresh)
	if paused.LocalConfiguration.State != "paused" || paused.LocalConfiguration.Revision == paused.Task.AgentConfigurationRevision {
		t.Fatal("pause/rebind distinction lost")
	}
}
func TestP08WalletReviewShopExactRequestedFieldsWithoutOrderRead(t *testing.T) {
	f := newP08ShopFixture(t, true)
	source, _ := f.server.OpenTaskStoreSource()
	snapshot, err := source.Capture(context.Background(), TaskStoreCapture{Principal: TaskStorePrincipal{Account: f.session.Account, DeviceID: f.session.DeviceID, SessionID: f.session.ID}, TaskID: f.task.ID, StepID: f.step.ID})
	if err != nil {
		t.Fatal(err)
	}
	defer snapshot.Close()
	out, raw := p08ReadExecutionReview(t, snapshot)
	if len(out.Resources) != 1 || out.Resources[0].ResourceID != f.selection.OrderID || out.Resources[0].Version != f.selection.Snapshot || strings.Join(out.RequestedFields, ",") != strings.Join(f.selection.Fields, ",") || len(out.ApprovedFields) != 0 {
		t.Fatal("Shop requested selection became approval or changed")
	}
	if f.caller.calls.Load() != 0 || f.caller.queries.Load() != 0 || bytes.Contains(raw, []byte(`"totalYNXT":"17"`)) {
		t.Fatal("review executed or disclosed order data")
	}
}
func TestP08WalletReviewExistingConversationDoesNotCreateTask(t *testing.T) {
	store, conversation, _ := p08TaskStore(t)
	source, _ := NewTaskStoreSource(store)
	snapshot, err := source.CaptureConversation(context.Background(), TaskStorePrincipal{Account: conversation.Account, DeviceID: "PUBLIC-device", SessionID: "PUBLIC-session"}, conversation.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer snapshot.Close()
	before, _ := os.ReadFile(store.path)
	out, _ := p08ReadExecutionReview(t, snapshot)
	if out.Task != nil || out.Operation != nil || len(out.Resources) != 1 || out.Resources[0].ResourceID != conversation.ID || len(store.state.Tasks) != 0 {
		t.Fatal("review manufactured a task/operation")
	}
	after, _ := os.ReadFile(store.path)
	if !bytes.Equal(before, after) {
		t.Fatal("review wrote store")
	}
}
func TestP08WalletReviewRecordedModelLabelsExcludePromptSessionAndResults(t *testing.T) {
	f := newP08ModelFixture(t)
	run, task, _, _, _, err := f.server.beginTaskRun(f.session, f.task.ID, f.request())
	if err != nil {
		t.Fatal(err)
	}
	private := cloneTaskModelSession(f.session)
	private.TokenHash = "PRIVATE-token-hash"
	err = f.server.recordTaskModelAdmission(context.Background(), run, taskModelAdmissionSnapshot{Session: private, Task: task, ProviderURL: "http://127.0.0.1:11434/v1", Model: "PUBLIC-fixed-model", Body: []byte(`{"messages":[{"role":"user","content":"PRIVATE prompt and tool result"}]}`)})
	if err != nil {
		t.Fatal(err)
	}
	source, _ := f.server.OpenTaskStoreSource()
	snapshot, err := source.Capture(context.Background(), TaskStoreCapture{Principal: TaskStorePrincipal{Account: f.session.Account, DeviceID: f.session.DeviceID, SessionID: f.session.ID}, TaskID: task.ID, RunID: run.RunID})
	if err != nil {
		t.Fatal(err)
	}
	defer snapshot.Close()
	out, raw := p08ReadExecutionReview(t, snapshot)
	if out.OriginalRunID != run.RunID || out.Model.State != "ORIGINAL_RECORDED_DESTINATION" || out.Model.Model != "PUBLIC-fixed-model" || out.Model.ProviderURL != "http://127.0.0.1:11434/v1" {
		t.Fatal("recorded model identity lost")
	}
	if bytes.Contains(raw, []byte("PRIVATE")) || f.requests.Load() != 0 {
		t.Fatal("review disclosed private context or executed model")
	}
}
func TestP08WalletReviewClosedCancelledForeignAndTamperedFailClosed(t *testing.T) {
	for _, kind := range []string{"closed", "cancelled", "foreign", "tampered-input"} {
		t.Run(kind, func(t *testing.T) {
			store, expected, _ := taskReadFixture(t)
			source, _ := NewTaskStoreSource(store)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			p := TaskStorePrincipal{Account: expected.Account, DeviceID: expected.Holder, SessionID: "PUBLIC-session"}
			if kind == "foreign" {
				p.Account = "PUBLIC-foreign"
			}
			snapshot, err := source.Capture(ctx, TaskStoreCapture{Principal: p, TaskID: expected.TaskID, StepID: expected.StepID})
			if kind == "foreign" {
				if err == nil || snapshot != nil {
					t.Fatal("foreign review captured")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			defer snapshot.Close()
			switch kind {
			case "closed":
				snapshot.Close()
			case "cancelled":
				cancel()
			case "tampered-input":
				r := store.state.Actions[expected.StepID]
				r.ToolStep.InputCipher = "invalid"
				store.state.Actions[expected.StepID] = r
			}
			if raw, err := snapshot.ReadOriginalTaskReviewDATA(); err == nil || raw != nil {
				t.Fatal("invalid original review released DATA")
			}
		})
	}
}
func TestP08WalletReviewOriginalDigestMatchesFrozenPriorRelease(t *testing.T) {
	raw, err := os.ReadFile("testdata/legacy-product-step-digest.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		Binding  ToolStepBinding `json:"binding"`
		Input    json.RawMessage `json:"input"`
		Expected string          `json:"expectedInputDigest"`
	}
	if json.Unmarshal(raw, &v) != nil {
		t.Fatal("bad prior-release vector")
	}
	var input conversationToolInput
	if json.Unmarshal(v.Input, &input) != nil {
		t.Fatal("bad resource")
	}
	canonical, _ := json.Marshal(input)
	digest, err := originalToolStepInputDigest(v.Binding, canonical)
	if err != nil || digest != v.Expected {
		t.Fatal("review refactor changed existing product operation binding", err)
	}
}
func TestP08WalletReviewOriginalPageReferencesExcludePageBytes(t *testing.T) {
	f := newP08ModelFixture(t)
	run, _, _, _, _, err := f.server.beginTaskRun(f.session, f.task.ID, f.request())
	if err != nil {
		t.Fatal(err)
	}
	pages := p08Pages(run.TaskID)
	raw, _ := json.Marshal(pages)
	refs := make([]TaskPageReference, len(pages))
	for i, p := range pages {
		refs[i] = p.Reference
	}
	run.PagesBinding = taskPageReferenceBinding(refs)
	run.PagesNonce, run.PagesCipher, err = f.server.store.encrypt(run.Account, run.TaskID, run.ID+":pages", string(raw))
	if err != nil {
		t.Fatal(err)
	}
	f.server.store.mu.Lock()
	err = f.server.store.saveTaskRunLocked(run, "PUBLIC_retained_pages_for_review")
	f.server.store.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	source, _ := f.server.OpenTaskStoreSource()
	principal := TaskStorePrincipal{Account: f.session.Account, DeviceID: f.session.DeviceID, SessionID: f.session.ID}
	held, err := source.Capture(context.Background(), TaskStoreCapture{Principal: principal, TaskID: run.TaskID, RunID: run.RunID})
	if err != nil {
		t.Fatal(err)
	}
	defer held.Close()
	out, review := p08ReadExecutionReview(t, held)
	if len(out.Resources) != 3 || out.Resources[0].ResourceID != pages[0].Reference.SelectionID || out.Resources[0].Version != pages[0].Reference.Version || bytes.Contains(review, []byte("Synthetic comparison input")) || bytes.Contains(review, []byte("snapshotUTF8")) {
		t.Fatal("review lost reference or released Browser content")
	}
	if f.requests.Load() != 0 {
		t.Fatal("review replayed model")
	}
	principal.SessionID = "PUBLIC-other-session"
	other, err := source.Capture(context.Background(), TaskStoreCapture{Principal: principal, TaskID: run.TaskID, RunID: run.RunID})
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	restricted, _ := p08ReadExecutionReview(t, other)
	if !restricted.Historical || len(restricted.Resources) != 0 || restricted.Model.State != "ORIGINAL_SESSION_SOURCE_REQUIRED" {
		t.Fatal("other session borrowed original private context")
	}
}
func TestP08WalletReviewNormalServerProvidesPinnedModelBeforeAnySend(t *testing.T) {
	store, conversation, _ := p08TaskStore(t)
	model, err := NewTaskModelService(TaskModelConfig{ChainURL: "http://127.0.0.1:1", ProviderURL: "http://127.0.0.1:11434/v1", ProviderAuth: "none-loopback", Model: "PUBLIC-fixed-model", AccessAPIKey: "PUBLIC-access-key", UpstreamKey: "PUBLIC-upstream-key"})
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{store: store, taskModel: model}
	source, err := server.OpenTaskStoreSource()
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := source.CaptureConversation(context.Background(), TaskStorePrincipal{Account: conversation.Account, DeviceID: "PUBLIC-device", SessionID: "PUBLIC-session"}, conversation.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer snapshot.Close()
	out, raw := p08ReadExecutionReview(t, snapshot)
	if out.Model.State != "CONFIGURED_DESTINATION_DATA_ONLY" || out.Model.ProviderURL != "http://127.0.0.1:11434/v1" || out.Model.Model != "PUBLIC-fixed-model" || bytes.Contains(raw, []byte("PUBLIC-access-key")) || bytes.Contains(raw, []byte("PUBLIC-upstream-key")) {
		t.Fatal("normal pinned model absent or credential released")
	}
}
func TestP08WalletReviewConsumerSample(t *testing.T) {
	store, task, _, expected := p08AgentConfiguredReadFixture(t)
	source, _ := NewTaskStoreSource(store)
	held, err := source.Capture(context.Background(), TaskStoreCapture{Principal: TaskStorePrincipal{Account: task.Account, DeviceID: task.Holder, SessionID: "PUBLIC-sample-session"}, TaskID: task.ID, StepID: expected.StepID})
	if err != nil {
		t.Fatal(err)
	}
	defer held.Close()
	out, raw := p08ReadExecutionReview(t, held)
	if out.Tool == nil || out.Tool.ID != "ai.conversation.read" || out.OriginalRequesterOperationID != "configured-original-read" {
		t.Fatal("original operation identity/callee missing")
	}
	if path := os.Getenv("P08_TASK_REVIEW_SAMPLE_OUT"); path != "" {
		if err = os.WriteFile(path, raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
}
func TestP08WalletReviewWebDAVShowsReferencesWithoutCredentialsOrIO(t *testing.T) {
	f := newP08WebDAVRuntime(t)
	if _, err := f.deliver(); err != nil {
		t.Fatal(err)
	}
	source, _ := f.s.OpenTaskStoreSource()
	held, err := source.Capture(context.Background(), TaskStoreCapture{Principal: TaskStorePrincipal{Account: f.session.Account, DeviceID: f.session.DeviceID, SessionID: f.session.ID}, TaskID: f.task.ID, StepID: f.input.OperationID})
	if err != nil {
		t.Fatal(err)
	}
	defer held.Close()
	before := f.dav.requests()
	out, raw := p08ReadExecutionReview(t, held)
	if out.Tool == nil || out.Tool.ID != taskWebDAVToolID || len(out.Resources) != 2 || out.Resources[0].ResourceID != f.input.ResourceID || out.Resources[0].Version != taskWebDAVDigest(f.content) || out.Resources[1].ResourceID != f.input.DestinationID {
		t.Fatal("original destination/resource references lost")
	}
	if f.dav.requests() != before || bytes.Contains(raw, f.content) || f.dav.cfg.Password != "" && bytes.Contains(raw, []byte(f.dav.cfg.Password)) {
		t.Fatal("review read remote object or disclosed secret/content")
	}
}
