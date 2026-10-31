//go:build linux || darwin

package securelink

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

// localPeer reads credentials and closure state from the original fd on EVERY
// use. Poll/peek never consumes request bytes. Request fields cannot supply any
// credential. A closed peer fails even while its old handle is retained.
func localPeer(c *net.UnixConn, uid uint32, pid int) error {
	if c == nil || uid == 0 || pid <= 0 {
		return ErrDenied
	}
	raw, err := c.SyscallConn()
	if err != nil {
		return err
	}
	var check error
	err = raw.Control(func(fd uintptr) {
		u, p, e := localPeerCredentials(int(fd))
		if e != nil {
			check = e
			return
		}
		if u != uid || p != pid {
			check = ErrDenied
			return
		}
		fds := []unix.PollFd{{Fd: int32(fd), Events: unix.POLLIN}}
		if _, e = unix.Poll(fds, 0); e != nil {
			check = e
			return
		}
		if fds[0].Revents&(unix.POLLHUP|unix.POLLERR|unix.POLLNVAL) != 0 {
			check = ErrDenied
			return
		}
		var b [1]byte
		n, _, e := unix.Recvfrom(int(fd), b[:], unix.MSG_PEEK|unix.MSG_DONTWAIT)
		if e == nil && n == 0 {
			check = ErrDenied
		} else if e != nil && !errors.Is(e, syscall.EAGAIN) && !errors.Is(e, syscall.EWOULDBLOCK) {
			check = e
		}
	})
	if err != nil {
		return err
	}
	return check
}

func localRoutes(routes []LocalCallerRoute) (map[string]LocalCallerRoute, error) {
	if len(routes) == 0 || len(routes) > 64 {
		return nil, ErrBounds
	}
	m := make(map[string]LocalCallerRoute, len(routes))
	for _, r := range routes {
		u, err := url.ParseRequestURI(r.Path)
		if r.Method == "" || len(r.Method) > 32 || strings.Trim(r.Method, "ABCDEFGHIJKLMNOPQRSTUVWXYZ") != "" || r.Method == http.MethodConnect || err != nil || u == nil || u.Path == "" || u.Path != r.Path || u.EscapedPath() != r.Path || u.String() != r.Path || u.IsAbs() || u.Host != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || strings.Contains(r.Path, "//") || strings.Contains(r.Path, "/../") || strings.Contains(r.Path, "/./") || strings.HasSuffix(r.Path, "/..") || strings.HasSuffix(r.Path, "/.") {
			return nil, ErrDenied
		}
		if r.MaxBodyBytes < 1 || r.MaxBodyBytes > 16<<20 || r.Timeout <= 0 || r.Timeout > time.Minute {
			return nil, ErrBounds
		}
		key := r.Method + " " + r.Path
		if _, exists := m[key]; exists {
			return nil, ErrDenied
		}
		m[key] = r
	}
	return m, nil
}

func localService(s string) bool {
	return profileName(s) && !strings.ContainsAny(s, ":")
}

func localIdentityHeader(h http.Header) bool {
	if proxyIdentityHeader(h) || h.Get("Upgrade") != "" {
		return true
	}
	for k := range h {
		k = strings.ToLower(k)
		if strings.HasPrefix(k, "x-ynx-caller-") || k == "x-peer-uid" || k == "x-peer-pid" || k == "x-caller-uid" || k == "x-caller-pid" {
			return true
		}
	}
	return false
}

type localCallerConn struct {
	*net.UnixConn
	closed atomic.Bool
}

func (c *localCallerConn) Close() error {
	c.closed.Store(true)
	return c.UnixConn.Close()
}

type localCallerConnKey struct{}

type localCallerState struct {
	request  *http.Request
	ctx      context.Context
	conn     *localCallerConn
	server   *LocalCallerServer
	material LocalCallerMaterial
	handle   *LocalCaller
	active   atomic.Bool
}

