package aiproduct

import (
	"reflect"
	"testing"
)

// Exercise the EXISTING durable task event cursor with original run references.
// No new public schema, provider call, Source or authority is introduced.
func TestP08RunEventCursorColdReconnect(t *testing.T) {
	store, conversation, key := p08TaskStore(t)
	task, err := store.CreateTask("tenant-a", conversation.ID, "device")
	if err != nil {
		t.Fatal(err)
	}
	run := taskModelRun{ID: modelRunKey("tenant-a", task.ID, "PUBLIC-original-run"), RunID: "PUBLIC-original-run", TaskID: task.ID, Account: "tenant-a", Holder: "device", SessionID: "PUBLIC-session", TaskRevision: task.Revision, Generation: task.Generation, Status: "UNKNOWN", FirstCause: "MODEL_RESPONSE_UNCONFIRMED_AFTER_RESTART"}
	store.mu.Lock()
	for i := 0; i < 103; i++ {
		if err = store.saveTaskRunLocked(run, "PUBLIC_original_run_metadata"); err != nil {
			store.mu.Unlock()
			t.Fatal(err)
		}
	}
	store.mu.Unlock()
	first, err := store.ReadTaskProjection("tenant-a", task.ID, 0)
	if err != nil || !first.HasMore || len(first.Events) != 100 || first.Cursor != 100 {
		t.Fatalf("bounded first page: %v %+v", err, first)
	}
	cold, err := NewStore(store.path, key)
	if err != nil {
		t.Fatal(err)
	}
	second, err := cold.ReadTaskProjection("tenant-a", task.ID, first.Cursor)
	if err != nil || second.HasMore || len(second.Events) != 4 || second.Cursor != 104 {
		t.Fatalf("cold page: %v %+v", err, second)
	}
	for _, event := range second.Events {
		if event.ObjectID != run.ID {
			t.Fatal("original run reference changed")
		}
	}
	last, err := cold.ReadTaskProjection("tenant-a", task.ID, second.Cursor)
	if err != nil || len(last.Events) != 0 || last.Cursor != 104 {
		t.Fatal("acknowledged page replayed")
	}
	original := cold.state.TaskRuns[run.ID]
	if !reflect.DeepEqual(original, run) {
		t.Fatal("query rewrote original run/first cause")
	}
	if _, err = cold.ReadTaskProjection("foreign", task.ID, 0); err == nil {
		t.Fatal("cross-account event page returned")
	}
}
func TestP08RunEventFailedSaveKeepsOriginalCursor(t *testing.T) {
	store, conversation, _ := p08TaskStore(t)
	task, err := store.CreateTask("tenant-a", conversation.ID, "device")
	if err != nil {
		t.Fatal(err)
	}
	before, err := store.ReadTaskProjection("tenant-a", task.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	path := store.path
	store.path = t.TempDir()
	run := taskModelRun{ID: modelRunKey("tenant-a", task.ID, "PUBLIC-original"), RunID: "PUBLIC-original", TaskID: task.ID, Account: "tenant-a", Status: "UNKNOWN", FirstCause: "PUBLIC_FIRST_CAUSE"}
	store.mu.Lock()
	err = store.saveTaskRunLocked(run, "PUBLIC_not_committed")
	store.mu.Unlock()
	store.path = path
	if err == nil {
		t.Fatal("failure seam did not reject durable save")
	}
	after, err := store.ReadTaskProjection("tenant-a", task.ID, 0)
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatal("failed save advanced event cursor")
	}
	if _, ok := store.state.TaskRuns[run.ID]; ok {
		t.Fatal("failed save published new run")
	}
}
