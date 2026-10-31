//go:build darwin || linux

package commerce

import (
	"context"
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	link "github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	originalclient "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-history-client/go"
)

type shopTaskCallLease interface {
	RequestDATA() (string, []byte, error)
	Wait(context.Context) (originalclient.TaskAuthorityResult, error)
	Close() error
}
type shopTaskTypedBroker interface {
	http.Handler
	ReadRegistration(context.Context) (originalclient.OriginalLocalCallerRegistration, error)
	Capture(context.Context, originalclient.TaskAuthorityCall) (shopTaskCallLease, error)
	Retire() error
	Close() error
}
type originalShopTypedBroker struct {
	owner *originalclient.OriginalTaskAuthorityBroker
}

func (b *originalShopTypedBroker) ReadRegistration(ctx context.Context) (originalclient.OriginalLocalCallerRegistration, error) {
	return b.owner.ReadRegistration(ctx)
}
func (b *originalShopTypedBroker) Capture(ctx context.Context, c originalclient.TaskAuthorityCall) (shopTaskCallLease, error) {
	l, err := b.owner.Capture(ctx, c)
	if l == nil {
		return nil, err
	}
	return l, err
}
func (b *originalShopTypedBroker) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	b.owner.ServeHTTP(w, r)
}
func (b *originalShopTypedBroker) Retire() error { return b.owner.Retire() }
func (b *originalShopTypedBroker) Close() error  { return b.owner.Close() }

// This endpoint owns only a newly created socket directory. Deployment chooses
// its filesystem location, never a caller identity/Source/role. Actual UID/PID
// and routes must match Auth's current protected registration before binding.
type shopTaskCallerEndpoint struct {
	server     *link.LocalCallerServer
	client     *link.LocalCallerClient
	listener   net.Listener
	directory  string
	mu         sync.Mutex
	retired    bool
	started    bool
	done       chan struct{}
	serveErr   error
	retireOnce sync.Once
	retireErr  error
}

func shopTaskCallerRoutes(r originalclient.OriginalLocalCallerRegistration) ([]link.LocalCallerRoute, bool, error) {
	if r.LocalService == "" || r.PeerUID == 0 || r.PeerUID != uint32(os.Geteuid()) || r.PeerPID != os.Getpid() {
		return nil, false, link.ErrDenied
	}
	seen := map[string]bool{}
	var routes []link.LocalCallerRoute
	for _, action := range r.Actions {
		if seen[action] || action != "effect" && action != "query" {
			return nil, false, ErrConflict
		}
		seen[action] = true
		route := r.Query
		if action == "effect" {
			route = r.Effect
		}
		if route.Method != http.MethodPost || route.ContentType != "application/json" || route.Path == "" || route.MaxBodyBytes < 1 || route.MaxBodyBytes > maxBody {
			return nil, false, ErrConflict
		}
		routes = append(routes, link.LocalCallerRoute{Method: route.Method, Path: route.Path, MaxBodyBytes: route.MaxBodyBytes, Timeout: 30 * time.Second})
	}
	if !seen["query"] {
		return nil, false, ErrUnavailable
	}
	return routes, seen["effect"], nil
}

