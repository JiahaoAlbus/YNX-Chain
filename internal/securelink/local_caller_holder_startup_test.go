//go:build cgo && (linux || darwin)

package securelink

import (
	"context"
	"errors"
	"net/http"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
	"unsafe"
)

func startupOwnerConfig(t *testing.T) (LocalCallerClientConfig, [5]NativeLocalCallerBinding, *atomic.Int32) {
	t.Helper()
	path, l := localTestSocket(t)
	route := LocalCallerRoute{Method: http.MethodGet, Path: "/PUBLIC/startup-current", MaxBodyBytes: 1024, Timeout: time.Second}
	var bindings [5]NativeLocalCallerBinding
	bindings[4] = NativeLocalCallerBinding{Method: route.Method, Path: route.Path}
	calls := &atomic.Int32{}
	s, err := NewLocalCallerServer(LocalCallerServerConfig{Service: "startup-owner", PeerUID: localTestUID(t), PeerPID: os.Getpid(), Routes: []LocalCallerRoute{route}, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(http.StatusNoContent) })})
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- s.Serve(l) }()
	t.Cleanup(func() {
		_ = s.Retire()
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := s.Join(ctx); err != nil {
			t.Error(err)
		}
		_ = s.Close()
		<-done
	})
	return LocalCallerClientConfig{Service: "startup-owner", SocketPath: path, PeerUID: localTestUID(t), PeerPID: os.Getpid(), Routes: []LocalCallerRoute{route}}, bindings, calls
}
func startupOwnerDrain(t *testing.T, o *NativeLocalCallerStartupOwner) {
	t.Helper()
	_ = o.Retire()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := o.Join(ctx); err != nil {
		t.Fatal(err)
	}
	if err := o.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestNativeLocalCallerStartupActualFactoryTransferAndErrorPartial(t *testing.T) {
	cfg, bindings, calls := startupOwnerConfig(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	o, err := OpenNativeLocalCallerStartup(ctx, cfg, bindings)
	if err != nil || o == nil {
		t.Fatal(o, err)
	}
	first := errors.New("PUBLIC original constructor failure with adopted output")
	var adopted unsafe.Pointer
	nativeOutput := unsafe.Pointer(new(byte))
	var constructors atomic.Int32
	out, err := o.TransferBorrowToNativeSource(func(p unsafe.Pointer) (unsafe.Pointer, error) {
		constructors.Add(1)
		if o.FirstCause() != nil || o.registration.NativeRegistrationPointer() == nil {
			t.Error("constructor was called with a failed owner")
		}
		if err := nativeLocalCallerStartupBorrowCurrent(p); err != nil {
			t.Error(err)
		}
		// Exactly one real Unix request proves this factory constructed the
		// original actual client. The callback/output here are PUBLIC custody
		// controls, not an Auth Source factory, Root or authorization fixture.
		packet, err := o.registration.client.Call(o.ctx, bindings[4].Method, bindings[4].Path, "", nil)
		if err != nil || packet.StatusCode != 204 || packet.RequestPath != bindings[4].Path {
			t.Error(packet, err)
		}
		adopted = p
		return nativeOutput, first
	})
	if out != nativeOutput || !errors.Is(err, first) || calls.Load() != 1 {
		t.Fatal("nonnull error partial was discarded", out, err, calls.Load())
	}
	if _, err := o.TransferBorrowToNativeSource(func(unsafe.Pointer) (unsafe.Pointer, error) { constructors.Add(1); return nil, nil }); !errors.Is(err, ErrDenied) || constructors.Load() != 1 {
		t.Fatal("constructor replay", err)
	}
	_ = o.Retire()
	wait, end := context.WithTimeout(context.Background(), 20*time.Millisecond)
	if err := o.Join(wait); !errors.Is(err, context.DeadlineExceeded) {
		end()
		t.Fatal("adopted Source borrow falsely drained", err)
	}
	end()
	if !errors.Is(o.Close(), ErrLocalCallerDraining) {
		t.Fatal("parent closed before Source drop")
	}
	if err := nativeLocalCallerStartupReleaseBorrow(adopted); err != nil {
		t.Fatal(err)
	}
	startupOwnerDrain(t, o)
	if !errors.Is(o.FirstCause(), first) {
		t.Fatal("physical cleanup erased original constructor failure", o.FirstCause())
	}
}

func TestNativeLocalCallerStartupInflightCancelAndNoReplay(t *testing.T) {
	cfg, bindings, _ := startupOwnerConfig(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	o, err := OpenNativeLocalCallerStartup(ctx, cfg, bindings)
	if err != nil {
		t.Fatal(err)
	}
	entered := make(chan unsafe.Pointer, 1)
	resume := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		_, err := o.TransferBorrowToNativeSource(func(p unsafe.Pointer) (unsafe.Pointer, error) { entered <- p; <-resume; return nil, context.Canceled })
		done <- err
	}()
	borrow := <-entered
	cancel() // original normal startup context; never WithoutCancel
	if err := o.Retire(); err != nil {
		t.Fatal(err)
	}
	if o.ctx.Err() == nil {
		t.Fatal("retirement did not promptly cancel original child")
	}
	if err := nativeLocalCallerStartupBorrowCurrent(borrow); !errors.Is(err, ErrDenied) || !strings.Contains(err.Error(), "(7)") {
		t.Fatal("native rejection code lost", err)
	}
	wait, end := context.WithTimeout(context.Background(), 20*time.Millisecond)
	if err := o.Join(wait); !errors.Is(err, context.DeadlineExceeded) {
		end()
		t.Fatal("inflight constructor falsely drained", err)
	}
	end()
	if !errors.Is(o.Close(), ErrLocalCallerDraining) {
		t.Fatal("inflight constructor parent released")
	}
	close(resume)
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	startupOwnerDrain(t, o)
	if !errors.Is(o.FirstCause(), context.DeadlineExceeded) {
		t.Fatal("Join timeout first diagnostic was erased", o.FirstCause())
	}
	if _, err := o.TransferBorrowToNativeSource(func(unsafe.Pointer) (unsafe.Pointer, error) { t.Error("retired constructor replay"); return nil, nil }); !errors.Is(err, ErrDenied) {
		t.Fatal(err)
	}
}

func TestNativeLocalCallerStartupEarlyCloseAndOpeningPartial(t *testing.T) {
	for _, mode := range []string{"early-close", "invalid-profile", "cancelled-parent"} {
		t.Run(mode, func(t *testing.T) {
			cfg, bindings, _ := startupOwnerConfig(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if mode == "invalid-profile" {
				cfg.PeerPID = 0
			}
			if mode == "cancelled-parent" {
				cancel()
			}
			o, err := OpenNativeLocalCallerStartup(ctx, cfg, bindings)
			if o == nil {
				t.Fatal("opening partial was abandoned", err)
			}
			if mode != "early-close" {
				if err == nil {
					t.Fatal("invalid opening succeeded")
				}
				first := err
				startupOwnerDrain(t, o)
				if !errors.Is(o.FirstCause(), first) {
					t.Fatal("opening first cause erased")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if !errors.Is(o.Close(), ErrLocalCallerDraining) {
				t.Fatal("Close without Join was reported drained")
			}
			startupOwnerDrain(t, o)
			if !errors.Is(o.FirstCause(), ErrLocalCallerDraining) {
				t.Fatal("early Close diagnostic was erased", o.FirstCause())
			}
		})
	}
}

func TestNativeLocalCallerStartupPanicPreservesUnknownCustody(t *testing.T) {
	cfg, bindings, _ := startupOwnerConfig(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	o, err := OpenNativeLocalCallerStartup(ctx, cfg, bindings)
	if err != nil {
		t.Fatal(err)
	}
	first := errors.New("PUBLIC constructor panicked after possible adoption")
	if out, err := o.TransferBorrowToNativeSource(func(unsafe.Pointer) (unsafe.Pointer, error) { panic(first) }); out != nil || !errors.Is(err, first) || !errors.Is(err, ErrNativeLocalCallerTransferUnknown) {
		t.Fatal("panic lost original/UNKNOWN", out, err)
	}
	_ = o.Retire()
	wait, end := context.WithTimeout(context.Background(), time.Second)
	defer end()
	if err := o.Join(wait); !errors.Is(err, ErrNativeLocalCallerTransferUnknown) {
		t.Fatal("unknown constructor falsely drained", err)
	}
	if err := o.Close(); !errors.Is(err, ErrNativeLocalCallerTransferUnknown) {
		t.Fatal("unknown borrow released", err)
	}
	if _, err := o.TransferBorrowToNativeSource(func(unsafe.Pointer) (unsafe.Pointer, error) { t.Error("UNKNOWN constructor replay"); return nil, nil }); !errors.Is(err, ErrDenied) {
		t.Fatal(err)
	}
	o.mu.Lock()
	held := o.borrow != nil && !o.releaseStarted
	o.mu.Unlock()
	if !held {
		t.Fatal("UNKNOWN custody was dropped")
	}
	// Intentional PUBLIC test debt stays in its original C/Go inventories until
	// process exit. No fake manualDrained, pointer reconstruction or forced drop.
}

// Cleanup-only contexts establish a scheduling barrier after a Join has read
// the outstanding borrow but before it selects its notification. This is not
// an operation context, Source/current callback, sleep, or polling hook.
type startupJoinContext struct {
	context.Context
	calls   atomic.Int32
	entered chan struct{}
	permit  <-chan struct{}
}

func (c *startupJoinContext) Done() <-chan struct{} {
	// The owner's initial retireDone select asks once. The second evaluation
	// is the actual registration Join (or the new owner's follower queue).
	if c.calls.Add(1) == 2 {
		close(c.entered)
		<-c.permit
	}
	return c.Context.Done()
}

func TestNativeLocalCallerStartupConcurrentJoinersLateSourceDrop(t *testing.T) {
	t.Run("both-live", func(t *testing.T) {
		cfg, bindings, _ := startupOwnerConfig(t)
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		o, err := OpenNativeLocalCallerStartup(ctx, cfg, bindings)
		if err != nil {
			t.Fatal(err)
		}
		var sourceBorrow unsafe.Pointer
		if _, err := o.TransferBorrowToNativeSource(func(p unsafe.Pointer) (unsafe.Pointer, error) {
			sourceBorrow = p
			return unsafe.Pointer(new(byte)), nil
		}); err != nil {
			t.Fatal(err)
		}
		_ = o.Retire()
		permit := make(chan struct{})
		base, end := context.WithTimeout(context.Background(), 2*time.Second)
		defer end()
		one := &startupJoinContext{Context: base, entered: make(chan struct{}), permit: permit}
		two := &startupJoinContext{Context: base, entered: make(chan struct{}), permit: permit}
		results := make(chan error, 2)
		go func() { results <- o.Join(one) }()
		go func() { results <- o.Join(two) }()
		<-one.entered
		<-two.entered
		if err := nativeLocalCallerStartupReleaseBorrow(sourceBorrow); err != nil {
			t.Fatal(err)
		}
		close(permit)
		for i := 0; i < 2; i++ {
			if err := <-results; err != nil {
				t.Error("live Join waiter missed actual Source drop", err)
			}
		}
		startupOwnerDrain(t, o)
	})
	t.Run("leader-cancel-live-follower", func(t *testing.T) {
		cfg, bindings, _ := startupOwnerConfig(t)
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		o, err := OpenNativeLocalCallerStartup(ctx, cfg, bindings)
		if err != nil {
			t.Fatal(err)
		}
		var sourceBorrow unsafe.Pointer
		if _, err := o.TransferBorrowToNativeSource(func(p unsafe.Pointer) (unsafe.Pointer, error) {
			sourceBorrow = p
			return unsafe.Pointer(new(byte)), nil
		}); err != nil {
			t.Fatal(err)
		}
		_ = o.Retire()
		permit := make(chan struct{})
		leaderBase, leaderCancel := context.WithCancel(context.Background())
		defer leaderCancel()
		followerBase, end := context.WithTimeout(context.Background(), 2*time.Second)
		defer end()
		leader := &startupJoinContext{Context: leaderBase, entered: make(chan struct{}), permit: permit}
		follower := &startupJoinContext{Context: followerBase, entered: make(chan struct{}), permit: permit}
		leadResult := make(chan error, 1)
		followResult := make(chan error, 1)
		go func() { leadResult <- o.Join(leader) }()
		<-leader.entered
		go func() { followResult <- o.Join(follower) }()
		<-follower.entered
		leaderCancel()
		close(permit)
		if err := <-leadResult; !errors.Is(err, context.Canceled) {
			t.Fatal("leader ignored its own cancellation", err)
		}
		if err := nativeLocalCallerStartupReleaseBorrow(sourceBorrow); err != nil {
			t.Fatal(err)
		}
		if err := <-followResult; err != nil {
			t.Fatal("live follower could not take over real Join", err)
		}
		startupOwnerDrain(t, o)
		if !errors.Is(o.FirstCause(), context.Canceled) {
			t.Fatal("leader cancellation diagnostic was erased", o.FirstCause())
		}
	})
}
