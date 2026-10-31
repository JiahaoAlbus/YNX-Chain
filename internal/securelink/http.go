package securelink

import (
	"bufio"
	"bytes"
	"context"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink/native"
)

type HTTPClientConfig struct {
	TLS                     native.Config
	Gate                    *Gate
	EdgeID, Address, Origin string
	Timeout, IdleTTL        time.Duration
	MaxConnections          int
	MaxResponseBytes        int64
}
type pooledConn struct {
	conn   *native.Conn
	reader *bufio.Reader
	until  time.Time
	budget *wireBudget
}

// A per-response wire budget bounds status/header parsing before ReadResponse
// allocates its map, and bounds chunk metadata/trailers as well as body bytes.
type wireBudget struct {
	reader    io.Reader
	remaining int64
}

func (b *wireBudget) Read(p []byte) (int, error) {
	if b.remaining <= 0 {
		return 0, ErrBounds
	}
	if int64(len(p)) > b.remaining {
		p = p[:b.remaining]
	}
	n, err := b.reader.Read(p)
	b.remaining -= int64(n)
	return n, err
}

// Transport is an identity-isolated, bounded HTTP/1.1 pool over the native TLS
// endpoint. It never uses environment proxies, follows redirects, retries a
// request, resumes TLS, or falls back to plaintext/ordinary TLS.
type Transport struct {
	tls                   *native.Context
	gate                  *Gate
	edge, address, origin string
	idleTTL               time.Duration
	maxResponse           int64
	slots                 chan struct{}
	mu                    sync.Mutex
	idle                  []*pooledConn
	all                   map[*native.Conn]bool
	closed                bool
}

