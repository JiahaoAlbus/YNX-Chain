//go:build linux || darwin

package securelink

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"reflect"
	"sync"
	"sync/atomic"
	"syscall"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink/native"
	"golang.org/x/sys/unix"
)

// AuthorityIPCIngress accepts only the exact request privately bound by the
// native TLS HTTP server. It opens one registered Unix connection and transfers
// one control capability for that request. No HTTP/header/JSON constructor can
// manufacture the original TLS connection, Gate or control capability.
type AuthorityIPCIngress struct {
	cfg         AuthorityIPCIngressConfig
	routes      map[string]AuthorityIngressRoute
	mu          sync.Mutex
	retired     bool
	active      map[*authorityIngressRequest]bool
	drained     chan struct{}
	drainClosed bool
}

type authorityIngressRequest struct {
	ingress       *AuthorityIPCIngress
	request       *http.Request
	originalBody  io.ReadCloser
	ctx           context.Context
	cancel        context.CancelFunc
	tls           *native.Conn
	route         AuthorityIngressRoute
	body          []byte
	contentType   string
	contentLength int64
	active        atomic.Bool
	mu            sync.Mutex
	data          *net.UnixConn
	control       *net.UnixConn
}

func NewAuthorityIPCIngress(cfg AuthorityIPCIngressConfig) (*AuthorityIPCIngress, error) {
	if !localService(cfg.Service) || cfg.PeerUID == 0 || cfg.PeerPID <= 0 || len(cfg.Routes) == 0 || len(cfg.Routes) > 2 {
		return nil, ErrDenied
	}
	if err := privateParent(cfg.SocketPath, cfg.PeerUID); err != nil {
		return nil, err
	}
	if cfg.MaxHeaderBytes == 0 {
		cfg.MaxHeaderBytes = 16 << 10
	}
	if cfg.MaxConcurrentRequests == 0 {
		cfg.MaxConcurrentRequests = 16
	}
	if cfg.MaxHeaderBytes < 1 || cfg.MaxHeaderBytes > 64<<10 || cfg.MaxConcurrentRequests < 1 || cfg.MaxConcurrentRequests > 64 {
		return nil, ErrBounds
	}
	routes := make(map[string]AuthorityIngressRoute, len(cfg.Routes))
	for _, r := range cfg.Routes {
		if r.Method != http.MethodPost || r.MaxResponseBytes < 1 || r.MaxResponseBytes > 16<<20 {
			return nil, ErrDenied
		}
		if _, err := localRoutes([]LocalCallerRoute{{Method: r.Method, Path: r.Path, MaxBodyBytes: r.MaxRequestBytes, Timeout: r.Timeout}}); err != nil {
			return nil, err
		}
		key := r.Method + " " + r.Path
		if _, exists := routes[key]; exists {
			return nil, ErrDenied
		}
		routes[key] = r
	}
	cfg.Routes = nil
	return &AuthorityIPCIngress{cfg: cfg, routes: routes, active: make(map[*authorityIngressRequest]bool), drained: make(chan struct{})}, nil
}

func (i *AuthorityIPCIngress) finishDrainLocked() {
	if i.retired && len(i.active) == 0 && !i.drainClosed {
		i.drainClosed = true
		close(i.drained)
	}
}

func (i *AuthorityIPCIngress) Retire() error {
	if i == nil {
		return nil
	}
	i.mu.Lock()
	i.retired = true
	requests := make([]*authorityIngressRequest, 0, len(i.active))
	for s := range i.active {
		requests = append(requests, s)
	}
	i.finishDrainLocked()
	i.mu.Unlock()
	for _, s := range requests {
		s.cancel()
		s.abort()
	}
	return nil
}

