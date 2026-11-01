package aitaskactionsource

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"

	"github.com/JiahaoAlbus/YNX-Chain/internal/aiproduct"
)

var ErrTaskStateUnavailable = errors.New("AI_TASK_V6_ORIGINAL_TASK_STATE_NOT_SUPPLIED")
var ErrTaskStateMismatch = errors.New("AI_TASK_V6_ORIGINAL_TASK_STATE_MISMATCH")

// SDK-parsed DATA, not a signature/Root/session/ToolGrant constructor. The
// normal Source must independently AND its authenticated registered principal
// and policy/current with this concrete original P08 Store snapshot.
type TaskBindingDATA struct {
	Action, TaskID, StepID, RunID, Holder, ConversationID string
	Revision, Generation                                  uint64
}
type OriginalTaskStateReader struct {
	original  *aiproduct.TaskStoreSource
	server    *aiproduct.Server
	retired   atomic.Bool
	children  atomic.Int64
	closeOnce sync.Once
	closeErr  error
}
type HeldTaskStateDATA struct {
	parent        *OriginalTaskStateReader
	snapshot      *aiproduct.TaskStoreSnapshot
	released      atomic.Bool
	first         atomic.Pointer[taskStateFailure]
	effectEntered atomic.Bool
	closeOnce     sync.Once
	closeErr      error
}
type taskStateFailure struct{ cause error }

func (h *HeldTaskStateDATA) remember(e error) error {
	if e == nil {
		return nil
	}
	h.first.CompareAndSwap(nil, &taskStateFailure{cause: e})
	return h.first.Load().cause
}

func NewOriginalTaskStateReader(store *aiproduct.Store) (*OriginalTaskStateReader, error) {
	source, e := aiproduct.NewTaskStoreSource(store)
	out := &OriginalTaskStateReader{original: source}
	return out, e
}

// Normal process composition supplies the original Server, not an execution
// callback. Its entry also cancels the actual in-flight model on cancel/complete.
// The caller must retain Server/Store until all reader children have closed.
func NewOriginalTaskStateReaderForServer(server *aiproduct.Server, store *aiproduct.Store) (*OriginalTaskStateReader, error) {
	r, err := NewOriginalTaskStateReader(store)
	if r != nil {
		r.server = server
	}
	if err == nil && server == nil {
		err = ErrTaskStateUnavailable
	}
	return r, err
}

// Normal Server-only resource acquisition: the actual P08 getter closes the
// Server/Store association; no caller-selected path, Store or callback exists.
func NewOriginalTaskStateReaderFromServer(server *aiproduct.Server) (*OriginalTaskStateReader, error) {
	r := &OriginalTaskStateReader{server: server}
	if server == nil {
		return r, ErrTaskStateUnavailable
	}
	var err error
	r.original, err = server.OpenTaskStoreSource()
	return r, err
}
func (r *OriginalTaskStateReader) CaptureDATA(ctx context.Context, principal aiproduct.TaskStorePrincipal, binding TaskBindingDATA) (result *HeldTaskStateDATA, resultErr error) {
	out := &HeldTaskStateDATA{parent: r}
	if r != nil {
		r.children.Add(1)
	}
	defer func() {
		if resultErr != nil {
			out.remember(resultErr)
		}
	}()
	if r == nil || r.retired.Load() || r.original == nil || ctx == nil || principal.Account == "" || principal.DeviceID == "" || principal.SessionID == "" {
		return out, ErrTaskStateUnavailable
	}
	if e := ctx.Err(); e != nil {
		return out, e
	}
	var s *aiproduct.TaskStoreSnapshot
	var e error
	switch binding.Action {
	case "task.create":
		if binding.TaskID != "" || binding.Revision != 0 || binding.Generation != 0 || binding.ConversationID == "" || binding.Holder != principal.DeviceID || binding.StepID != "" || binding.RunID != "" {
			return out, ErrTaskStateMismatch
		}
		s, e = r.original.CaptureConversation(ctx, principal, binding.ConversationID)
	case "task.prepare", "task.approve", "task.cancel", "task.dispatch", "task.reconcile", "task.read", "task.step-result", "task.run-start", "task.run-resume", "task.run-read", "task.propose-tool-step", "task.complete":
		if binding.TaskID == "" || binding.Revision == 0 || binding.Generation == 0 || binding.Holder == "" {
			return out, ErrTaskStateMismatch
		}
		run := binding.RunID
		if binding.Action == "task.run-start" {
			run = ""
		} // new run has no fabricated existing record
		s, e = r.original.Capture(ctx, aiproduct.TaskStoreCapture{Principal: principal, TaskID: binding.TaskID, StepID: binding.StepID, RunID: run})
	default:
		return out, ErrTaskStateUnavailable // list has no selected task; handoff remains UNREGISTERED
	}
	out.snapshot = s // adopt before any callee error/current check
	if e != nil {
		return out, e
	}
	if e = out.Current(); e != nil {
		return out, e
	}
	view, e := s.View()
	if e != nil {
		return out, e
	}
	if view.Principal != principal {
		return out, ErrTaskStateMismatch
	}
	if binding.Action == "task.create" {
		if view.ConversationID != binding.ConversationID {
			return out, ErrTaskStateMismatch
		}
	} else {
		if view.Task.ID != binding.TaskID || view.Task.Revision != binding.Revision || view.Task.Generation != binding.Generation || view.Task.Holder != binding.Holder {
			return out, ErrTaskStateMismatch
		}
		// Original-query can inspect an old operation's holder; only the actual
		// current holder may enter new task mutations. This grants no tool effect.
		switch binding.Action {
		case "task.reconcile", "task.read", "task.step-result", "task.run-read":
		default:
			if view.Task.Holder != principal.DeviceID {
				return out, ErrTaskStateMismatch
			}
		}
		if binding.StepID != "" && view.Operation.ID != binding.StepID {
			return out, ErrTaskStateMismatch
		}
	}
	if e = out.Current(); e != nil {
		return out, e
	}
	return out, nil
}

