//go:build linux || darwin

package securelink

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// These cases exercise the original Unix HTTP server's PRE-handler lifecycle.
// There is no Source/Root, product daemon, Cloud parent or business success
// fixture here. Registered handler reachability is transport evidence only.
func localHostServe(t *testing.T, s *LocalCallerServer, l net.Listener) <-chan error {
	t.Helper()
	done := make(chan error, 1)
	go func() { done <- s.Serve(l) }()
	t.Cleanup(func() {
		_ = s.Close()
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := s.Join(ctx); err != nil {
			t.Errorf("actual local host still has request children: %v", err)
		}
		select {
		case err := <-done:
			if err != nil && !errors.Is(err, http.ErrServerClosed) {
				t.Errorf("actual local Serve: %v", err)
			}
		case <-ctx.Done():
			t.Error("actual local Serve did not return after retire")
		}
	})
	return done
}

func localHostServer(t *testing.T, route LocalCallerRoute, handler http.Handler) *LocalCallerServer {
	t.Helper()
	s, err := NewLocalCallerServer(LocalCallerServerConfig{Service: "auth-native", PeerUID: localTestUID(t), PeerPID: os.Getpid(), Routes: []LocalCallerRoute{route}, Handler: handler})
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func requireLocalHostPeerEnded(t *testing.T, conn net.Conn) {
	t.Helper()
	if err := conn.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	_, err := io.Copy(io.Discard, conn)
	if nerr, ok := err.(net.Error); ok && nerr.Timeout() {
		t.Fatal("retired/cancelled actual Unix peer remained open")
	}
	// EOF and the platform's connection-reset/closed errors are all observable
	// transport closure. None means a business result or a request retry.
}

func TestLocalCallerHostRetireAcceptedBeforeHeaders(t *testing.T) {
	path, l := localTestSocket(t)
	var dispatched atomic.Int32
	s := localHostServer(t, localTestRoute(), http.HandlerFunc(func(http.ResponseWriter, *http.Request) { dispatched.Add(1) }))
	accepted := make(chan net.Conn, 1)
	s.http.ConnState = func(conn net.Conn, state http.ConnState) {
		if state == http.StateNew {
			accepted <- conn
		}
	}
	localHostServe(t, s, l)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	peer, err := DialPrivate(ctx, path, localTestUID(t))
	if err != nil {
		t.Fatal(err)
	}
	defer peer.Close()
	var actual net.Conn
	select {
	case actual = <-accepted:
	case <-ctx.Done():
		t.Fatal("real Unix connection was not accepted")
	}
	if _, err = io.WriteString(peer, "POST /authority/prepare HTTP/1.1\r\nHost: auth-native\r\n"); err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	before := len(s.active)
	s.mu.Unlock()
	if before != 0 || dispatched.Load() != 0 {
		t.Fatal("preheader connection minted a request child")
	}
	if err = s.Retire(); err != nil {
		t.Fatal(err)
	}
	if err = s.Join(ctx); err != nil {
		t.Fatal("preheader closure did not drain", err)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	if conn, ok := actual.(*localCallerConn); !ok || !conn.closed.Load() {
		t.Fatal("retire did not close the actual accepted preheader connection")
	}
	requireLocalHostPeerEnded(t, peer)
	if dispatched.Load() != 0 {
		t.Fatal("retired preheader request reached registered handler")
	}
	// A normal host reconciles its original endpoint. Shutdown cannot delete or
	// silently replace the old socket, and a new Serve cannot reopen this server.
	info, err := os.Lstat(path)
	if err != nil || info.Mode()&os.ModeSocket == 0 {
		t.Fatal("normal retirement removed its original endpoint", err)
	}
	if replacement, e := ListenPrivate(path, localTestUID(t)); e == nil {
		_ = replacement.Close()
		t.Fatal("retirement permitted overwriting the original endpoint")
	}
	if err = s.Serve(l); !errors.Is(err, ErrDenied) {
		t.Fatal("retired host restarted its listener", err)
	}
}

// gateAfterActualBodyRead never supplies bytes or substitutes a fake request.
// Its Read delegates to the real net/http Unix body first, then delays delivery
// of that genuine partial read so the owning host can observe a retained child.
// This makes cancellation/drain ordering deterministic without a sleep or a
// made-up authorization provider.
type gateAfterActualBodyRead struct {
	io.ReadCloser
	once    sync.Once
	read    chan struct{}
	release <-chan struct{}
}

func (b *gateAfterActualBodyRead) Read(p []byte) (int, error) {
	n, err := b.ReadCloser.Read(p)
	if n > 0 {
		b.once.Do(func() { close(b.read); <-b.release })
	}
	return n, err
}

func TestLocalCallerHostRetireRetainsUnmintedBodyCaptureUntilRealDrain(t *testing.T) {
	path, l := localTestSocket(t)
	var dispatched atomic.Int32
	s := localHostServer(t, localTestRoute(), http.HandlerFunc(func(http.ResponseWriter, *http.Request) { dispatched.Add(1) }))
	read := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	defer once.Do(func() { close(release) })
	original := s.http.Handler
	s.http.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Body = &gateAfterActualBodyRead{ReadCloser: r.Body, read: read, release: release}
		original.ServeHTTP(w, r)
	})
	localHostServe(t, s, l)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	peer, err := DialPrivate(ctx, path, localTestUID(t))
	if err != nil {
		t.Fatal(err)
	}
	defer peer.Close()
	_, err = io.WriteString(peer, "POST /authority/prepare HTTP/1.1\r\nHost: auth-native\r\nContent-Type: application/json\r\nContent-Length: 32\r\n\r\n{")
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-read:
	case <-ctx.Done():
		t.Fatal("real body capture did not read the supplied partial byte")
	}
	s.mu.Lock()
	if len(s.active) != 1 {
		s.mu.Unlock()
		t.Fatal("actual body capture is not retained as one request child")
	}
	var pending *localCallerState
	for child := range s.active {
		pending = child
	}
	s.mu.Unlock()
	if pending == nil || pending.request != nil || pending.handle != nil || pending.ctx != nil {
		t.Fatal("partial body capture minted original caller material")
	}
	if err = s.Retire(); err != nil {
		t.Fatal(err)
	}
	if err = s.Close(); !errors.Is(err, ErrLocalCallerDraining) {
		t.Fatal("host close reported success while real body Read had not returned", err)
	}
	drain, cancelDrain := context.WithTimeout(context.Background(), 30*time.Millisecond)
	if err = s.Join(drain); !errors.Is(err, context.DeadlineExceeded) {
		cancelDrain()
		t.Fatal("host lost retained pre-handler child on drain timeout", err)
	}
	cancelDrain()
	if dispatched.Load() != 0 {
		t.Fatal("retired partial body was delivered to the registered handler")
	}
	// The parent must remain owned while Join reports its real timeout. The
	// server does not close borrowed parents or fabricate completion on cancel.
	s.mu.Lock()
	retained := s.active[pending] != nil
	s.mu.Unlock()
	if !retained {
		t.Fatal("drain timeout erased the original pending body child")
	}
	once.Do(func() { close(release) })
	joined, cancelJoined := context.WithTimeout(context.Background(), time.Second)
	defer cancelJoined()
	if err = s.Join(joined); err != nil {
		t.Fatal("normal host could not finish drain after actual body Read returned", err)
	}
	if err = s.Close(); err != nil {
		t.Fatal("actually drained host could not close", err)
	}
	s.mu.Lock()
	remaining := len(s.active)
	s.mu.Unlock()
	if remaining != 0 || pending.handle != nil || pending.request != nil || dispatched.Load() != 0 {
		t.Fatal("retired body capture revived material or left request children")
	}
	requireLocalHostPeerEnded(t, peer)
}

