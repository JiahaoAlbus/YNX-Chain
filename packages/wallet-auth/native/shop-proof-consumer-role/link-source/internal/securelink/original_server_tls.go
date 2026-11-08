package securelink

import (
	"bytes"
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"reflect"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink/native"
)

// ServerTLSIdentity is owned public DATA read from the actual listener's held
// OpenSSL context. It is not a receiver registration, Source or Root capability.
// Auth independently matches its reviewed receiver and SAME Source originals.
var errOriginalServerTLSPending = errors.New("secure link: original server TLS physical drain pending")

type ServerTLSIdentity struct {
	native.ServerIdentity
	SourceID, InstanceID, IssuerRef, CredentialRef, TargetOrigin, ServerName string
	CredentialEpoch                                                          uint64
	CredentialUntil                                                          time.Time
}

// Only the fixed original Auth adapter in this package may implement this
// private borrow. No exported constructor, interface/vtable registration,
// configuration/path/ENV parameter or callback setter accepts one. The adapter
// must hold the actual reviewed issuer's context and credential until release;
// it may not synthesize a borrow from a certificate or received JSON.
// The actual Auth leaf-package mother is a separate required dependency.
type originalServerTLSCredentialBorrow interface {
	originalServerTLSBorrowHeld() bool
	currentOriginalServerTLSCredential(context.Context) error
	originalServerTLSProfile(context.Context) (originalServerTLSProfile, error)
	retireOriginalServerTLSCredential()
	releaseOriginalServerTLSCredential(context.Context) (released, closed bool, err error)
}

type originalServerTLSProfile struct {
	sourceID, instanceID, issuerRef, credentialRef, targetOrigin, serverName string
	peerSAN                                                                  string
	listenNetwork, listenAddress                                             string
	certificateSHA256, spkiSHA256                                            string
	credentialEpoch                                                          uint64
	credentialFrom, credentialUntil                                          time.Time
}

// OriginalServerTLS is a concrete private listener handle. Copies share ONE
// state/lifetime. The zero value cannot serve, attest, or mint a TLS identity.
// Its normal zero-input factory will use only the original Auth issuer callee;
// this transport body provides no alternate public material constructor.
type OriginalServerTLS struct{ state *originalServerTLSState }

type ServerTLSLifetime struct {
	Retired, ServeStarted, ServeExited, ListenerClosed    bool
	Connections, Requests, IssuerCalls                    int
	Closing, PhysicalComplete, BorrowHeld, CleanupUnknown bool
	IssuerLeaseHeld                                       bool
}

type originalServerTLSState struct {
	mu                                                          sync.Mutex
	changed                                                     chan struct{}
	ctx                                                         context.Context
	cancel                                                      context.CancelCauseFunc
	stopParent                                                  func() bool
	base                                                        *HTTPServer
	listener                                                    net.Listener
	listenerClose                                               sync.Once
	lease                                                       originalServerTLSCredentialBorrow
	profile                                                     originalServerTLSProfile
	identity                                                    native.ServerIdentity
	ctxClosed                                                   bool
	first                                                       error
	retired, serving, serveStarted, serveExited, listenerClosed bool
	closing, closed, cleanupUnknown, borrowed                   bool
	calls, requests                                             int
	connections                                                 map[*originalServerTLSConn]struct{}
}

