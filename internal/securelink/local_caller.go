package securelink

import (
	"context"
	"errors"
	"net/http"
	"time"
)

// LocalCallerRoute is deployment registration, never request-supplied routing.
// Paths are exact origin-form paths, without query strings or escape aliases.
type LocalCallerRoute struct {
	Method, Path string
	MaxBodyBytes int64
	Timeout      time.Duration
}

type LocalCallerServerConfig struct {
	Service                                                   string
	PeerUID                                                   uint32
	PeerPID                                                   int
	Routes                                                    []LocalCallerRoute
	Handler                                                   http.Handler
	ReadHeaderTimeout, ReadTimeout, WriteTimeout, IdleTimeout time.Duration
	MaxHeaderBytes                                            int
}

// LocalCallerMaterial describes the actual OS transport caller and registered
// route. It is not a business principal, Source, Grant, proof or approval. A
// caller-created or previously returned material value confers no authority;
// Auth must retain the real LocalCaller and re-read Current for each use.
type LocalCallerMaterial struct {
	Service, Method, Path string
	PeerUID               uint32
	PeerPID               int
	RequestBody           []byte
	ContentType           string
	ContentLength         int64
}

// LocalCaller has no exported constructor or writable authority fields. Value
// copies share the original request's lifetime and do not mint another caller.
type LocalCaller struct{ state *localCallerState }

func (c *LocalCaller) Current(ctx context.Context) (LocalCallerMaterial, error) {
	if c == nil || c.state == nil {
		return LocalCallerMaterial{}, ErrDenied
	}
	return c.state.current(ctx)
}

// LocalCallerFromRequest accepts only the exact request minted by the private
// listener boundary. Copying its context into a new request is insufficient.
func LocalCallerFromRequest(r *http.Request) (*LocalCaller, error) {
	if r == nil {
		return nil, ErrDenied
	}
	c, ok := r.Context().Value(localCallerKey{}).(*LocalCaller)
	if !ok || c == nil || c.state == nil || c.state.request != r {
		return nil, ErrDenied
	}
	if _, err := c.Current(r.Context()); err != nil {
		return nil, err
	}
	return c, nil
}

type localCallerKey struct{}

// LocalCallerFromContext is for the private Auth source invoked from an active
// handler. Derived timeout/cancellation contexts retain the same capability;
// this is not a way to authenticate another HTTP request. Request adapters must
// use LocalCallerFromRequest, which additionally requires the original pointer.
func LocalCallerFromContext(ctx context.Context) (*LocalCaller, error) {
	if ctx == nil {
		return nil, ErrDenied
	}
	c, ok := ctx.Value(localCallerKey{}).(*LocalCaller)
	if !ok || c == nil {
		return nil, ErrDenied
	}
	if _, err := c.Current(ctx); err != nil {
		return nil, err
	}
	return c, nil
}

// ErrLocalCallerDraining means the transport has retired and closed, but at
// least one registered handler has not returned. Join is the actual drain gate.
var ErrLocalCallerDraining = errors.New("LINK local caller handlers still draining")

type LocalCallerClientConfig struct {
	SocketPath, Service string
	PeerUID             uint32
	PeerPID             int
	Routes              []LocalCallerRoute
	Timeout             time.Duration
	MaxHeaderBytes      int
	MaxResponseBytes    int64
}

// LocalCallerResponse carries opaque original bytes. No response body is
// interpreted as authorization, a receipt or an authenticated LocalCaller.
type LocalCallerResponse struct {
	StatusCode int
	Header     http.Header
	Body       []byte
}