func (s *localCallerState) currentOriginalCaller(r *http.Request) error {
	if r == nil || s.request != r || s.ctx == nil || r.Context() != s.ctx || s.handle == nil || s.handle.state != s || s.conn == nil || s.conn.UnixConn == nil || s.server == nil {
		return ErrDenied
	}
	if s.server.cfg.PeerUID == 0 || s.server.cfg.PeerPID <= 0 || s.material.PeerUID != s.server.cfg.PeerUID || s.material.PeerPID != s.server.cfg.PeerPID || s.material.Service != s.server.cfg.Service {
		return ErrDenied
	}
	// Consult only the privately minted context, never a caller-supplied
	// context's Value/Err callback. The request context must be that exact value.
	if s.ctx.Value(localCallerKey{}) != s.handle {
		return ErrDenied
	}
	if r.URL == nil || r.Method != s.material.Method || r.Host != s.material.Service || r.RequestURI != s.material.Path || r.URL.String() != s.material.Path || r.URL.EscapedPath() != s.material.Path || r.ProtoMajor != 1 || r.ProtoMinor != 1 || r.ContentLength != s.material.ContentLength || r.Header.Get("Content-Type") != s.material.ContentType || len(r.Header.Values("Content-Type")) > 1 || localIdentityHeader(r.Header) {
		return ErrDenied
	}
	// Preserve the original cancellation/deadline cause rather than replacing
	// an already observed context error with a generic lifecycle denial.
	if err := s.ctx.Err(); err != nil {
		return err
	}
	if !s.active.Load() || s.server.closed.Load() || s.conn.closed.Load() {
		return ErrDenied
	}
	return nil
}

func (s *localCallerState) current(ctx context.Context) (LocalCallerMaterial, error) {
	if ctx == nil || s.ctx == nil || ctx.Value(localCallerKey{}) != s.handle || s.request == nil || s.conn == nil || s.server == nil || !s.active.Load() || s.server.closed.Load() || s.conn.closed.Load() {
		return LocalCallerMaterial{}, ErrDenied
	}
	if err := s.ctx.Err(); err != nil {
		return LocalCallerMaterial{}, err
	}
	if err := ctx.Err(); err != nil {
		return LocalCallerMaterial{}, err
	}
	r := s.request
	if r.Context() != s.ctx || r.URL == nil || r.Method != s.material.Method || r.Host != s.material.Service || r.RequestURI != s.material.Path || r.URL.String() != s.material.Path || r.URL.EscapedPath() != s.material.Path || r.ProtoMajor != 1 || r.ProtoMinor != 1 || r.ContentLength != s.material.ContentLength || r.Header.Get("Content-Type") != s.material.ContentType || len(r.Header.Values("Content-Type")) > 1 || localIdentityHeader(r.Header) {
		return LocalCallerMaterial{}, ErrDenied
	}
	if err := localPeer(s.conn.UnixConn, s.material.PeerUID, s.material.PeerPID); err != nil {
		return LocalCallerMaterial{}, err
	}
	if !s.active.Load() || s.server.closed.Load() || s.conn.closed.Load() || ctx.Err() != nil {
		return LocalCallerMaterial{}, ErrDenied
	}
	m := s.material
	m.RequestBody = bytes.Clone(m.RequestBody)
	return m, nil
}

// LocalCallerServer only mints a handle after ListenPrivate's UID check AND an
// independent live UID/PID check on its actual accepted Unix connection. It
// serves one HTTP/1.1 request per connection; no upgrade or proxy path exists.
type LocalCallerServer struct {
	cfg         LocalCallerServerConfig
	routes      map[string]LocalCallerRoute
	http        *http.Server
	closed      atomic.Bool
	mu          sync.Mutex
	serving     bool
	active      map[*localCallerState]context.CancelFunc
	drained     chan struct{}
	drainClosed bool
}

