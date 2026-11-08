//go:build darwin || linux

package securelink

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"syscall"

	"golang.org/x/sys/unix"
)

// Actual partials remain in private custody until known physical closure. This
// is not an acquisition/permission lookup table and has no public lookup/setter.
var originalLocalCallerExchangeCustody = struct {
	sync.Mutex
	owners map[*originalLocalCallerExchangeState]struct{}
}{owners: make(map[*originalLocalCallerExchangeState]struct{})}

type originalLocalCallerExchangeState struct {
	mu, peerWork, socketClose sync.Mutex
	ownerPID                  int
	client                    *LocalCallerClient
	ctx                       context.Context
	cancel                    context.CancelFunc
	conn                      *os.File
	socketFD                  int
	peer                      *originalLocalCallerPeer
	changed                   chan struct{}
	callbackDone              chan struct{}
	stopCallback              func() bool
	active                    int
	callComplete              bool
	bodyComplete              bool
	dispatched                bool
	retired, joined           bool
	closing, closed           bool
	manualRetire              bool
	socketSelected            bool
	socketClosed              bool
	cleanupUnknown            bool
	first, cleanupFirst       error
	observation               LocalCallerPeerObservation
}

func (s *originalLocalCallerExchangeState) notifyLocked() {
	close(s.changed)
	s.changed = make(chan struct{})
}
func (s *originalLocalCallerExchangeState) remember(err error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err != nil && s.first == nil {
		s.first = err
	}
	return s.first
}
func (s *originalLocalCallerExchangeState) resultError() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.first != nil {
		return s.first
	}
	return s.cleanupFirst
}

// CallOriginalOwned performs one HTTP request on this original client's fixed
// destination/route map. The expected process is independent registered server
// DATA, never TOFU. The returned exchange is adopted before response/error.
// A complete normal FIN may prove terminal original DATA, never live transport
// or Auth Source. The socket and image/proc FDs stay owned until real cleanup.
func (c *LocalCallerClient) CallOriginalOwned(ctx context.Context, method, path, contentType string, body []byte, expected LocalCallerExpectedProcess) (exchange *OriginalLocalCallerExchange, out LocalCallerResponse, err error) {
	return c.callOriginalOwned(ctx, method, path, contentType, body, expected, nil, nil)
}

// CallOriginalShopGETOwned carries only the sole SDK's original V2 proof header
// on an empty GET from this client's exact registered route map. It performs
// the same one socket attempt and retains the same peer/response/close debt as
// CallOriginalOwned. The header is not parsed or treated as authorization;
// the original Auth/P07 session and Source current remain independent gates.
func (c *LocalCallerClient) CallOriginalShopGETOwned(ctx context.Context, path string, proof ProductSessionProofV2DATA, expected LocalCallerExpectedProcess) (exchange *OriginalLocalCallerExchange, out LocalCallerResponse, err error) {
	return c.callOriginalOwned(ctx, http.MethodGet, path, "", nil, expected, &proof, nil)
}

// CallOriginalShopGETV4Owned carries only one original SDK V4 value on a
// registered MaxBodyBytes=0 GET. It shares the exact original owned socket,
// peer/image fences, response partial and physical-close debt with the old
// methods; it supplies no session, Source or business approval.
func (c *LocalCallerClient) CallOriginalShopGETV4Owned(ctx context.Context, path string, proof ProductSessionProofV4DATA, expected LocalCallerExpectedProcess) (exchange *OriginalLocalCallerExchange, out LocalCallerResponse, err error) {
	return c.callOriginalOwned(ctx, http.MethodGet, path, "", nil, expected, nil, &proof)
}

