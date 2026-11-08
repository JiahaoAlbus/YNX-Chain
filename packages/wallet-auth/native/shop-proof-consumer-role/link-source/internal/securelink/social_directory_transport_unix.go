//go:build linux || darwin

package securelink

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"reflect"
	"sync"
	"time"

	"golang.org/x/sys/unix"
)

type socialDirectoryPeerConnection struct {
	mu        sync.Mutex
	conn      *net.UnixConn
	uid       uint32
	pid, self int
	closed    bool
}

func (p *socialDirectoryPeerConnection) current(ctx context.Context) error {
	if p == nil || ctx == nil {
		return ErrDenied
	}
	if e := ctx.Err(); e != nil {
		return e
	}
	p.mu.Lock()
	c, closed := p.conn, p.closed
	p.mu.Unlock()
	if c == nil || closed || p.self != os.Getpid() {
		return ErrDenied
	}
	if e := localPeer(c, p.uid, p.pid); e != nil {
		return e
	}
	p.mu.Lock()
	same := !p.closed && p.conn == c
	p.mu.Unlock()
	if !same {
		return ErrDenied
	}
	return ctx.Err()
}

type SocialDirectoryForwarder struct {
	cfg     SocialDirectoryForwarderConfig
	mu      sync.Mutex
	retired bool
	seen    map[*http.Request]map[SocialDirectoryOperation]*socialDirectoryCall
}
type SocialDirectoryResponseLoan struct{ call *socialDirectoryCall }
type socialDirectoryCall struct {
	parent                                         *SocialDirectoryForwarder
	original                                       *socialDirectoryOriginalRequest
	ctx                                            context.Context
	cancel                                         context.CancelFunc
	operation                                      SocialDirectoryOperation
	mu, writeMu                                    sync.Mutex
	binding                                        SocialDirectoryReadBinding
	originals                                      SocialDirectoryOriginals
	peer                                           *socialDirectoryPeerConnection
	control                                        *net.UnixConn
	controlDone, forwardDone, originalEnded        chan struct{}
	first                                          error
	unknown, retired, dispatch, complete           bool
	wSelected, wWritten, ackReceived, remoteClosed bool
	localClosing, localDone, bindingClosed         bool
	localCloseUnknown                              bool
	bindingRetired, closeSelected, finishRunning   bool
	response                                       SocialDirectoryResponseDATA
	requestSHA, responseSHA                        [32]byte
	hashesKnown                                    bool
	changed                                        chan struct{}
}

func NewSocialDirectoryForwarderForOriginalBootstrap(cfg SocialDirectoryForwarderConfig) (*SocialDirectoryForwarder, error) {
	if !localService(cfg.Service) || cfg.PeerUID == 0 || cfg.PeerPID <= 0 || cfg.OpenOriginalReadBinding == nil {
		return nil, ErrDenied
	}
	if cfg.Timeout <= 0 || cfg.Timeout > 30*time.Second {
		return nil, ErrBounds
	}
	if cfg.MaxConcurrentRequests == 0 {
		cfg.MaxConcurrentRequests = 16
	}
	if cfg.MaxConcurrentRequests < 1 || cfg.MaxConcurrentRequests > 64 {
		return nil, ErrBounds
	}
	if e := privateParent(cfg.SocketPath, cfg.PeerUID); e != nil {
		return nil, e
	}
	return &SocialDirectoryForwarder{cfg: cfg, seen: make(map[*http.Request]map[SocialDirectoryOperation]*socialDirectoryCall)}, nil
}
func (s *socialDirectoryCall) notifyLocked() { close(s.changed); s.changed = make(chan struct{}) }

// A request's original context may end before its actual cleanup. Reap on
// both events, and only after every operation under that same request has
// returned its real local, remote and binding debts. UNKNOWN stays bounded.
func (f *SocialDirectoryForwarder) reap(r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, call := range f.seen[r] {
		select {
		case <-call.originalEnded:
		default:
			return
		}
		call.mu.Lock()
		closed := call.bindingClosed && call.localDone && (!call.dispatch || call.remoteClosed)
		call.mu.Unlock()
		if !closed {
			return
		}
	}
	delete(f.seen, r)
}