func openShopTaskCallerEndpoint(ctx context.Context, parent string, r originalclient.OriginalLocalCallerRegistration, handler http.Handler) (*shopTaskCallerEndpoint, bool, error) {
	e := &shopTaskCallerEndpoint{done: make(chan struct{})}
	if ctx == nil || handler == nil || !filepath.IsAbs(parent) {
		return e, false, ErrUnavailable
	}
	if err := ctx.Err(); err != nil {
		return e, false, err
	}
	routes, effect, err := shopTaskCallerRoutes(r)
	if err != nil {
		return e, false, err
	}
	e.server, err = link.NewLocalCallerServer(link.LocalCallerServerConfig{Service: r.LocalService, PeerUID: r.PeerUID, PeerPID: r.PeerPID, Routes: routes, Handler: handler})
	if err != nil {
		return e, false, err
	}
	e.directory, err = os.MkdirTemp(parent, "sc-")
	if err != nil {
		return e, false, err
	}
	socket := filepath.Join(e.directory, "s.sock")
	// Never fall back to the internal disk or another operator's socket when
	// Darwin's Unix path bound is exceeded. Host supplies a short external path.
	if len([]byte(socket)) > 100 {
		return e, false, ErrInvalidState
	}
	e.listener, err = link.ListenPrivate(socket, r.PeerUID)
	if err != nil {
		return e, false, err
	}
	e.client, err = link.NewLocalCallerClient(link.LocalCallerClientConfig{SocketPath: socket, Service: r.LocalService, PeerUID: r.PeerUID, PeerPID: r.PeerPID, Routes: routes, Timeout: 30 * time.Second, MaxResponseBytes: maxBody})
	if err != nil {
		return e, false, err
	}
	if err := ctx.Err(); err != nil {
		return e, false, err
	}
	e.started = true
	go func() {
		err := e.server.Serve(e.listener)
		e.mu.Lock()
		if errors.Is(err, http.ErrServerClosed) || errors.Is(err, net.ErrClosed) || e.retired && errors.Is(err, link.ErrDenied) {
			err = nil
		}
		e.serveErr = err
		e.mu.Unlock()
		close(e.done)
	}()
	return e, effect, nil
}

func (e *shopTaskCallerEndpoint) Current(ctx context.Context) error {
	if e == nil || ctx == nil || e.client == nil {
		return ErrUnavailable
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.retired {
		return ErrUnavailable
	}
	select {
	case <-e.done:
		return errors.Join(ErrUnavailable, e.serveErr)
	default:
		return nil
	}
}
func (e *shopTaskCallerEndpoint) Retire() error {
	if e == nil {
		return nil
	}
	e.retireOnce.Do(func() {
		e.mu.Lock()
		e.retired = true
		e.mu.Unlock()
		if e.server != nil {
			e.retireErr = errors.Join(e.retireErr, e.server.Retire())
		}
		if e.listener != nil {
			if err := e.listener.Close(); !errors.Is(err, net.ErrClosed) {
				e.retireErr = errors.Join(e.retireErr, err)
			}
		}
	})
	return e.retireErr
}
func (e *shopTaskCallerEndpoint) Join(ctx context.Context) error {
	if e == nil {
		return nil
	}
	if ctx == nil {
		return ErrUnavailable
	}
	e.mu.Lock()
	retired, started := e.retired, e.started
	e.mu.Unlock()
	if !retired {
		return ErrConflict
	}
	if e.server != nil {
		if err := e.server.Join(ctx); err != nil {
			return err
		}
	}
	if started {
		select {
		case <-e.done:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	return errors.Join(e.retireErr, e.serveErr)
}

func (c *OriginalShopTaskOrderConsumer) exchange(ctx context.Context, call originalclient.TaskAuthorityCall) (result originalclient.TaskAuthorityResult, err error) {
	lease, err := c.broker.Capture(ctx, call)
	if lease != nil {
		defer func() { err = errors.Join(err, lease.Close()) }()
	}
	if err != nil || lease == nil {
		return result, errors.Join(err, ErrUnavailable)
	}
	path, body, err := lease.RequestDATA()
	if err != nil {
		return result, err
	}
	response, transportErr := c.endpoint.client.Call(ctx, http.MethodPost, path, "application/json", body)
	var acknowledgementErr, closeErr error
	if transportErr == nil && (response.StatusCode != http.StatusNoContent || len(response.Body) != 0) {
		acknowledgementErr = ErrConflict
	}
	if transportErr != nil || acknowledgementErr != nil {
		closeErr = lease.Close()
	}
	waitCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	result, waitErr := lease.Wait(waitCtx)
	// A LINK acknowledgement is not a receipt. Only the original opaque lease
	// publishes the actual formal whole-verified typed result, inside handlerCtx.
	if transportErr != nil {
		return result, errors.Join(transportErr, waitErr, acknowledgementErr, closeErr, ctx.Err())
	}
	return result, errors.Join(waitErr, acknowledgementErr, closeErr, ctx.Err())
}
