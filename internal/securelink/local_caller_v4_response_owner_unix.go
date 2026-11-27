//go:build linux || darwin

package securelink

import (
	"context"
	"errors"
	"net"
	"net/http"
	"reflect"
	"sync"
)

// This registry keeps unresolved owners alive even if their server is dropped.
// Only confirmed transport and owner completion remove an entry.
var originalV4Custody = struct {
	sync.Mutex
	live map[*originalV4ResponseLease]struct{}
}{live: make(map[*originalV4ResponseLease]struct{})}

var originalV4Connections = struct {
	sync.Mutex
	live map[*localCallerConn]struct{}
}{live: make(map[*localCallerConn]struct{})}

type originalV4RejectedConn struct {
	conn   net.Conn
	server *LocalCallerServer
}

var originalV4Rejected = struct {
	sync.Mutex
	live map[*originalV4RejectedConn]struct{}
}{live: make(map[*originalV4RejectedConn]struct{})}

type originalV4ResponseLease struct {
	mu                                               sync.Mutex
	server                                           *LocalCallerServer
	owner                                            OriginalV4ResponseOwner
	handlerDone, connectionDone, connectionConfirmed bool
	ownerCloseStarted, ownerCloseReturned, ownerDone bool
	fences                                           int
	draining                                         bool
	first                                            error
}

func nilOriginalV4Owner(owner OriginalV4ResponseOwner) bool {
	if owner == nil {
		return true
	}
	v := reflect.ValueOf(owner)
	switch v.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Pointer, reflect.Slice:
		return v.IsNil()
	default:
		return false
	}
}

func (s *localCallerState) adoptOriginalV4ResponseOwner(r *http.Request, owner OriginalV4ResponseOwner) (*OriginalV4ResponseLease, error) {
	if nilOriginalV4Owner(owner) || s == nil || s.server == nil || !s.server.proofV4Required || s.request != r || s.handle == nil {
		return nil, ErrDenied
	}
	if _, err := s.handle.Current(r.Context()); err != nil {
		return nil, err
	}
	if err := s.currentOriginalCaller(r); err != nil {
		return nil, err
	}
	s.responseMu.Lock()
	defer s.responseMu.Unlock()
	if s.responseStarted || s.responseOwner != nil {
		return nil, ErrDenied
	}
	c := s.conn
	if c == nil {
		return nil, ErrDenied
	}
	c.v4Mu.Lock()
	defer c.v4Mu.Unlock()
	if c.v4CloseStarted || c.v4Owner != nil || !s.active.Load() {
		return nil, ErrDenied
	}
	s.server.mu.Lock()
	defer s.server.mu.Unlock()
	if s.server.closed.Load() || !s.active.Load() {
		return nil, ErrDenied
	}
	l := &originalV4ResponseLease{server: s.server, owner: owner}
	s.server.v4Owners[l] = struct{}{}
	originalV4Custody.Lock()
	originalV4Custody.live[l] = struct{}{}
	originalV4Custody.Unlock()
	c.v4Owner, s.responseOwner = l, l
	return &OriginalV4ResponseLease{state: l}, nil
}

func (c *localCallerConn) closeOriginalV4() error {
	c.v4Mu.Lock()
	if c.v4CloseStarted {
		if !c.v4CloseReturned {
			c.v4Mu.Unlock()
			return ErrLocalCallerDraining
		}
		err := c.v4CloseErr
		c.v4Mu.Unlock()
		return err
	}
	c.v4CloseStarted = true
	c.closed.Store(true)
	c.v4Mu.Unlock()
	err := c.UnixConn.Close()
	c.v4Mu.Lock()
	c.v4CloseReturned, c.v4CloseErr = true, err
	owner := c.v4Owner
	c.v4Mu.Unlock()
	if c.v4Server != nil {
		c.v4Server.mu.Lock()
		if err != nil && c.v4Server.v4FirstError == nil {
			c.v4Server.v4FirstError = err
		}
		if err == nil {
			delete(c.v4Server.v4Connections, c)
		}
		c.v4Server.finishDrainLocked()
		c.v4Server.mu.Unlock()
		if err == nil {
			originalV4Connections.Lock()
			delete(originalV4Connections.live, c)
			originalV4Connections.Unlock()
		}
	}
	if owner != nil {
		owner.connectionClosed(err)
	}
	return err
}