func (s *socialDirectoryCall) remember(e error, unknown bool) error {
	if e == nil {
		return nil
	}
	s.mu.Lock()
	if s.first == nil {
		s.first = e
	}
	s.unknown = s.unknown || unknown
	first := s.first
	s.notifyLocked()
	s.mu.Unlock()
	return first
}
func socialDirectoryBindingNil(b SocialDirectoryReadBinding) bool {
	if b == nil {
		return true
	}
	v := reflect.ValueOf(b)
	switch v.Kind() {
	case reflect.Pointer, reflect.Map, reflect.Interface, reflect.Slice, reflect.Func, reflect.Chan:
		return v.IsNil()
	}
	return false
}
func socialDirectoryCopyOriginals(v SocialDirectoryOriginals) (SocialDirectoryOriginals, error) {
	if len(v.RequestOriginal) < 1 || len(v.RequestOriginal) > 393216 || len(v.SourceBindingOriginal) < 1 || len(v.SourceBindingOriginal) > 1<<20 || len(v.SourceWindowOriginal) < 1 || len(v.SourceWindowOriginal) > 65536 {
		return SocialDirectoryOriginals{}, ErrBounds
	}
	return SocialDirectoryOriginals{bytes.Clone(v.RequestOriginal), bytes.Clone(v.SourceBindingOriginal), bytes.Clone(v.SourceWindowOriginal)}, nil
}
func sameSocialDirectoryOriginals(a, b SocialDirectoryOriginals) bool {
	return bytes.Equal(a.RequestOriginal, b.RequestOriginal) && bytes.Equal(a.SourceBindingOriginal, b.SourceBindingOriginal) && bytes.Equal(a.SourceWindowOriginal, b.SourceWindowOriginal)
}
func (s *socialDirectoryCall) current() error {
	if e := s.original.localCurrent(s.original.original); e != nil {
		return e
	}
	s.mu.Lock()
	b, p, w := s.binding, s.peer, s.wSelected
	s.mu.Unlock()
	if socialDirectoryBindingNil(b) || w {
		return ErrDenied
	}
	if e := b.Current(s.ctx); e != nil {
		return e
	}
	got, e := b.Originals(s.ctx)
	if e != nil {
		return e
	}
	if !sameSocialDirectoryOriginals(got, s.originals) {
		return ErrDenied
	}
	if p != nil {
		if e = p.current(s.ctx); e != nil {
			return e
		}
	}
	if e = s.original.localCurrent(s.original.original); e != nil {
		return e
	}
	return b.Current(s.ctx)
}
func (s *socialDirectoryCall) metadata() ([]byte, error) {
	if e := s.current(); e != nil {
		return nil, e
	}
	meta, e := json.Marshal(struct {
		Kind                                                                        string `json:"transportKind"`
		Service                                                                     string
		Operation                                                                   SocialDirectoryOperation
		Method, Path, Host                                                          string
		ContentLength                                                               int64
		RequestOriginalBytes, SourceBindingOriginalBytes, SourceWindowOriginalBytes int
	}{SocialDirectoryTransportKind, s.parent.cfg.Service, s.operation, http.MethodGet, s.original.path, s.original.host, 0, len(s.originals.RequestOriginal), len(s.originals.SourceBindingOriginal), len(s.originals.SourceWindowOriginal)})
	if e != nil || len(meta) > 65536 {
		return nil, ErrBounds
	}
	n := 4 + len(meta) + len(s.originals.RequestOriginal) + len(s.originals.SourceBindingOriginal) + len(s.originals.SourceWindowOriginal)
	if n > 2<<20 {
		return nil, ErrBounds
	}
	frame := make([]byte, 8, 4+n)
	binary.BigEndian.PutUint32(frame[:4], uint32(n))
	binary.BigEndian.PutUint32(frame[4:], uint32(len(meta)))
	frame = append(frame, meta...)
	frame = append(frame, s.originals.RequestOriginal...)
	frame = append(frame, s.originals.SourceBindingOriginal...)
	frame = append(frame, s.originals.SourceWindowOriginal...)
	if e = s.current(); e != nil {
		return nil, e
	}
	return frame, nil
}
func (s *socialDirectoryCall) controlLoop() {
	defer func() {
		if value := recover(); value != nil {
			s.remember(fmt.Errorf("Social binding panic (%T)", value), true)
		}
		close(s.controlDone)
	}()
	queries := 0
	for {
		var tag [1]byte
		if _, e := io.ReadFull(s.control, tag[:]); e != nil {
			s.mu.Lock()
			done := s.localClosing || s.localDone
			s.mu.Unlock()
			if !done {
				s.remember(e, true)
			}
			return
		}
		if tag[0] == 'C' {
			queries++
			if queries > 64 {
				s.remember(ErrBounds, true)
				return
			}
			frame, e := s.metadata()
			s.writeMu.Lock()
			s.mu.Lock()
			w := s.wSelected
			s.mu.Unlock()
			if e != nil || w {
				_, _ = s.control.Write([]byte{0, 0, 0, 0})
				s.writeMu.Unlock()
				if e == nil {
					e = ErrDenied
				}
				s.remember(e, true)
				return
			}
			_, e = io.Copy(s.control, bytes.NewReader(frame))
			s.writeMu.Unlock()
			if e != nil {
				s.remember(e, true)
				return
			}
			continue
		}
		if tag[0] != 'A' {
			s.remember(ErrSocialDirectoryUnknown, true)
			return
		}
		frame := make([]byte, 81)
		frame[0] = 'A'
		if _, e := io.ReadFull(s.control, frame[1:]); e != nil {
			s.remember(e, true)
			return
		}
		s.mu.Lock()
		selected, req, resp := s.wSelected, s.requestSHA, s.responseSHA
		s.mu.Unlock()
		if !selected {
			s.remember(ErrSocialDirectoryUnknown, true)
			return
		}
		ack, e := decodeSocialDirectoryClosedAck(frame, req, resp)
		if e != nil {
			s.remember(e, true)
			return
		}
		// A is independent from expected post-A EOF; check identity on the
		// retained data fd, not the Main-created control socketpair's PID.
		s.peer.mu.Lock()
		data := s.peer.conn
		s.peer.mu.Unlock()
		if data == nil {
			s.remember(ErrSocialDirectoryUnknown, true)
			return
		}
		raw, e := data.SyscallConn()
		if e != nil {
			s.remember(e, true)
			return
		}
		var peerError error
		e = raw.Control(func(fd uintptr) {
			u, p, err := localPeerCredentials(int(fd))
			if err != nil {
				peerError = err
			} else if u != s.parent.cfg.PeerUID || p != s.parent.cfg.PeerPID {
				peerError = ErrDenied
			}
		})
		if e == nil {
			e = peerError
		}
		if e != nil {
			s.remember(e, true)
			return
		}
		s.mu.Lock()
		s.ackReceived = true
		s.remoteClosed = ack.Closed
		s.notifyLocked()
		s.mu.Unlock()
		if ack.ErrorPresent {
			s.remember(SocialDirectoryRemoteError{Kind: ack.ErrorKind, Code: ack.ErrorCode}, false)
		}
		if !ack.Closed {
			s.remember(ErrSocialDirectoryUnknown, true)
		}
		return
	}
}

