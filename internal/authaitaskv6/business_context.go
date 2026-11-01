package aitaskactionsource

import (
	"context"
	"net/http"
	"sync/atomic"
	"time"
)

// A genuine derived cancellation context, never WithoutCancel or a fabricated
// background lease. Product Snapshot.Current calls Err INSIDE its own CAS, so
// the actual private LINK observed-lifecycle getter is ANDed there without IO,
// P08 Store locks, an HTTP-current RPC or a Node cross-process atomic claim.
// Node Root/identity and SQLite remain independently checked pre/post exchange.
type originalTaskRuntimeContext struct {
	context context.Context
	cancel  context.CancelFunc
	request *http.Request
	loan    originalTaskRuntimeLoan
	first   atomic.Pointer[taskStateFailure]
}

func newOriginalTaskRuntimeContext(r *http.Request, loan originalTaskRuntimeLoan) *originalTaskRuntimeContext {
	if r == nil || loan == nil {
		return nil
	}
	ctx, cancel := context.WithCancel(r.Context())
	return &originalTaskRuntimeContext{context: ctx, cancel: cancel, request: r, loan: loan}
}
func newOriginalTaskRuntimeContextFrom(base context.Context, r *http.Request, loan originalTaskRuntimeLoan) *originalTaskRuntimeContext {
	if base == nil || r == nil || loan == nil {
		return nil
	}
	ctx, cancel := context.WithCancel(base)
	return &originalTaskRuntimeContext{context: ctx, cancel: cancel, request: r, loan: loan}
}
func (c *originalTaskRuntimeContext) Deadline() (time.Time, bool) { return c.context.Deadline() }
func (c *originalTaskRuntimeContext) Done() <-chan struct{}       { return c.context.Done() }
func (c *originalTaskRuntimeContext) Value(k any) any             { return c.context.Value(k) }
func (c *originalTaskRuntimeContext) Err() error {
	if err := c.context.Err(); err != nil {
		return err
	}
	if err := c.loan.currentOriginalRequest(c.request); err != nil {
		c.first.CompareAndSwap(nil, &taskStateFailure{cause: err})
		c.cancel()
		return c.context.Err()
	}
	return nil
}
func (c *originalTaskRuntimeContext) cause() error {
	if f := c.first.Load(); f != nil {
		return f.cause
	}
	return c.context.Err()
}
