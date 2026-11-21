//go:build linux || (darwin && cgo)

package securelink

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// PUBLIC transport controls: no product Source or authority is supplied.
type publicV4ResponseOwner struct {
	mu                                   sync.Mutex
	currentErr, closeErr                 error
	currentCalls, closeCalls, drainCalls int
	closed                               bool
	closeCalled                          chan struct{}
	currentFn                            func(*http.Request) error
	drainFn                              func(context.Context) error
}

func (o *publicV4ResponseOwner) Current(r *http.Request) error {
	o.mu.Lock()
	o.currentCalls++
	fn, err := o.currentFn, o.currentErr
	o.mu.Unlock()
	if fn != nil {
		return fn(r)
	}
	return err
}
func (o *publicV4ResponseOwner) Close() error {
	o.mu.Lock()
	o.closeCalls++
	err := o.closeErr
	if err == nil {
		o.closed = true
	}
	ch := o.closeCalled
	o.mu.Unlock()
	if ch != nil {
		close(ch)
	}
	return err
}
func (o *publicV4ResponseOwner) PhysicalClosed() bool {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.closed
}
func (o *publicV4ResponseOwner) Drain(ctx context.Context) error {
	o.mu.Lock()
	o.drainCalls++
	fn := o.drainFn
	if fn != nil {
		o.mu.Unlock()
		return fn(ctx)
	}
	o.closed = true
	o.mu.Unlock()
	return nil
}