func (i *AuthorityIPCIngress) Join(ctx context.Context) error {
	if i == nil || ctx == nil {
		return ErrDenied
	}
	i.mu.Lock()
	retired := i.retired
	i.mu.Unlock()
	if !retired {
		return ErrDenied
	}
	select {
	case <-i.drained:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (i *AuthorityIPCIngress) Close() error {
	if i == nil {
		return nil
	}
	_ = i.Retire()
	select {
	case <-i.drained:
		return nil
	default:
		return ErrLocalCallerDraining
	}
}

func (s *authorityIngressRequest) stop() {
	s.active.Store(false)
	s.mu.Lock()
	data, control := s.data, s.control
	s.mu.Unlock()
	if control != nil {
		_ = control.Close()
	}
	if data != nil {
		_ = data.Close()
	}
}

func (s *authorityIngressRequest) abort() {
	s.stop()
	// Unblocks a partial original request body on deadline/disconnect/retire.
	// Ordinary successful completion closes only its local control/data fds.
	if s.tls != nil {
		_ = s.tls.Close()
	}
}

func (s *authorityIngressRequest) attach(data, control *net.UnixConn) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.active.Load() || s.ctx.Err() != nil {
		_ = data.Close()
		_ = control.Close()
		return ErrDenied
	}
	s.data, s.control = data, control
	return nil
}

func sameIngressBody(a, b io.ReadCloser) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	// The real net/http body is comparable; a forged/custom uncomparable body
	// cannot turn a diagnostic request into authority or crash this comparison.
	v := reflect.ValueOf(a)
	return v.Type().Comparable() && reflect.TypeOf(b) == v.Type() && a == b
}

// Unlike the public diagnostic channel getter, this fixed ingress requires the
// complete original body at the private TLS mint point. It cannot qualify a
// replacement reader, forged Content-Length/MIME, or an already consumed prefix.
// Known length is part of this finite profile; chunked input is unavailable.
func sealedAuthorityIngressBinding(r *http.Request) (*serviceChannelBinding, error) {
	if r == nil {
		return nil, ErrDenied
	}
	binding, ok := r.Context().Value(serviceChannelKey{}).(*serviceChannelBinding)
	if !ok || binding == nil || binding.request != r || binding.conn == nil || !sameIngressBody(binding.body, r.Body) || binding.contentLength < 0 || binding.contentLength != r.ContentLength || len(binding.contentTypes) != 1 || binding.contentTypes[0] != "application/json" || len(r.Header.Values("Content-Type")) != 1 || r.Header.Get("Content-Type") != binding.contentTypes[0] {
		return nil, ErrDenied
	}
	if err := authorityIngressFrontendLive(r, binding); err != nil {
		return nil, err
	}
	return binding, nil
}