func (s *originalServerTLSState) notifyLocked() { close(s.changed); s.changed = make(chan struct{}) }
func (s *originalServerTLSState) rememberLocked(err error) {
	if err != nil && s.first == nil {
		s.first = err
	}
}
func originalServerTLSNil(v any) bool {
	if v == nil {
		return true
	}
	x := reflect.ValueOf(v)
	switch x.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Pointer, reflect.Slice:
		return x.IsNil()
	}
	return false
}
func cloneServerTLSIdentity(i native.ServerIdentity) native.ServerIdentity {
	i.CertificateDER = bytes.Clone(i.CertificateDER)
	i.SPKIDER = bytes.Clone(i.SPKIDER)
	i.DNSNames = append([]string(nil), i.DNSNames...)
	return i
}
func sameServerTLSIdentity(a, b native.ServerIdentity) bool {
	if !bytes.Equal(a.CertificateDER, b.CertificateDER) || !bytes.Equal(a.SPKIDER, b.SPKIDER) || a.CertificateSHA256 != b.CertificateSHA256 || a.SPKISHA256 != b.SPKISHA256 || !a.NotBefore.Equal(b.NotBefore) || !a.NotAfter.Equal(b.NotAfter) || a.RuntimeVersion != b.RuntimeVersion || a.Protocol != b.Protocol || a.Group != b.Group || a.Cipher != b.Cipher || a.Signature != b.Signature || a.ServerAuth != b.ServerAuth || len(a.DNSNames) != len(b.DNSNames) {
		return false
	}
	for n := range a.DNSNames {
		if a.DNSNames[n] != b.DNSNames[n] {
			return false
		}
	}
	return true
}
func matchOriginalServerTLSProfile(p originalServerTLSProfile, i native.ServerIdentity, l net.Listener) error {
	now := time.Now()
	u, e := url.Parse(p.targetOrigin)
	if e != nil || u.Scheme != "https" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.String() != p.targetOrigin || u.Hostname() != p.serverName || !exactSAN(p.serverName) || p.sourceID == "" || p.instanceID == "" || p.issuerRef == "" || p.credentialRef == "" || p.credentialEpoch == 0 || p.credentialFrom.IsZero() || now.Before(p.credentialFrom) || !now.Before(p.credentialUntil) {
		return ErrDenied
	}
	if !digest(p.certificateSHA256, 64) || !digest(p.spkiSHA256, 64) || p.certificateSHA256 != i.CertificateSHA256 || p.spkiSHA256 != i.SPKISHA256 || !i.ServerAuth || !i.Mutual || !i.TicketsOff || i.Protocol != "TLSv1.3" || i.Group != Group || i.Cipher != Cipher || i.Signature != "mldsa87" || !strings.HasPrefix(i.RuntimeVersion, "OpenSSL 3.6.4 ") || now.Before(i.NotBefore) || !now.Before(i.NotAfter) {
		return ErrDenied
	}
	found := false
	for _, san := range i.DNSNames {
		found = found || san == p.serverName
	}
	if !found {
		return ErrDenied
	}
	if originalServerTLSNil(l) || p.listenNetwork != "tcp" || l.Addr().Network() != p.listenNetwork || l.Addr().String() != p.listenAddress {
		return ErrDenied
	}
	return nil
}

// The fixed Auth normal adapter adopts its nonnil reviewed borrow and transfers
// the registered listener here before interpreting any original acquisition
// error. Neither a generic NewHTTPServer caller nor Cloud JSON can call this
// private transport constructor. The SSL_CTX is transferred to LINK; it is freed only after real transport
// drain and BEFORE returning credential FDs to the original issuer.
func newOriginalServerTLS(parent context.Context, base *HTTPServer, l net.Listener, lease originalServerTLSCredentialBorrow, acquisitionErr error) (out *OriginalServerTLS, err error) {
	ctx, cancel := context.WithCancelCause(context.Background())
	s := &originalServerTLSState{changed: make(chan struct{}), ctx: ctx, cancel: cancel, base: base, listener: l, lease: lease, connections: make(map[*originalServerTLSConn]struct{})}
	if !originalServerTLSNil(lease) {
		s.borrowed = lease.originalServerTLSBorrowHeld()
	}
	out = &OriginalServerTLS{state: s}
	fail := func(e error) (*OriginalServerTLS, error) {
		s.mu.Lock()
		s.rememberLocked(e)
		s.mu.Unlock()
		out.Retire()
		return out, e
	}
	if acquisitionErr != nil {
		return fail(acquisitionErr)
	}
	if parent == nil || parent.Err() != nil || base == nil || base.tls == nil || originalServerTLSNil(l) || !s.borrowed {
		return fail(ErrUnavailable)
	}
	// The owner context is standard and private. Cancellation never detaches an
	// actual issuer/Source operation or claims an uninterruptible callback exited.
	s.stopParent = context.AfterFunc(parent, func() { s.cancel(context.Cause(parent)); out.Retire() })
	s.mu.Lock()
	s.calls++
	s.mu.Unlock()
	e := lease.currentOriginalServerTLSCredential(parent)
	var p originalServerTLSProfile
	if e == nil {
		p, e = lease.originalServerTLSProfile(parent)
	}
	s.mu.Lock()
	s.calls--
	s.notifyLocked()
	s.mu.Unlock()
	if e != nil {
		return fail(e)
	}
	i, e := base.tls.ServerIdentity()
	if e != nil {
		return fail(e)
	}
	if e = matchOriginalServerTLSProfile(p, i, l); e != nil {
		return fail(e)
	}
	s.profile = p
	s.identity = cloneServerTLSIdentity(i)
	if e = out.Current(parent); e != nil {
		return fail(e)
	}
	return out, nil
}