func (s *localCallerState) finishOriginalV4Handler() {
	s.responseMu.Lock()
	s.responseHandlerEnded = true
	var l *originalV4ResponseLease
	if s.responseUses == 0 {
		l = s.responseOwner
	}
	s.responseMu.Unlock()
	if l != nil {
		l.handlerFinished()
	}
}

func (s *localCallerState) beginOriginalV4ResponseUse() bool {
	s.responseMu.Lock()
	defer s.responseMu.Unlock()
	if s.responseHandlerEnded {
		return false
	}
	s.responseUses++
	return true
}

func (s *localCallerState) endOriginalV4ResponseUse() {
	s.responseMu.Lock()
	s.responseUses--
	var l *originalV4ResponseLease
	if s.responseHandlerEnded && s.responseUses == 0 {
		l = s.responseOwner
	}
	s.responseMu.Unlock()
	if l != nil {
		l.handlerFinished()
	}
}

func (l *originalV4ResponseLease) record(err error) {
	if err == nil {
		return
	}
	l.mu.Lock()
	if l.first == nil {
		l.first = err
	}
	l.mu.Unlock()
	l.server.mu.Lock()
	if l.server.v4FirstError == nil {
		l.server.v4FirstError = err
	}
	l.server.mu.Unlock()
}

func (l *originalV4ResponseLease) connectionClosed(err error) {
	l.record(err)
	l.mu.Lock()
	l.connectionDone, l.connectionConfirmed = true, err == nil
	l.mu.Unlock()
	l.startOwnerClose()
}

func (l *originalV4ResponseLease) handlerFinished() {
	l.mu.Lock()
	l.handlerDone = true
	l.mu.Unlock()
	l.startOwnerClose()
}

func (l *originalV4ResponseLease) startOwnerClose() {
	l.mu.Lock()
	if !l.handlerDone || !l.connectionDone || !l.connectionConfirmed || l.ownerCloseStarted || l.fences != 0 {
		l.mu.Unlock()
		return
	}
	l.ownerCloseStarted = true
	l.draining = true
	l.mu.Unlock()
	// Product callbacks may retire this server. Never call them under a LINK
	// connection, server, or custody lock.
	go func() {
		err := callOriginalV4Owner(func() error { return l.owner.Close() })
		l.finishOwnerCall(err, true)
	}()
}

// Only one owner callback and physical-completion observation may be in
// flight. Server/global custody is removed after that call has returned.
func (l *originalV4ResponseLease) finishOwnerCall(callErr error, closeReturned bool) {
	l.record(callErr)
	closed := false
	err := callOriginalV4Owner(func() error { closed = l.owner.PhysicalClosed(); return nil })
	l.record(err)
	l.mu.Lock()
	if closeReturned {
		l.ownerCloseReturned = true
	}
	l.draining = false
	if err == nil && closed {
		l.ownerDone = true
	}
	done := l.ownerDone
	l.mu.Unlock()
	if !done {
		return
	}
	l.server.mu.Lock()
	delete(l.server.v4Owners, l)
	l.server.finishDrainLocked()
	l.server.mu.Unlock()
	originalV4Custody.Lock()
	delete(originalV4Custody.live, l)
	originalV4Custody.Unlock()
}

func (l *originalV4ResponseLease) status() OriginalV4ResponseStatus {
	l.mu.Lock()
	defer l.mu.Unlock()
	return OriginalV4ResponseStatus{ConnectionCloseConfirmed: l.connectionConfirmed,
		HandlerDrained: l.handlerDone, OwnerCloseReturned: l.ownerCloseReturned,
		OwnerPhysicalClosed: l.ownerDone, FirstError: l.first}
}

