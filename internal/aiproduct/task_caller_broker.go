package aiproduct

import (
	"context"
	"errors"
	"net/http"
	"time"

	link "github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	originalclient "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-history-client/go"
)

// Original Auth owns capture, canonical DATA, the genuine handler and typed
// result verification. This adapter only composes its opaque lease with LINK.
type taskIPCBrokerClient struct {
	client          originalTaskBrokerClient
	broker          taskCallerTypedBroker
	endpoint        *taskCallerEndpoint
	effectAvailable bool
}

type taskCallerCallLease interface {
	RequestDATA() (string, []byte, error)
	Wait(context.Context) (originalclient.TaskAuthorityResult, error)
	Close() error
}
type taskCallerTypedBroker interface {
	http.Handler
	ReadRegistration(context.Context) (originalclient.OriginalLocalCallerRegistration, error)
	Capture(context.Context, originalclient.TaskAuthorityCall) (taskCallerCallLease, error)
}

// Production uses only this adapter around the original concrete Auth owner.
// The private interface supports PUBLIC consumer controls without exporting a
// Source/handler setter or adding a test constructor to the shared Auth module.
type originalTaskCallerTypedBroker struct {
	owner *originalclient.OriginalTaskAuthorityBroker
}

func (b *originalTaskCallerTypedBroker) ReadRegistration(ctx context.Context) (originalclient.OriginalLocalCallerRegistration, error) {
	return b.owner.ReadRegistration(ctx)
}
func (b *originalTaskCallerTypedBroker) Capture(ctx context.Context, call originalclient.TaskAuthorityCall) (taskCallerCallLease, error) {
	lease, err := b.owner.Capture(ctx, call)
	if lease == nil {
		return nil, err
	}
	return lease, err
}
func (b *originalTaskCallerTypedBroker) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	b.owner.ServeHTTP(w, r)
}

func taskCallerRegistration(r originalclient.OriginalLocalCallerRegistration) (taskCallerEndpointRegistration, bool, error) {
	registration := taskCallerEndpointRegistration{service: r.LocalService, callerUID: r.PeerUID, callerPID: r.PeerPID}
	seen := map[string]bool{}
	for _, action := range r.Actions {
		if seen[action] || (action != "effect" && action != "query") {
			return registration, false, errToolConflict
		}
		seen[action] = true
		route := r.Query
		if action == "effect" {
			route = r.Effect
		}
		if route.Method != http.MethodPost || route.ContentType != "application/json" || route.Path == "" || route.MaxBodyBytes < 1 || route.MaxBodyBytes > 1<<20 {
			return registration, false, errToolConflict
		}
		registration.routes = append(registration.routes, link.LocalCallerRoute{Method: route.Method, Path: route.Path, MaxBodyBytes: route.MaxBodyBytes, Timeout: 30 * time.Second})
	}
	// Do not start new effects with no registered original recovery route.
	if !seen["query"] {
		return registration, false, errTaskEffectSourceUnavailable
	}
	return registration, seen["effect"], nil
}

func (c *taskIPCBrokerClient) Current(ctx context.Context) error {
	if c == nil || missingTaskRuntimeOperand(c.client) || missingTaskRuntimeOperand(c.broker) || c.endpoint == nil {
		return errTaskEffectSourceUnavailable
	}
	if err := c.client.Current(ctx); err != nil {
		return err
	}
	if _, err := c.broker.ReadRegistration(ctx); err != nil {
		return err
	}
	return c.endpoint.Current(ctx)
}
func (c *taskIPCBrokerClient) NewEffectsCurrent(ctx context.Context) error {
	if err := c.Current(ctx); err != nil {
		return err
	}
	if !c.effectAvailable {
		return errTaskEffectSourceUnavailable
	}
	return nil
}
func (c *taskIPCBrokerClient) AuthorizeAtEffect(ctx context.Context, call originalclient.TaskAuthorityCall) (originalclient.TaskAuthorityResult, error) {
	if call.OriginalOperation != "" {
		return originalclient.TaskAuthorityResult{}, errToolConflict
	}
	if err := c.NewEffectsCurrent(ctx); err != nil {
		return originalclient.TaskAuthorityResult{}, err
	}
	return c.exchange(ctx, call)
}
func (c *taskIPCBrokerClient) QueryOriginalEffect(ctx context.Context, call originalclient.TaskAuthorityCall) (originalclient.TaskAuthorityResult, error) {
	if call.OriginalOperation == "" {
		return originalclient.TaskAuthorityResult{}, errToolConflict
	}
	if err := c.Current(ctx); err != nil {
		return originalclient.TaskAuthorityResult{}, err
	}
	return c.exchange(ctx, call)
}
func (c *taskIPCBrokerClient) exchange(ctx context.Context, call originalclient.TaskAuthorityCall) (result originalclient.TaskAuthorityResult, err error) {
	lease, err := c.broker.Capture(ctx, call)
	if lease != nil {
		defer func() { err = errors.Join(err, lease.Close()) }()
	}
	if err != nil {
		return result, err
	}
	if lease == nil {
		return result, errTaskEffectSourceUnavailable
	}
	path, body, err := lease.RequestDATA()
	if err != nil {
		return result, err
	}
	response, transportErr := c.endpoint.Call(ctx, http.MethodPost, path, "application/json", body)
	var acknowledgementErr error
	if transportErr == nil && (response.StatusCode != http.StatusNoContent || len(response.Body) != 0) {
		acknowledgementErr = errors.New("AI_TASK_CALLER_ACKNOWLEDGEMENT_REJECTED")
	}
	var cancelErr error
	if transportErr != nil || acknowledgementErr != nil {
		cancelErr = lease.Close()
	}
	// A 204 is not a receipt. Read only the original opaque lease's published
	// typed result, whose verification happened inside the actual OS handler.
	// On transport error cancellation does not extend caller lifetime or retry.
	waitCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	result, waitErr := lease.Wait(waitCtx)
	if transportErr != nil {
		err = errors.Join(transportErr, waitErr, acknowledgementErr, cancelErr, ctx.Err())
	} else {
		// An original handler failure precedes its HTTP failure status. Keep
		// that Source cause first, rather than replacing it with an ack error.
		err = errors.Join(waitErr, acknowledgementErr, cancelErr, ctx.Err())
	}
	return result, err
}

var _ originalTaskBrokerClient = (*taskIPCBrokerClient)(nil)
