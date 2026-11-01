//go:build linux || darwin

package securelink

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"reflect"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/sys/unix"
)

type OriginalTaskRuntimeForwarder struct {
	cfg     TaskRuntimeForwarderConfig
	retired atomic.Bool
	mu      sync.Mutex
	active  map[*taskRuntimeRequest]bool
	seen    map[*http.Request]*taskRuntimeRequest
	changed chan struct{}
}

type taskRuntimeFailure struct{ err error }
type taskRuntimeContextKey struct{}
type taskRuntimeRequest struct {
	parent                                 *OriginalTaskRuntimeForwarder
	request                                *http.Request
	originalCtx, ctx                       context.Context
	cancel                                 context.CancelFunc
	method, target, uri, host, contentType string
	contentTypes                           int
	length                                 int64
	body                                   io.ReadCloser
	headers                                http.Header
	envelope                               []byte
	path                                   string
	active, finished, released             atomic.Bool
	executed                               atomic.Bool
	first                                  atomic.Pointer[taskRuntimeFailure]
	cleanupFirst                           atomic.Pointer[taskRuntimeFailure]
	mu                                     sync.Mutex
	data, control                          *net.UnixConn
	session                                TaskRuntimeSession
	retireOnce                             sync.Once
	draining                               atomic.Bool
	closeOnce                              sync.Once
	closeErr                               error
}

func NewOriginalTaskRuntimeForwarder(cfg TaskRuntimeForwarderConfig) (*OriginalTaskRuntimeForwarder, error) {
	if !localService(cfg.Service) || cfg.PeerUID == 0 || cfg.PeerPID <= 0 || cfg.OpenSession == nil {
		return nil, ErrUnavailable
	}
	if err := privateParent(cfg.SocketPath, cfg.PeerUID); err != nil {
		return nil, err
	}
	if cfg.Timeout == 0 {
		cfg.Timeout = 30 * time.Second
	}
	if cfg.MaxConcurrentRequests == 0 {
		cfg.MaxConcurrentRequests = 16
	}
	if cfg.Timeout <= 0 || cfg.Timeout > time.Minute || cfg.MaxConcurrentRequests < 1 || cfg.MaxConcurrentRequests > 64 {
		return nil, ErrBounds
	}
	return &OriginalTaskRuntimeForwarder{cfg: cfg, active: make(map[*taskRuntimeRequest]bool), seen: make(map[*http.Request]*taskRuntimeRequest), changed: make(chan struct{}, 1)}, nil
}

func (s *taskRuntimeRequest) remember(err error) error {
	if err == nil {
		return nil
	}
	s.first.CompareAndSwap(nil, &taskRuntimeFailure{err: err})
	return s.first.Load().err
}
func sameTaskRuntimeContext(a, b context.Context) bool {
	if a == nil || b == nil {
		return false
	}
	t := reflect.TypeOf(a)
	v := reflect.ValueOf(a)
	if (v.Kind() == reflect.Pointer || v.Kind() == reflect.Interface) && v.IsNil() {
		return false
	}
	return t.Comparable() && t == reflect.TypeOf(b) && a == b
}

// Capture the original request's bounded header DATA once, outside any Store
// lock. The synchronous fence compares against this private copy; it never
// clones caller DATA or invokes a caller-supplied callback.
func taskRuntimeHeaders(h http.Header) (http.Header, error) {
	const maxHeaders = 256 << 10
	remaining := maxHeaders
	for key, values := range h {
		if len(key)+4 > remaining {
			return nil, ErrBounds
		}
		remaining -= len(key) + 4
		for _, value := range values {
			if len(value)+2 > remaining {
				return nil, ErrBounds
			}
			remaining -= len(value) + 2
		}
	}
	return h.Clone(), nil
}