// Current is a FULL transport/issuer observation, not a Store-lock-safe fence
// or business admission. Call it outside Auth/Source/Store locks. It performs
// neither Go x509 parsing nor crypto.Signer projection of ML-DSA material.
func (o *OriginalServerTLS) Current(ctx context.Context) error {
	if o == nil || o.state == nil || ctx == nil {
		return ErrDenied
	}
	s := o.state
	if e := ctx.Err(); e != nil {
		return e
	}
	s.mu.Lock()
	if s.closed || s.retired || s.closing || s.first != nil {
		e := s.first
		if e == nil {
			e = ErrRevoked
		}
		s.mu.Unlock()
		return e
	}
	s.calls++
	lease, base, p, expected := s.lease, s.base, s.profile, s.identity
	s.mu.Unlock()
	e := lease.currentOriginalServerTLSCredential(ctx)
	// A caller's request timeout is not evidence of issuer revocation. Never
	// let one disconnected HTTP client permanently retire unrelated requests.
	operationCancelled := e != nil && ctx.Err() != nil
	if e == nil {
		var i native.ServerIdentity
		i, e = base.tls.ServerIdentity()
		if e == nil && !sameServerTLSIdentity(i, expected) {
			e = ErrRevoked
		}
		if e == nil {
			e = matchOriginalServerTLSProfile(p, i, s.listener)
		}
	}
	if e == nil {
		e = ctx.Err()
		operationCancelled = e != nil
	}
	s.mu.Lock()
	s.calls--
	if e != nil && !operationCancelled {
		s.rememberLocked(e)
	}
	retired := s.retired
	s.notifyLocked()
	s.mu.Unlock()
	if e != nil {
		if !operationCancelled {
			o.Retire()
		}
		return e
	}
	if retired {
		return ErrRevoked
	}
	return nil
}
func (o *OriginalServerTLS) Identity(ctx context.Context) (ServerTLSIdentity, error) {
	if e := o.Current(ctx); e != nil {
		return ServerTLSIdentity{}, e
	}
	s := o.state
	s.mu.Lock()
	defer s.mu.Unlock()
	return ServerTLSIdentity{ServerIdentity: cloneServerTLSIdentity(s.identity), SourceID: s.profile.sourceID, InstanceID: s.profile.instanceID, IssuerRef: s.profile.issuerRef, CredentialRef: s.profile.credentialRef, TargetOrigin: s.profile.targetOrigin, ServerName: s.profile.serverName, CredentialEpoch: s.profile.credentialEpoch, CredentialUntil: s.profile.credentialUntil}, nil
}

type originalServerTLSConnKey struct{}
type originalServerTLSRequestKey struct{}
type originalServerTLSRequest struct {
	state                     *originalServerTLSState
	request                   *http.Request
	ctx                       context.Context
	conn                      *originalServerTLSConn
	method, host, target, url string
}

