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
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

// PUBLIC transport sessions only: no real task/Source/Root/authorization is
// fabricated by these tests. The production interface delegates to Auth/P08.
type testTaskSession struct {
	caller                                     *OriginalTaskRuntimeCaller
	request                                    *http.Request
	ctx                                        context.Context
	mu                                         sync.Mutex
	ops                                        []byte
	currentCalls                               int
	retired                                    atomic.Bool
	closed                                     atomic.Int32
	operationError, errorOnCurrent, closeError error
	errorOp                                    byte
	entered                                    chan struct{}
	gate                                       <-chan struct{}
}

func (s *testTaskSession) Current() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.currentCalls++
	return s.errorOnCurrent
}
func (s *testTaskSession) call(ctx context.Context, op byte, b []byte) (TaskRuntimeReply, error) {
	s.mu.Lock()
	s.ops = append(s.ops, op)
	s.mu.Unlock()
	if s.caller != nil {
		if err := s.caller.CurrentOriginalRequest(s.request); err != nil {
			return TaskRuntimeReply{StatusCode: 409}, err
		}
	}
	if s.entered != nil && op == 3 {
		close(s.entered)
		<-s.gate
	}
	reply := TaskRuntimeReply{StatusCode: 200, Body: bytes.Clone(b)}
	if op == s.errorOp {
		return TaskRuntimeReply{StatusCode: 409, Body: []byte(`{"PUBLIC":"original partial"}`)}, s.operationError
	}
	return reply, nil
}
func (s *testTaskSession) Capture(c context.Context, b []byte) (TaskRuntimeReply, error) {
	return s.call(c, 1, b)
}
func (s *testTaskSession) CaptureConversation(c context.Context, b []byte) (TaskRuntimeReply, error) {
	return s.call(c, 2, b)
}
func (s *testTaskSession) ExecuteLocal(c context.Context, b []byte) (TaskRuntimeReply, error) {
	return s.call(c, 3, b)
}
func (s *testTaskSession) Observe(c context.Context, b []byte) (TaskRuntimeReply, error) {
	return s.call(c, 4, b)
}
func (s *testTaskSession) Outcome(c context.Context, b []byte) (TaskRuntimeReply, error) {
	return s.call(c, 5, b)
}
func (s *testTaskSession) ObserveOutcome(c context.Context, b []byte) (TaskRuntimeReply, error) {
	return s.call(c, 6, b)
}
func (s *testTaskSession) ReconcileObserve(c context.Context, b []byte) (TaskRuntimeReply, error) {
	return s.call(c, 7, b)
}
func (s *testTaskSession) Release(c context.Context, b []byte) (TaskRuntimeReply, error) {
	return s.call(c, 8, b)
}
func (s *testTaskSession) Retire()                    { s.retired.Store(true) }
func (s *testTaskSession) Join(context.Context) error { return nil }
func (s *testTaskSession) Close() error               { s.closed.Add(1); return s.closeError }

type testTaskPeer struct {
	path  string
	dials atomic.Int32
}