func (f *SocialDirectoryForwarder) ForwardOriginal(ctx context.Context, r *http.Request, operation SocialDirectoryOperation) (loan *SocialDirectoryResponseLoan, err error) {
	if f == nil || (operation != SocialDirectoryCurrent && operation != SocialDirectoryRecheck) {
		return nil, ErrDenied
	}
	original, e := captureSocialDirectoryOriginalRequest(ctx, r)
	if e != nil {
		return nil, e
	}
	private, cancel := context.WithTimeout(original.ctx, f.cfg.Timeout)
	s := &socialDirectoryCall{parent: f, original: original, ctx: private, cancel: cancel, operation: operation, forwardDone: make(chan struct{}), originalEnded: make(chan struct{}), changed: make(chan struct{})}
	loan = &SocialDirectoryResponseLoan{call: s}
	f.mu.Lock()
	if f.retired || (f.seen[r] == nil && len(f.seen) >= f.cfg.MaxConcurrentRequests) {
		f.mu.Unlock()
		cancel()
		original.cancel(ErrDenied)
		return nil, ErrDenied
	}
	ops := f.seen[r]
	if ops == nil {
		ops = make(map[SocialDirectoryOperation]*socialDirectoryCall)
		f.seen[r] = ops
	}
	if ops[operation] != nil {
		f.mu.Unlock()
		cancel()
		original.cancel(ErrDenied)
		return nil, ErrDenied
	}
	for _, prior := range ops {
		prior.mu.Lock()
		allowed := prior.bindingClosed && prior.localDone && prior.first == nil && !prior.unknown
		prior.mu.Unlock()
		if !allowed {
			f.mu.Unlock()
			cancel()
			original.cancel(ErrDenied)
			return nil, ErrDenied
		}
	}
	ops[operation] = s
	f.mu.Unlock()
	// Remove only known-closed tombstones after the original context ends.
	// An unresolved attempt remains owned and bounded; it cannot be replayed.
	context.AfterFunc(r.Context(), func() {
		close(s.originalEnded)
		f.reap(r)
	})
	defer func() {
		if value := recover(); value != nil {
			err = s.remember(fmt.Errorf("Social binding opener panic (%T)", value), true)
		}
		s.mu.Lock()
		physicalUnknown := s.dispatch && (!s.complete || !s.hashesKnown)
		s.mu.Unlock()
		if err != nil {
			err = s.remember(err, physicalUnknown)
		}
		close(s.forwardDone)
		s.mu.Lock()
		s.notifyLocked()
		s.mu.Unlock()
	}()
	// Non-null partial is adopted before an actual opener error is inspected.
	binding, openErr := f.cfg.OpenOriginalReadBinding(private, r, &OriginalSocialDirectoryCaller{request: original}, operation)
	s.binding = binding
	if openErr != nil {
		return loan, openErr
	}
	if socialDirectoryBindingNil(binding) {
		return loan, ErrDenied
	}
	got, e := binding.Originals(private)
	if e != nil {
		return loan, e
	}
	s.originals, e = socialDirectoryCopyOriginals(got)
	if e != nil {
		return loan, e
	}
	if e = s.current(); e != nil {
		return loan, e
	}
	conn, e := DialPrivate(private, f.cfg.SocketPath, f.cfg.PeerUID)
	if e != nil {
		return loan, e
	}
	data, ok := conn.(*net.UnixConn)
	if !ok {
		_ = conn.Close()
		return loan, ErrDenied
	}
	s.peer = &socialDirectoryPeerConnection{conn: data, uid: f.cfg.PeerUID, pid: f.cfg.PeerPID, self: os.Getpid()}
	original.peer.Store(s.peer)
	// Cancel only this owned connection's blocked operations. Go's net.Conn
	// object pins its descriptor; this never stores/reuses a raw numeric fd.
	context.AfterFunc(private, func() {
		_ = data.SetDeadline(time.Now())
		// Business cancellation stops HTTP IO, not an already known original
		// response's W/A cleanup. Finish gives control IO its own bounded
		// deadline; it can never dispatch another HTTP request or C permission.
	})
	if e = s.peer.current(private); e != nil {
		return loan, e
	}
	control, nodeFD, e := authorityControlPair()
	if e != nil {
		return loan, e
	}
	s.mu.Lock()
	s.control = control
	s.mu.Unlock()
	defer nodeFD.Close()
	deadline, _ := private.Deadline()
	_ = data.SetDeadline(deadline)
	_ = control.SetWriteDeadline(deadline)
	if e = s.current(); e != nil {
		return loan, e
	}
	rights := unix.UnixRights(int(nodeFD.Fd()))
	n, on, e := data.WriteMsgUnix([]byte{'L'}, rights, nil)
	if e != nil || n != 1 || on != len(rights) {
		if e == nil {
			e = ErrDenied
		}
		return loan, e
	}
	_ = nodeFD.Close()
	s.controlDone = make(chan struct{})
	go s.controlLoop()
	req, e := http.NewRequestWithContext(private, http.MethodGet, "http://"+f.cfg.Service+original.path, nil)
	if e != nil {
		return loan, e
	}
	req.Header.Set(SocialDirectoryProofHeader, original.headers.Get(SocialDirectoryProofHeader))
	req.ContentLength = 0
	if e = s.current(); e != nil {
		return loan, e
	}
	s.mu.Lock()
	s.dispatch = true
	s.mu.Unlock()
	if e = req.Write(data); e != nil {
		return loan, e
	}
	budget := &wireBudget{reader: data, remaining: SocialDirectoryMaxHeaders}
	reader := bufio.NewReader(budget)
	resp, e := http.ReadResponse(reader, req)
	if e != nil {
		return loan, e
	}
	defer resp.Body.Close()
	s.mu.Lock()
	s.response.StatusCode = resp.StatusCode
	s.response.Header = resp.Header.Clone()
	s.mu.Unlock()
	budget.remaining = 524288 + SocialDirectoryMaxHeaders - int64(reader.Buffered())
	body, readError := io.ReadAll(io.LimitReader(resp.Body, 524289))
	s.mu.Lock()
	s.response.Body = bytes.Clone(body)
	s.complete = readError == nil && len(body) <= 524288
	s.response.BodyComplete = s.complete
	s.responseSHA = sha256.Sum256(body)
	s.mu.Unlock()
	if readError != nil {
		return loan, readError
	}
	if len(body) > 524288 {
		return loan, ErrBounds
	}
	if resp.StatusCode < 200 || resp.StatusCode > 599 || resp.Header.Get("Content-Type") != "application/json" || len(resp.Header.Values("Content-Type")) != 1 || resp.Header.Get("Content-Encoding") != "" {
		return loan, ErrDenied
	}
	// Only Main's original verifier supplies the independent Qualified9 hash.
	reqSHA, e := binding.InspectOriginalRootResponse(private, bytes.Clone(body))
	if e != nil {
		return loan, e
	}
	if reqSHA != sha256.Sum256(s.originals.RequestOriginal) {
		return loan, ErrDenied
	}
	s.mu.Lock()
	s.requestSHA = reqSHA
	s.hashesKnown = true
	s.mu.Unlock()
	if e = s.current(); e != nil {
		return loan, e
	}
	return loan, nil
}
func (l *SocialDirectoryResponseLoan) Response() SocialDirectoryResponseDATA {
	if l == nil || l.call == nil {
		return SocialDirectoryResponseDATA{}
	}
	s := l.call
	s.mu.Lock()
	defer s.mu.Unlock()
	return SocialDirectoryResponseDATA{s.response.StatusCode, s.response.Header.Clone(), bytes.Clone(s.response.Body), s.response.BodyComplete}
}
func (l *SocialDirectoryResponseLoan) Retire() {
	if l == nil || l.call == nil {
		return
	}
	s := l.call
	s.mu.Lock()
	s.retired = true
	s.notifyLocked()
	s.mu.Unlock()
	s.original.retired.Store(true)
	s.cancel()
}
func (l *SocialDirectoryResponseLoan) Lifetime() SocialDirectoryTransportLifetime {
	if l == nil || l.call == nil {
		return SocialDirectoryTransportLifetime{Unknown: true}
	}
	s := l.call
	s.mu.Lock()
	defer s.mu.Unlock()
	closed := s.localDone && s.bindingClosed && (!s.dispatch || s.remoteClosed)
	return SocialDirectoryTransportLifetime{s.retired, s.dispatch, s.complete, s.wWritten, s.ackReceived, s.remoteClosed, s.localDone, s.bindingClosed, closed, s.unknown || s.first != nil, closed && !s.retired && s.first == nil && !s.unknown}
}
func (l *SocialDirectoryResponseLoan) FirstCause() error {
	if l == nil || l.call == nil {
		return ErrDenied
	}
	s := l.call
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.first
}

