package aiproduct

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
)

// Detached original registration DATA, never an authorization decision. The
// normal composition reads it from Auth's protected selection; HTTP/model
// input has no path to this private constructor. Auth supplies the handler.
type taskCallerEndpointRegistration struct {
	service   string
	callerUID uint32
	callerPID int
	routes    []link.LocalCallerRoute
}

type taskCallerEndpoint struct {
	client            *link.LocalCallerClient
	server            *link.LocalCallerServer
	listener          net.Listener
	directory, socket string
	mu                sync.Mutex
	retired           bool
	started           bool
	serveErr          error
	serveDone         chan struct{}
	retireOnce        sync.Once
	retireErr         error
}

// This is a same-process normal host, not a launcher or an external-daemon
// fallback. Both real endpoints run in this process, so the original selected
// caller registration must match its actual OS identity before any socket opens.
func openTaskCallerEndpoint(ctx context.Context, registration taskCallerEndpointRegistration, handler http.Handler) (*taskCallerEndpoint, error) {
	e := &taskCallerEndpoint{serveDone: make(chan struct{})}
	if ctx == nil || handler == nil {
		return e, errTaskEffectSourceUnavailable
	}
	if err := ctx.Err(); err != nil {
		return e, err
	}
	if registration.callerUID == 0 || registration.callerUID != uint32(os.Geteuid()) || registration.callerPID != os.Getpid() {
		return e, link.ErrDenied
	}
	routes := append([]link.LocalCallerRoute(nil), registration.routes...)
	server, err := link.NewLocalCallerServer(link.LocalCallerServerConfig{Service: registration.service, PeerUID: registration.callerUID, PeerPID: registration.callerPID, Routes: routes, Handler: handler})
	e.server = server
	if err != nil {
		return e, err
	}
	// Keep Darwin's Unix path bound even if the product's state path is long.
	// This is a newly owned private directory, not an existing operator socket.
	e.directory, err = os.MkdirTemp("/tmp", "ynx-ai-caller-")
	if err != nil {
		return e, err
	}
	e.socket = filepath.Join(e.directory, "c.sock")
	e.listener, err = link.ListenPrivate(e.socket, registration.callerUID)
	if err != nil {
		return e, err
	}
	// The server is this already managed process. Never interpret the selected
	// caller PID as the identity of an unrelated Auth daemon.
	e.client, err = link.NewLocalCallerClient(link.LocalCallerClientConfig{SocketPath: e.socket, Service: registration.service, PeerUID: uint32(os.Geteuid()), PeerPID: os.Getpid(), Routes: routes, Timeout: 30 * time.Second, MaxResponseBytes: 1 << 20})
	if err != nil {
		return e, err
	}
	if err := ctx.Err(); err != nil {
		return e, err
	}
	e.started = true
	go func() {
		err := e.server.Serve(e.listener)
		e.mu.Lock()
		if errors.Is(err, http.ErrServerClosed) || errors.Is(err, net.ErrClosed) || (e.retired && errors.Is(err, link.ErrDenied)) {
			err = nil
		}
		e.serveErr = err
		e.mu.Unlock()
		close(e.serveDone)
	}()
	return e, nil
}

func (e *taskCallerEndpoint) Current(ctx context.Context) error {
	if e == nil || ctx == nil || e.client == nil {
		return errTaskEffectSourceUnavailable
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.retired {
		return errTaskCallerRetired
	}
	select {
	case <-e.serveDone:
		if e.serveErr != nil {
			return e.serveErr
		}
		return errTaskEffectSourceUnavailable
	default:
		return nil
	}
}
func (e *taskCallerEndpoint) Call(ctx context.Context, method, path, contentType string, body []byte) (link.LocalCallerResponse, error) {
	if err := e.Current(ctx); err != nil {
		return link.LocalCallerResponse{}, err
	}
	// Original LINK copies and carries the original bytes. Response is DATA;
	// only the original Auth handler/typed-call owner can supply verified facts.
	return e.client.Call(ctx, method, path, contentType, body)
}
func (e *taskCallerEndpoint) Retire() error {
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
			err := e.listener.Close()
			if !errors.Is(err, net.ErrClosed) {
				e.retireErr = errors.Join(e.retireErr, err)
			}
		}
	})
	return e.retireErr
}
func (e *taskCallerEndpoint) Join(ctx context.Context) error {
	if e == nil || ctx == nil {
		return errTaskEffectSourceUnavailable
	}
	e.mu.Lock()
	retired, started := e.retired, e.started
	e.mu.Unlock()
	if !retired {
		return errTaskCallerNotRetired
	}
	if e.server != nil {
		if err := e.server.Join(ctx); err != nil {
			return err
		}
	}
	if started {
		select {
		case <-e.serveDone:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	e.mu.Lock()
	err := e.serveErr
	e.mu.Unlock()
	return errors.Join(e.retireErr, err)
}

// The original ListenPrivate contract preserves the socket pathname after
// shutdown. Retire/Join release resources but never unlink the endpoint or
// remove its private directory; the original operator reconciles that identity.