func taskPeer(t *testing.T, handler func(*net.UnixConn, *net.UnixConn, *http.Request)) *testTaskPeer {
	t.Helper()
	path, l := localTestSocket(t)
	p := &testTaskPeer{path: path}
	var mu sync.Mutex
	var conns []net.Conn
	var workers sync.WaitGroup
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			conn, err := l.Accept()
			if err != nil {
				return
			}
			p.dials.Add(1)
			data := conn.(*net.UnixConn)
			mu.Lock()
			conns = append(conns, data)
			mu.Unlock()
			workers.Add(1)
			go func() {
				defer workers.Done()
				defer data.Close()
				_ = data.SetDeadline(time.Now().Add(3 * time.Second))
				var marker [1]byte
				oob := make([]byte, unix.CmsgSpace(4))
				n, on, flags, _, e := data.ReadMsgUnix(marker[:], oob)
				if e != nil {
					return
				}
				messages, e := unix.ParseSocketControlMessage(oob[:on])
				if e != nil {
					return
				}
				var fds []int
				for _, msg := range messages {
					rights, e := unix.ParseUnixRights(&msg)
					if e == nil {
						fds = append(fds, rights...)
					}
				}
				if n != 1 || marker[0] != 'A' || len(fds) != 1 || flags&unix.MSG_CTRUNC != 0 {
					for _, fd := range fds {
						_ = unix.Close(fd)
					}
					t.Error("dedicated A plus one FD required")
					return
				}
				unix.CloseOnExec(fds[0])
				file := os.NewFile(uintptr(fds[0]), "PUBLIC-task-control")
				raw, e := net.FileConn(file)
				_ = file.Close()
				if e != nil {
					t.Error(e)
					return
				}
				control := raw.(*net.UnixConn)
				defer control.Close()
				_ = control.SetDeadline(time.Now().Add(3 * time.Second))
				mu.Lock()
				conns = append(conns, control)
				mu.Unlock()
				req, e := http.ReadRequest(bufio.NewReader(data))
				if e != nil {
					return
				}
				handler(data, control, req)
			}()
		}
	}()
	t.Cleanup(func() {
		_ = l.Close()
		<-done
		mu.Lock()
		for _, c := range conns {
			_ = c.Close()
		}
		mu.Unlock()
		workers.Wait()
	})
	return p
}
func taskForwarder(t *testing.T, p *testTaskPeer, session *testTaskSession, openErr error) *OriginalTaskRuntimeForwarder {
	t.Helper()
	f, err := NewOriginalTaskRuntimeForwarder(TaskRuntimeForwarderConfig{Service: "runtime-test", SocketPath: p.path, PeerUID: localTestUID(t), PeerPID: os.Getpid(), Timeout: time.Second, OpenSession: func(ctx context.Context, r *http.Request, c *OriginalTaskRuntimeCaller) (TaskRuntimeSession, error) {
		session.ctx, session.request, session.caller = ctx, r, c
		return session, openErr
	}})
	if err != nil {
		t.Fatal(err)
	}
	return f
}
func taskOriginal(t *testing.T) (*http.Request, context.CancelFunc) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	r, err := http.NewRequestWithContext(ctx, http.MethodPost, "http://original-user.test/api/tasks", bytes.NewReader([]byte(`{"PUBLIC":"user original"}`)))
	if err != nil {
		t.Fatal(err)
	}
	r.Header.Set("Content-Type", "application/json")
	return r, cancel
}
func taskCurrent(control *net.UnixConn) (TaskRuntimeMetadata, []byte, error) {
	var out TaskRuntimeMetadata
	if _, e := control.Write([]byte{'C'}); e != nil {
		return out, nil, e
	}
	var n [4]byte
	if _, e := io.ReadFull(control, n[:]); e != nil {
		return out, nil, e
	}
	length := binary.BigEndian.Uint32(n[:])
	if length == 0 {
		return out, nil, ErrDenied
	}
	if length < 4 || length > TaskRuntimeMaxEnvelope+65536 {
		return out, nil, ErrBounds
	}
	b := make([]byte, length)
	if _, e := io.ReadFull(control, b); e != nil {
		return out, nil, e
	}
	ml := binary.BigEndian.Uint32(b[:4])
	if ml > length-4 {
		return out, nil, ErrBounds
	}
	e := json.Unmarshal(b[4:4+ml], &out)
	return out, bytes.Clone(b[4+ml:]), e
}
func taskCommand(control *net.UnixConn, op byte, b []byte) (TaskRuntimeReply, bool, error) {
	var out TaskRuntimeReply
	header := []byte{'T', op, 0, 0, 0, 0}
	binary.BigEndian.PutUint32(header[2:], uint32(len(b)))
	if _, e := control.Write(append(header, b...)); e != nil {
		return out, false, e
	}
	var n [4]byte
	if _, e := io.ReadFull(control, n[:]); e != nil {
		return out, false, e
	}
	length := binary.BigEndian.Uint32(n[:])
	if length == 0 {
		return out, false, ErrDenied
	}
	if length < 3 || length > TaskRuntimeMaxReply+3 {
		return out, false, ErrBounds
	}
	frame := make([]byte, length)
	if _, e := io.ReadFull(control, frame); e != nil {
		return out, false, e
	}
	if frame[2] > 1 {
		return out, false, ErrDenied
	}
	return TaskRuntimeReply{StatusCode: int(binary.BigEndian.Uint16(frame[:2])), Body: bytes.Clone(frame[3:])}, frame[2] == 1, nil
}
func taskHTTP(data net.Conn, status string) {
	_, _ = io.WriteString(data, "HTTP/1.1 "+status+"\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}")
}
func taskJoin(t *testing.T, f *OriginalTaskRuntimeForwarder) {
	t.Helper()
	_ = f.Retire()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if e := f.Join(ctx); e != nil {
		t.Error(e)
	}
	if e := f.Close(); e != nil {
		t.Error(e)
	}
}

