package aiproduct

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestP08ActualTaskStoreSourceCaptureAndLockFreeCurrent(t *testing.T) {
	store, c, _ := p08TaskStore(t)
	task, err := store.CreateTask("tenant-a", c.ID, "holder-a")
	if err != nil {
		t.Fatal(err)
	}
	source, err := NewTaskStoreSource(store)
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	principal := TaskStorePrincipal{Account: task.Account, DeviceID: task.Holder, SessionID: "PUBLIC original Auth session operand"}
	held, err := source.Capture(context.Background(), TaskStoreCapture{Principal: principal, TaskID: task.ID})
	if err != nil {
		t.Fatal(err)
	}
	view, err := held.View()
	if err != nil || view.Task != task || view.Principal != principal {
		t.Fatalf("wrong actual source %+v %v", view, err)
	}
	view.Task.Holder = "forged"
	again, _ := held.View()
	if again.Task.Holder != task.Holder {
		t.Fatal("snapshot view aliases source")
	}
	store.mu.Lock()
	err = held.Current()
	store.mu.Unlock()
	if err != nil {
		t.Fatalf("actual locked fence unusable %v", err)
	}
	if _, err = source.CaptureConversation(context.Background(), principal, c.ID); err != nil {
		t.Fatal(err)
	}
	foreign := principal
	foreign.Account = "foreign"
	if _, err = source.CaptureConversation(context.Background(), foreign, c.ID); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("foreign create ownership captured")
	}
	if _, err = source.Capture(context.Background(), TaskStoreCapture{Principal: foreign, TaskID: task.ID}); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("foreign task captured")
	}
	if _, err = store.HandoffTask(task.Account, task.ID, 1, 1, task.Holder, "holder-b"); err != nil {
		t.Fatal(err)
	}
	if !errors.Is(held.Current(), ErrTaskStoreSnapshotStale) {
		t.Fatal("old holder snapshot survived real persisted handoff")
	}
	if _, err = source.Capture(context.Background(), TaskStoreCapture{Principal: principal, TaskID: task.ID}); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("old holder captured new authority")
	}
}

func TestP08TaskStoreSourceFailedWriteRetireAndCancellation(t *testing.T) {
	store, c, _ := p08TaskStore(t)
	task, _ := store.CreateTask("tenant-a", c.ID, "holder-a")
	source, _ := NewTaskStoreSource(store)
	p := TaskStorePrincipal{Account: task.Account, DeviceID: task.Holder, SessionID: "PUBLIC Auth checked session"}
	ctx, cancel := context.WithCancel(context.Background())
	held, err := source.Capture(ctx, TaskStoreCapture{Principal: p, TaskID: task.ID})
	if err != nil {
		t.Fatal(err)
	}
	cancel()
	if !errors.Is(held.Current(), context.Canceled) {
		t.Fatal("cancelled capture stayed current")
	}
	held, err = source.Capture(context.Background(), TaskStoreCapture{Principal: p, TaskID: task.ID})
	if err != nil {
		t.Fatal(err)
	}
	oldPath := store.path
	store.path = filepath.Join(oldPath, "impossible.json")
	if _, err = store.HandoffTask(task.Account, task.ID, 1, 1, task.Holder, "holder-b"); err == nil {
		t.Fatal("failed write accepted")
	}
	store.path = oldPath
	if !errors.Is(held.Current(), ErrTaskStoreSnapshotStale) {
		t.Fatal("failed write retained held qualification")
	}
	fresh, err := source.Capture(context.Background(), TaskStoreCapture{Principal: p, TaskID: task.ID})
	if err != nil {
		t.Fatal(err)
	}
	source.Retire()
	if !errors.Is(fresh.Current(), ErrTaskStoreSnapshotStale) {
		t.Fatal("retire retained capture")
	}
	if _, err = source.Capture(context.Background(), TaskStoreCapture{Principal: p, TaskID: task.ID}); !errors.Is(err, ErrTaskStoreSnapshotStale) {
		t.Fatal("retired source reopened")
	}
	if err = source.Close(); err != nil {
		t.Fatal(err)
	}
	var absent *TaskStoreSnapshot
	if !errors.Is(absent.Current(), ErrTaskStoreSnapshotStale) {
		t.Fatal("zero snapshot current")
	}
}

func TestP08TaskStoreSnapshotReleaseIsLocal(t *testing.T) {
	store, c, _ := p08TaskStore(t)
	task, _ := store.CreateTask("tenant-a", c.ID, "holder-a")
	source, _ := NewTaskStoreSource(store)
	defer source.Close()
	input := TaskStoreCapture{Principal: TaskStorePrincipal{Account: task.Account, DeviceID: task.Holder, SessionID: "PUBLIC session operand"}, TaskID: task.ID}
	first, err := source.Capture(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	second, err := source.Capture(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if err = first.Close(); err != nil {
		t.Fatal(err)
	}
	if !errors.Is(first.Current(), ErrTaskStoreSnapshotStale) {
		t.Fatal("released snapshot current")
	}
	if err = second.Current(); err != nil {
		t.Fatal("release retired unrelated capture")
	}
}