func TestLocalCallerHostPartialBodyTimeoutIsLocalAndNextRequestUsesOriginalHandler(t *testing.T) {
	path, l := localTestSocket(t)
	var dispatched atomic.Int32
	seen := make(chan error, 1)
	route := localTestRoute()
	route.Timeout = 100 * time.Millisecond
	s := localHostServer(t, route, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		dispatched.Add(1)
		caller, err := LocalCallerFromRequest(r)
		if err == nil {
			var material LocalCallerMaterial
			material, err = caller.Current(r.Context())
			if err == nil && (material.PeerUID != localTestUID(t) || material.PeerPID != os.Getpid() || string(material.RequestBody) != "complete") {
				err = ErrDenied
			}
		}
		if err == nil {
			err = caller.CurrentOriginalCaller(r)
		}
		seen <- err
		if err != nil {
			http.Error(w, "transport denied", http.StatusForbidden)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	active := make(chan struct{}, 2)
	s.http.ConnState = func(_ net.Conn, state http.ConnState) {
		if state == http.StateActive {
			active <- struct{}{}
		}
	}
	localHostServe(t, s, l)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	peer, err := DialPrivate(ctx, path, localTestUID(t))
	if err != nil {
		t.Fatal(err)
	}
	defer peer.Close()
	if _, err = io.WriteString(peer, "POST /authority/prepare HTTP/1.1\r\nHost: auth-native\r\nContent-Type: application/json\r\nContent-Length: 32\r\n\r\n{"); err != nil {
		t.Fatal(err)
	}
	select {
	case <-active:
	case <-ctx.Done():
		t.Fatal("partial request headers were not parsed on the real connection")
	}
	requireLocalHostPeerEnded(t, peer)
	if dispatched.Load() != 0 {
		t.Fatal("incomplete body reached the original registered handler")
	}
	if s.closed.Load() {
		t.Fatal("one partial-body timeout retired the entire normal host")
	}
	client, err := NewLocalCallerClient(LocalCallerClientConfig{Service: "auth-native", SocketPath: path, PeerUID: localTestUID(t), PeerPID: os.Getpid(), Routes: []LocalCallerRoute{route}})
	if err != nil {
		t.Fatal(err)
	}
	out, err := client.Call(ctx, http.MethodPost, route.Path, "application/json", []byte("complete"))
	if err != nil || out.StatusCode != http.StatusNoContent {
		t.Fatal("same fixed host did not recover for the next independent complete request", out.StatusCode, err)
	}
	if err = <-seen; err != nil || dispatched.Load() != 1 {
		t.Fatal("next request did not use its own original caller/full capture/sync lifecycle", err)
	}
}