// Local descriptors and the original control worker can drain even when the
// remote paired loan is UNKNOWN. That does not release the Main Source borrow
// or turn EOF into a closed ACK. A failed actual Close is selected once only.
// A later waiter may finish waiting for that same worker, never close again.
func (s *socialDirectoryCall) finishLocal(ctx context.Context) (bool, error) {
	s.mu.Lock()
	if s.localDone {
		s.mu.Unlock()
		return true, nil
	}
	selected := s.localClosing
	s.localClosing = true
	s.mu.Unlock()
	if !selected {
		s.cancel()
		s.original.active.Store(false)
		s.original.cancel(context.Canceled)
		var closeErr error
		if s.peer != nil {
			s.peer.mu.Lock()
			s.peer.closed = true
			data := s.peer.conn
			s.peer.mu.Unlock()
			if data != nil {
				closeErr = data.Close()
			}
		}
		if s.control != nil {
			if e := s.control.Close(); e != nil && closeErr == nil {
				closeErr = e
			}
		}
		if closeErr != nil {
			s.mu.Lock()
			s.localCloseUnknown = true
			s.mu.Unlock()
			s.remember(closeErr, true)
		}
	}
	if s.controlDone != nil {
		select {
		case <-s.controlDone:
		case <-ctx.Done():
			return false, ctx.Err()
		}
	}
	s.mu.Lock()
	done := !s.localCloseUnknown
	s.localDone = done
	first := s.first
	s.notifyLocked()
	s.mu.Unlock()
	return done, first
}