// Pure original atomic Current: no IO, lock acquisition or recapture. Can be
// ANDed with Auth's independent synchronous current at the real Task CAS.
func (h *HeldTaskStateDATA) Current() error {
	if h == nil {
		return ErrTaskStateUnavailable
	}
	if first := h.first.Load(); first != nil {
		return first.cause
	}
	if h.released.Load() || h.parent == nil || h.parent.retired.Load() || h.snapshot == nil {
		return h.remember(ErrTaskStateUnavailable)
	}
	return h.remember(h.snapshot.Current())
}
func (h *HeldTaskStateDATA) ViewDATA() (aiproduct.TaskStoreView, error) {
	if e := h.Current(); e != nil {
		return aiproduct.TaskStoreView{}, e
	}
	v, e := h.snapshot.View()
	if e != nil {
		return aiproduct.TaskStoreView{}, h.remember(e)
	}
	if e = h.Current(); e != nil {
		return aiproduct.TaskStoreView{}, e
	}
	return v, nil
}
func (h *HeldTaskStateDATA) Close() error {
	if h == nil {
		return nil
	}
	h.closeOnce.Do(func() {
		h.released.Store(true)
		if h.parent != nil {
			defer h.parent.children.Add(-1)
		}
		if h.snapshot != nil {
			h.closeErr = h.snapshot.Close()
		}
	})
	return h.closeErr
}
func (r *OriginalTaskStateReader) Retire() {
	if r != nil {
		r.retired.Store(true)
		if r.original != nil {
			r.original.Retire()
		}
	}
}
func (r *OriginalTaskStateReader) Close() error {
	if r == nil {
		return nil
	}
	r.closeOnce.Do(func() {
		r.Retire()
		if r.children.Load() != 0 {
			r.closeErr = errors.New("AI_TASK_V6_CHILDREN_RETAINED")
		} else if r.original != nil {
			r.closeErr = r.original.Close()
		}
	})
	return r.closeErr
}

// Borrowed actual Server/Store are never closed here. Caller closes them only
// after reader children drain; an initial close error remains the first result.
func (r *OriginalTaskStateReader) DrainPartial() error {
	if r == nil {
		return nil
	}
	r.Retire()
	if r.children.Load() != 0 {
		return errors.New("AI_TASK_V6_CHILDREN_RETAINED")
	}
	if r.original != nil {
		_ = r.original.Close()
	}
	return r.closeErr
}
