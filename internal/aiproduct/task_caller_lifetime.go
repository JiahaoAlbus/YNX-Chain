package aiproduct

import (
	"context"
	"errors"
	"sync"

	originalclient "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-history-client/go"
)

var errTaskCallerRetired = errors.New("AI_TASK_CALLER_RETIRED")
var errTaskCallerNotRetired = errors.New("AI_TASK_CALLER_RETIRE_BEFORE_JOIN")

// Tracks this product's actual IPC calls. It creates cancellation contexts,
// never a LocalCaller capability; the original LINK listener/handler alone
// creates that capability. The underlying normal adapter must use that route.
type taskCallerLifetime struct {
	client      originalTaskBrokerClient
	mu          sync.Mutex
	retired     bool
	active      map[*taskCallerLease]struct{}
	drained     chan struct{}
	drainClosed bool
}
type taskCallerLease struct{ cancel context.CancelFunc }

func newTaskCallerLifetime(client originalTaskBrokerClient) (*taskCallerLifetime, error) {
	if missingTaskRuntimeOperand(client) {
		return nil, errTaskEffectSourceUnavailable
	}
	return &taskCallerLifetime{client: client, active: map[*taskCallerLease]struct{}{}, drained: make(chan struct{})}, nil
}

func (c *taskCallerLifetime) enter(ctx context.Context) (context.Context, *taskCallerLease, error) {
	if c == nil || ctx == nil || missingTaskRuntimeOperand(c.client) {
		return nil, nil, errTaskEffectSourceUnavailable
	}
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.retired {
		return nil, nil, errTaskCallerRetired
	}
	callCtx, cancel := context.WithCancel(ctx)
	lease := &taskCallerLease{cancel: cancel}
	c.active[lease] = struct{}{}
	return callCtx, lease, nil
}

func (c *taskCallerLifetime) finish(ctx context.Context, lease *taskCallerLease, err error) error {
	c.mu.Lock()
	if c.retired {
		err = errors.Join(err, errTaskCallerRetired)
	}
	err = errors.Join(err, ctx.Err())
	delete(c.active, lease)
	c.finishDrainLocked()
	c.mu.Unlock()
	lease.cancel()
	return err
}
func (c *taskCallerLifetime) finishDrainLocked() {
	if c.retired && len(c.active) == 0 && !c.drainClosed && c.drained != nil {
		c.drainClosed = true
		close(c.drained)
	}
}

func (c *taskCallerLifetime) Current(ctx context.Context) (err error) {
	callCtx, lease, err := c.enter(ctx)
	if err != nil {
		return err
	}
	defer func() { err = c.finish(callCtx, lease, err) }()
	return c.client.Current(callCtx)
}
func (c *taskCallerLifetime) NewEffectsCurrent(ctx context.Context) (err error) {
	callCtx, lease, err := c.enter(ctx)
	if err != nil {
		return err
	}
	defer func() { err = c.finish(callCtx, lease, err) }()
	if client, ok := c.client.(interface{ NewEffectsCurrent(context.Context) error }); ok {
		return client.NewEffectsCurrent(callCtx)
	}
	return c.client.Current(callCtx)
}
func (c *taskCallerLifetime) AuthorizeAtEffect(ctx context.Context, call originalclient.TaskAuthorityCall) (originalclient.TaskAuthorityResult, error) {
	return c.exchange(ctx, call, false)
}
func (c *taskCallerLifetime) QueryOriginalEffect(ctx context.Context, call originalclient.TaskAuthorityCall) (originalclient.TaskAuthorityResult, error) {
	return c.exchange(ctx, call, true)
}
func (c *taskCallerLifetime) exchange(ctx context.Context, call originalclient.TaskAuthorityCall, query bool) (result originalclient.TaskAuthorityResult, err error) {
	callCtx, lease, err := c.enter(ctx)
	if err != nil {
		return originalclient.TaskAuthorityResult{}, err
	}
	defer func() { err = c.finish(callCtx, lease, err) }()
	if query {
		result, err = c.client.QueryOriginalEffect(callCtx, call)
	} else {
		result, err = c.client.AuthorizeAtEffect(callCtx, call)
	}
	// Preserve original partial operation/result DATA alongside a late error.
	// The existing broker records recovery metadata and cannot accept a receipt
	// while this error is nonnil. No retry or replacement operation is issued.
	return result, err
}

func (c *taskCallerLifetime) Retire() error {
	if c == nil {
		return nil
	}
	c.mu.Lock()
	c.retired = true
	cancels := make([]context.CancelFunc, 0, len(c.active))
	for lease := range c.active {
		cancels = append(cancels, lease.cancel)
	}
	c.finishDrainLocked()
	c.mu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
	return nil
}
func (c *taskCallerLifetime) Join(ctx context.Context) error {
	if c == nil || ctx == nil || c.drained == nil {
		return errTaskEffectSourceUnavailable
	}
	c.mu.Lock()
	retired := c.retired
	drained := c.drained
	c.mu.Unlock()
	if !retired {
		return errTaskCallerNotRetired
	}
	select {
	case <-drained:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

var _ originalTaskBrokerClient = (*taskCallerLifetime)(nil)