func NewHTTPClient(cfg HTTPClientConfig) (*http.Client, error) {
	t, err := NewTransport(cfg)
	if err != nil {
		return nil, err
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	return &http.Client{Transport: t, Timeout: timeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, nil
}
func NewTransport(cfg HTTPClientConfig) (*Transport, error) {
	if cfg.Gate == nil || cfg.EdgeID == "" || cfg.TLS.Server {
		return nil, ErrDenied
	}
	u, err := url.Parse(cfg.Origin)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Host == "" || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.Hostname() != cfg.TLS.PeerSAN {
		return nil, ErrDenied
	}
	if _, _, err = net.SplitHostPort(cfg.Address); err != nil {
		return nil, ErrDenied
	}
	if cfg.MaxConnections == 0 {
		cfg.MaxConnections = 16
	}
	if cfg.MaxConnections < 1 || cfg.MaxConnections > 64 {
		return nil, ErrBounds
	}
	if cfg.IdleTTL == 0 {
		cfg.IdleTTL = time.Minute
	}
	if cfg.IdleTTL <= 0 || cfg.IdleTTL > 5*time.Minute {
		return nil, ErrBounds
	}
	if cfg.MaxResponseBytes == 0 {
		cfg.MaxResponseBytes = 16 << 20
	}
	if cfg.MaxResponseBytes < 1 || cfg.MaxResponseBytes > 16<<20 {
		return nil, ErrBounds
	}
	tlsContext, err := native.NewContext(cfg.TLS)
	if err != nil {
		return nil, err
	}
	return &Transport{tls: tlsContext, gate: cfg.Gate, edge: cfg.EdgeID, address: cfg.Address, origin: u.Host, idleTTL: cfg.IdleTTL, maxResponse: cfg.MaxResponseBytes, slots: make(chan struct{}, cfg.MaxConnections), all: make(map[*native.Conn]bool)}, nil
}
func proxyIdentityHeader(h http.Header) bool {
	for k := range h {
		k = strings.ToLower(k)
		if k == "forwarded" || k == "x-client-cert" || k == "x-client-dn" || strings.HasPrefix(k, "x-forwarded-") || strings.HasPrefix(k, "x-ssl-") || strings.HasPrefix(k, "x-tls-") || strings.HasPrefix(k, "x-ynx-peer-") || strings.HasPrefix(k, "x-ynx-service-") {
			return true
		}
	}
	return false
}
func (t *Transport) RoundTrip(req *http.Request) (*http.Response, error) {
	return t.roundTrip(req, nil)
}

// prepare runs only after this exact native connection has passed its service
// gate. Its returned wire is sent on that same connection, never another pool
// member. The public http.RoundTripper path has no prepare capability.
func (t *Transport) roundTrip(req *http.Request, prepare func(context.Context, *native.Conn) (WireRequest, error)) (*http.Response, error) {
	if req == nil {
		return nil, ErrDenied
	}
	if req.Body != nil {
		defer req.Body.Close()
	}
	if req.URL == nil || req.URL.Scheme != "https" || req.URL.Host != t.origin || req.URL.User != nil || (req.Host != "" && req.Host != t.origin) || req.URL.Fragment != "" || proxyIdentityHeader(req.Header) || req.Header.Get("Upgrade") != "" || req.Method == http.MethodConnect {
		return nil, ErrDenied
	}
	if err := req.Context().Err(); err != nil {
		return nil, err
	}
	select {
	case t.slots <- struct{}{}:
	case <-req.Context().Done():
		return nil, req.Context().Err()
	}
	release := func() { <-t.slots }
	p, err := t.acquire(req.Context())
	if err != nil {
		release()
		return nil, err
	}
	if _, err = t.gate.AuthenticateServicePeer(req.Context(), p.conn, t.edge, req.Method, req.URL.EscapedPath()); err != nil {
		t.discard(p)
		release()
		return nil, err
	}
	deadline := time.Now().Add(30 * time.Second)
	if d, ok := req.Context().Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	_ = p.conn.SetDeadline(deadline)
	stop := context.AfterFunc(req.Context(), func() { t.discard(p) })
	fail := func(err error) (*http.Response, error) { stop(); t.discard(p); release(); return nil, err }
	clone := req.Clone(req.Context())
	clone.RequestURI = ""
	clone.Close = false
	if prepare != nil {
		wire, e := prepare(req.Context(), p.conn)
		if e != nil {
			return fail(e)
		}
		clone.Body = io.NopCloser(bytes.NewReader(wire.Body))
		defer clone.Body.Close()
		clone.ContentLength = int64(len(wire.Body))
		clone.GetBody = nil
		if wire.ContentType != "" {
			clone.Header.Set("Content-Type", wire.ContentType)
		}
		// The original SDK/Auth preparation may have waited on authority. A
		// revoked/expired/cancelled channel must not emit its prepared body.
		if e = req.Context().Err(); e != nil {
			return fail(e)
		}
		if _, e = t.gate.AuthenticateServicePeer(req.Context(), p.conn, t.edge, req.Method, req.URL.EscapedPath()); e != nil {
			return fail(e)
		}
	}
	if err = clone.Write(p.conn); err != nil {
		return fail(err)
	}
	var resp *http.Response
	p.budget.remaining = 64 << 10
	for i := 0; i < 8; i++ {
		resp, err = http.ReadResponse(p.reader, clone)
		if err != nil {
			return fail(err)
		}
		if resp.StatusCode >= 200 || resp.StatusCode == 101 {
			break
		}
		_ = resp.Body.Close()
	}
	if resp == nil || resp.StatusCode < 200 || resp.StatusCode == 101 {
		return fail(ErrDenied)
	}
	p.budget.remaining = t.maxResponse + (64 << 10)
	if resp.ContentLength > t.maxResponse {
		_ = p.conn.Close()
		_ = resp.Body.Close()
		return fail(ErrBounds)
	}
	body := &pooledBody{body: resp.Body, remaining: t.maxResponse, finish: func(reuse bool) {
		stop()
		if reuse && !resp.Close && req.Context().Err() == nil && p.reader.Buffered() == 0 {
			t.put(p)
		} else {
			t.discard(p)
		}
		release()
	}, abort: func() { t.discard(p) }}
	resp.Body = body
	return resp, nil
}
func (t *Transport) acquire(ctx context.Context) (*pooledConn, error) {
	t.mu.Lock()
	if t.closed {
		t.mu.Unlock()
		return nil, ErrUnavailable
	}
	var p *pooledConn
	if len(t.idle) > 0 {
		p = t.idle[len(t.idle)-1]
		t.idle = t.idle[:len(t.idle)-1]
	}
	t.mu.Unlock()
	if p != nil {
		if time.Now().Before(p.until) {
			return p, nil
		}
		t.discard(p)
	}
	raw, err := (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, "tcp", t.address)
	if err != nil {
		return nil, err
	}
	conn, err := t.tls.Client(ctx, raw)
	if err != nil {
		_ = raw.Close()
		return nil, err
	}
	t.mu.Lock()
	if t.closed {
		t.mu.Unlock()
		_ = conn.Close()
		return nil, ErrUnavailable
	}
	t.all[conn] = true
	t.mu.Unlock()
	budget := &wireBudget{reader: conn}
	return &pooledConn{conn: conn, reader: bufio.NewReaderSize(budget, 32<<10), budget: budget}, nil
}
func (t *Transport) put(p *pooledConn) {
	t.mu.Lock()
	if t.closed {
		t.mu.Unlock()
		t.discard(p)
		return
	}
	p.until = time.Now().Add(t.idleTTL)
	_ = p.conn.SetDeadline(p.until)
	t.idle = append(t.idle, p)
	t.mu.Unlock()
}
func (t *Transport) discard(p *pooledConn) {
	_ = p.conn.Close()
	t.gate.ForgetConnection(p.conn)
	t.mu.Lock()
	delete(t.all, p.conn)
	t.mu.Unlock()
}
func (t *Transport) CloseIdleConnections() {
	t.mu.Lock()
	idle := t.idle
	t.idle = nil
	t.mu.Unlock()
	for _, p := range idle {
		t.discard(p)
	}
}
func (t *Transport) Close() error {
	t.mu.Lock()
	if t.closed {
		t.mu.Unlock()
		return nil
	}
	t.closed = true
	all := t.all
	t.all = make(map[*native.Conn]bool)
	t.idle = nil
	t.mu.Unlock()
	for c := range all {
		_ = c.Close()
		t.gate.ForgetConnection(c)
	}
	return t.tls.Close()
}

type pooledBody struct {
	body      io.ReadCloser
	remaining int64
	once      sync.Once
	finish    func(bool)
	abort     func()
}

func (b *pooledBody) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	if b.remaining < 0 {
		return 0, ErrBounds
	}
	if int64(len(p)) > b.remaining+1 {
		p = p[:b.remaining+1]
	}
	n, err := b.body.Read(p)
	b.remaining -= int64(n)
	if b.remaining < 0 {
		b.once.Do(func() { b.abort(); _ = b.body.Close(); b.finish(false) })
		return 0, ErrBounds
	}
	if err == io.EOF {
		b.once.Do(func() { _ = b.body.Close(); b.finish(true) })
	} else if err != nil {
		b.once.Do(func() { b.abort(); _ = b.body.Close(); b.finish(false) })
	}
	return n, err
}
func (b *pooledBody) Close() error {
	var err error
	b.once.Do(func() {
		b.abort()
		err = b.body.Close()
		b.finish(false)
	})
	return err
}

type HTTPServerConfig struct {
	TLS     native.Config
	Gate    *Gate
	EdgeID  string
	Handler http.Handler
}
type HTTPServer struct {
	tls    *native.Context
	gate   *Gate
	edge   string
	server *http.Server
}
type connKey struct{}

func NewHTTPServer(cfg HTTPServerConfig) (*HTTPServer, error) {
	if !cfg.TLS.Server || cfg.Gate == nil || cfg.EdgeID == "" || cfg.Handler == nil {
		return nil, ErrDenied
	}
	tlsContext, err := native.NewContext(cfg.TLS)
	if err != nil {
		return nil, err
	}
	s := &HTTPServer{tls: tlsContext, gate: cfg.Gate, edge: cfg.EdgeID}
	s.server = &http.Server{ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: time.Minute, MaxHeaderBytes: 64 << 10, ConnContext: func(ctx context.Context, c net.Conn) context.Context { return context.WithValue(ctx, connKey{}, c) }, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, ok := r.Context().Value(connKey{}).(*pendingConn)
		if !ok || proxyIdentityHeader(r.Header) || r.Method == http.MethodConnect || r.Header.Get("Upgrade") != "" {
			http.Error(w, "service peer denied", http.StatusForbidden)
			return
		}
		conn, err := c.secure()
		if err != nil {
			http.Error(w, "service peer denied", http.StatusForbidden)
			return
		}
		if _, err = s.gate.AuthenticateServicePeer(r.Context(), conn, s.edge, r.Method, r.URL.EscapedPath()); err != nil {
			http.Error(w, "service peer denied", http.StatusForbidden)
			return
		}
		cfg.Handler.ServeHTTP(w, withServiceChannel(r, conn, s.gate, s.edge))
	})}
	return s, nil
}
func (s *HTTPServer) Serve(l net.Listener) error {
	return s.server.Serve(&secureListener{Listener: l, owner: s})
}
func (s *HTTPServer) Shutdown(ctx context.Context) error {
	err := s.server.Shutdown(ctx)
	if err == nil {
		return s.tls.Close()
	}
	return err
}
func (s *HTTPServer) Close() error { err := s.server.Close(); _ = s.tls.Close(); return err }