// Same-attempt cleanup only. Never redial, replay a nonce, or treat EOF as A.
func (l *SocialDirectoryResponseLoan) Finish(ctx context.Context) (done bool, err error) {
	if l == nil || l.call == nil || ctx == nil {
		return false, ErrDenied
	}
	s := l.call
	defer func() {
		if value := recover(); value != nil {
			done = false
			err = s.remember(fmt.Errorf("Social binding cleanup panic (%T)", value), true)
		}
	}()
	select {
	case <-s.forwardDone:
	case <-ctx.Done():
		return false, ctx.Err()
	}
	for {
		s.mu.Lock()
		if s.finishRunning {
			change := s.changed
			s.mu.Unlock()
			select {
			case <-change:
				continue
			case <-ctx.Done():
				return false, ctx.Err()
			}
		}
		if s.bindingClosed && s.localDone {
			done := !s.dispatch || s.remoteClosed
			first := s.first
			s.mu.Unlock()
			return done, first
		}
		s.finishRunning = true
		s.mu.Unlock()
		break
	}
	defer func() { s.mu.Lock(); s.finishRunning = false; s.notifyLocked(); s.mu.Unlock() }()
	if e := s.ctx.Err(); e != nil {
		// Original business failure remains a failure even though independent
		// same-attempt cleanup can still return known physical facts.
		s.remember(context.Cause(s.ctx), false)
	}
	// Every selected cleanup, including malformed/half/lost A, returns the
	// original owned local worker and fd facts. Remote UNKNOWN retains binding.
	defer func() {
		local, localErr := s.finishLocal(ctx)
		if !local {
			done = false
		}
		if err == nil && localErr != nil {
			err = localErr
		}
	}()
	s.mu.Lock()
	dispatched, known, complete, alreadyClosed, unknown := s.dispatch, s.hashesKnown, s.complete, s.ackReceived && s.remoteClosed, s.unknown
	s.mu.Unlock()
	if unknown {
		return false, s.remember(ErrSocialDirectoryUnknown, true)
	}
	if dispatched && !alreadyClosed {
		if !known || !complete {
			return false, s.remember(ErrSocialDirectoryUnknown, true)
		}
		if e := s.binding.Current(ctx); e != nil {
			s.remember(e, false)
		}
		cleanupDeadline := time.Now().Add(s.parent.cfg.Timeout)
		if end, ok := ctx.Deadline(); ok && end.Before(cleanupDeadline) {
			cleanupDeadline = end
		}
		if e := s.control.SetDeadline(cleanupDeadline); e != nil {
			return false, s.remember(e, true)
		}
		s.writeMu.Lock()
		s.mu.Lock()
		already := s.wSelected
		if !already {
			s.wSelected = true
		}
		req, resp := s.requestSHA, s.responseSHA
		s.mu.Unlock()
		if !already {
			frame := encodeSocialDirectoryReadRelease(req, resp)
			_, e := io.Copy(s.control, bytes.NewReader(frame[:]))
			if e != nil {
				s.writeMu.Unlock()
				return false, s.remember(e, true)
			}
			s.mu.Lock()
			s.wWritten = true
			s.notifyLocked()
			s.mu.Unlock()
		}
		s.writeMu.Unlock()
		select {
		case <-s.controlDone:
		case <-ctx.Done():
			return false, ctx.Err()
		}
		s.mu.Lock()
		ack, remote, unknown := s.ackReceived, s.remoteClosed, s.unknown
		s.mu.Unlock()
		if !ack || !remote || unknown {
			return false, s.remember(ErrSocialDirectoryUnknown, true)
		}
		if e := s.binding.Current(ctx); e != nil {
			s.remember(e, false)
		}
	}
	if local, e := s.finishLocal(ctx); !local {
		return false, e
	}
	if !socialDirectoryBindingNil(s.binding) {
		s.mu.Lock()
		retired := s.bindingRetired
		s.bindingRetired = true
		s.mu.Unlock()
		if !retired {
			s.binding.Retire()
		}
		if e := s.binding.Join(ctx); e != nil {
			return false, s.remember(e, false)
		}
		s.mu.Lock()
		if s.closeSelected {
			s.mu.Unlock()
			return false, s.remember(ErrSocialDirectoryUnknown, true)
		}
		s.closeSelected = true
		s.mu.Unlock()
		closed, e := s.binding.Close()
		if e != nil {
			s.remember(e, !closed)
		}
		if !closed {
			return false, s.remember(ErrSocialDirectoryUnknown, true)
		}
	}
	s.mu.Lock()
	s.bindingClosed = true
	s.notifyLocked()
	first := s.first
	s.mu.Unlock()
	s.parent.reap(s.original.original)
	return true, first
}
func (l *SocialDirectoryResponseLoan) Join(ctx context.Context) (bool, error)  { return l.Finish(ctx) }
func (l *SocialDirectoryResponseLoan) Close(ctx context.Context) (bool, error) { return l.Finish(ctx) }
func (f *SocialDirectoryForwarder) Retire() {
	if f == nil {
		return
	}
	f.mu.Lock()
	f.retired = true
	calls := []*socialDirectoryCall{}
	for _, ops := range f.seen {
		for _, s := range ops {
			calls = append(calls, s)
		}
	}
	f.mu.Unlock()
	for _, s := range calls {
		(&SocialDirectoryResponseLoan{s}).Retire()
	}
}
func (f *SocialDirectoryForwarder) Join(ctx context.Context) error {
	if f == nil || ctx == nil {
		return ErrDenied
	}
	f.mu.Lock()
	retired := f.retired
	calls := []*socialDirectoryCall{}
	for _, ops := range f.seen {
		for _, s := range ops {
			calls = append(calls, s)
		}
	}
	f.mu.Unlock()
	if !retired {
		return ErrDenied
	}
	var first error
	for _, s := range calls {
		done, e := (&SocialDirectoryResponseLoan{s}).Finish(ctx)
		if e != nil && first == nil {
			first = e
		}
		if !done {
			if first == nil {
				first = ErrSocialDirectoryUnknown
			}
		}
	}
	return first
}
func (f *SocialDirectoryForwarder) Close(ctx context.Context) (bool, error) {
	if f == nil {
		return true, nil
	}
	f.Retire()
	err := f.Join(ctx)
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, ops := range f.seen {
		for _, s := range ops {
			s.mu.Lock()
			done := s.bindingClosed && s.localDone && (!s.dispatch || s.remoteClosed)
			s.mu.Unlock()
			if !done {
				return false, err
			}
		}
	}
	return true, err
}
