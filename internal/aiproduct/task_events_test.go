package aiproduct

import (
	"encoding/json"
	"fmt"
	"reflect"
	"testing"
)

func TestP08TaskEventProjection(t *testing.T) {
	store, conversation, key := p08TaskStore(t)
	task, err := store.CreateTask("tenant-a", conversation.ID, "device")
	if err != nil {
		t.Fatal(err)
	}
	initial, err := store.ReadTaskProjection("tenant-a", task.ID, 0)
	if err != nil || initial.Cursor != 1 || len(initial.Events) != 1 {
		t.Fatalf("initial projection: %+v %v", initial, err)
	}
	raw, _ := json.Marshal(conversationToolInput{ConversationID: conversation.ID})
	session := ProductSession{Account: "tenant-a", DeviceID: "device", Scopes: []string{"ai:conversations"}}
	input := toolStepRequest{OperationID: "call-1", TaskRevision: 1, Generation: 1, ToolID: "ai.conversation.read", ToolVersion: "1", Input: raw}
	step, _, err := store.reserveToolStep(session, task.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	if _, created, err := store.reserveToolStep(session, task.ID, input); err != nil || created {
		t.Fatalf("replay changed slot: %v %v", created, err)
	}
	page, err := store.ReadTaskProjection("tenant-a", task.ID, 1)
	if err != nil || !page.Changed || page.Cursor != 2 || page.Revision != 1 || page.HasMore || len(page.Events) != 1 || len(page.Steps) != 1 {
		t.Fatalf("new step invisible to task cursor: %+v %v", page, err)
	}
	if page.Steps[0].ID != step.ID || page.Steps[0].ToolStep.InputCipher != "" || page.Steps[0].ToolStep.InputNonce != "" {
		t.Fatal("projection leaked encrypted input or changed step")
	}
	page.Steps[0].ToolStep.Holder = "mutated-projection"
	if record, _ := store.Action("tenant-a", step.ID); record.ToolStep.Holder != "device" {
		t.Fatal("projection aliases stored binding")
	}
	if _, err := store.CancelTask("tenant-a", task.ID, 1, 1, "device"); err != nil {
		t.Fatal(err)
	}
	cancelled, err := store.ReadTaskProjection("tenant-a", task.ID, 2)
	if err != nil || cancelled.Status != "CANCELLED" || cancelled.Cursor != 3 || len(cancelled.Events) != 1 {
		t.Fatalf("cancellation event missing: %+v %v", cancelled, err)
	}
	restarted, err := NewStore(store.path, key)
	if err != nil {
		t.Fatal(err)
	}
	recovered, err := restarted.ReadTaskProjection("tenant-a", task.ID, 2)
	if err != nil || !reflect.DeepEqual(recovered, cancelled) {
		t.Fatalf("event restart mismatch: %+v %v", recovered, err)
	}
	if _, err := restarted.ReadTaskProjection("foreign-tenant", task.ID, 0); err == nil {
		t.Fatal("foreign task history visible")
	}
}

func TestP08TaskEventBoundedPage(t *testing.T) {
	store, conversation, _ := p08TaskStore(t)
	task, err := store.CreateTask("tenant-a", conversation.ID, "device")
	if err != nil {
		t.Fatal(err)
	}
	// Isolated event-page fixture: no tool dispatch or real history mutation.
	store.mu.Lock()
	for i := 0; i < 105; i++ {
		if err := store.appendTaskEventLocked(task.ID, 1, "fixture-reference", fmt.Sprintf("step-%d", i)); err != nil {
			store.mu.Unlock()
			t.Fatal(err)
		}
	}
	store.mu.Unlock()
	first, err := store.ReadTaskProjection("tenant-a", task.ID, 0)
	if err != nil || len(first.Events) != 100 || first.Cursor != 100 || first.LatestCursor != 106 || !first.HasMore {
		t.Fatalf("unbounded or incorrect first page: %+v %v", first, err)
	}
	second, err := store.ReadTaskProjection("tenant-a", task.ID, first.Cursor)
	if err != nil || len(second.Events) != 6 || second.Cursor != 106 || second.HasMore {
		t.Fatalf("incorrect continuation: %+v %v", second, err)
	}
	unchanged, err := store.ReadTaskProjection("tenant-a", task.ID, second.Cursor)
	if err != nil || unchanged.Changed || len(unchanged.Events) != 0 || unchanged.Cursor != 106 {
		t.Fatalf("unchanged cursor replayed events: %+v %v", unchanged, err)
	}
	if _, err := store.ReadTaskProjection("tenant-a", task.ID, 107); err != ErrTaskCursor {
		t.Fatalf("future cursor accepted: %v", err)
	}
}