func NewLocalCallerServer(cfg LocalCallerServerConfig) (*LocalCallerServer, error) {
	if !localService(cfg.Service) || cfg.PeerUID == 0 || cfg.PeerPID <= 0 || cfg.Handler == nil {
		return nil, ErrDenied
	}
	routes, err := localRoutes(cfg.Routes)
	if err != nil {
		return nil, err
	}
	if cfg.MaxHeaderBytes == 0 {
		cfg.MaxHeaderBytes = 16 << 10
	}
	if cfg.ReadHeaderTimeout == 0 {
		cfg.ReadHeaderTimeout = 5 * time.Second
	}
	if cfg.ReadTimeout == 0 {
		cfg.ReadTimeout = 30 * time.Second
	}
	if cfg.WriteTimeout == 0 {
		cfg.WriteTimeout = 30 * time.Second
	}
	if cfg.IdleTimeout == 0 {
		cfg.IdleTimeout = 5 * time.Second
	}
	if cfg.MaxHeaderBytes < 1 || cfg.MaxHeaderBytes > 64<<10 || cfg.ReadHeaderTimeout <= 0 || cfg.ReadHeaderTimeout > time.Minute || cfg.ReadTimeout <= 0 || cfg.ReadTimeout > time.Minute || cfg.WriteTimeout <= 0 || cfg.WriteTimeout > time.Minute || cfg.IdleTimeout <= 0 || cfg.IdleTimeout > time.Minute {
		return nil, ErrBounds
	}
	// Registration is copied, so operator mutation cannot retarget live handles.
	cfg.Routes = nil
	s := &LocalCallerServer{cfg: cfg, routes: routes, active: make(map[*localCallerState]context.CancelFunc), drained: make(chan struct{})}
	s.http = &http.Server{Handler: http.HandlerFunc(s.serveHTTP), ReadHeaderTimeout: cfg.ReadHeaderTimeout, ReadTimeout: cfg.ReadTimeout, WriteTimeout: cfg.WriteTimeout, IdleTimeout: cfg.IdleTimeout, MaxHeaderBytes: cfg.MaxHeaderBytes,
		ConnContext: func(ctx context.Context, conn net.Conn) context.Context {
			c, ok := conn.(*localCallerConn)
			if !ok {
				return ctx
			}
			return context.WithValue(ctx, localCallerConnKey{}, c)
		},
	}
	s.http.SetKeepAlivesEnabled(false)
	return s, nil
}

type localCallerListener struct {
	net.Listener
	server *LocalCallerServer
}

func (l *localCallerListener) Accept() (net.Conn, error) {
	for {
		c, err := l.Listener.Accept()
		if err != nil {
			return nil, err
		}
		u, ok := c.(*net.UnixConn)
		if ok && localPeer(u, l.server.cfg.PeerUID, l.server.cfg.PeerPID) == nil {
			return &localCallerConn{UnixConn: u}, nil
		}
		_ = c.Close()
	}
}

func (s *LocalCallerServer) Serve(l net.Listener) error {
	if s == nil || l == nil {
		return ErrDenied
	}
	private, ok := l.(*privateListener)
	if !ok || private.uid != s.cfg.PeerUID {
		return ErrDenied
	}
	if _, ok := private.Listener.(*net.UnixListener); !ok {
		return ErrDenied
	}
	s.mu.Lock()
	if s.serving || s.closed.Load() {
		s.mu.Unlock()
		return ErrDenied
	}
	s.serving = true
	s.mu.Unlock()
	return s.http.Serve(&localCallerListener{Listener: l, server: s})
}

func (s *LocalCallerServer) Close() error {
	if s == nil {
		return nil
	}
	err := s.Retire()
	select {
	case <-s.drained:
		return err
	default:
		return ErrLocalCallerDraining
	}
}

func (s *LocalCallerServer) Retire() error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	s.closed.Store(true)
	for state, cancel := range s.active {
		state.active.Store(false)
		cancel()
	}
	s.finishDrainLocked()
	s.mu.Unlock()
	return s.http.Close()
}

func (s *LocalCallerServer) finishDrainLocked() {
	if s.closed.Load() && len(s.active) == 0 && !s.drainClosed {
		s.drainClosed = true
		close(s.drained)
	}
}