// A native snapshot cannot observe a TCP FIN that net/http has not processed
// yet. Inspect only closure on the original fd (without consuming TLS bytes),
// and require the same actual native endpoint as the private server binding.
func authorityIngressFrontendLive(r *http.Request, binding *serviceChannelBinding) error {
	p, ok := r.Context().Value(connKey{}).(*pendingConn)
	if !ok || p == nil {
		return ErrDenied
	}
	p.mu.Lock()
	rawConn, tlsConn, closed, handshakeErr := p.raw, p.tls, p.closed, p.err
	p.mu.Unlock()
	if closed || handshakeErr != nil || tlsConn != binding.conn {
		return ErrDenied
	}
	sc, ok := rawConn.(syscall.Conn)
	if !ok {
		return ErrDenied
	}
	raw, err := sc.SyscallConn()
	if err != nil {
		return err
	}
	var check error
	err = raw.Control(func(fd uintptr) {
		fds := []unix.PollFd{{Fd: int32(fd), Events: unix.POLLIN}}
		if _, e := unix.Poll(fds, 0); e != nil {
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

func (s *authorityIngressRequest) current() (AuthorityIngressMetadata, error) {
	var out AuthorityIngressMetadata
	if !s.active.Load() || s.ctx.Err() != nil || s.request == nil || !sameIngressBody(s.request.Body, s.originalBody) || s.request.ContentLength != s.contentLength || s.request.Header.Get("Content-Type") != s.contentType || len(s.request.Header.Values("Content-Type")) != 1 || localIdentityHeader(s.request.Header) {
		return out, ErrDenied
	}
	if _, err := sealedAuthorityIngressBinding(s.request); err != nil {
		return out, err
	}
	s.ingress.mu.Lock()
	retired := s.ingress.retired
	s.ingress.mu.Unlock()
	if retired {
		return out, ErrDenied
	}
	channel, err := ServiceChannelFromRequest(s.request)
	if err != nil {
		return out, err
	}
	s.mu.Lock()
	data := s.data
	s.mu.Unlock()
	if err = localPeer(data, s.ingress.cfg.PeerUID, s.ingress.cfg.PeerPID); err != nil {
		return out, err
	}
	if !s.active.Load() || s.ctx.Err() != nil {
		return out, ErrDenied
	}
	return AuthorityIngressMetadata{Service: s.ingress.cfg.Service, Method: s.route.Method, Path: s.route.Path, Host: s.request.Host, ContentType: s.contentType, ContentLength: s.contentLength, Channel: AuthorityIngressChannel{Peer: channel.Peer, Exporter: bytes.Clone(channel.Exporter), LocalSAN: channel.LocalSAN}}, nil
}

// The private control protocol is a transport capability, not an Auth message:
// SCM marker 'L'; query 'C'; response BE32(payloadLen), BE32(metaLen), metadata
// JSON, then exact opaque original body. A zero length rejects and closes. No
// more than 64 queries, no concurrent responses, and no post-request replay.
func (s *authorityIngressRequest) serveControl(control *net.UnixConn) {
	defer control.Close()
	deny := func() { _, _ = control.Write([]byte{0, 0, 0, 0}); s.abort() }
	for n := 0; ; n++ {
		var query [1]byte
		if _, err := io.ReadFull(control, query[:]); err != nil {
			return
		}
		if query[0] != 'C' || n >= 64 {
			deny()
			return
		}
		metadata, err := s.current()
		if err != nil {
			deny()
			return
		}
		meta, err := json.Marshal(metadata)
		if err != nil || len(meta)+8 > 64<<10 {
			deny()
			return
		}
		payloadLen := 4 + len(meta) + len(s.body)
		if int64(payloadLen+4) > s.route.MaxRequestBytes+64<<10 {
			deny()
			return
		}
		frame := make([]byte, 8, payloadLen+4)
		binary.BigEndian.PutUint32(frame[:4], uint32(payloadLen))
		binary.BigEndian.PutUint32(frame[4:8], uint32(len(meta)))
		frame = append(frame, meta...)
		frame = append(frame, s.body...)
		if _, err = io.Copy(control, bytes.NewReader(frame)); err != nil {
			return
		}
	}
}

func authorityControlPair() (*net.UnixConn, *os.File, error) {
	// Darwin has no SOCK_CLOEXEC socketpair flag. Hold Go's fork lock until
	// both original fds are close-on-exec, also on Linux, before publishing.
	syscall.ForkLock.Lock()
	fds, err := unix.Socketpair(unix.AF_UNIX, unix.SOCK_STREAM, 0)
	if err == nil {
		unix.CloseOnExec(fds[0])
		unix.CloseOnExec(fds[1])
	}
	syscall.ForkLock.Unlock()
	if err != nil {
		return nil, nil, err
	}
	a, b := os.NewFile(uintptr(fds[0]), "authority-control-go"), os.NewFile(uintptr(fds[1]), "authority-control-node")
	c, err := net.FileConn(a)
	_ = a.Close()
	if err != nil {
		_ = b.Close()
		return nil, nil, err
	}
	u, ok := c.(*net.UnixConn)
	if !ok {
		_ = c.Close()
		_ = b.Close()
		return nil, nil, ErrDenied
	}
	return u, b, nil
}

func (i *AuthorityIPCIngress) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if i == nil || r == nil || r.URL == nil || r.Method != http.MethodPost || r.URL.String() != r.RequestURI || r.URL.EscapedPath() != r.RequestURI || r.Header.Get("Content-Type") != "application/json" || len(r.Header.Values("Content-Type")) != 1 || localIdentityHeader(r.Header) {
		http.Error(w, "authority transport denied", http.StatusForbidden)
		return
	}
	if _, err := ServiceChannelFromRequest(r); err != nil {
		http.Error(w, "authority transport denied", http.StatusForbidden)
		return
	}
	route, ok := i.routes[r.Method+" "+r.RequestURI]
	if !ok {
		http.Error(w, "authority transport denied", http.StatusForbidden)
		return
	}
	if r.ContentLength > route.MaxRequestBytes {
		http.Error(w, "request too large", http.StatusRequestEntityTooLarge)
		return
	}
	binding, err := sealedAuthorityIngressBinding(r)
	if err != nil {
		http.Error(w, "authority transport denied", http.StatusForbidden)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), route.Timeout)
	s := &authorityIngressRequest{ingress: i, request: r, originalBody: binding.body, ctx: ctx, cancel: cancel, tls: binding.conn, route: route, contentType: binding.contentTypes[0], contentLength: binding.contentLength}
	s.active.Store(true)
	i.mu.Lock()
	if i.retired || len(i.active) >= i.cfg.MaxConcurrentRequests {
		i.mu.Unlock()
		cancel()
		http.Error(w, "authority transport unavailable", http.StatusServiceUnavailable)
		return
	}
	i.active[s] = true
	i.mu.Unlock()
	var controlDone chan struct{}
	stopCancel := context.AfterFunc(ctx, s.abort)
	defer func() {
		stopCancel()
		s.stop()
		cancel()
		if controlDone != nil {
			<-controlDone
		}
		i.mu.Lock()
		delete(i.active, s)
		i.finishDrainLocked()
		i.mu.Unlock()
	}()
	deadline, _ := ctx.Deadline()
	if err := binding.conn.SetReadDeadline(deadline); err != nil {
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, route.MaxRequestBytes))
	if err != nil || int64(len(body)) != binding.contentLength || ctx.Err() != nil {
		http.Error(w, "invalid authority body", http.StatusBadRequest)
		return
	}
	s.body = bytes.Clone(body)
	conn, err := DialPrivate(ctx, i.cfg.SocketPath, i.cfg.PeerUID)
	if err != nil {
		http.Error(w, "authority backend unavailable", http.StatusBadGateway)
		return
	}
	data, ok := conn.(*net.UnixConn)
	if !ok {
		_ = conn.Close()
		http.Error(w, "authority backend denied", http.StatusBadGateway)
		return
	}
	defer data.Close()
	if err = localPeer(data, i.cfg.PeerUID, i.cfg.PeerPID); err != nil {
		http.Error(w, "authority backend denied", http.StatusBadGateway)
		return
	}
	control, nodeFD, err := authorityControlPair()
	if err != nil {
		http.Error(w, "authority control unavailable", http.StatusBadGateway)
		return
	}
	defer nodeFD.Close()
	if err = s.attach(data, control); err != nil {
		return
	}
	_ = data.SetDeadline(deadline)
	_ = control.SetDeadline(deadline)
	if _, err = s.current(); err != nil {
		http.Error(w, "authority transport denied", http.StatusForbidden)
		return
	}
	rights := unix.UnixRights(int(nodeFD.Fd()))
	n, oobn, err := data.WriteMsgUnix([]byte{'L'}, rights, nil)
	if err != nil || n != 1 || oobn != len(rights) {
		http.Error(w, "authority control transfer failed", http.StatusBadGateway)
		return
	}
	_ = nodeFD.Close()
	controlDone = make(chan struct{})
	go func() { defer close(controlDone); s.serveControl(control) }()
	req, err := http.NewRequestWithContext(ctx, r.Method, "http://"+i.cfg.Service+route.Path, bytes.NewReader(s.body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", s.contentType)
	req.ContentLength = r.ContentLength
	req.Close = true
	if _, err = s.current(); err != nil {
		return
	}
	// This is the one dispatch attempt. A partial write/read is never retried
	// and never replaced by an authorization receipt or a new operation.
	if err = req.Write(data); err != nil {
		http.Error(w, "authority backend exchange failed", http.StatusBadGateway)
		return
	}
	budget := &wireBudget{reader: data, remaining: int64(i.cfg.MaxHeaderBytes)}
	reader := bufio.NewReader(budget)
	resp, err := http.ReadResponse(reader, req)
	if err != nil {
		http.Error(w, "invalid authority response", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 599 || resp.Header.Get("Content-Type") != "application/json" || len(resp.Header.Values("Content-Type")) != 1 || resp.ContentLength > route.MaxResponseBytes || resp.Header.Get("Content-Encoding") != "" || resp.Header.Get("Upgrade") != "" {
		http.Error(w, "invalid authority response", http.StatusBadGateway)
		return
	}
	budget.remaining = route.MaxResponseBytes + int64(i.cfg.MaxHeaderBytes) - int64(reader.Buffered())
	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, route.MaxResponseBytes+1))
	if err != nil || int64(len(responseBody)) > route.MaxResponseBytes || ctx.Err() != nil {
		http.Error(w, "invalid authority response", http.StatusBadGateway)
		return
	}
	if _, err = ServiceChannelFromRequest(r); err != nil {
		http.Error(w, "authority transport denied", http.StatusForbidden)
		return
	}
	if _, err = sealedAuthorityIngressBinding(r); err != nil {
		http.Error(w, "authority transport denied", http.StatusForbidden)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(responseBody)
}
