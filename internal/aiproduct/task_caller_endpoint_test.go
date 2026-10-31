package aiproduct

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"sync/atomic"
	"testing"
	"time"

	link "github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
)

func p08CallerEndpointRegistration(t *testing.T) taskCallerEndpointRegistration {
	t.Helper()
	if os.Geteuid() == 0 {
		t.Skip("original LINK requires a registered non-root OS caller; no privilege bypass")
	}
	return taskCallerEndpointRegistration{service: "public-ai-caller", callerUID: uint32(os.Geteuid()), callerPID: os.Getpid(), routes: []link.LocalCallerRoute{{Method: "POST", Path: "/public-effect", MaxBodyBytes: 4096, Timeout: time.Second}, {Method: "POST", Path: "/public-query", MaxBodyBytes: 4096, Timeout: time.Second}}}
}

func p08CallerEndpointCleanup(t *testing.T, e *taskCallerEndpoint) {
	t.Helper()
	socketInfo, _ := os.Lstat(e.socket)
	dirInfo, _ := os.Lstat(e.directory)
	t.Cleanup(func() {
		_ = e.Retire()
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if err := e.Join(ctx); err != nil {
			t.Error(err)
			return
		}
		// Only this PUBLIC test reconciles its newly created fixture endpoint.
		// Production Retire/Join deliberately retain the original pathname.
		if info, err := os.Lstat(e.socket); err == nil && socketInfo != nil && os.SameFile(socketInfo, info) {
			if err := os.Remove(e.socket); err != nil {
				t.Error(err)
			}
		}
		if info, err := os.Lstat(e.directory); err == nil && dirInfo != nil && os.SameFile(dirInfo, info) {
			if err := os.Remove(e.directory); err != nil {
				t.Error(err)
			}
		}
	})
}

func TestP08TaskCallerEndpointRealOSHandler(t *testing.T) {
	registration := p08CallerEndpointRegistration(t)
	body := []byte(`{"PUBLIC":"owned unchanged bytes"}`)
	var calls atomic.Int32
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		caller, err := link.LocalCallerFromRequest(r)
		if err != nil {
			t.Error(err)
			w.WriteHeader(403)
			return
		}
		fromContext, err := link.LocalCallerFromContext(r.Context())
		if err != nil || fromContext != caller {
			t.Error("handler lost its actual caller")
			w.WriteHeader(403)
			return
		}
		material, err := caller.Current(r.Context())
		if err != nil {
			t.Error(err)
			w.WriteHeader(403)
			return
		}
		raw, err := io.ReadAll(r.Body)
		if err != nil || !bytes.Equal(raw, body) || !bytes.Equal(material.RequestBody, body) || material.PeerUID != uint32(os.Geteuid()) || material.PeerPID != os.Getpid() || material.Service != registration.service {
			t.Error("original OS/request/body registration changed")
			w.WriteHeader(403)
			return
		}
		calls.Add(1)
		w.WriteHeader(http.StatusNoContent)
	})
	endpoint, err := openTaskCallerEndpoint(context.Background(), registration, handler)
	if err != nil {
		t.Fatal(err)
	}
	p08CallerEndpointCleanup(t, endpoint)
	if _, err := link.LocalCallerFromContext(context.Background()); err == nil {
		t.Fatal("ordinary context acquired a caller")
	}
	for _, route := range []string{"/public-effect", "/public-query"} {
		response, err := endpoint.Call(context.Background(), "POST", route, "application/json", body)
		if err != nil || response.StatusCode != 204 || len(response.Body) != 0 {
			t.Fatalf("registered raw call: %+v %v", response, err)
		}
	}
	if calls.Load() != 2 {
		t.Fatal("route was not dispatched exactly once")
	}
	if _, err := endpoint.Call(context.Background(), "POST", "/unregistered", "application/json", body); err == nil || calls.Load() != 2 {
		t.Fatal("destination override reached handler")
	}
	if err := endpoint.Retire(); err != nil {
		t.Fatal(err)
	}
	if err := endpoint.Join(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := endpoint.Call(context.Background(), "POST", "/public-effect", "application/json", body); !errors.Is(err, errTaskCallerRetired) {
		t.Fatal(err)
	}
	if _, err := os.Lstat(endpoint.socket); err != nil {
		t.Fatal("normal retirement unlinked original endpoint")
	}
}

func TestP08TaskCallerEndpointRetireRequiresActualHandlerDrain(t *testing.T) {
	registration := p08CallerEndpointRegistration(t)
	started, release := make(chan struct{}), make(chan struct{})
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := link.LocalCallerFromRequest(r); err != nil {
			t.Error(err)
			return
		}
		close(started)
		<-release
		w.WriteHeader(204)
	})
	endpoint, err := openTaskCallerEndpoint(context.Background(), registration, handler)
	if err != nil {
		t.Fatal(err)
	}
	p08CallerEndpointCleanup(t, endpoint)
	done := make(chan error, 1)
	go func() {
		_, err := endpoint.Call(context.Background(), "POST", "/public-effect", "application/json", []byte(`{"PUBLIC":true}`))
		done <- err
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("real handler did not start")
	}
	if err := endpoint.Retire(); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Millisecond)
	err = endpoint.Join(ctx)
	cancel()
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("active handler falsely drained: %v", err)
	}
	close(release)
	ctx, cancel = context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := endpoint.Join(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		var progress *link.DispatchError
		if !errors.As(err, &progress) || !progress.DispatchPossible {
			t.Fatalf("real IPC progress/unknown lost: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("caller did not close its connection")
	}
}

func TestP08TaskCallerEndpointRejectsDifferentRegisteredProcess(t *testing.T) {
	registration := p08CallerEndpointRegistration(t)
	registration.callerPID++
	endpoint, err := openTaskCallerEndpoint(context.Background(), registration, http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Error("unexpected handler") }))
	if !errors.Is(err, link.ErrDenied) || endpoint == nil || endpoint.directory != "" {
		t.Fatalf("caller registration became guessed server identity: %v", err)
	}
	if err := endpoint.Retire(); err != nil {
		t.Fatal(err)
	}
	if err := endpoint.Join(context.Background()); err != nil {
		t.Fatal(err)
	}
}
