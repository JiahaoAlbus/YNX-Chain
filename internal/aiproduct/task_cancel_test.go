package aiproduct

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestP08CancelTask(t *testing.T) {
	for _, remoteStatus := range []string{"", "UNKNOWN", "SENT", "DISPATCHING", "RECONCILING"} {
		t.Run("remote_"+remoteStatus, func(t *testing.T) {
			store, conversation, key := p08TaskStore(t)
			task, err := store.CreateTask("tenant-a", conversation.ID, "device")
			if err != nil {
				t.Fatal(err)
			}
			raw, _ := json.Marshal(conversationToolInput{ConversationID: conversation.ID})
			session := ProductSession{Account: "tenant-a", DeviceID: "device", Scopes: []string{"ai:conversations"}}
			input := toolStepRequest{OperationID: "pending", TaskRevision: 1, Generation: 1, ToolID: "ai.conversation.read", ToolVersion: "1", Input: raw}
			pending, _, err := store.reserveToolStep(session, task.ID, input)
			if err != nil {
				t.Fatal(err)
			}
			remote := ActionRecord{ID: "original-remote", Account: "tenant-a", ConversationID: conversation.ID, Status: remoteStatus, GatewayID: "receipt-original", Description: "firstCause: response lost", Evidence: []string{"original-evidence"}, ToolStep: &ToolStepBinding{TaskID: task.ID, OperationID: "original-operation"}}
			if remoteStatus != "" {
				if err := store.SaveAction(remote); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := store.CancelTask("other-tenant", task.ID, 1, 1, "device"); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("tenant boundary: %v", err)
			}
			if _, err := store.CancelTask("tenant-a", task.ID, 1, 1, "old-device"); !errors.Is(err, ErrTaskConflict) {
				t.Fatalf("holder boundary: %v", err)
			}
			cancelled, err := store.CancelTask("tenant-a", task.ID, 1, 1, "device")
			if err != nil {
				t.Fatal(err)
			}
			want := "CANCELLED"
			if remoteStatus != "" {
				want = "RECONCILING"
			}
			if cancelled.Status != want || cancelled.CancelledAt.IsZero() || cancelled.Revision != 2 || cancelled.Generation != 1 {
				t.Fatalf("cancellation blurred remote status: %+v", cancelled)
			}
			if got, _ := store.Action("tenant-a", pending.ID); got.Status != "CANCELLED" {
				t.Fatal("pending proposal still active")
			}
			if remoteStatus != "" {
				if got, _ := store.Action("tenant-a", remote.ID); !reflect.DeepEqual(got, remote) {
					t.Fatalf("remote original changed: %+v", got)
				}
			}
			input.OperationID = "new-after-cancel"
			input.TaskRevision = cancelled.Revision
			if _, _, err := store.reserveToolStep(session, task.ID, input); err != errToolConflict {
				t.Fatalf("cancelled task accepted future work: %v", err)
			}
			restarted, err := NewStore(store.path, key)
			if err != nil {
				t.Fatal(err)
			}
			projection, err := restarted.ReadTaskProjection("tenant-a", task.ID, 1)
			if err != nil || !reflect.DeepEqual(projection.TaskRecord, cancelled) {
				t.Fatalf("cancelled task recovery: %+v %v", projection, err)
			}
		})
	}
}

func TestP08CancelTaskSaveFailure(t *testing.T) {
	store, conversation, _ := p08TaskStore(t)
	task, err := store.CreateTask("tenant-a", conversation.ID, "device")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SaveAction(ActionRecord{ID: "pending", Account: "tenant-a", Status: "NEEDS_APPROVAL", ToolStep: &ToolStepBinding{TaskID: task.ID}}); err != nil {
		t.Fatal(err)
	}
	before, err := json.Marshal(store.state)
	if err != nil {
		t.Fatal(err)
	}
	original := store.path
	diskBefore, err := os.ReadFile(original)
	if err != nil {
		t.Fatal(err)
	}
	store.path = filepath.Join(original, "impossible.json")
	if task, err := store.CancelTask("tenant-a", task.ID, 1, 1, "device"); err == nil || task != (TaskRecord{}) {
		t.Fatalf("failed cancel returned success: %+v %v", task, err)
	}
	after, _ := json.Marshal(store.state)
	diskAfter, err := os.ReadFile(original)
	if !bytes.Equal(before, after) || err != nil || !bytes.Equal(diskBefore, diskAfter) {
		t.Fatal("failed cancellation altered memory or disk")
	}
}

func TestP08CancelTaskHTTP(t *testing.T) {
	gateway := newGatewayFixture(t, true)
	defer gateway.Close()
	store, product := testProduct(t, gateway.URL)
	defer product.Close()
	session := authenticate(t, product.URL, store, newTestIdentity(t))
	conversation, err := store.CreateConversation(session.Account, "Cancel source")
	if err != nil {
		t.Fatal(err)
	}
	task, err := store.CreateTask(session.Account, conversation.ID, session.DeviceID)
	if err != nil {
		t.Fatal(err)
	}
	raw := authedJSON(t, http.MethodPost, product.URL+"/api/tasks/"+task.ID+"/cancel", map[string]uint64{"revision": 1, "generation": 1}, session, http.StatusOK)
	var result struct {
		Task     TaskRecord `json:"task"`
		Closed   bool       `json:"futureDispatchClosed"`
		Rollback bool       `json:"remoteRollback"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	if !result.Closed || result.Rollback || result.Task.Status != "CANCELLED" {
		t.Fatalf("incorrect cancellation response: %s", raw)
	}
	authedJSON(t, http.MethodGet, product.URL+"/api/tasks/"+task.ID, nil, session, http.StatusOK)
}