func (l *originalV4ResponseLease) drain(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	l.mu.Lock()
	if l.ownerDone {
		err := l.first
		l.mu.Unlock()
		return err
	}
	if !l.connectionConfirmed || !l.handlerDone || !l.ownerCloseReturned || l.draining {
		l.mu.Unlock()
		return ErrLocalCallerDraining
	}
	l.draining = true
	l.mu.Unlock()
	err := callOriginalV4Owner(func() error { return l.owner.Drain(ctx) })
	first := err
	if ctx.Err() != nil && err == ctx.Err() {
		first = nil
	}
	l.finishOwnerCall(first, false)
	l.mu.Lock()
	done, prior := l.ownerDone, l.first
	l.mu.Unlock()
	if !done && ctx.Err() != nil {
		return ctx.Err()
	}
	if !done {
		return ErrLocalCallerDraining
	}
	return prior
}

type originalV4ResponseWriter struct {
	http.ResponseWriter
	state    *localCallerState
	mu       sync.Mutex
	started  bool
	checking bool
	err      error
}

func callOriginalV4Owner(fn func() error) (err error) {
	returned := false
	defer func() {
		if !returned {
			_ = recover()
			err = ErrOriginalV4OwnerUnknown
		}
	}()
	err = fn()
	returned = true
	return err
}

func (w *originalV4ResponseWriter) start(status int, explicitHeader bool) (bool, error) {
	w.mu.Lock()
	if w.started {
		err := w.err
		w.mu.Unlock()
		return false, err
	}
	if w.checking {
		w.mu.Unlock()
		return false, ErrLocalCallerDraining
	}
	w.checking = true
	w.mu.Unlock()
	s := w.state
	s.responseMu.Lock()
	s.responseStarted = true
	l := s.responseOwner
	var fenceErr error
	if l != nil {
		l.mu.Lock()
		if l.handlerDone {
			fenceErr = ErrDenied
		} else {
			l.fences++
		}
		l.mu.Unlock()
	}
	s.responseMu.Unlock()
	if l != nil && fenceErr == nil {
		defer func() {
			l.mu.Lock()
			l.fences--
			l.mu.Unlock()
			l.startOwnerClose()
		}()
	}
	var err error
	if l == nil {
		if s.server.cfg.RequireOriginalV4ResponseOwner && (status < 400 || status > 599) {
			err = ErrDenied
		}
	} else {
		err = fenceErr
		if err == nil {
			_, err = s.handle.Current(s.request.Context())
		}
		if err == nil {
			err = callOriginalV4Owner(func() error { return l.owner.Current(s.request) })
		}
		if err == nil {
			_, err = s.handle.Current(s.request.Context())
		}
		if err == nil {
			err = s.currentOriginalCaller(s.request)
		}
	}
	if err != nil {
		if l != nil {
			l.record(err)
		}
	}
	w.mu.Lock()
	w.checking, w.started, w.err = false, true, err
	if err != nil {
		// Do not emit headers supplied by a handler whose fence failed.
		for key := range w.Header() {
			w.Header().Del(key)
		}
		w.ResponseWriter.WriteHeader(http.StatusForbidden)
	} else if explicitHeader {
		// Publish the chosen first status before another concurrent Write can
		// implicitly commit 200. No product callback runs under this lock.
		w.ResponseWriter.WriteHeader(status)
	}
	w.mu.Unlock()
	return true, err
}

func (w *originalV4ResponseWriter) WriteHeader(status int) {
	if !w.state.beginOriginalV4ResponseUse() {
		return
	}
	defer w.state.endOriginalV4ResponseUse()
	first, err := w.start(status, true)
	if err != nil || first {
		return
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	w.ResponseWriter.WriteHeader(status)
}

func (w *originalV4ResponseWriter) Write(p []byte) (int, error) {
	if !w.state.beginOriginalV4ResponseUse() {
		return 0, ErrDenied
	}
	defer w.state.endOriginalV4ResponseUse()
	if _, err := w.start(http.StatusOK, false); err != nil {
		return 0, err
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.ResponseWriter.Write(p)
}

// net/http otherwise emits an implicit 200 after the handler and its original
// request context have ended. Commit that default while the fence is live.
func (w *originalV4ResponseWriter) finish() {
	w.mu.Lock()
	started, checking := w.started, w.checking
	w.mu.Unlock()
	if checking {
		_ = w.state.conn.Close()
		return
	}
	if !started {
		_, err := w.start(http.StatusOK, true)
		if errors.Is(err, ErrLocalCallerDraining) {
			_ = w.state.conn.Close()
			return
		}
	}
}