// Join reports success only when every admitted handler (and pending bounded
// body capture) has actually returned. Cancellation never fabricates a drain.
func (s *LocalCallerServer) Join(ctx context.Context) error {
	if s == nil || ctx == nil || !s.closed.Load() {
		return ErrDenied
	}
	select {
	case <-s.drained:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Do not expose Hijacker/Unwrap: this fixed HTTP boundary cannot be upgraded
// into an unbounded raw connection by the registered handler.
type localResponseWriter struct{ http.ResponseWriter }

func (s *LocalCallerServer) serveHTTP(w http.ResponseWriter, r *http.Request) {
	c, ok := r.Context().Value(localCallerConnKey{}).(*localCallerConn)
	if !ok || c == nil || s.closed.Load() || r.URL == nil || r.ProtoMajor != 1 || r.ProtoMinor != 1 || r.Host != s.cfg.Service || r.RequestURI != r.URL.String() || r.URL.IsAbs() || r.URL.Host != "" || localIdentityHeader(r.Header) {
		http.Error(w, "local caller denied", http.StatusForbidden)
		return
	}
	route, ok := s.routes[r.Method+" "+r.RequestURI]
	if !ok || r.URL.EscapedPath() != route.Path || localPeer(c.UnixConn, s.cfg.PeerUID, s.cfg.PeerPID) != nil {
		http.Error(w, "local caller denied", http.StatusForbidden)
		return
	}
	if r.ContentLength > route.MaxBodyBytes {
		http.Error(w, "request too large", http.StatusRequestEntityTooLarge)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), route.Timeout)
	defer cancel()
	state := &localCallerState{conn: c, server: s, material: LocalCallerMaterial{Service: s.cfg.Service, Method: route.Method, Path: route.Path, PeerUID: s.cfg.PeerUID, PeerPID: s.cfg.PeerPID, ContentType: r.Header.Get("Content-Type"), ContentLength: r.ContentLength}}
	s.mu.Lock()
	if s.closed.Load() {
		s.mu.Unlock()
		http.Error(w, "local caller denied", http.StatusForbidden)
		return
	}
	s.active[state] = cancel
	s.mu.Unlock()
	defer func() {
		state.active.Store(false)
		s.mu.Lock()
		delete(s.active, state)
		s.finishDrainLocked()
		s.mu.Unlock()
	}()
	stop := context.AfterFunc(ctx, func() { state.active.Store(false); _ = c.Close() })
	defer stop()
	deadline, _ := ctx.Deadline()
	if d := time.Now().Add(s.cfg.ReadTimeout); d.Before(deadline) {
		deadline = d
	}
	if err := c.SetReadDeadline(deadline); err != nil {
		return
	}
	boundedBody := http.MaxBytesReader(w, r.Body, route.MaxBodyBytes)
	body, err := io.ReadAll(boundedBody)
	if err != nil || (r.ContentLength >= 0 && int64(len(body)) != r.ContentLength) || ctx.Err() != nil || s.closed.Load() || len(r.Header.Values("Content-Type")) > 1 {
		http.Error(w, "invalid local request body", http.StatusBadRequest)
		return
	}
	state.material.RequestBody = bytes.Clone(body)
	handle := &LocalCaller{state: state}
	state.handle = handle
	bound := r.WithContext(context.WithValue(ctx, localCallerKey{}, handle))
	state.request, state.ctx = bound, bound.Context()
	state.active.Store(true)
	bound.Body = io.NopCloser(bytes.NewReader(body))
	if _, err := handle.Current(bound.Context()); err != nil {
		return
	}
	s.cfg.Handler.ServeHTTP(localResponseWriter{w}, bound)
}

// LocalCallerClient has one registered socket, service and finite route set.
// Call is a single attempt: no proxy, redirect, retry or destination override.
type LocalCallerClient struct {
	cfg    LocalCallerClientConfig
	routes map[string]LocalCallerRoute
}

func NewLocalCallerClient(cfg LocalCallerClientConfig) (*LocalCallerClient, error) {
	if !localService(cfg.Service) || cfg.PeerUID == 0 || cfg.PeerPID <= 0 {
		return nil, ErrDenied
	}
	if err := privateParent(cfg.SocketPath, cfg.PeerUID); err != nil {
		return nil, err
	}
	routes, err := localRoutes(cfg.Routes)
	if err != nil {
		return nil, err
	}
	if cfg.Timeout == 0 {
		cfg.Timeout = 30 * time.Second
	}
	if cfg.MaxHeaderBytes == 0 {
		cfg.MaxHeaderBytes = 16 << 10
	}
	if cfg.MaxResponseBytes == 0 {
		cfg.MaxResponseBytes = 1 << 20
	}
	if cfg.Timeout <= 0 || cfg.Timeout > time.Minute || cfg.MaxHeaderBytes < 1 || cfg.MaxHeaderBytes > 64<<10 || cfg.MaxResponseBytes < 1 || cfg.MaxResponseBytes > 16<<20 {
		return nil, ErrBounds
	}
	cfg.Routes = nil
	return &LocalCallerClient{cfg: cfg, routes: routes}, nil
}

func (c *LocalCallerClient) Call(ctx context.Context, method, path, contentType string, body []byte) (out LocalCallerResponse, err error) {
	var dispatched bool
	var partialBytes int64
	defer func() {
		if err != nil {
			err = &DispatchError{Cause: err, DispatchPossible: dispatched, PartialResponseBytes: partialBytes}
		}
	}()
	if c == nil || ctx == nil || strings.ContainsAny(contentType, "\r\n\x00") {
		return out, ErrDenied
	}
	route, ok := c.routes[method+" "+path]
	if !ok {
		return out, ErrDenied
	}
	if int64(len(body)) > route.MaxBodyBytes {
		return out, ErrBounds
	}
	body = bytes.Clone(body)
	timeout := min(c.cfg.Timeout, route.Timeout)
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	conn, err := DialPrivate(ctx, c.cfg.SocketPath, c.cfg.PeerUID)
	if err != nil {
		return out, err
	}
	defer conn.Close()
	u, ok := conn.(*net.UnixConn)
	if !ok {
		return out, ErrDenied
	}
	if err = localPeer(u, c.cfg.PeerUID, c.cfg.PeerPID); err != nil {
		return out, err
	}
	deadline, _ := ctx.Deadline()
	if err = conn.SetDeadline(deadline); err != nil {
		return out, err
	}
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stop()
	req, err := http.NewRequestWithContext(ctx, method, "http://"+c.cfg.Service+path, bytes.NewReader(body))
	if err != nil {
		return out, err
	}
	req.Close = true
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if err = ctx.Err(); err != nil {
		return out, err
	}
	if err = localPeer(u, c.cfg.PeerUID, c.cfg.PeerPID); err != nil {
		return out, err
	}
	dispatched = true
	if err = req.Write(conn); err != nil {
		return out, err
	}
	// The total wire bound also covers chunk metadata/trailers, not only the
	// decoded body. ReadResponse cannot allocate unbounded header maps.
	budget := &wireBudget{reader: conn, remaining: int64(c.cfg.MaxHeaderBytes)}
	reader := bufio.NewReader(budget)
	resp, err := http.ReadResponse(reader, req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	budget.remaining = c.cfg.MaxResponseBytes + int64(c.cfg.MaxHeaderBytes) - int64(reader.Buffered())
	if resp.ContentLength > c.cfg.MaxResponseBytes {
		return out, ErrBounds
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, c.cfg.MaxResponseBytes+1))
	partialBytes = int64(len(b))
	if err != nil {
		return out, err
	}
	if int64(len(b)) > c.cfg.MaxResponseBytes {
		return out, ErrBounds
	}
	if err = ctx.Err(); err != nil {
		return out, err
	}
	return LocalCallerResponse{StatusCode: resp.StatusCode, Header: resp.Header.Clone(), Body: b}, nil
}