func publicV4OwnerServer(t *testing.T, handler http.HandlerFunc) (*LocalCallerServer, net.Conn) {
	t.Helper()
	dir := publicOriginalPeerSocketDirectory(t, "v4owner-")
	socket := filepath.Join(dir, "s")
	listener, err := ListenPrivate(socket, localTestUID(t))
	if err != nil {
		t.Fatal(err)
	}
	server, err := NewProductSessionProofV4LocalCallerServer(LocalCallerServerConfig{
		Service: "ynx-shop-source", PeerUID: localTestUID(t), PeerPID: os.Getpid(),
		Routes:  []LocalCallerRoute{{Method: http.MethodGet, Path: publicShopProofPath, Timeout: 3 * time.Second}},
		Handler: handler, RequireOriginalV4ResponseOwner: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	ready := localTestServeReady(server)
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	localTestAwaitServe(t, ready, done)
	t.Cleanup(func() { _ = server.Retire(); _ = listener.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	peer, err := DialPrivate(ctx, socket, localTestUID(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = peer.Close() })
	if err := peer.SetDeadline(time.Now().Add(4 * time.Second)); err != nil {
		t.Fatal(err)
	}
	_, err = fmt.Fprintf(peer, "GET %s HTTP/1.1\r\nHost: ynx-shop-source\r\n%s: Aa\r\nConnection: close\r\n\r\n", publicShopProofPath, ProductSessionProofV4Header)
	if err != nil {
		t.Fatal(err)
	}
	return server, peer
}

func publicReadV4Response(t *testing.T, peer net.Conn) (int, string, http.Header) {
	t.Helper()
	response, err := http.ReadResponse(bufio.NewReader(peer), &http.Request{Method: http.MethodGet})
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	return response.StatusCode, string(body), response.Header
}

func publicAwaitV4Owner(t *testing.T, owner *publicV4ResponseOwner) {
	t.Helper()
	select {
	case <-owner.closeCalled:
	case <-time.After(3 * time.Second):
		t.Fatal("original owner was not closed")
	}
}

func TestOriginalV4ResponseOwnerFencesRealConnectionAndDrains(t *testing.T) {
	owner := &publicV4ResponseOwner{closeCalled: make(chan struct{})}
	leaseCh := make(chan *OriginalV4ResponseLease, 1)
	server, peer := publicV4OwnerServer(t, func(w http.ResponseWriter, r *http.Request) {
		caller, err := LocalCallerFromRequest(r)
		if err != nil {
			t.Error(err)
			return
		}
		if _, err := caller.AdoptOriginalV4ResponseOwner(r.Clone(r.Context()), owner); !errors.Is(err, ErrDenied) {
			t.Error("request clone transferred owner", err)
			return
		}
		lease, err := caller.AdoptOriginalV4ResponseOwner(r, owner)
		if err != nil {
			t.Error(err)
			return
		}
		leaseCh <- lease
		_, err = w.Write([]byte("PUBLIC"))
		if err != nil {
			t.Error(err)
		}
	})
	status, body, _ := publicReadV4Response(t, peer)
	if status != http.StatusOK || body != "PUBLIC" {
		t.Fatalf("response %d %q", status, body)
	}
	lease := <-leaseCh
	publicAwaitV4Owner(t, owner)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := server.Retire(); err != nil {
		t.Fatal(err)
	}
	if err := server.Join(ctx); err != nil {
		t.Fatal(err)
	}
	got := lease.Status()
	if !got.ConnectionCloseConfirmed || !got.HandlerDrained || !got.OwnerCloseReturned || !got.OwnerPhysicalClosed || got.FirstError != nil {
		t.Fatalf("original completion missing: %+v", got)
	}
	owner.mu.Lock()
	defer owner.mu.Unlock()
	if owner.currentCalls != 1 || owner.closeCalls != 1 || owner.drainCalls != 0 {
		t.Fatalf("unexpected owner calls: %+v", owner)
	}
}

func TestOriginalV4ResponseOwnerRejectsImplicitSuccessAndRevokedWrite(t *testing.T) {
	t.Run("missing owner", func(t *testing.T) {
		_, peer := publicV4OwnerServer(t, func(http.ResponseWriter, *http.Request) {})
		status, _, _ := publicReadV4Response(t, peer)
		if status != http.StatusForbidden {
			t.Fatalf("implicit response was %d", status)
		}
	})
	t.Run("revoked", func(t *testing.T) {
		owner := &publicV4ResponseOwner{currentErr: ErrRevoked, closeCalled: make(chan struct{})}
		_, peer := publicV4OwnerServer(t, func(w http.ResponseWriter, r *http.Request) {
			caller, err := LocalCallerFromRequest(r)
			if err != nil {
				t.Error(err)
				return
			}
			if _, err = caller.AdoptOriginalV4ResponseOwner(r, owner); err != nil {
				t.Error(err)
				return
			}
			w.Header().Set("X-Private", "must-not-escape")
			if _, err = w.Write([]byte("must-not-escape")); !errors.Is(err, ErrRevoked) {
				t.Error("fence", err)
			}
		})
		status, body, headers := publicReadV4Response(t, peer)
		if status != http.StatusForbidden || body != "" || headers.Get("X-Private") != "" {
			t.Fatalf("revoked response %d %q %v", status, body, headers)
		}
		publicAwaitV4Owner(t, owner)
	})
}

func TestOriginalV4ResponseOwnerCloseWaitsForHandlerAndExplicitDrain(t *testing.T) {
	owner := &publicV4ResponseOwner{closeErr: ErrLocalCallerDraining, closeCalled: make(chan struct{})}
	ready, leave := make(chan struct{}), make(chan struct{})
	leaseCh := make(chan *OriginalV4ResponseLease, 1)
	server, _ := publicV4OwnerServer(t, func(w http.ResponseWriter, r *http.Request) {
		caller, err := LocalCallerFromRequest(r)
		if err != nil {
			t.Error(err)
			return
		}
		lease, err := caller.AdoptOriginalV4ResponseOwner(r, owner)
		if err != nil {
			t.Error(err)
			return
		}
		leaseCh <- lease
		if _, err := w.Write([]byte("PUBLIC")); err != nil {
			t.Error(err)
		}
		close(ready)
		<-leave
	})
	<-ready
	lease := <-leaseCh
	if err := server.Retire(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-owner.closeCalled:
		t.Fatal("owner closed before handler drained")
	default:
	}
	close(leave)
	publicAwaitV4Owner(t, owner)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	if err := server.Join(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("pending owner escaped join", err)
	}
	ctx2, cancel2 := context.WithTimeout(context.Background(), time.Second)
	defer cancel2()
	if err := lease.Drain(ctx2); !errors.Is(err, ErrLocalCallerDraining) {
		t.Fatal("original first cause was lost", err)
	}
	if err := server.Join(ctx2); !errors.Is(err, ErrLocalCallerDraining) {
		t.Fatal("join lost original first cause", err)
	}
	owner.mu.Lock()
	defer owner.mu.Unlock()
	if owner.closeCalls != 1 || owner.drainCalls != 1 {
		t.Fatalf("original owner repeated: close=%d drain=%d", owner.closeCalls, owner.drainCalls)
	}
}

func TestOriginalV4ResponseOwnerUnknownTransportNeverReleases(t *testing.T) {
	owner := &publicV4ResponseOwner{closeCalled: make(chan struct{})}
	server := &LocalCallerServer{v4Owners: make(map[*originalV4ResponseLease]struct{}), drained: make(chan struct{})}
	lease := &originalV4ResponseLease{server: server, owner: owner}
	server.v4Owners[lease] = struct{}{}
	originalV4Custody.Lock()
	originalV4Custody.live[lease] = struct{}{}
	originalV4Custody.Unlock()
	t.Cleanup(func() { originalV4Custody.Lock(); delete(originalV4Custody.live, lease); originalV4Custody.Unlock() })
	lease.handlerFinished()
	lease.connectionClosed(ErrUnavailable)
	if err := lease.drain(context.Background()); !errors.Is(err, ErrLocalCallerDraining) {
		t.Fatal(err)
	}
	owner.mu.Lock()
	defer owner.mu.Unlock()
	if owner.closeCalls != 0 || owner.drainCalls != 0 || lease.status().ConnectionCloseConfirmed {
		t.Fatal("unknown transport released original owner")
	}
}

func TestOriginalV4ResponseUnknownConnectionIsRetainedWithoutOwner(t *testing.T) {
	dir := publicOriginalPeerSocketDirectory(t, "v4unknown-")
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: filepath.Join(dir, "s"), Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	peer, err := net.DialUnix("unix", nil, listener.Addr().(*net.UnixAddr))
	if err != nil {
		t.Fatal(err)
	}
	defer peer.Close()
	unixConn, err := listener.AcceptUnix()
	if err != nil {
		t.Fatal(err)
	}
	server := &LocalCallerServer{drained: make(chan struct{}), v4Connections: make(map[*localCallerConn]struct{})}
	server.closed.Store(true)
	conn := &localCallerConn{UnixConn: unixConn, proofV4Header: &localCallerProductSessionProofV4HeaderReader{}, v4Server: server}
	server.v4Connections[conn] = struct{}{}
	originalV4Connections.Lock()
	originalV4Connections.live[conn] = struct{}{}
	originalV4Connections.Unlock()
	t.Cleanup(func() {
		originalV4Connections.Lock()
		delete(originalV4Connections.live, conn)
		originalV4Connections.Unlock()
	})
	// Force the real Unix connection's first observed wrapper close to fail.
	// Its earlier physical state is deliberately not treated as a witness.
	if err := unixConn.Close(); err != nil {
		t.Fatal(err)
	}
	first := conn.Close()
	if first == nil {
		t.Fatal("expected unknown close result")
	}
	if second := conn.Close(); !errors.Is(second, first) {
		t.Fatal("original close result changed", second)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	if err := server.Join(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("unknown accepted connection escaped Join", err)
	}
	server.mu.Lock()
	_, retained := server.v4Connections[conn]
	server.mu.Unlock()
	if !retained {
		t.Fatal("unknown original connection was dropped")
	}
}

func TestOriginalV4ResponseRejectsWrongPeerAndDrainsConnection(t *testing.T) {
	dir := publicOriginalPeerSocketDirectory(t, "v4badpeer-")
	socket := filepath.Join(dir, "s")
	listener, err := ListenPrivate(socket, localTestUID(t))
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	server, err := NewProductSessionProofV4LocalCallerServer(LocalCallerServerConfig{
		Service: "ynx-shop-source", PeerUID: localTestUID(t), PeerPID: os.Getpid() + 1,
		Routes:                         []LocalCallerRoute{{Method: http.MethodGet, Path: publicShopProofPath, Timeout: time.Second}},
		Handler:                        http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Error("wrong peer reached handler") }),
		RequireOriginalV4ResponseOwner: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	ready := localTestServeReady(server)
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	localTestAwaitServe(t, ready, done)
	peer, err := net.Dial("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	defer peer.Close()
	if err := peer.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	var one [1]byte
	if _, err := peer.Read(one[:]); err == nil {
		t.Fatal("wrong peer stayed open")
	}
	if err := server.Retire(); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := server.Join(ctx); err != nil {
		t.Fatal("rejected original connection did not drain", err)
	}
	server.mu.Lock()
	count, accepting := len(server.v4Connections), server.v4Accepting
	server.mu.Unlock()
	if count != 0 || accepting != 0 {
		t.Fatalf("unexpected accepted connection debt: %d %d", count, accepting)
	}
}

func TestOriginalV4ResponseOwnerCloseWaitsForInFlightFence(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	owner := &publicV4ResponseOwner{closeCalled: make(chan struct{})}
	owner.currentFn = func(*http.Request) error { close(entered); <-release; return nil }
	server, _ := publicV4OwnerServer(t, func(w http.ResponseWriter, r *http.Request) {
		caller, err := LocalCallerFromRequest(r)
		if err != nil {
			t.Error(err)
			return
		}
		if _, err = caller.AdoptOriginalV4ResponseOwner(r, owner); err != nil {
			t.Error(err)
			return
		}
		_, _ = w.Write([]byte("PUBLIC"))
	})
	<-entered
	if err := server.Retire(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-owner.closeCalled:
		t.Fatal("owner closed while original fence was running")
	default:
	}
	close(release)
	publicAwaitV4Owner(t, owner)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := server.Join(ctx); err == nil {
		t.Fatal("cancelled original request did not retain its first cause")
	}
}

func TestOriginalV4ResponseOwnerReentrantFenceDoesNotDeadlock(t *testing.T) {
	owner := &publicV4ResponseOwner{closeCalled: make(chan struct{})}
	_, peer := publicV4OwnerServer(t, func(w http.ResponseWriter, r *http.Request) {
		caller, err := LocalCallerFromRequest(r)
		if err != nil {
			t.Error(err)
			return
		}
		owner.currentFn = func(*http.Request) error { w.WriteHeader(http.StatusAccepted); return nil }
		if _, err = caller.AdoptOriginalV4ResponseOwner(r, owner); err != nil {
			t.Error(err)
			return
		}
		if _, err = w.Write([]byte("PUBLIC")); err != nil {
			t.Error(err)
		}
	})
	status, body, _ := publicReadV4Response(t, peer)
	if status != http.StatusOK || body != "PUBLIC" {
		t.Fatalf("reentrant fence result %d %q", status, body)
	}
	publicAwaitV4Owner(t, owner)
}

func TestOriginalV4ResponseOwnerDrainDoesNotRetireInFlightCallback(t *testing.T) {
	owner := &publicV4ResponseOwner{closeErr: ErrLocalCallerDraining, closeCalled: make(chan struct{})}
	entered, release := make(chan struct{}), make(chan struct{})
	owner.drainFn = func(context.Context) error {
		owner.mu.Lock()
		owner.closed = true
		owner.mu.Unlock()
		close(entered)
		<-release
		return nil
	}
	leaseCh := make(chan *OriginalV4ResponseLease, 1)
	server, peer := publicV4OwnerServer(t, func(w http.ResponseWriter, r *http.Request) {
		caller, err := LocalCallerFromRequest(r)
		if err != nil {
			t.Error(err)
			return
		}
		lease, err := caller.AdoptOriginalV4ResponseOwner(r, owner)
		if err != nil {
			t.Error(err)
			return
		}
		leaseCh <- lease
		_, _ = w.Write([]byte("PUBLIC"))
	})
	publicReadV4Response(t, peer)
	lease := <-leaseCh
	publicAwaitV4Owner(t, owner)
	if err := server.Retire(); err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	go func() { result <- lease.Drain(context.Background()) }()
	<-entered
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	if err := server.Join(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("Join escaped in-flight drain", err)
	}
	close(release)
	if err := <-result; !errors.Is(err, ErrLocalCallerDraining) {
		t.Fatal("first error lost", err)
	}
}

func TestOriginalV4ResponseOwnerDrainRetainsJoinedPhysicalError(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	owner := &publicV4ResponseOwner{}
	owner.drainFn = func(context.Context) error {
		owner.mu.Lock()
		owner.closed = true
		owner.mu.Unlock()
		cancel()
		return errors.Join(ErrUnavailable, context.Canceled)
	}
	server := &LocalCallerServer{v4Owners: make(map[*originalV4ResponseLease]struct{}), drained: make(chan struct{})}
	lease := &originalV4ResponseLease{server: server, owner: owner, handlerDone: true,
		connectionDone: true, connectionConfirmed: true, ownerCloseStarted: true, ownerCloseReturned: true}
	server.v4Owners[lease] = struct{}{}
	originalV4Custody.Lock()
	originalV4Custody.live[lease] = struct{}{}
	originalV4Custody.Unlock()
	t.Cleanup(func() { originalV4Custody.Lock(); delete(originalV4Custody.live, lease); originalV4Custody.Unlock() })
	err := lease.drain(ctx)
	if !errors.Is(err, ErrUnavailable) || !errors.Is(lease.status().FirstError, ErrUnavailable) {
		t.Fatal("joined physical failure was hidden by context cancellation", err, lease.status().FirstError)
	}
}

func TestOriginalV4ResponseOwnerNilPanicIsUnknown(t *testing.T) {
	t.Setenv("GODEBUG", "panicnil=1")
	err := callOriginalV4Owner(func() error { panic(nil) })
	if !errors.Is(err, ErrOriginalV4OwnerUnknown) {
		t.Fatal("nil panic became success", err)
	}
}
