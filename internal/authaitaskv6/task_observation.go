package aitaskactionsource

import (
	"context"
	"encoding/json"
	"strconv"
	"sync"
	"sync/atomic"

	"github.com/JiahaoAlbus/YNX-Chain/internal/aiproduct"
)

// This is the real product's immutable observation, not an HTTP-200 classifier.
// ProductSession must originate in independent Auth session/current admission;
// this DATA adapter neither constructs that authority nor grants write access.
type HeldOriginalObservation struct {
	parent             *OriginalTaskStateReader
	original           *aiproduct.TaskStoreObservation
	action, requestRef string
	released           atomic.Bool
	first              atomic.Pointer[taskStateFailure]
	closeOnce          sync.Once
	closeErr           error
}
type OriginalObservationDATA struct {
	State, Action, CompletionScope, RequestRef, BodyDigest, BodyBytes string
	Status                                                            int
	BusinessReceiptOriginal, BodyOriginal                             []byte
}

func (o *HeldOriginalObservation) remember(err error) error {
	if err == nil {
		return nil
	}
	o.first.CompareAndSwap(nil, &taskStateFailure{cause: err})
	return o.first.Load().cause
}
func (r *OriginalTaskStateReader) ObserveOriginalDATA(ctx context.Context, session aiproduct.ProductSession, call OriginalLocalActionDATA) (out *HeldOriginalObservation, err error) {
	out = &HeldOriginalObservation{parent: r, action: call.Action, requestRef: call.RequestRef}
	if r != nil {
		r.children.Add(1)
	}
	defer func() {
		if err != nil {
			out.remember(err)
		}
	}()
	if ctx == nil || r == nil || r.retired.Load() || r.original == nil || r.server == nil {
		return out, ErrOriginalOutcomeUnavailable
	}
	if err = ctx.Err(); err != nil {
		return out, err
	}
	c := aiproduct.TaskActionCall{OriginalOperationID: call.OperationID, RequestRef: call.RequestRef, RequestDigest: call.RequestDigest, BodyDigest: call.BodyDigest, Action: call.Action, Method: call.Method, Path: call.Path, Body: append([]byte(nil), call.Body...)}
	switch call.Action {
	case "task.list", "task.read", "task.step-result", "task.run-read":
		out.original, err = r.original.ObserveOriginalTaskRead(ctx, r.server, session, c)
	case "task.reconcile":
		out.original, err = r.original.ObserveOriginalTaskQuery(ctx, r.server, session, c)
	default:
		return out, ErrOriginalOutcomeUnavailable
	}
	// Adopt the opaque owner before checking an error, including late-current.
	if err != nil {
		return out, err
	}
	if err = out.Current(); err != nil {
		return out, err
	}
	return out, nil
}
func (o *HeldOriginalObservation) Current() error {
	if o == nil {
		return ErrOriginalOutcomeUnavailable
	}
	if f := o.first.Load(); f != nil {
		return f.cause
	}
	if o.released.Load() || o.parent == nil || o.parent.retired.Load() || o.original == nil {
		return o.remember(ErrOriginalOutcomeUnavailable)
	}
	return o.remember(o.original.Current())
}
func (o *HeldOriginalObservation) ReadOriginalObservationDATA() (out OriginalObservationDATA, err error) {
	if err = o.Current(); err != nil {
		return out, err
	}
	v, e := o.original.View()
	if e != nil {
		return out, o.remember(e)
	}
	b, e := o.original.Body()
	if e != nil {
		return out, o.remember(e)
	}
	if v.Decision != "OBSERVED" || v.Scope != "READ_ONLY_OBSERVATION" {
		return out, o.remember(ErrOriginalOutcomeUnavailable)
	}
	raw, e := json.Marshal(v)
	if e != nil {
		return out, o.remember(e)
	}
	out = OriginalObservationDATA{State: v.Decision, Action: o.action, CompletionScope: v.Scope, RequestRef: o.requestRef, BodyDigest: v.BodyDigest, BodyBytes: strconv.FormatUint(v.BodyBytes, 10), Status: v.Status, BusinessReceiptOriginal: raw, BodyOriginal: b}
	if err = o.Current(); err != nil {
		return OriginalObservationDATA{}, err
	}
	return out, nil
}
func (o *HeldOriginalObservation) Close() error {
	if o == nil {
		return nil
	}
	o.closeOnce.Do(func() {
		o.released.Store(true)
		if o.parent != nil {
			defer o.parent.children.Add(-1)
		}
		if o.original != nil {
			o.closeErr = o.original.Close()
		}
	})
	return o.closeErr
}