func TestTaskRuntimeActualSCMEightOperationsAndOriginalLifetime(t *testing.T) {
	const envelope = `{"PUBLIC":"exact Node envelope"}`
	session := &testTaskSession{}
	p := taskPeer(t, func(data, control *net.UnixConn, request *http.Request) {
		body, e := io.ReadAll(request.Body)
		if e != nil || string(body) != envelope || request.Host != "runtime-test" || request.RequestURI != TaskRuntimeEffectPath {
			t.Error("actual carrier changed", e)
			return
		}
		meta, original, e := taskCurrent(control)
		if e != nil || meta.Profile != TaskRuntimeProfile || meta.Path != TaskRuntimeEffectPath || meta.ContentLength != int64(len(body)) || !bytes.Equal(original, body) {
			t.Error("A-profile current differs", e)
			return
		}
		// The private sync caller is safe while the original owner's lock is
		// held; it cannot call that Store or the sideband/current/fresh peer.
		session.mu.Lock()
		if e = session.caller.CurrentOriginalRequest(session.request); e != nil {
			t.Error(e)
		}
		session.mu.Unlock()
		copy := *session.request
		if e = session.caller.CurrentOriginalRequest(&copy); e == nil {
			t.Error("copied request accepted")
		}
		alias := *session.caller
		if e = alias.CurrentOriginalRequest(session.request); e != nil {
			t.Error("legitimate handle copy changed same lifetime", e)
		}
		for op := byte(1); op <= 8; op++ {
			raw := []byte(`{ "PUBLIC" : "original reverse bytes" }`)
			reply, failed, e := taskCommand(control, op, raw)
			if e != nil || failed || reply.StatusCode != 200 || !bytes.Equal(reply.Body, raw) {
				t.Errorf("op %d changed original DATA: %v", op, e)
				return
			}
			if session.ctx.Err() != nil {
				t.Error("intermediate reply cancelled original session")
			}
		}
		if e = session.caller.CurrentOriginalRequest(session.request); e == nil {
			t.Error("release did not retire local business caller")
		}
		taskHTTP(data, "200 OK")
	})
	f := taskForwarder(t, p, session, nil)
	r, cancel := taskOriginal(t)
	defer cancel()
	out, e := f.Forward(r.Context(), r, "effect", []byte(envelope))
	if e != nil || out.StatusCode != 200 || string(out.Body) != "{}" {
		t.Fatal("actual normal forward failed", out, e)
	}
	if session.closed.Load() != 1 || !session.retired.Load() {
		t.Fatal("actual owned session did not drain/close once")
	}
	if session.ctx.Err() == nil {
		t.Fatal("final response did not end original private session context")
	}
	session.mu.Lock()
	ops := append([]byte(nil), session.ops...)
	currents := session.currentCalls
	session.mu.Unlock()
	if !bytes.Equal(ops, []byte{1, 2, 3, 4, 5, 6, 7, 8}) || currents != 1 {
		t.Fatal("typed dispatch or C-only business Current changed", ops, currents)
	}
	_, e = f.Forward(r.Context(), r, "effect", []byte(envelope))
	if !errors.Is(e, ErrDenied) || p.dials.Load() != 1 {
		t.Fatal("same original request re-dispatched after completed ACK", e, p.dials.Load())
	}
	taskJoin(t, f)
}

