package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"testing"
)

// Isolated original Source stand-in calls the REAL Store resource handler.
// Production has no setter or admitted Source and must remain unavailable.
type p08EffectFixture struct {
	store               *Store
	expected            taskReadExpectation
	dispatches, queries int
	mode                string
}

func (f *p08EffectFixture) dispatchTaskTool(ctx context.Context, call taskEffectCall, ref string) (taskReadReceipt, error) {
	f.dispatches++
	if ref != "isolated-approved-reference" || call.OriginalOperationID != f.expected.StepID {
		return taskReadReceipt{}, errors.New("fixture authority denied")
	}
	if f.mode == "unknown" {
		return taskReadReceipt{}, errors.New("isolated response lost")
	}
	result, err := f.store.commitTaskReadAtEffectFence(ctx, f.expected, func() error { return nil })
	if f.mode == "lost-after-commit" {
		return taskReadReceipt{}, errors.New("isolated committed response lost")
	}
	return result, err
}
func (f *p08EffectFixture) reconcileTaskTool(_ context.Context, call taskEffectCall, _ string) (taskReadReceipt, error) {
	f.queries++
	if call.OriginalOperationID != f.expected.StepID {
		return taskReadReceipt{}, errors.New("changed original operation")
	}
	f.store.mu.Lock()
	defer f.store.mu.Unlock()
	return f.store.taskReadReceiptLocked(f.store.state.Actions[call.OriginalOperationID])
}

func TestP08DispatchAndOriginalReconcile(t *testing.T) {
	for _, mode := range []string{"success", "unknown", "lost-after-commit"} {
		t.Run(mode, func(t *testing.T) {
			store, expected, _ := taskReadFixture(t)
			source := &p08EffectFixture{store: store, expected: expected, mode: mode}
			server := &Server{store: store, toolEffects: source}
			session := ProductSession{Account: expected.Account, DeviceID: expected.Holder}
			receipt, err := server.dispatchApprovedStep(context.Background(), session, expected.TaskID, expected.StepID, "isolated-approved-reference")
			if mode == "success" {
				if err != nil || receipt.State != "COMMITTED" {
					t.Fatalf("actual handler dispatch failed: %+v %v", receipt, err)
				}
			} else if err == nil {
				t.Fatal("lost result reported success")
			}
			if _, err := server.dispatchApprovedStep(context.Background(), session, expected.TaskID, expected.StepID, "isolated-approved-reference"); err == nil {
				t.Fatal("operation redispatched")
			}
			recovered, err := server.reconcileStep(context.Background(), session, expected.TaskID, expected.StepID, "isolated-approved-reference")
			if mode == "unknown" {
				if err == nil || source.queries != 1 {
					t.Fatalf("UNKNOWN not queried as original: %v queries=%d", err, source.queries)
				}
			} else if err != nil || recovered.EffectRef != expected.StepID || recovered.State != "COMMITTED" {
				t.Fatalf("original result not recovered: %+v %v", recovered, err)
			}
			if source.dispatches != 1 {
				t.Fatalf("reconcile reran effect: %d", source.dispatches)
			}
			record, _ := store.Action(expected.Account, expected.StepID)
			if mode != "success" && record.ToolStep.EffectFirstCause == "" {
				t.Fatal("first cause lost")
			}
		})
	}
}

func TestP08DispatchFailsClosedWithoutSource(t *testing.T) {
	store, expected, _ := taskReadFixture(t)
	server := &Server{store: store}
	session := ProductSession{Account: expected.Account, DeviceID: expected.Holder}
	if _, err := server.dispatchApprovedStep(context.Background(), session, expected.TaskID, expected.StepID, "ordinary-session-is-not-grant"); !errors.Is(err, errTaskEffectSourceUnavailable) {
		t.Fatalf("unadmitted source executed: %v", err)
	}
	if record, _ := store.Action(expected.Account, expected.StepID); record.Status != "approved_not_executed" || record.ToolStep.RemoteOperationID != "" {
		t.Fatal("unavailable source consumed operation")
	}
}

type p08DeletingSource struct {
	store *Store
	mode  string
	after []byte
	calls int
}

func (f *p08DeletingSource) dispatchTaskTool(_ context.Context, call taskEffectCall, _ string) (taskReadReceipt, error) {
	f.calls++
	if f.mode == "account" {
		if err := f.store.DeleteAccount(call.Account); err != nil {
			return taskReadReceipt{}, err
		}
	} else {
		f.store.mu.Lock()
		if f.mode == "step" {
			delete(f.store.state.Actions, call.OriginalStep.ID)
		} else {
			delete(f.store.state.Tasks, call.CurrentTask.ID)
		}
		err := f.store.saveLocked()
		f.store.mu.Unlock()
		if err != nil {
			return taskReadReceipt{}, err
		}
	}
	f.after, _ = json.Marshal(f.store.state)
	return taskReadReceipt{}, errors.New("isolated state deleted while Source was pending")
}

func (f *p08DeletingSource) reconcileTaskTool(context.Context, taskEffectCall, string) (taskReadReceipt, error) {
	return taskReadReceipt{}, errors.New("deleted state must not be dispatched again")
}

func TestP08DispatchRejectsDeletedState(t *testing.T) {
	for _, mode := range []string{"account", "task", "step"} {
		t.Run(mode, func(t *testing.T) {
			store, expected, _ := taskReadFixture(t)
			source := &p08DeletingSource{store: store, mode: mode}
			server := &Server{store: store, toolEffects: source}
			receipt, err := server.dispatchApprovedStep(context.Background(), ProductSession{Account: expected.Account, DeviceID: expected.Holder}, expected.TaskID, expected.StepID, "isolated-original-reference")
			if !errors.Is(err, errToolNotFound) || receipt.EffectRef != "" || len(receipt.Result) != 0 || source.calls != 1 {
				t.Fatalf("deleted state accepted: %+v %v calls=%d", receipt, err, source.calls)
			}
			after, _ := json.Marshal(store.state)
			if !bytes.Equal(after, source.after) {
				t.Fatal("late Source completion recreated or changed deleted state")
			}
		})
	}
}
