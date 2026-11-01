package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/aitaskclient"
)

// The network client reaches real daemon routes and original encrypted Store.
// Only identity verification is explicitly PUBLIC controlled; no production
// Wallet, Grant or tool Source is minted by this test.
func TestP08IndependentClientCreateReadRestartAndDeniedDispatch(t *testing.T) {
	server, store, authorizer := canonicalTestServer(t)
	peer := httptest.NewServer(server.Handler())
	defer peer.Close()
	journalDirectory := filepath.Join(t.TempDir(), "operations")
	journal, err := aitaskclient.OpenJournal(journalDirectory)
	if err != nil {
		t.Fatal(err)
	}
	client, err := aitaskclient.New(peer.URL, journal)
	if err != nil {
		t.Fatal(err)
	}
	call := func(action, operation, task, step string, body any) aitaskclient.Response {
		t.Helper()
		raw, _ := json.Marshal(body)
		if body == nil {
			raw = nil
		}
		r, err := client.Do(context.Background(), aitaskclient.Request{Action: action, OperationID: operation, TaskID: task, StepID: step, Proof: "PUBLIC-controlled-session-proof", Body: raw})
		if err != nil {
			t.Fatalf("%s: HTTP%d %v", action, r.Status, err)
		}
		return r
	}
	conversationResponse := call("conversation-create", "conversation-1", "", "", map[string]any{"title": "Independent task client"})
	var conversation Conversation
	if err := json.Unmarshal(conversationResponse.Body, &conversation); err != nil {
		t.Fatal(err)
	}
	created := call("task-create", "task-1", "", "", map[string]any{"conversationId": conversation.ID})
	var task TaskRecord
	if err := json.Unmarshal(created.Body, &task); err != nil || task.Status != "DRAFT" {
		t.Fatalf("task metadata: %+v %v", task, err)
	}
	retained, err := journal.Read("task-1")
	if err != nil || retained.TaskID != task.ID || retained.State != "RESPONSE_RECEIVED" {
		t.Fatal("created task lookup not persisted", err)
	}
	prepared := call("task-prepare", "prepare-1", task.ID, "", map[string]any{"revision": task.Revision, "generation": task.Generation})
	var preparedView struct {
		Task TaskRecord `json:"task"`
	}
	_ = json.Unmarshal(prepared.Body, &preparedView)
	task = preparedView.Task
	proposal := call("step-propose", "proposal-1", task.ID, "", map[string]any{"operationId": "original-local-read", "taskRevision": task.Revision, "generation": task.Generation, "toolId": "ai.conversation.read", "toolVersion": "1", "input": map[string]any{"conversationId": conversation.ID}})
	var proposed struct {
		Step     ActionRecord `json:"step"`
		Executed bool         `json:"executed"`
	}
	if err := json.Unmarshal(proposal.Body, &proposed); err != nil || proposed.Executed || proposed.Step.Status != "NEEDS_APPROVAL" {
		t.Fatalf("proposal became authorization: %+v %v", proposed, err)
	}
	denied, err := client.Do(context.Background(), aitaskclient.Request{Action: "step-dispatch", TaskID: task.ID, StepID: proposed.Step.ID, OperationID: "denied-dispatch", Proof: "PUBLIC-controlled-session-proof", Body: json.RawMessage(`{"authorizationRef":"not-a-Grant"}`)})
	var httpErr *aitaskclient.HTTPError
	if !errors.As(err, &httpErr) || denied.Status != 503 {
		t.Fatalf("unadmitted Source executed: %s %v", denied.Body, err)
	}
	peer.Close()
	// Reopen the same original encrypted Store, not an in-memory replacement.
	restored, err := NewStore(store.path, bytes.Repeat([]byte{7}, 32))
	if err != nil {
		t.Fatal(err)
	}
	restarted, err := NewServer(server.cfg, restored, nil)
	if err != nil {
		t.Fatal(err)
	}
	restarted.wallet = authorizer
	after := httptest.NewServer(restarted.Handler())
	defer after.Close()
	journal, err = aitaskclient.OpenJournal(journalDirectory)
	if err != nil {
		t.Fatal(err)
	}
	client, err = aitaskclient.New(after.URL, journal)
	if err != nil {
		t.Fatal(err)
	}
	view := call("task-show", "", task.ID, "", nil)
	var projection TaskProjection
	if err := json.Unmarshal(view.Body, &projection); err != nil || projection.ID != task.ID || len(projection.Steps) != 1 || projection.Steps[0].ID != proposed.Step.ID || projection.Steps[0].ToolStep.ResultCipher != "" {
		t.Fatalf("restart lost original task or fabricated result: %+v %v", projection, err)
	}
	discovered := call("task-list", "", "", "", nil)
	var page TaskPage
	if json.Unmarshal(discovered.Body, &page) != nil || len(page.Tasks) != 1 || page.Tasks[0].ID != task.ID {
		t.Fatal("client could not discover original task after create response loss")
	}
	if len(restored.state.Sessions) != 0 || len(restored.state.Permissions) != 0 {
		t.Fatal("client manufactured a session or approval")
	}
}

func TestP08OwnedTaskDiscoveryBoundedAndTenantFiltered(t *testing.T) {
	_, store, authorizer := canonicalTestServer(t)
	conversation, err := store.CreateConversation(authorizer.account, "owned discovery")
	if err != nil {
		t.Fatal(err)
	}
	for n := 0; n < 102; n++ {
		if _, err := store.CreateTask(authorizer.account, conversation.ID, "holder"); err != nil {
			t.Fatal(err)
		}
	}
	foreign, err := store.CreateConversation("PUBLIC-foreign", "foreign")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateTask("PUBLIC-foreign", foreign.ID, "foreign-holder"); err != nil {
		t.Fatal(err)
	}
	first, err := store.ListOwnedTasks(authorizer.account, "")
	if err != nil || len(first.Tasks) != 100 || !first.HasMore || first.NextID == "" {
		t.Fatalf("unbounded task list: %+v %v", first, err)
	}
	second, err := store.ListOwnedTasks(authorizer.account, first.NextID)
	if err != nil || len(second.Tasks) != 2 || second.HasMore {
		t.Fatal("discovery cursor lost owned tasks", err)
	}
	seen := map[string]bool{}
	for _, row := range append(first.Tasks, second.Tasks...) {
		if row.Account != authorizer.account || seen[row.ID] {
			t.Fatal("tenant leak or duplicate task")
		}
		seen[row.ID] = true
	}
	if _, err := store.ListOwnedTasks(authorizer.account, "../foreign"); !errors.Is(err, ErrTaskCursor) {
		t.Fatal("invalid discovery cursor accepted")
	}
}