func (c *LocalCallerClient) callOriginalOwned(ctx context.Context, method, path, contentType string, body []byte, expected LocalCallerExpectedProcess, proof *ProductSessionProofV2DATA, proofV4 *ProductSessionProofV4DATA) (exchange *OriginalLocalCallerExchange, out LocalCallerResponse, err error) {
	s := &originalLocalCallerExchangeState{ownerPID: os.Getpid(), client: c, changed: make(chan struct{}), active: 1, socketFD: -1}
	exchange = &OriginalLocalCallerExchange{state: s}
	originalLocalCallerExchangeCustody.Lock()
	full := len(originalLocalCallerExchangeCustody.owners) >= 1024
	if !full {
		originalLocalCallerExchangeCustody.owners[s] = struct{}{}
	}
	originalLocalCallerExchangeCustody.Unlock()
	var partialBytes int64
	defer func() {
		if err == nil {
			// Do not return apparent success when a cancellation/cleanup first
			// cause has already been observed before this return boundary.
			err = s.resultError()
		}
		if err != nil {
			cause := s.remember(err)
			s.mu.Lock()
			dispatched := s.dispatched
			s.mu.Unlock()
			err = &DispatchError{Cause: cause, DispatchPossible: dispatched, PartialResponseBytes: partialBytes}
		}
		s.mu.Lock()
		s.active--
		s.callComplete = true
		s.notifyLocked()
		s.mu.Unlock()
	}()
	if full {
		return exchange, out, ErrBounds
	}
	if c == nil || ctx == nil || strings.ContainsAny(contentType, "\r\n\x00") {
		return exchange, out, ErrDenied
	}
	var proofValue string
	if proof != nil && proofV4 != nil {
		return exchange, out, ErrDenied
	}
	if proof != nil {
		if len(proof.HeaderValue) > MaxProductSessionProofV2HeaderBytes {
			return exchange, out, ErrBounds
		}
		proofValue = strings.Clone(proof.HeaderValue)
		if err = validateProductSessionProofV2Carrier(proofValue); err != nil {
			return exchange, out, err
		}
	}
	if proofV4 != nil {
		if len(proofV4.HeaderValue) > MaxProductSessionProofV4HeaderBytes {
			return exchange, out, ErrBounds
		}
		proofValue = strings.Clone(proofV4.HeaderValue)
		if err = validateProductSessionProofV4Carrier(proofValue); err != nil {
			return exchange, out, err
		}
		if method != http.MethodGet || contentType != "" || len(body) != 0 {
			return exchange, out, ErrDenied
		}
	}
	if err = validateLocalCallerExpectedProcess(expected); err != nil {
		return exchange, out, err
	}
	if expected.UID != c.cfg.PeerUID || expected.PID != c.cfg.PeerPID {
		return exchange, out, ErrDenied
	}
	route, ok := c.routes[method+" "+path]
	if !ok {
		return exchange, out, ErrDenied
	}
	if proofV4 != nil && route.MaxBodyBytes != 0 {
		return exchange, out, ErrDenied
	}
	if int64(len(body)) > route.MaxBodyBytes {
		return exchange, out, ErrBounds
	}
	if proof != nil && (len(path) > MaxProductSessionProofV2RequestHeaderBytes || len(c.cfg.Service) > MaxProductSessionProofV2RequestHeaderBytes-len(path)) {
		// Bound input lengths before building the URL or request-line copy.
		return exchange, out, ErrBounds
	}
	if proofV4 != nil && (len(path) > MaxProductSessionProofV4RequestHeaderBytes || len(c.cfg.Service) > MaxProductSessionProofV4RequestHeaderBytes-len(path)) {
		return exchange, out, ErrBounds
	}
	body = bytes.Clone(body)
	s.ctx, s.cancel = context.WithTimeout(ctx, min(c.cfg.Timeout, route.Timeout))
	var req *http.Request
	var requestWire []byte
	if proof != nil || proofV4 != nil {
		// Serialize only the new fixed empty GET before any process/hash/Dial
		// work. This is the exact bounded owned byte sequence later written on
		// the SAME socket; it is not a second HTTP attempt or a proof codec.
		req, err = http.NewRequestWithContext(s.ctx, http.MethodGet, "http://"+c.cfg.Service+path, nil)
		if err != nil {
			return exchange, out, err
		}
		req.Close = true
		if proofV4 != nil {
			req.Header.Set(ProductSessionProofV4Header, proofValue)
			bounded := originalLocalCallerProofV4RequestBuffer{}
			if err = req.Write(&bounded); err != nil {
				return exchange, out, err
			}
			requestWire = bounded.Bytes()
		} else {
			req.Header.Set(ProductSessionProofV2Header, proofValue)
			bounded := originalLocalCallerProofRequestBuffer{}
			if err = req.Write(&bounded); err != nil {
				return exchange, out, err
			}
			requestWire = bounded.Bytes()
		}
	}
	s.callbackDone = make(chan struct{})
	s.stopCallback = context.AfterFunc(s.ctx, func() {
		defer close(s.callbackDone)
		s.mu.Lock()
		intentional := s.manualRetire
		s.retired = true
		s.notifyLocked()
		s.mu.Unlock()
		if !intentional {
			s.remember(s.ctx.Err())
		}
		_ = s.closeOriginalSocket()
	})
	// Prepare holds the process root/directory and image before any Dial; a PID
	// reused across Dial cannot be admitted as the originally registered server.
	peer, e := prepareOriginalLocalCallerPeer(s.ctx, expected)
	s.mu.Lock()
	s.peer = peer // adopt every real peer partial before its error
	s.mu.Unlock()
	if e != nil {
		return exchange, out, e
	}
	if peer == nil {
		return exchange, out, ErrUnavailable
	}
	if e = s.connectOriginalSocket(c.cfg.SocketPath, c.cfg.PeerUID); e != nil {
		return exchange, out, e
	}
	u := s.conn
	deadline, _ := s.ctx.Deadline()
	if e = u.SetDeadline(deadline); e != nil {
		return exchange, out, e
	}
	if e = peer.bind(s.ctx, u); e != nil {
		return exchange, out, e
	}
	if req == nil {
		req, e = http.NewRequestWithContext(s.ctx, method, "http://"+c.cfg.Service+path, bytes.NewReader(body))
		if e != nil {
			return exchange, out, e
		}
		req.Close = true
		if contentType != "" {
			req.Header.Set("Content-Type", contentType)
		}
	}
	if e = s.observe(s.ctx, false); e != nil {
		return exchange, out, e
	}
	if e = s.ctx.Err(); e != nil {
		return exchange, out, e
	}
	s.mu.Lock()
	s.dispatched = true
	s.mu.Unlock()
	if requestWire != nil {
		n, writeErr := u.Write(requestWire)
		if writeErr == nil && n != len(requestWire) {
			writeErr = io.ErrShortWrite
		}
		if writeErr != nil {
			return exchange, out, writeErr
		}
	} else if e = req.Write(u); e != nil {
		return exchange, out, e
	}
	out, partialBytes, err = readBoundedLocalCallerResponse(u, req, c.cfg.MaxHeaderBytes, c.cfg.MaxResponseBytes)
	s.mu.Lock()
	s.bodyComplete = out.BodyComplete
	s.mu.Unlock()
	// Preserve a received prefix/original read error before late peer checks.
	if err != nil {
		s.remember(err)
	}
	if e = s.observe(s.ctx, out.BodyComplete); e != nil {
		if err == nil {
			err = e
		}
	}
	if e = s.ctx.Err(); err == nil && e != nil {
		err = e
	}
	return exchange, out, err
}