func TestTaskRuntimePartialErrorCurrentFirstCauseAndExecuteOnce(t *testing.T) {
	for _, mode := range []string{"partial", "current", "execute-twice", "release-error-terminal"} {
		t.Run(mode, func(t *testing.T) {
			first := errors.New("PUBLIC original first failure")
			session := &testTaskSession{}
			if mode == "partial" {
				session.errorOp = 3
				session.operationError = first
			}
			if mode == "current" {
				session.errorOnCurrent = first
			}
			if mode == "release-error-terminal" {
				session.errorOp = 8
				session.operationError = first
			}
			p := taskPeer(t, func(data, control *net.UnixConn, r *http.Request) {
				_, _ = io.Copy(io.Discard, r.Body)
				if mode == "current" {
					if _, _, e := taskCurrent(control); e == nil {
						t.Error("failed original Current accepted")
					}
					return
				}
				op := byte(3)
				if mode == "release-error-terminal" {
					op = 8
				}
				reply, failed, e := taskCommand(control, op, []byte(`{"PUBLIC":1}`))
				if e != nil {
					t.Error(e)
					return
				}
				if mode == "partial" || mode == "release-error-terminal" {
					if !failed || reply.StatusCode != 409 || string(reply.Body) != `{"PUBLIC":"original partial"}` {
						t.Error("original partial DATA was discarded")
					}
				}
				if mode == "execute-twice" {
					if _, _, e = taskCommand(control, 3, nil); e == nil {
						t.Error("second execute was accepted")
					}
					return
				}
				if mode == "release-error-terminal" {
					if _, _, e = taskCurrent(control); e == nil {
						t.Error("failed release allowed later C")
					}
					return
				}
				// An original outcome lookup remains possible after a failed execute;
				// transport does not interpret it as permission to dispatch again.
				if _, failed, e = taskCommand(control, 5, nil); e != nil || failed {
					t.Error("original outcome unavailable", e)
				}
				taskHTTP(data, "409 Conflict")
			})
			f := taskForwarder(t, p, session, nil)
			r, cancel := taskOriginal(t)
			defer cancel()
			out, e := f.Forward(r.Context(), r, "effect", []byte(`{"PUBLIC":"envelope"}`))
			if mode == "execute-twice" {
				if !errors.Is(e, ErrDenied) {
					t.Fatal("second execute cause lost", e)
				}
			} else if !errors.Is(e, first) {
				t.Fatal("original first cause lost", e)
			}
			if mode == "partial" && (out.StatusCode != 409 || string(out.Body) != "{}") {
				t.Fatal("outer original error DATA lost", out)
			}
			if mode == "execute-twice" {
				session.mu.Lock()
				count := len(session.ops)
				session.mu.Unlock()
				if count != 1 {
					t.Fatal("actual execute repeated", count)
				}
			}
			taskJoin(t, f)
		})
	}
}

func TestTaskRuntimeLostACKConsumesRequestAndCancelledChildDrains(t *testing.T) {
	session := &testTaskSession{}
	called := make(chan struct{})
	p := taskPeer(t, func(data, control *net.UnixConn, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		if _, _, e := taskCommand(control, 3, []byte("{}")); e != nil {
			t.Error(e)
		}
		close(called)
		_ = data.Close()
		_ = control.Close()
	})
	f := taskForwarder(t, p, session, nil)
	r, cancel := taskOriginal(t)
	defer cancel()
	_, e := f.Forward(r.Context(), r, "effect", []byte("{}"))
	var de *DispatchError
	if !errors.As(e, &de) || !de.DispatchPossible {
		t.Fatal("lost final ACK falsely proved no dispatch", e)
	}
	<-called
	_, e = f.Forward(r.Context(), r, "effect", []byte("{}"))
	if !errors.Is(e, ErrDenied) || p.dials.Load() != 1 {
		t.Fatal("UNKNOWN original request auto-dispatched again", e)
	}
	taskJoin(t, f)
}

func TestTaskRuntimeRetireWaitsForActualOperationAndKeepsCloseFailure(t *testing.T) {
	for _, closeFailure := range []bool{false, true} {
		t.Run(map[bool]string{false: "actual-drain", true: "close-first-error"}[closeFailure], func(t *testing.T) {
			gate := make(chan struct{})
			entered := make(chan struct{})
			session := &testTaskSession{gate: gate, entered: entered}
			first := errors.New("PUBLIC original close failure")
			if closeFailure {
				session.closeError = first
				session.gate = nil
				session.entered = nil
			}
			p := taskPeer(t, func(data, control *net.UnixConn, r *http.Request) {
				_, _ = io.Copy(io.Discard, r.Body)
				_, _, _ = taskCommand(control, 3, nil)
				if closeFailure {
					taskHTTP(data, "200 OK")
				}
			})
			f := taskForwarder(t, p, session, nil)
			r, cancel := taskOriginal(t)
			defer cancel()
			done := make(chan error, 1)
			go func() { _, e := f.Forward(r.Context(), r, "effect", []byte("{}")); done <- e }()
			if !closeFailure {
				<-entered
				_ = f.Retire()
				ctx, end := context.WithTimeout(context.Background(), 20*time.Millisecond)
				if e := f.Join(ctx); !errors.Is(e, context.DeadlineExceeded) {
					end()
					t.Fatal("actual in-flight method falsely drained", e)
				}
				end()
				close(gate)
				if e := <-done; e == nil {
					t.Fatal("retired in-flight exchange reported success")
				}
				taskJoin(t, f)
			} else {
				if e := <-done; !errors.Is(e, first) {
					t.Fatal("close first cause lost", e)
				}
				_ = f.Retire()
				ctx, end := context.WithTimeout(context.Background(), time.Second)
				defer end()
				if e := f.Join(ctx); !errors.Is(e, first) {
					t.Fatal("unknown Close changed into successful drain", e)
				}
				if e := f.Close(); !errors.Is(e, first) {
					t.Fatal(e)
				}
				if session.closed.Load() != 1 {
					t.Fatal("unknown Close was repeated", session.closed.Load())
				}
			}
		})
	}
}