func sameTaskRuntimeHeaders(current, original http.Header) bool {
	if len(current) != len(original) {
		return false
	}
	// Iterate only the already bounded private snapshot. A changed request
	// cannot make the lock-internal fence walk an unbounded caller map/slice.
	for key, values := range original {
		actual, ok := current[key]
		if !ok || len(actual) != len(values) {
			return false
		}
		for i, value := range values {
			if actual[i] != value {
				return false
			}
		}
	}
	return true
}
func (s *taskRuntimeRequest) localCurrent(r *http.Request) error {
	return s.requestCurrent(r, true)
}
func (s *taskRuntimeRequest) requestCurrent(r *http.Request, checkRelease bool) error {
	if s == nil || r == nil || r != s.request || !sameTaskRuntimeContext(r.Context(), s.originalCtx) || r.URL == nil || r.Method != s.method || r.URL.String() != s.target || r.RequestURI != s.uri || r.Host != s.host || r.Header.Get("Content-Type") != s.contentType || len(r.Header.Values("Content-Type")) != s.contentTypes || !sameTaskRuntimeHeaders(r.Header, s.headers) || r.ContentLength != s.length || !sameIngressBody(r.Body, s.body) || localIdentityHeader(r.Header) {
		return ErrDenied
	}
	// ctx is our private WithTimeout child; never invoke a request-supplied
	// context Value/Err callback while the owner holds its actual Store lock.
	if err := s.ctx.Err(); err != nil {
		return context.Cause(s.ctx)
	}
	if !s.active.Load() || s.parent.retired.Load() || (checkRelease && s.released.Load()) {
		return ErrDenied
	}
	return nil
}
func (s *taskRuntimeRequest) freshCurrent(ctx context.Context) error {
	if err := s.localCurrent(s.request); err != nil {
		return err
	}
	return s.transportFreshCurrent(ctx)
}
func (s *taskRuntimeRequest) transportFreshCurrent(ctx context.Context) error {
	if ctx == nil || ctx.Value(taskRuntimeContextKey{}) != s {
		return ErrDenied
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := s.requestCurrent(s.request, false); err != nil {
		return err
	}
	s.mu.Lock()
	data := s.data
	s.mu.Unlock()
	if err := localPeer(data, s.parent.cfg.PeerUID, s.parent.cfg.PeerPID); err != nil {
		return err
	}
	return s.requestCurrent(s.request, false)
}
func (f *OriginalTaskRuntimeForwarder) notify() {
	select {
	case f.changed <- struct{}{}:
	default:
	}
}
func (s *taskRuntimeRequest) stop() {
	s.active.Store(false)
	s.cancel()
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
func (s *taskRuntimeRequest) retire() {
	s.mu.Lock()
	session := s.session
	s.mu.Unlock()
	if session != nil {
		s.retireOnce.Do(session.Retire)
	}
}

// drain is cleanup ONLY. A caller-supplied Join context cannot extend the
// original qualified operation context or permit a new T command.
func (s *taskRuntimeRequest) drain(ctx context.Context) (bool, error) {
	if !s.finished.Load() || !s.draining.CompareAndSwap(false, true) {
		return false, nil
	}
	defer func() { s.draining.Store(false); s.parent.notify() }()
	s.retire()
	s.mu.Lock()
	session := s.session
	s.mu.Unlock()
	if session != nil {
		if err := session.Join(ctx); err != nil {
			s.cleanupFirst.CompareAndSwap(nil, &taskRuntimeFailure{err: err})
			return false, s.cleanupFirst.Load().err
		}
		s.closeOnce.Do(func() { s.closeErr = session.Close() })
		if err := s.closeErr; err != nil {
			s.cleanupFirst.CompareAndSwap(nil, &taskRuntimeFailure{err: err})
			return false, s.cleanupFirst.Load().err
		}
	}
	if first := s.cleanupFirst.Load(); first != nil {
		return false, first.err
	}
	s.parent.mu.Lock()
	delete(s.parent.active, s)
	s.parent.mu.Unlock()
	return true, nil
}
func (f *OriginalTaskRuntimeForwarder) Retire() error {
	if f == nil {
		return nil
	}
	f.retired.Store(true)
	f.mu.Lock()
	requests := make([]*taskRuntimeRequest, 0, len(f.active))
	for s := range f.active {
		requests = append(requests, s)
	}
	f.mu.Unlock()
	for _, s := range requests {
		s.stop()
		s.retire()
	}
	f.notify()
	return nil
}
func (f *OriginalTaskRuntimeForwarder) Join(ctx context.Context) error {
	if f == nil || ctx == nil || !f.retired.Load() {
		return ErrDenied
	}
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		f.mu.Lock()
		requests := make([]*taskRuntimeRequest, 0, len(f.active))
		for s := range f.active {
			requests = append(requests, s)
		}
		f.mu.Unlock()
		if len(requests) == 0 {
			return nil
		}
		progress := false
		for _, s := range requests {
			done, err := s.drain(ctx)
			if err != nil {
				return err
			}
			progress = progress || done
		}
		if progress {
			continue
		}
		select {
		case <-f.changed:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}
func (f *OriginalTaskRuntimeForwarder) Close() error {
	if f == nil {
		return nil
	}
	_ = f.Retire()
	f.mu.Lock()
	defer f.mu.Unlock()
	for s := range f.active {
		if first := s.cleanupFirst.Load(); first != nil {
			return first.err
		}
	}
	if len(f.active) != 0 {
		return ErrLocalCallerDraining
	}
	return nil
}

func (s *taskRuntimeRequest) metadata() TaskRuntimeMetadata {
	return TaskRuntimeMetadata{Profile: TaskRuntimeProfile, Service: s.parent.cfg.Service, Method: http.MethodPost, Path: s.path, Host: s.parent.cfg.Service, ContentType: "application/json", ContentLength: int64(len(s.envelope))}
}
func (s *taskRuntimeRequest) command(ctx context.Context, op byte, body []byte) (TaskRuntimeReply, error) {
	s.mu.Lock()
	session := s.session
	s.mu.Unlock()
	if session == nil || s.released.Load() {
		return TaskRuntimeReply{}, ErrDenied
	}
	switch op {
	case 1:
		return session.Capture(ctx, body)
	case 2:
		return session.CaptureConversation(ctx, body)
	case 3:
		if !s.executed.CompareAndSwap(false, true) {
			return TaskRuntimeReply{}, ErrDenied
		}
		return session.ExecuteLocal(ctx, body)
	case 4:
		return session.Observe(ctx, body)
	case 5:
		return session.Outcome(ctx, body)
	case 6:
		return session.ObserveOutcome(ctx, body)
	case 7:
		return session.ReconcileObserve(ctx, body)
	case 8:
		defer s.released.Store(true)
		return session.Release(ctx, body)
	default:
		return TaskRuntimeReply{}, ErrDenied
	}
}
func (s *taskRuntimeRequest) serveControl(control *net.UnixConn) {
	defer control.Close()
	deny := func(err error) { s.remember(err); _, _ = control.Write([]byte{0, 0, 0, 0}); s.stop() }
	for count := 0; ; count++ {
		var command [1]byte
		if _, err := io.ReadFull(control, command[:]); err != nil {
			return
		}
		if count >= 64 {
			deny(ErrBounds)
			return
		}
		if s.released.Load() {
			deny(ErrDenied)
			return
		}
		if err := s.transportFreshCurrent(s.ctx); err != nil {
			deny(err)
			return
		}
		switch command[0] {
		case 'C':
			s.mu.Lock()
			session := s.session
			s.mu.Unlock()
			if session == nil {
				deny(ErrUnavailable)
				return
			}
			if err := session.Current(); err != nil {
				deny(err)
				return
			}
			if err := s.transportFreshCurrent(s.ctx); err != nil {
				deny(err)
				return
			}
			meta, err := json.Marshal(s.metadata())
			if err != nil {
				deny(err)
				return
			}
			frame := make([]byte, 8, 8+len(meta)+len(s.envelope))
			binary.BigEndian.PutUint32(frame[:4], uint32(4+len(meta)+len(s.envelope)))
			binary.BigEndian.PutUint32(frame[4:8], uint32(len(meta)))
			frame = append(frame, meta...)
			frame = append(frame, s.envelope...)
			if _, err = io.Copy(control, bytes.NewReader(frame)); err != nil {
				return
			}
		case 'T':
			var header [5]byte
			if _, err := io.ReadFull(control, header[:]); err != nil {
				return
			}
			length := binary.BigEndian.Uint32(header[1:])
			if header[0] < 1 || header[0] > 8 || length > TaskRuntimeMaxRequest || s.released.Load() {
				deny(ErrBounds)
				return
			}
			body := make([]byte, int(length))
			if _, err := io.ReadFull(control, body); err != nil {
				return
			}
			if err := s.transportFreshCurrent(s.ctx); err != nil {
				deny(err)
				return
			}
			reply, operationErr := s.command(s.ctx, header[0], body)
			if operationErr != nil {
				s.remember(operationErr)
			}
			// Do not call business Current here: the operation may have advanced
			// its writer epoch into an immutable outcome. That phase belongs Auth.
			if err := s.transportFreshCurrent(s.ctx); err != nil {
				deny(err)
				return
			}
			if reply.StatusCode < 100 || reply.StatusCode > 599 || len(reply.Body) > TaskRuntimeMaxReply {
				deny(ErrBounds)
				return
			}
			raw := bytes.Clone(reply.Body)
			frame := make([]byte, 7, 7+len(raw))
			binary.BigEndian.PutUint32(frame[:4], uint32(3+len(raw)))
			binary.BigEndian.PutUint16(frame[4:6], uint16(reply.StatusCode))
			if operationErr != nil {
				frame[6] = 1
			}
			frame = append(frame, raw...)
			if _, err := io.Copy(control, bytes.NewReader(frame)); err != nil {
				return
			}
		default:
			deny(ErrDenied)
			return
		}
	}
}

func (f *OriginalTaskRuntimeForwarder) Forward(ctx context.Context, r *http.Request, kind string, envelope []byte) (reply TaskRuntimeReply, err error) {
	dispatch := false
	var partial int64
	var state *taskRuntimeRequest
	defer func() {
		if state != nil {
			if first := state.first.Load(); first != nil {
				err = first.err
			}
		}
		if err != nil {
			err = &DispatchError{Cause: err, DispatchPossible: dispatch, PartialResponseBytes: partial}
		}
	}()
	if f == nil || r == nil || r.URL == nil || !sameTaskRuntimeContext(ctx, r.Context()) || localIdentityHeader(r.Header) || len(envelope) == 0 || len(envelope) > TaskRuntimeMaxEnvelope {
		return reply, ErrDenied
	}
	path := TaskRuntimeEffectPath
	if kind == "effect-query" {
		path = TaskRuntimeQueryPath
	} else if kind != "effect" {
		return reply, ErrDenied
	}
	headers, e := taskRuntimeHeaders(r.Header)
	if e != nil {
		return reply, e
	}
	operationCtx, cancel := context.WithTimeout(ctx, f.cfg.Timeout)
	s := &taskRuntimeRequest{parent: f, request: r, originalCtx: r.Context(), cancel: cancel, method: r.Method, target: r.URL.String(), uri: r.RequestURI, host: r.Host, contentType: r.Header.Get("Content-Type"), contentTypes: len(r.Header.Values("Content-Type")), headers: headers, length: r.ContentLength, body: r.Body, envelope: bytes.Clone(envelope), path: path}
	state = s
	s.ctx = context.WithValue(operationCtx, taskRuntimeContextKey{}, s)
	s.active.Store(true)
	f.mu.Lock()
	if f.seen[r] != nil {
		f.mu.Unlock()
		cancel()
		return reply, ErrDenied
	}
	if f.retired.Load() || len(f.active) >= f.cfg.MaxConcurrentRequests || len(f.seen) >= f.cfg.MaxConcurrentRequests {
		f.mu.Unlock()
		cancel()
		return reply, ErrUnavailable
	}
	f.active[s] = true
	f.seen[r] = s
	f.mu.Unlock()
	// One original request is consumed even after a lost ACK. The marker lives
	// until THAT original context ends, not just until this Forward returns.
	// Both maps are capped by the same finite registration; no token can reset it.
	context.AfterFunc(s.originalCtx, func() {
		f.mu.Lock()
		if f.seen[r] == s {
			delete(f.seen, r)
		}
		f.mu.Unlock()
		f.notify()
	})
	var controlDone chan struct{}
	stop := context.AfterFunc(s.ctx, s.stop)
	defer func() {
		stop()
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
		s.retire()
		if controlDone != nil {
			<-controlDone
		}
		s.finished.Store(true)
		// Normal response cleanup uses the still-live ORIGINAL child context.
		// Cancellation cleanup stays retained for the hosting owner's Join(ctx).
		if s.ctx.Err() == nil {
			if _, e := s.drain(s.ctx); e != nil && err == nil {
				err = e
			}
		}
		cancel()
		f.notify()
	}()
	conn, e := DialPrivate(s.ctx, f.cfg.SocketPath, f.cfg.PeerUID)
	if e != nil {
		return reply, e
	}
	data, ok := conn.(*net.UnixConn)
	if !ok {
		_ = conn.Close()
		return reply, ErrDenied
	}
	if e = localPeer(data, f.cfg.PeerUID, f.cfg.PeerPID); e != nil {
		_ = data.Close()
		return reply, e
	}
	control, nodeFD, e := authorityControlPair()
	if e != nil {
		_ = data.Close()
		return reply, e
	}
	defer nodeFD.Close()
	s.mu.Lock()
	s.data, s.control = data, control
	s.mu.Unlock()
	deadline, _ := s.ctx.Deadline()
	_ = data.SetDeadline(deadline)
	_ = control.SetDeadline(deadline)
	if e = s.freshCurrent(s.ctx); e != nil {
		return reply, e
	}
	caller := &OriginalTaskRuntimeCaller{state: s}
	session, openErr := f.cfg.OpenSession(s.ctx, r, caller)
	if session != nil && taskRuntimeNilSession(session) {
		session = nil
	}
	s.mu.Lock()
	s.session = session
	s.mu.Unlock() // adopt NONNULL partial before error
	if openErr != nil {
		return reply, openErr
	}
	if session == nil {
		return reply, ErrUnavailable
	}
	if e = s.freshCurrent(s.ctx); e != nil {
		return reply, e
	}
	rights := unix.UnixRights(int(nodeFD.Fd()))
	n, on, e := data.WriteMsgUnix([]byte{'A'}, rights, nil)
	if e != nil || n != 1 || on != len(rights) {
		if e == nil {
			e = ErrDenied
		}
		return reply, e
	}
	_ = nodeFD.Close()
	controlDone = make(chan struct{})
	go func() { defer close(controlDone); s.serveControl(control) }()
	req, e := http.NewRequestWithContext(s.ctx, http.MethodPost, "http://"+f.cfg.Service+path, bytes.NewReader(s.envelope))
	if e != nil {
		return reply, e
	}
	req.Header.Set("Content-Type", "application/json")
	req.Close = true
	if e = s.freshCurrent(s.ctx); e != nil {
		return reply, e
	}
	dispatch = true
	if e = req.Write(data); e != nil {
		return reply, e
	}
	budget := &wireBudget{reader: data, remaining: 64 << 10}
	reader := bufio.NewReader(budget)
	response, e := http.ReadResponse(reader, req)
	if e != nil {
		return reply, e
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode > 599 || response.Header.Get("Content-Type") != "application/json" || len(response.Header.Values("Content-Type")) != 1 || response.ContentLength > TaskRuntimeMaxResponse || response.Header.Get("Upgrade") != "" || response.Header.Get("Content-Encoding") != "" {
		return reply, ErrDenied
	}
	budget.remaining = TaskRuntimeMaxResponse + (64 << 10) - int64(reader.Buffered())
	raw, e := io.ReadAll(io.LimitReader(response.Body, TaskRuntimeMaxResponse+1))
	partial = int64(len(raw))
	reply = TaskRuntimeReply{StatusCode: response.StatusCode, Body: raw}
	if e != nil {
		return reply, e
	}
	if len(raw) > TaskRuntimeMaxResponse {
		return reply, ErrBounds
	}
	if e = s.requestCurrent(r, false); e != nil {
		return reply, e
	}
	return reply, nil
}

func taskRuntimeNilSession(session TaskRuntimeSession) bool {
	v := reflect.ValueOf(session)
	switch v.Kind() {
	case reflect.Pointer, reflect.Interface, reflect.Map, reflect.Slice, reflect.Func, reflect.Chan:
		return v.IsNil()
	}
	return false
}