// CurrentOriginalRequest accepts only the exact request minted on this SAME
// listener's actual native connection. Header/context copies and httptest
// requests cannot create it. This transports identity; Auth still owns every
// independent receiver row, Source, DEVICE/session proof and business check.
func (o *OriginalServerTLS) CurrentOriginalRequest(r *http.Request) error {
	if o == nil || o.state == nil || r == nil || r.URL == nil {
		return ErrDenied
	}
	b, ok := r.Context().Value(originalServerTLSRequestKey{}).(*originalServerTLSRequest)
	if !ok || b == nil || b.state != o.state || b.request != r || r.Context() != b.ctx || r.Method != b.method || r.Host != b.host || r.RequestURI != b.target || r.URL.String() != b.url {
		return ErrDenied
	}
	if e := o.Current(b.ctx); e != nil {
		return e
	}
	c, e := b.conn.secure()
	if e != nil {
		return e
	}
	a := c.Snapshot()
	if !a.Verified || !a.Mutual || a.Resumed || !a.AllChainMLDSA87 || a.Protocol != "TLSv1.3" || a.Group != Group || a.Cipher != Cipher || a.PeerSignature != "mldsa87" || a.LocalEKU != "serverAuth" || a.PeerEKU != "clientAuth" || a.LocalSAN != o.state.profile.serverName || a.PeerSAN != o.state.profile.peerSAN || !time.Now().Before(a.NotAfter) {
		return ErrDenied
	}
	return b.ctx.Err()
}

// Serve installs native OpenSSL on the ORIGINAL product http.Server, preserving
// its handler/limits; no crypto/tls TLSConfig or substitute listener is accepted.
// Auth's original finiteGET principal middleware remains business authority.
func (o *OriginalServerTLS) Serve(server *http.Server) error {
	if o == nil || o.state == nil || server == nil || server.Handler == nil || server.TLSConfig != nil {
		return ErrDenied
	}
	s := o.state
	if e := o.Current(s.ctx); e != nil {
		return e
	}
	s.mu.Lock()
	if s.serveStarted || s.retired {
		s.mu.Unlock()
		return ErrDenied
	}
	s.serveStarted = true
	s.serving = true
	handler, oldCtx, oldState := server.Handler, server.ConnContext, server.ConnState
	s.mu.Unlock()
	server.ConnContext = func(ctx context.Context, c net.Conn) context.Context {
		conn, ok := c.(*originalServerTLSConn)
		if !ok {
			return ctx
		}
		if oldCtx != nil {
			ctx = oldCtx(ctx, c)
		}
		ctx, cancel := context.WithCancelCause(ctx)
		stop := context.AfterFunc(s.ctx, func() { cancel(context.Cause(s.ctx)) })
		conn.setCancel(cancel, stop)
		return context.WithValue(ctx, originalServerTLSConnKey{}, conn)
	}
	server.ConnState = func(c net.Conn, state http.ConnState) {
		s.mu.Lock()
		s.calls++
		s.mu.Unlock()
		defer func() { s.mu.Lock(); s.calls--; s.notifyLocked(); s.mu.Unlock() }()
		if oldState != nil {
			oldState(c, state)
		}
		if state == http.StateClosed || state == http.StateHijacked {
			if conn, ok := c.(*originalServerTLSConn); ok {
				conn.httpDone()
			}
		}
	}
	if server.MaxHeaderBytes == 0 || server.MaxHeaderBytes > 262144 {
		server.MaxHeaderBytes = 262144
	}
	server.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, ok := r.Context().Value(originalServerTLSConnKey{}).(*originalServerTLSConn)
		if !ok || conn == nil || r.URL == nil {
			http.Error(w, "native listener unavailable", http.StatusServiceUnavailable)
			return
		}
		s.mu.Lock()
		if s.retired {
			s.mu.Unlock()
			http.Error(w, "native listener unavailable", http.StatusServiceUnavailable)
			return
		}
		s.requests++
		s.mu.Unlock()
		defer func() { s.mu.Lock(); s.requests--; s.notifyLocked(); s.mu.Unlock() }()
		b := &originalServerTLSRequest{state: s, conn: conn, method: r.Method, host: r.Host, target: r.RequestURI, url: r.URL.String()}
		r = r.WithContext(context.WithValue(r.Context(), originalServerTLSRequestKey{}, b))
		b.ctx = r.Context()
		b.request = r
		if e := o.CurrentOriginalRequest(r); e != nil {
			http.Error(w, "native listener unavailable", http.StatusServiceUnavailable)
			return
		}
		handler.ServeHTTP(w, r)
	})
	e := server.Serve(&originalServerTLSListener{owner: o})
	s.mu.Lock()
	s.serving = false
	s.serveExited = true
	retired := s.retired
	if !retired && e != nil {
		s.rememberLocked(e)
	}
	s.notifyLocked()
	s.mu.Unlock()
	o.Retire()
	if retired {
		return http.ErrServerClosed
	}
	return e
}