func TestTaskRuntimeOptionalRegistrationPartialOpenAndBounds(t *testing.T) {
	path, _ := localTestSocket(t)
	if _, e := NewOriginalTaskRuntimeForwarder(TaskRuntimeForwarderConfig{Service: "runtime-test", SocketPath: path, PeerUID: localTestUID(t), PeerPID: os.Getpid()}); e == nil {
		t.Fatal("missing original opener admitted")
	}
	for _, mode := range []string{"partial-open", "typed-nil", "oversized-command", "unknown-op", "wrong-peer"} {
		t.Run(mode, func(t *testing.T) {
			session := &testTaskSession{}
			first := errors.New("PUBLIC partial open")
			p := taskPeer(t, func(data, control *net.UnixConn, r *http.Request) {
				_, _ = io.Copy(io.Discard, r.Body)
				op := byte(9)
				length := uint32(0)
				if mode == "oversized-command" {
					op = 1
					length = TaskRuntimeMaxRequest + 1
				}
				header := []byte{'T', op, 0, 0, 0, 0}
				binary.BigEndian.PutUint32(header[2:], length)
				_, _ = control.Write(header)
				var out [4]byte
				_, e := io.ReadFull(control, out[:])
				if e == nil && binary.BigEndian.Uint32(out[:]) != 0 {
					t.Error("malformed command emitted reply")
				}
			})
			var openErr error
			if mode == "partial-open" {
				openErr = first
			}
			f := taskForwarder(t, p, session, openErr)
			if mode == "typed-nil" {
				f.cfg.OpenSession = func(context.Context, *http.Request, *OriginalTaskRuntimeCaller) (TaskRuntimeSession, error) {
					var nilSession *testTaskSession
					return nilSession, nil
				}
			}
			if mode == "wrong-peer" {
				f.cfg.PeerPID += 10000
			}
			r, cancel := taskOriginal(t)
			defer cancel()
			_, e := f.Forward(r.Context(), r, "effect-query", []byte("{}"))
			if e == nil {
				t.Fatal("invalid transport accepted")
			}
			if mode == "partial-open" {
				if !errors.Is(e, first) || session.closed.Load() != 1 {
					t.Fatal("partial original was not adopted/closed", e)
				}
			}
			taskJoin(t, f)
		})
	}
}

type taskRuntimeCallbackContext struct{ calls *atomic.Int32 }

func (c *taskRuntimeCallbackContext) Deadline() (time.Time, bool) {
	c.calls.Add(1)
	return time.Time{}, false
}
func (c *taskRuntimeCallbackContext) Done() <-chan struct{} { c.calls.Add(1); return nil }
func (c *taskRuntimeCallbackContext) Err() error            { c.calls.Add(1); return nil }
func (c *taskRuntimeCallbackContext) Value(any) any         { c.calls.Add(1); return nil }