type originalLocalCallerProofRequestBuffer struct{ buffer bytes.Buffer }

func (b *originalLocalCallerProofRequestBuffer) Write(p []byte) (int, error) {
	if len(p) > MaxProductSessionProofV2RequestHeaderBytes-b.buffer.Len() {
		return 0, ErrBounds
	}
	return b.buffer.Write(p)
}

func (b *originalLocalCallerProofRequestBuffer) Bytes() []byte { return b.buffer.Bytes() }

func (s *originalLocalCallerExchangeState) observe(ctx context.Context, terminal bool) error {
	s.peerWork.Lock()
	defer s.peerWork.Unlock()
	s.mu.Lock()
	peer := s.peer
	s.mu.Unlock()
	if peer == nil || s.conn == nil {
		return ErrUnavailable
	}
	observation, err := peer.current(ctx, s.conn, terminal)
	s.mu.Lock()
	s.observation = observation
	s.mu.Unlock()
	return err
}

func (s *originalLocalCallerExchangeState) current(ctx context.Context) error {
	if ctx == nil || s.ownerPID != os.Getpid() {
		return ErrDenied
	}
	if err := ctx.Err(); err != nil {
		return err // a canceled observation probe is not issuer revocation
	}
	s.mu.Lock()
	if s.first != nil {
		err := s.first
		s.mu.Unlock()
		return err
	}
	if s.cleanupFirst != nil {
		err := s.cleanupFirst
		s.mu.Unlock()
		return err
	}
	if s.retired || s.closing || s.closed || !s.callComplete || s.ctx == nil {
		s.mu.Unlock()
		return ErrDenied
	}
	s.active++
	terminal := s.bodyComplete
	s.mu.Unlock()
	defer func() { s.mu.Lock(); s.active--; s.notifyLocked(); s.mu.Unlock() }()
	if err := s.ctx.Err(); err != nil {
		return s.remember(err)
	}
	if err := s.observe(ctx, terminal); err != nil {
		s.remember(err)
		_ = s.retire()
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.first != nil {
		return s.first
	}
	if s.cleanupFirst != nil {
		return s.cleanupFirst
	}
	if s.retired || s.ctx.Err() != nil {
		return ErrDenied
	}
	return nil
}

// Cancellation and explicit cleanup share the exact same selected close.
// socketClose is never held across peer/process or Source callbacks.
func (s *originalLocalCallerExchangeState) closeOriginalSocket() error {
	s.socketClose.Lock()
	defer s.socketClose.Unlock()
	if s.socketFD < 0 || s.socketSelected {
		return nil
	}
	s.socketSelected = true
	var err error
	if s.conn != nil {
		err = s.conn.Close()
	} else {
		err = unix.Close(s.socketFD)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.socketClosed = err == nil
	if err != nil {
		s.cleanupUnknown = true
		if s.cleanupFirst == nil {
			s.cleanupFirst = errors.Join(ErrOriginalLocalCallerCloseUnknown, err)
		}
	}
	s.notifyLocked()
	return err
}

func (s *originalLocalCallerExchangeState) retire() error {
	if s.ownerPID != os.Getpid() {
		return ErrDenied
	}
	s.mu.Lock()
	s.retired, s.manualRetire = true, true
	cancel := s.cancel
	s.notifyLocked()
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	_ = s.closeOriginalSocket()
	return s.resultError()
}

func (s *originalLocalCallerExchangeState) join(ctx context.Context) error {
	if ctx == nil || s.ownerPID != os.Getpid() {
		return ErrDenied
	}
	for {
		s.mu.Lock()
		if !s.retired {
			s.mu.Unlock()
			return ErrLocalCallerDraining
		}
		ready, changed := s.callComplete && s.active == 0, s.changed
		callback := s.callbackDone
		s.mu.Unlock()
		if ready {
			if callback != nil {
				select {
				case <-callback:
				case <-ctx.Done():
					return ctx.Err()
				}
			}
			s.mu.Lock()
			s.joined = true
			s.mu.Unlock()
			return s.resultError()
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-changed:
		}
	}
}

func (s *originalLocalCallerExchangeState) close() error {
	if s.ownerPID != os.Getpid() {
		return ErrDenied
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return s.resultError()
	}
	if s.cleanupUnknown {
		s.mu.Unlock()
		return s.resultError()
	}
	if !s.retired || !s.joined || !s.callComplete || s.active != 0 || s.closing {
		s.mu.Unlock()
		return ErrLocalCallerDraining
	}
	s.closing = true
	peer := s.peer
	s.mu.Unlock()
	_ = s.closeOriginalSocket()
	var peerErr error
	if peer != nil {
		s.peerWork.Lock()
		peerErr = peer.close()
		s.peerWork.Unlock()
	}
	s.socketClose.Lock()
	socketDone := s.socketFD < 0 || s.socketClosed
	s.socketClose.Unlock()
	s.mu.Lock()
	if peerErr != nil || (peer != nil && !peer.closed()) {
		s.cleanupUnknown = true
		if s.cleanupFirst == nil {
			s.cleanupFirst = errors.Join(ErrOriginalLocalCallerCloseUnknown, peerErr)
		}
	}
	s.closed = socketDone && !s.cleanupUnknown
	s.closing = false
	s.notifyLocked()
	closed := s.closed
	s.mu.Unlock()
	if closed {
		originalLocalCallerExchangeCustody.Lock()
		delete(originalLocalCallerExchangeCustody.owners, s)
		originalLocalCallerExchangeCustody.Unlock()
	}
	return s.resultError()
}

func (s *originalLocalCallerExchangeState) assertClosed() error {
	if s.ownerPID != os.Getpid() {
		return ErrDenied
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cleanupUnknown {
		return errors.Join(ErrOriginalLocalCallerCloseUnknown, s.cleanupFirst)
	}
	if !s.closed {
		return ErrLocalCallerDraining
	}
	return nil
}

func (s *originalLocalCallerExchangeState) lifetime() OriginalLocalCallerExchangeLifetime {
	s.mu.Lock()
	defer s.mu.Unlock()
	first := s.first
	if first == nil {
		first = s.cleanupFirst
	}
	return OriginalLocalCallerExchangeLifetime{Retired: s.retired, Joined: s.joined, Closed: s.closed, CleanupUnknown: s.cleanupUnknown, CallComplete: s.callComplete, DispatchPossible: s.dispatched, Active: s.active, FirstCause: first, Peer: s.observation}
}

// No net.Dialer/FileConn hides an intermediate socket close or descriptor dup.
// The original socket is adopted immediately, before Connect or peer checks.
// This is still the same client's fixed Unix destination and bounded HTTP; no
// alternate endpoint, reconnect, retry, heartbeat or remote protocol is added.
func (s *originalLocalCallerExchangeState) connectOriginalSocket(path string, uid uint32) error {
	if err := s.ctx.Err(); err != nil {
		return err
	}
	if err := privateParent(path, uid); err != nil {
		return err
	}
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok || info.Mode()&os.ModeSocket == 0 || info.Mode().Perm()&0077 != 0 || uint32(st.Uid) != uid {
		return ErrDenied
	}
	s.socketClose.Lock()
	// Serialize the non-atomic Darwin Socket/CLOEXEC sequence against Go's
	// ForkExec. No child may inherit an untracked copy during setup.
	syscall.ForkLock.RLock()
	fd, err := unix.Socket(unix.AF_UNIX, unix.SOCK_STREAM, 0)
	if fd >= 0 {
		s.socketFD = fd
	}
	if err == nil {
		var flags int
		flags, err = unix.FcntlInt(uintptr(fd), unix.F_GETFD, 0)
		if err == nil {
			_, err = unix.FcntlInt(uintptr(fd), unix.F_SETFD, flags|unix.FD_CLOEXEC)
		}
		if err == nil {
			err = unix.SetNonblock(fd, true)
		}
		if err == nil {
			s.conn = os.NewFile(uintptr(fd), "LINK original local client")
			if s.conn == nil {
				err = ErrUnavailable
			}
		}
	}
	syscall.ForkLock.RUnlock()
	s.socketClose.Unlock()
	if err != nil {
		return err
	}
	if err = s.ctx.Err(); err != nil {
		return err
	}
	raw, err := s.conn.SyscallConn()
	if err != nil {
		return err
	}
	var connected error
	if err = raw.Control(func(original uintptr) {
		connected = unix.Connect(int(original), &unix.SockaddrUnix{Name: path})
	}); err != nil {
		return err
	}
	if connected == nil {
		return nil
	}
	if !errors.Is(connected, unix.EINPROGRESS) && !errors.Is(connected, unix.EALREADY) {
		return connected
	}
	// A pending Connect is completed on THIS socket; Connect is never reissued.
	for {
		if err = s.ctx.Err(); err != nil {
			return err
		}
		var pollErr error
		var ready bool
		if err = raw.Control(func(original uintptr) {
			fds := []unix.PollFd{{Fd: int32(original), Events: unix.POLLOUT}}
			_, pollErr = unix.Poll(fds, 25)
			if pollErr != nil || fds[0].Revents == 0 {
				return
			}
			if fds[0].Revents&unix.POLLNVAL != 0 {
				pollErr = unix.EBADF
				return
			}
			var code int
			code, pollErr = unix.GetsockoptInt(int(original), unix.SOL_SOCKET, unix.SO_ERROR)
			if pollErr == nil && code != 0 {
				pollErr = syscall.Errno(code)
			}
			ready = pollErr == nil && fds[0].Revents&unix.POLLOUT != 0
			if !ready && pollErr == nil {
				pollErr = ErrDenied
			}
		}); err != nil {
			return err
		}
		if errors.Is(pollErr, unix.EINTR) {
			continue
		}
		if pollErr != nil {
			return pollErr
		}
		if ready {
			return nil
		}
	}
}