type originalServerTLSListener struct{ owner *OriginalServerTLS }

func (l *originalServerTLSListener) Addr() net.Addr { return l.owner.state.listener.Addr() }
func (l *originalServerTLSListener) Close() error {
	l.owner.Retire()
	s := l.owner.state
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.first
}
func (l *originalServerTLSListener) Accept() (net.Conn, error) {
	s := l.owner.state
	s.mu.Lock()
	retired := s.retired
	s.mu.Unlock()
	if retired {
		return nil, net.ErrClosed
	}
	raw, e := s.listener.Accept()
	if e != nil {
		return nil, e
	}
	c := &originalServerTLSConn{state: s}
	c.raw = &originalServerTLSRawConn{Conn: raw, state: s}
	s.mu.Lock()
	if s.retired {
		s.mu.Unlock()
		_ = c.raw.Close()
		return nil, net.ErrClosed
	}
	s.connections[c] = struct{}{}
	s.notifyLocked()
	s.mu.Unlock()
	return c, nil
}

// The actual accepted transport's FIRST close is recorded once. Legacy
// pendingConn ignored that result and retried through native.Conn.Close; this
// owner must never let a later ErrClosed erase an ambiguous first close.
type originalServerTLSRawConn struct {
	net.Conn
	state *originalServerTLSState
	once  sync.Once
	err   error
}

func (c *originalServerTLSRawConn) Close() error {
	c.once.Do(func() {
		c.err = c.Conn.Close()
		if c.err != nil && !errors.Is(c.err, net.ErrClosed) {
			s := c.state
			s.mu.Lock()
			s.cleanupUnknown = true
			s.rememberLocked(c.err)
			s.notifyLocked()
			s.mu.Unlock()
		}
	})
	return c.err
}
func (c *originalServerTLSRawConn) SyscallConn() (syscall.RawConn, error) {
	s, ok := c.Conn.(syscall.Conn)
	if !ok {
		return nil, ErrDenied
	}
	return s.SyscallConn()
}

type originalServerTLSConn struct {
	raw                                *originalServerTLSRawConn
	state                              *originalServerTLSState
	mu                                 sync.Mutex
	secureOnce, closeOnce              sync.Once
	tls                                *native.Conn
	err, closeErr                      error
	closed, closeCompleted, httpExited bool
	calls                              int
	readDeadline, writeDeadline        time.Time
	cancel                             context.CancelCauseFunc
	stop                               func() bool
}