type secureListener struct {
	net.Listener
	owner *HTTPServer
}

func (l *secureListener) Accept() (net.Conn, error) {
	c, err := l.Listener.Accept()
	if err != nil {
		return nil, err
	}
	return &pendingConn{raw: c, owner: l.owner}, nil
}

type pendingConn struct {
	raw                         net.Conn
	owner                       *HTTPServer
	once                        sync.Once
	mu                          sync.Mutex
	tls                         *native.Conn
	err                         error
	closed                      bool
	readDeadline, writeDeadline time.Time
}

func (c *pendingConn) secure() (*native.Conn, error) {
	c.once.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		conn, err := c.owner.tls.Server(ctx, c.raw)
		c.mu.Lock()
		defer c.mu.Unlock()
		if err == nil && c.closed {
			_ = conn.Close()
			err = net.ErrClosed
		}
		c.tls = conn
		c.err = err
		if err != nil {
			_ = c.raw.Close()
		} else {
			// Native handshake deadlines are local to the handshake. Restore the
			// outer net/http limits established before its first call to Read.
			if e := c.raw.SetReadDeadline(c.readDeadline); e != nil {
				c.err = e
				_ = conn.Close()
			}
			if e := c.raw.SetWriteDeadline(c.writeDeadline); e != nil {
				c.err = e
				_ = conn.Close()
			}
		}
	})
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.tls, c.err
}
func (c *pendingConn) Read(p []byte) (int, error) {
	conn, err := c.secure()
	if err != nil {
		return 0, err
	}
	return conn.Read(p)
}
func (c *pendingConn) Write(p []byte) (int, error) {
	conn, err := c.secure()
	if err != nil {
		return 0, err
	}
	return conn.Write(p)
}
func (c *pendingConn) Close() error {
	_ = c.raw.Close()
	c.mu.Lock()
	c.closed = true
	conn := c.tls
	c.mu.Unlock()
	if conn != nil {
		err := conn.Close()
		c.owner.gate.ForgetConnection(conn)
		return err
	}
	return nil
}
func (c *pendingConn) LocalAddr() net.Addr  { return c.raw.LocalAddr() }
func (c *pendingConn) RemoteAddr() net.Addr { return c.raw.RemoteAddr() }
func (c *pendingConn) SetDeadline(t time.Time) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.readDeadline = t
	c.writeDeadline = t
	return c.raw.SetDeadline(t)
}
func (c *pendingConn) SetReadDeadline(t time.Time) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.readDeadline = t
	return c.raw.SetReadDeadline(t)
}
func (c *pendingConn) SetWriteDeadline(t time.Time) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.writeDeadline = t
	return c.raw.SetWriteDeadline(t)
}

var _ http.RoundTripper = (*Transport)(nil)
var _ net.Conn = (*pendingConn)(nil)
