//go:build cgo && (linux || darwin)

package securelink

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
)

func TestNativeLocalCallerActualWriteFenceAndPartialPacket(t *testing.T) {
	t.Run("actual-write-fence", func(t *testing.T) {
		var handlers, guards atomic.Int32
		_, client, _ := localTestServe(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { handlers.Add(1); w.WriteHeader(200) }), localTestRoute())
		first := errors.New("PUBLIC actual native fence rejected at write")
		out, err := client.call(context.Background(), "POST", localTestRoute().Path, "application/json", []byte("{}"), func() error { guards.Add(1); return first })
		var dispatch *DispatchError
		if !errors.Is(err, first) || !errors.As(err, &dispatch) || dispatch.DispatchPossible || dispatch.PartialResponseBytes != 0 || out.PacketPresent || guards.Load() != 1 || handlers.Load() != 0 {
			t.Fatal("write-current failure was not pre-dispatch", out, err, guards.Load(), handlers.Load())
		}
	})
	t.Run("actual-response-late-partial", func(t *testing.T) {
		_, client, _ := localTestServe(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Add("X-Public-Multi", "first")
			w.Header().Add("X-Public-Multi", "second")
			w.Header().Set("Content-Length", "10")
			w.WriteHeader(202)
			_, _ = w.Write([]byte("abc"))
		}), localTestRoute())
		out, err := client.Call(context.Background(), "POST", localTestRoute().Path, "application/json", []byte("{}"))
		var dispatch *DispatchError
		if !errors.Is(err, io.ErrUnexpectedEOF) || !errors.As(err, &dispatch) || !dispatch.DispatchPossible || dispatch.PartialResponseBytes != 3 {
			t.Fatal("late error metadata lost", err)
		}
		if !out.PacketPresent || out.StatusCode != 202 || out.Method != "POST" || out.RequestPath != localTestRoute().Path || string(out.Body) != "abc" || !bytes.Equal([]byte(out.Header.Values("X-Public-Multi")[0]), []byte("first")) || len(out.Header.Values("X-Public-Multi")) != 2 {
			t.Fatal("actual packet was lost or relabelled", out)
		}
	})
}