func (c *originalServerTLSConn) setCancel(cancel context.CancelCauseFunc, stop func() bool) {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		stop()
		cancel(net.ErrClosed)
		return
	}
	c.cancel, c.stop = cancel, stop
	c.mu.Unlock()
}
func (c *originalServerTLSConn) secure() (*native.Conn, error) {
	c.secureOnce.Do(func() {
		ctx, cancel := context.WithTimeout(c.state.ctx, 5*time.Second)
		defer cancel()
		conn, e := c.state.base.tls.Server(ctx, c.raw)
		c.mu.Lock()
		c.tls, c.err = conn, e
		closed, rd, wd := c.closed, c.readDeadline, c.writeDeadline
		c.mu.Unlock()
		if e == nil && closed {
			_ = conn.Close()
			e = net.ErrClosed
		}
		if e == nil {
			e = c.raw.SetReadDeadline(rd)
		}
		if e == nil {
			e = c.raw.SetWriteDeadline(wd)
		}
		if e != nil {
			_ = c.raw.Close()
			if conn != nil {
				_ = conn.Close()
			}
			c.mu.Lock()
			c.err = e
			c.mu.Unlock()
		}
	})
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.tls, c.err
}
func (c *originalServerTLSConn) begin() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return false
	}
	c.calls++
	return true
}
func (c *originalServerTLSConn) end() { c.mu.Lock(); c.calls--; c.mu.Unlock(); c.forgetIfDone() }
func (c *originalServerTLSConn) httpDone() {
	c.mu.Lock()
	c.httpExited = true
	c.mu.Unlock()
	c.forgetIfDone()
}
func (c *originalServerTLSConn) forgetIfDone() {
	c.mu.Lock()
	done := c.closed && c.closeCompleted && c.httpExited && c.calls == 0
	c.mu.Unlock()
	if done {
		s := c.state
		s.mu.Lock()
		delete(s.connections, c)
		s.notifyLocked()
		s.mu.Unlock()
	}
}
func (c *originalServerTLSConn) Read(p []byte) (int, error) {
	if !c.begin() {
		return 0, net.ErrClosed
	}
	defer c.end()
	conn, e := c.secure()
	if e != nil {
		return 0, e
	}
	return conn.Read(p)
}
func (c *originalServerTLSConn) Write(p []byte) (int, error) {
	if !c.begin() {
		return 0, net.ErrClosed
	}
	defer c.end()
	conn, e := c.secure()
	if e != nil {
		return 0, e
	}
	return conn.Write(p)
}
func (c *originalServerTLSConn) Close() error {
	c.closeOnce.Do(func() {
		c.mu.Lock()
		c.closed = true
		conn, cancel, stop := c.tls, c.cancel, c.stop
		c.mu.Unlock()
		if stop != nil {
			stop()
		}
		if cancel != nil {
			cancel(net.ErrClosed)
		}
		c.closeErr = c.raw.Close()
		if conn != nil {
			e := conn.Close()
			if c.closeErr == nil {
				c.closeErr = e
			}
		}
		c.mu.Lock()
		c.closeCompleted = true
		c.mu.Unlock()
	})
	c.forgetIfDone()
	return c.closeErr
}
func (c *originalServerTLSConn) LocalAddr() net.Addr  { return c.raw.LocalAddr() }
func (c *originalServerTLSConn) RemoteAddr() net.Addr { return c.raw.RemoteAddr() }
func (c *originalServerTLSConn) SetDeadline(t time.Time) error {
	c.mu.Lock()
	c.readDeadline, c.writeDeadline = t, t
	c.mu.Unlock()
	return c.raw.SetDeadline(t)
}
func (c *originalServerTLSConn) SetReadDeadline(t time.Time) error {
	c.mu.Lock()
	c.readDeadline = t
	c.mu.Unlock()
	return c.raw.SetReadDeadline(t)
}
func (c *originalServerTLSConn) SetWriteDeadline(t time.Time) error {
	c.mu.Lock()
	c.writeDeadline = t
	c.mu.Unlock()
	return c.raw.SetWriteDeadline(t)
}