func TestTaskRuntimeOriginalRequestHeaderFence(t *testing.T) {
	session := &testTaskSession{}
	p := taskPeer(t, func(data, _ *net.UnixConn, request *http.Request) {
		_, _ = io.Copy(io.Discard, request.Body)
		taskHTTP(data, "200 OK")
	})
	f := taskForwarder(t, p, session, nil)
	r, cancel := taskOriginal(t)
	defer cancel()
	r.Header.Set("Proof", "PUBLIC original proof bytes")
	r.Header["Public-Multi"] = []string{"first", "second"}
	open := f.cfg.OpenSession
	f.cfg.OpenSession = func(ctx context.Context, original *http.Request, caller *OriginalTaskRuntimeCaller) (TaskRuntimeSession, error) {
		// This is the actual privately minted caller with real data/control
		// connections, not a test-constructed state or request context token.
		originalValue := *original
		checkDenied := func(label string, changed *http.Request) {
			t.Helper()
			if e := caller.CurrentOriginalRequest(changed); !errors.Is(e, ErrDenied) {
				t.Errorf("%s was accepted: %v", label, e)
			}
		}
		f.mu.Lock()
		session.mu.Lock()
		done := make(chan error, 1)
		go func() { done <- caller.CurrentOriginalRequest(original) }()
		var e error
		select {
		case e = <-done:
		case <-time.After(200 * time.Millisecond):
			e = errors.New("sync getter reentered owner/server lock")
		}
		session.mu.Unlock()
		f.mu.Unlock()
		if e != nil {
			t.Error(e)
		}
		copy := *caller
		if e := copy.CurrentOriginalRequest(original); e != nil {
			t.Error("value copy must share the original private lifetime", e)
		}
		checkDenied("request copy", &originalValue)
		checkDenied("request clone", original.Clone(original.Context()))
		fresh, e := http.NewRequestWithContext(original.Context(), original.Method, original.URL.String(), nil)
		if e != nil {
			t.Fatal(e)
		}
		checkDenied("new request", fresh)
		if e := (&OriginalTaskRuntimeCaller{}).CurrentOriginalRequest(original); !errors.Is(e, ErrDenied) {
			t.Error("zero caller accepted", e)
		}
		// Reading the original reader is normal Auth processing. LINK does not
		// decode its business DATA or mistake reader position for authority.
		var public map[string]string
		if e := json.NewDecoder(original.Body).Decode(&public); e != nil {
			t.Fatal(e)
		}
		if e := caller.CurrentOriginalRequest(original); e != nil {
			t.Error("normal original-body decode invalidated identity", e)
		}
		mutations := []struct {
			name  string
			apply func()
		}{
			{"method", func() { original.Method = http.MethodGet }},
			{"URL", func() { u := *original.URL; u.Path += "/changed"; original.URL = &u }},
			{"raw target", func() { original.RequestURI += "?changed" }},
			{"host", func() { original.Host += ".changed" }},
			{"MIME", func() { original.Header.Set("Content-Type", "text/plain") }},
			{"proof bytes", func() { original.Header.Set("Proof", "PUBLIC replaced proof") }},
			{"proof removal", func() { original.Header.Del("Proof") }},
			{"header append", func() { original.Header.Add("Proof", "PUBLIC appended") }},
			{"header order", func() { original.Header["Public-Multi"][0], original.Header["Public-Multi"][1] = "second", "first" }},
			{"new header", func() { original.Header.Set("Public-Added", "added") }},
			{"length", func() { original.ContentLength++ }},
			{"reader replacement", func() { original.Body = io.NopCloser(strings.NewReader("{}")) }},
			{"derived request context", func() { *original = *original.WithContext(context.WithValue(original.Context(), "PUBLIC", true)) }},
		}
		for _, mutation := range mutations {
			*original = originalValue
			original.Header = originalValue.Header.Clone()
			mutation.apply()
			checkDenied(mutation.name, original)
		}
		*original = originalValue
		var calls atomic.Int32
		*original = *original.WithContext(&taskRuntimeCallbackContext{calls: &calls})
		checkDenied("caller callback context", original)
		if calls.Load() != 0 {
			t.Error("sync fence invoked a caller context callback", calls.Load())
		}
		*original = originalValue
		if e := caller.CurrentOriginalRequest(original); e != nil {
			t.Error("restored immutable request differs", e)
		}
		return open(ctx, original, caller)
	}
	if _, e := f.Forward(r.Context(), r, "effect", []byte("{}")); e != nil {
		t.Fatal(e)
	}
	if e := session.caller.CurrentOriginalRequest(r); e == nil {
		t.Fatal("returned request retained a live local caller")
	}
	// The header budget applies before connecting/opening any session. It is
	// independent of the exact, separately bounded Node envelope DATA.
	large, end := taskOriginal(t)
	defer end()
	large.Header.Set("Proof", strings.Repeat("P", 256<<10))
	_, e := f.Forward(large.Context(), large, "effect", []byte("{}"))
	if !errors.Is(e, ErrBounds) || p.dials.Load() != 1 {
		t.Fatal("oversized original headers caused dispatch", e, p.dials.Load())
	}
	taskJoin(t, f)
}