// These Go controls supply PUBLIC guard functions to the PRIVATE write hook,
// not a native Source. The separate real C++/c-shared controls exercise the
// retained native C SourceFence thunk through exactly this actual write hook.
func nativeHolderRegistration(t *testing.T) (*NativeLocalCallerRegistration, *atomic.Int32) {
	t.Helper()
	path, listener := localTestSocket(t)
	var routes []LocalCallerRoute
	var bindings [5]NativeLocalCallerBinding
	for i := range bindings {
		method := "POST"
		contentType := "application/json"
		if i >= 3 {
			method = "GET"
			contentType = ""
		}
		p := []string{"/PUBLIC/terms", "/PUBLIC/settlement", "/PUBLIC/refund", "/PUBLIC/intent", "/PUBLIC/invoice"}[i]
		routes = append(routes, LocalCallerRoute{Method: method, Path: p, MaxBodyBytes: 1024, Timeout: time.Second})
		bindings[i] = NativeLocalCallerBinding{Method: method, Path: p, ContentType: contentType}
	}
	calls := &atomic.Int32{}
	server, err := NewLocalCallerServer(LocalCallerServerConfig{Service: "public-holder", PeerUID: localTestUID(t), PeerPID: os.Getpid(), Routes: routes, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" && r.Header.Get("Content-Type") != "" {
			t.Error("GET acquired an unregistered Content-Type")
		}
		if r.Method == "POST" && r.Header.Get("Content-Type") != "application/json" {
			t.Error("POST lost registered Content-Type")
		}
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"PUBLIC":"packet"}`))
	})})
	if err != nil {
		t.Fatal(err)
	}
	ready := localTestServeReady(server)
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	client, err := NewLocalCallerClient(LocalCallerClientConfig{Service: "public-holder", SocketPath: path, PeerUID: localTestUID(t), PeerPID: os.Getpid(), Routes: routes})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	reg, err := RegisterNativeLocalCallerClient(ctx, client, bindings)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cancel()
		_ = reg.Retire()
		_ = server.Retire()
		ctx, end := context.WithTimeout(context.Background(), time.Second)
		defer end()
		if err := reg.Join(ctx); err != nil {
			t.Error(err)
		}
		if err := reg.Close(); err != nil {
			t.Error(err)
		}
		if err := server.Join(ctx); err != nil {
			t.Error(err)
		}
		_ = server.Close()
		<-done
	})
	localTestAwaitServe(t, ready, done)
	return reg, calls
}
func nativeHolderFree(t *testing.T, h *nativeLocalCallerHolder) {
	t.Helper()
	h.retire()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := h.join(ctx); err != nil {
		t.Fatal(err)
	}
	if err := h.close(); err != nil {
		t.Fatal(err)
	}
	if err := h.free(); err != nil {
		t.Fatal(err)
	}
}
func TestNativeLocalCallerRegisteredIndicesQueryAndOnePOST(t *testing.T) {
	reg, calls := nativeHolderRegistration(t)
	if reg.NativeRegistrationPointer() == nil {
		t.Fatal("normal Go startup handoff missing")
	}
	post, err := reg.capture(nil, false)
	if err != nil {
		t.Fatal(err)
	}
	var writes atomic.Int32
	guard := func() error { writes.Add(1); return nil }
	out, err := post.call(0, []byte("{}"), guard)
	if err != nil || !out.PacketPresent || out.Method != "POST" || out.RequestPath != reg.bindings[0].Path {
		t.Fatal(out, err)
	}
	out.Body[0] = 'X'
	post.mu.Lock()
	owned := bytes.Clone(post.last.Body)
	post.mu.Unlock()
	if string(owned) != `{"PUBLIC":"packet"}` {
		t.Fatal("caller mutation rewrote retained packet")
	}
	for _, op := range []uint8{0, 1, 2} {
		if _, err := post.call(op, []byte("{}"), guard); !errors.Is(err, ErrDenied) {
			t.Fatal("POST reattempt allowed", op, err)
		}
	}
	query, err := reg.capture(nil, true)
	if err != nil {
		t.Fatal(err)
	}
	for _, op := range []uint8{0, 1, 2} {
		if _, err := query.call(op, []byte("{}"), guard); !errors.Is(err, ErrDenied) {
			t.Fatal("query promoted to POST", op, err)
		}
	}
	if _, err := query.call(3, []byte("{}"), guard); !errors.Is(err, ErrDenied) {
		t.Fatal("GET body allowed", err)
	}
	for _, op := range []uint8{3, 4} {
		out, err := query.call(op, nil, guard)
		if err != nil || out.Method != "GET" || out.RequestPath != reg.bindings[op].Path {
			t.Fatal("registered exact GET changed", out, err)
		}
	}
	if _, err := query.call(5, nil, guard); !errors.Is(err, ErrDenied) {
		t.Fatal("unknown index allowed", err)
	}
	if calls.Load() != 3 || writes.Load() != 3 {
		t.Fatal("denied operations reached transport", calls.Load(), writes.Load())
	}
	nativeHolderFree(t, post)
	nativeHolderFree(t, query)
}
func TestNativeLocalCallerRetireJoinRetainsInFlightOwner(t *testing.T) {
	reg, _ := nativeHolderRegistration(t)
	h, err := reg.capture(nil, false)
	if err != nil {
		t.Fatal(err)
	}
	entered := make(chan struct{})
	release := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		_, err := h.call(0, []byte("{}"), func() error { close(entered); <-release; return nil })
		done <- err
	}()
	<-entered
	h.retire()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	if err := h.join(ctx); !errors.Is(err, context.DeadlineExceeded) {
		cancel()
		t.Fatal("blocked write hook falsely drained", err)
	}
	cancel()
	if !errors.Is(h.close(), ErrLocalCallerDraining) || !errors.Is(h.free(), ErrLocalCallerDraining) {
		t.Fatal("early cleanup abandoned live holder")
	}
	_ = reg.Retire()
	if !errors.Is(reg.Close(), ErrLocalCallerDraining) {
		t.Fatal("parent released retained holder")
	}
	close(release)
	if err := <-done; err == nil {
		t.Fatal("cancelled write was reported successful")
	}
	nativeHolderFree(t, h)
}

func TestNativeLocalCallerSubsetSlots(t *testing.T) {
	base, calls := nativeHolderRegistration(t)
	var bindings [5]NativeLocalCallerBinding
	var routes []LocalCallerRoute
	for _, i := range []int{1, 2, 4} {
		bindings[i] = base.bindings[i]
		routes = append(routes, base.client.routes[bindings[i].Method+" "+bindings[i].Path])
	}
	cfg := base.client.cfg
	cfg.Routes = routes
	client, err := NewLocalCallerClient(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := RegisterNativeLocalCallerClient(context.Background(), client, [5]NativeLocalCallerBinding{}); !errors.Is(err, ErrDenied) {
		t.Fatal("empty registry allowed", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reg, err := RegisterNativeLocalCallerClient(ctx, client, bindings)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = reg.Retire()
		ctx, end := context.WithTimeout(context.Background(), time.Second)
		defer end()
		if err := reg.Join(ctx); err != nil {
			t.Error(err)
		}
		if err := reg.Close(); err != nil {
			t.Error(err)
		}
	}()
	var writes atomic.Int32
	guard := func() error { writes.Add(1); return nil }
	h, err := reg.capture(nil, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, op := range []uint8{0, 3} {
		if out, err := h.call(op, nil, guard); !errors.Is(err, ErrDenied) || out.PacketPresent {
			t.Fatal("disabled slot dispatched", op, out, err)
		}
	}
	for _, op := range []uint8{1, 2} {
		if op == 2 {
			h, err = reg.capture(nil, false)
			if err != nil {
				t.Fatal(err)
			}
		}
		out, err := h.call(op, []byte("{}"), guard)
		if err != nil || out.RequestPath != bindings[op].Path || out.Method != "POST" {
			t.Fatal(out, err)
		}
		nativeHolderFree(t, h)
	}
	q, err := reg.capture(nil, true)
	if err != nil {
		t.Fatal(err)
	}
	out, err := q.call(4, nil, guard)
	if err != nil || out.Method != "GET" || out.RequestPath != bindings[4].Path {
		t.Fatal(out, err)
	}
	nativeHolderFree(t, q)
	if calls.Load() != 3 || writes.Load() != 3 {
		t.Fatal("disabled slots reached write", calls.Load(), writes.Load())
	}
}