func (o *OriginalServerTLS) Retire() {
	if o == nil || o.state == nil {
		return
	}
	s := o.state
	s.mu.Lock()
	s.retired = true
	cause := s.first
	if cause == nil {
		cause = ErrRevoked
	}
	s.cancel(cause)
	conns := make([]*originalServerTLSConn, 0, len(s.connections))
	for c := range s.connections {
		conns = append(conns, c)
	}
	s.notifyLocked()
	s.mu.Unlock()
	for _, c := range conns {
		_ = c.Close()
	}
	s.listenerClose.Do(func() {
		if !originalServerTLSNil(s.lease) {
			s.mu.Lock()
			s.calls++
			s.mu.Unlock()
			s.lease.retireOriginalServerTLSCredential()
			s.mu.Lock()
			s.calls--
			s.notifyLocked()
			s.mu.Unlock()
		}
	})
}
func (o *OriginalServerTLS) Join(ctx context.Context) error {
	if o == nil || o.state == nil || ctx == nil {
		return ErrDenied
	}
	s := o.state
	for {
		s.mu.Lock()
		done := s.retired && (!s.serveStarted || s.serveExited) && len(s.connections) == 0 && s.requests == 0 && s.calls == 0 && !s.closing
		unknown, first, changed := s.cleanupUnknown, s.first, s.changed
		s.mu.Unlock()
		if unknown {
			if first != nil {
				return first
			}
			return ErrUnavailable
		}
		if done {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-changed:
		}
	}
}
func (o *OriginalServerTLS) Close() error {
	if o == nil || o.state == nil {
		return ErrDenied
	}
	s := o.state
	s.mu.Lock()
	if s.closed {
		e := s.first
		s.mu.Unlock()
		return e
	}
	if s.cleanupUnknown {
		e := s.first
		if e == nil {
			e = ErrUnavailable
		}
		s.mu.Unlock()
		return e
	}
	if !s.retired || (s.serveStarted && !s.serveExited) || len(s.connections) != 0 || s.requests != 0 || s.calls != 0 || s.closing {
		s.mu.Unlock()
		return ErrUnavailable
	}
	s.closing = true
	s.calls++
	lease, base, ctxClosed := s.lease, s.base, s.ctxClosed
	s.mu.Unlock()
	released, closed, e := true, true, error(nil)
	if !ctxClosed && base != nil && base.tls != nil {
		e = base.tls.Close()
		if e != nil {
			s.mu.Lock()
			s.calls--
			s.closing = false
			s.cleanupUnknown = true
			s.rememberLocked(e)
			s.notifyLocked()
			s.mu.Unlock()
			return e
		}
	}
	s.mu.Lock()
	s.ctxClosed = true
	s.mu.Unlock()
	if !originalServerTLSNil(lease) {
		released, closed, e = lease.releaseOriginalServerTLSCredential(context.Background())
	}
	if closed && !released {
		closed = false
		if e == nil {
			e = ErrUnavailable
		}
	}
	s.mu.Lock()
	s.calls--
	s.closing = false
	s.borrowed = !released
	if !closed && !errors.Is(e, errOriginalServerTLSPending) {
		s.cleanupUnknown = true
		if e == nil {
			e = ErrUnavailable
		}
	} else {
		s.closed = closed
		s.listenerClosed = closed
	}
	if !errors.Is(e, errOriginalServerTLSPending) {
		s.rememberLocked(e)
	}
	first := s.first
	if first == nil && !closed {
		first = errOriginalServerTLSPending
	}
	s.notifyLocked()
	stop := s.stopParent
	s.mu.Unlock()
	if closed && stop != nil {
		stop()
	}
	return first
}
func (o *OriginalServerTLS) Lifetime() ServerTLSLifetime {
	if o == nil || o.state == nil {
		return ServerTLSLifetime{}
	}
	s := o.state
	s.mu.Lock()
	defer s.mu.Unlock()
	return ServerTLSLifetime{Retired: s.retired, ServeStarted: s.serveStarted, ServeExited: s.serveExited, ListenerClosed: s.listenerClosed, Connections: len(s.connections), Requests: s.requests, IssuerCalls: s.calls, Closing: s.closing, PhysicalComplete: s.closed, BorrowHeld: s.borrowed, CleanupUnknown: s.cleanupUnknown, IssuerLeaseHeld: !originalServerTLSNil(s.lease) && !s.closed}
}
func (o *OriginalServerTLS) FirstCause() error {
	if o == nil || o.state == nil {
		return ErrDenied
	}
	s := o.state
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.first
}
