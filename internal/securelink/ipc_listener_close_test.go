//go:build linux || (darwin && cgo)

package securelink

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

type controlledPrivateListener struct {
	started, release chan struct{}
	calls            atomic.Int32
	err              error
}

type controlledAcceptPrivateListener struct {
	*controlledPrivateListener
	acceptStarted, acceptRelease chan struct{}
}

type controlledHTTPListener struct {
	*localCallerListener
	closeObserved chan struct{}
}

func (l *controlledHTTPListener) Close() error {
	err := l.localCallerListener.Close()
	close(l.closeObserved)
	return err
}

func (l *controlledAcceptPrivateListener) Accept() (net.Conn, error) {
	close(l.acceptStarted)
	<-l.acceptRelease
	return nil, net.ErrClosed
}

func (l *controlledPrivateListener) Accept() (net.Conn, error) { return nil, net.ErrClosed }
func (l *controlledPrivateListener) Addr() net.Addr {
	return &net.UnixAddr{Name: "controlled", Net: "unix"}
}
func (l *controlledPrivateListener) Close() error {
	l.calls.Add(1)
	close(l.started)
	<-l.release
	return l.err
}

func TestOriginalV4ResponseOwnerPrivateListenerCloseWitness(t *testing.T) {
	t.Run("legacy listener does not acquire witness", func(t *testing.T) {
		dir := publicOriginalPeerSocketDirectory(t, "legacy-listen-")
		listener, err := ListenPrivate(filepath.Join(dir, "s"), localTestUID(t))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := InspectOriginalPrivateListener(listener); !errors.Is(err, ErrDenied) {
			t.Fatalf("legacy listener acquired a witness: %v", err)
		}
		if err := listener.Close(); err != nil {
			t.Fatal(err)
		}
		if err := listener.Close(); !errors.Is(err, net.ErrClosed) {
			t.Fatalf("legacy repeated close changed: %v", err)
		}
	})
	t.Run("concurrent close shares original result", func(t *testing.T) {
		raw := &controlledPrivateListener{started: make(chan struct{}), release: make(chan struct{})}
		private := &privateListener{Listener: raw, closeState: &privateListenerCloseState{}}
		result := make(chan error, 1)
		go func() { result <- private.Close() }()
		<-raw.started
		status, err := InspectOriginalPrivateListener(private)
		if err != nil || !status.CloseStarted || status.CloseReturned || status.CloseConfirmed {
			t.Fatalf("in-flight original close: %+v %v", status, err)
		}
		if err := private.Close(); !errors.Is(err, ErrLocalCallerDraining) {
			t.Fatalf("concurrent close was not pending: %v", err)
		}
		close(raw.release)
		if err := <-result; err != nil {
			t.Fatal(err)
		}
		status, err = InspectOriginalPrivateListener(private)
		if err != nil || !status.CloseConfirmed || status.FirstError != nil || private.Close() != nil || raw.calls.Load() != 1 {
			t.Fatalf("confirmed first close lost: %+v %v calls=%d", status, err, raw.calls.Load())
		}
	})
	t.Run("unknown remains held and never reclosed", func(t *testing.T) {
		first := errors.New("controlled physical close failure")
		raw := &controlledPrivateListener{started: make(chan struct{}), release: make(chan struct{}), err: first}
		close(raw.release)
		private := &privateListener{Listener: raw, closeState: &privateListenerCloseState{}}
		t.Cleanup(func() {
			originalPrivateListenerCustody.Lock()
			delete(originalPrivateListenerCustody.live, private)
			originalPrivateListenerCustody.Unlock()
		})
		if err := private.Close(); !errors.Is(err, first) || !errors.Is(err, ErrOriginalPrivateListenerCloseUnknown) {
			t.Fatalf("first failure lost: %v", err)
		}
		status, err := InspectOriginalPrivateListener(private)
		if err != nil || !status.CloseReturned || status.CloseConfirmed || !errors.Is(status.FirstError, first) {
			t.Fatalf("unknown became confirmed: %+v %v", status, err)
		}
		if err := private.Close(); !errors.Is(err, first) || raw.calls.Load() != 1 {
			t.Fatalf("unknown was retried: %v calls=%d", err, raw.calls.Load())
		}
		originalPrivateListenerCustody.Lock()
		_, held := originalPrivateListenerCustody.live[private]
		originalPrivateListenerCustody.Unlock()
		if !held {
			t.Fatal("unknown original listener was not held")
		}
	})
	t.Run("setup and first close failure retain partial", func(t *testing.T) {
		setupErr, closeErr := errors.New("controlled chmod failure"), errors.New("controlled close failure")
		raw := &controlledPrivateListener{started: make(chan struct{}), release: make(chan struct{}), err: closeErr}
		close(raw.release)
		private := &privateListener{Listener: raw, closeState: &privateListenerCloseState{}}
		t.Cleanup(func() {
			originalPrivateListenerCustody.Lock()
			delete(originalPrivateListenerCustody.live, private)
			originalPrivateListenerCustody.Unlock()
		})
		listener, err := finishPrivateListenerSetup(private, "/controlled", true, func(string, os.FileMode) error { return setupErr })
		if listener != private || !errors.Is(err, setupErr) || !errors.Is(err, closeErr) {
			t.Fatalf("setup partial or first errors lost: %v %v", listener, err)
		}
		status, err := InspectOriginalPrivateListener(listener)
		if err != nil || !status.CloseReturned || status.CloseConfirmed || !errors.Is(status.FirstError, closeErr) {
			t.Fatalf("setup close unknown became confirmed: %+v %v", status, err)
		}
		if err := listener.Close(); !errors.Is(err, closeErr) || raw.calls.Load() != 1 {
			t.Fatalf("setup unknown was reclosed: %v calls=%d", err, raw.calls.Load())
		}
	})
	t.Run("HTTP close sees pending without replacing first result", func(t *testing.T) {
		raw := &controlledAcceptPrivateListener{controlledPrivateListener: &controlledPrivateListener{
			started: make(chan struct{}), release: make(chan struct{}),
		}, acceptStarted: make(chan struct{}), acceptRelease: make(chan struct{})}
		private := &privateListener{Listener: raw, closeState: &privateListenerCloseState{}}
		httpServer := &http.Server{Handler: http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})}
		server := &LocalCallerServer{}
		serveDone := make(chan error, 1)
		wrapped := &controlledHTTPListener{localCallerListener: &localCallerListener{Listener: raw, server: server, closeOwner: private}, closeObserved: make(chan struct{})}
		go func() { serveDone <- httpServer.Serve(wrapped) }()
		<-raw.acceptStarted
		closeDone := make(chan error, 1)
		go func() { closeDone <- private.Close() }()
		<-raw.started
		httpCloseDone := make(chan error, 1)
		go func() { httpCloseDone <- httpServer.Close() }()
		<-wrapped.closeObserved
		close(raw.acceptRelease)
		if err := <-httpCloseDone; !errors.Is(err, ErrLocalCallerDraining) {
			t.Fatalf("HTTP close did not report the in-flight original: %v", err)
		}
		status, err := InspectOriginalPrivateListener(private)
		if err != nil || status.CloseReturned || status.CloseConfirmed || status.FirstError != nil {
			t.Fatalf("pending close became a physical result: %+v %v", status, err)
		}
		close(raw.release)
		if err := <-closeDone; err != nil {
			t.Fatal(err)
		}
		<-serveDone
		status, err = InspectOriginalPrivateListener(private)
		if err != nil || !status.CloseConfirmed || status.FirstError != nil || raw.calls.Load() != 1 {
			t.Fatalf("original result lost after HTTP pending: %+v %v calls=%d", status, err, raw.calls.Load())
		}
	})
	t.Run("Serve cannot confirm an already closed raw listener", func(t *testing.T) {
		dir := publicOriginalPeerSocketDirectory(t, "v4unknown-listen-")
		listener, err := ListenPrivateWithCloseWitness(filepath.Join(dir, "s"), localTestUID(t))
		if err != nil {
			t.Fatal(err)
		}
		private := listener.(*privateListener)
		t.Cleanup(func() {
			originalPrivateListenerCustody.Lock()
			delete(originalPrivateListenerCustody.live, private)
			originalPrivateListenerCustody.Unlock()
		})
		// A test-only bypass forces the first tracked Close to see ErrClosed.
		// That result is unknown, even though this test closed the raw fd itself.
		if err := private.Listener.Close(); err != nil {
			t.Fatal(err)
		}
		server, err := NewProductSessionProofV4LocalCallerServer(LocalCallerServerConfig{
			Service: "ynx-shop-source", PeerUID: localTestUID(t), PeerPID: os.Getpid(),
			Routes:  []LocalCallerRoute{{Method: http.MethodGet, Path: publicShopProofPath, Timeout: time.Second}},
			Handler: http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}), RequireOriginalV4ResponseOwner: true,
		})
		if err != nil {
			t.Fatal(err)
		}
		if err := server.Serve(listener); err == nil {
			t.Fatal("Serve accepted a closed raw listener")
		}
		status, err := InspectOriginalPrivateListener(listener)
		if err != nil || !status.CloseReturned || status.CloseConfirmed || !errors.Is(status.FirstError, ErrOriginalPrivateListenerCloseUnknown) {
			t.Fatalf("unknown Serve close became confirmed: %+v %v", status, err)
		}
		if err := listener.Close(); !errors.Is(err, status.FirstError) {
			t.Fatalf("unknown first result was not retained: %v", err)
		}
	})
	for _, closeFirst := range []bool{false, true} {
		name := "Retire first"
		if closeFirst {
			name = "listener first"
		}
		t.Run("real V4 "+name, func(t *testing.T) {
			dir := publicOriginalPeerSocketDirectory(t, "v4listen-")
			listener, err := ListenPrivateWithCloseWitness(filepath.Join(dir, "s"), localTestUID(t))
			if err != nil {
				t.Fatal(err)
			}
			server, err := NewProductSessionProofV4LocalCallerServer(LocalCallerServerConfig{
				Service: "ynx-shop-source", PeerUID: localTestUID(t), PeerPID: os.Getpid(),
				Routes: []LocalCallerRoute{{Method: http.MethodGet, Path: publicShopProofPath, Timeout: time.Second}},
				Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
					w.WriteHeader(http.StatusServiceUnavailable)
					_, _ = w.Write([]byte("rejected"))
				}), RequireOriginalV4ResponseOwner: true,
			})
			if err != nil {
				t.Fatal(err)
			}
			ready, done := localTestServeReady(server), make(chan error, 1)
			go func() { done <- server.Serve(listener) }()
			localTestAwaitServe(t, ready, done)
			peer, err := DialPrivate(context.Background(), filepath.Join(dir, "s"), localTestUID(t))
			if err != nil {
				t.Fatal(err)
			}
			defer peer.Close()
			if err := peer.SetDeadline(time.Now().Add(3 * time.Second)); err != nil {
				t.Fatal(err)
			}
			if _, err := fmt.Fprintf(peer, "GET %s HTTP/1.1\r\nHost: ynx-shop-source\r\n%s: Aa\r\nConnection: close\r\n\r\n", publicShopProofPath, ProductSessionProofV4Header); err != nil {
				t.Fatal(err)
			}
			if status, body, _ := publicReadV4Response(t, peer); status != http.StatusServiceUnavailable || body != "rejected" {
				t.Fatalf("original V4 peer or rejection changed: %d %q", status, body)
			}
			if closeFirst {
				if err := listener.Close(); err != nil {
					t.Fatal(err)
				}
			}
			if err := server.Retire(); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			if err := server.Join(ctx); err != nil {
				t.Fatal(err)
			}
			status, err := InspectOriginalPrivateListener(listener)
			if err != nil || !status.CloseConfirmed || listener.Close() != nil {
				t.Fatalf("actual listener first close not shared: %+v %v", status, err)
			}
			select {
			case <-done:
			case <-ctx.Done():
				t.Fatal("original Serve did not return")
			}
		})
	}
}
