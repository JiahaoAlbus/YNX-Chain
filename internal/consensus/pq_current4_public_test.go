//go:build (linux || darwin) && ynx_public_trace_testsupport

package consensus

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"os"
	"testing"
	"time"
)

func current4Open(t *testing.T, f *publicTraceObserver, parent context.Context) (*pqCurrent4Wire, *net.UnixConn) {
	t.Helper()
	s, err := f.app.WalletPolicyLiveSource()
	if err != nil {
		t.Fatal(err)
	}
	fd, c := current4Socketpair(t)
	w, err := attachPQCurrent4Wire(parent, s, fd, pqCurrent4Peer{uint32(os.Getuid()), int32(os.Getpid())})
	if w != nil {
		t.Cleanup(func() { _ = w.closeWalletPolicyCurrent4Child() })
	}
	if err != nil || w == nil {
		t.Fatal("actual fixed DATA child", err)
	}
	return w, c
}
func current4CaptureBody(f *publicTraceObserver) []byte {
	return append(bytes.Clone(f.expected.NetworkID), []byte(f.expected.Owner)...)
}
func current4Cap(n uint64) []byte { b := make([]byte, 8); binary.BigEndian.PutUint64(b, n); return b }
func current4Wait(t *testing.T, w *pqCurrent4Wire) {
	t.Helper()
	select {
	case <-w.done:
	case <-time.After(5 * time.Second):
		t.Fatal("physical worker debt did not drain")
	}
}
func current4WaitRead(t *testing.T, s *PQWalletPolicyLiveSource) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		s.mu.Lock()
		reading := s.reading
		s.mu.Unlock()
		if reading {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("actual original read was not admitted")
}

func TestPQCurrent4WirePUBLICRegisteredObserverData(t *testing.T) {
	f := openPublicTraceObserver(t, os.Getenv("YNX_PUBLIC_REGISTERED_OBSERVER_TRACE"))
	var original []byte
	t.Run("complete_read_current_retire_join_close", func(t *testing.T) {
		w, c := current4Open(t, f, context.Background())
		current4Expect(t, current4Exchange(t, c, 1, 1, current4CaptureBody(f)), 12, false, 1)
		b := current4Exchange(t, c, 2, 2, current4Cap(pqCurrent4PolicyMax))
		if len(b) <= 66 || binary.BigEndian.Uint32(b[4:8]) != 0 || binary.BigEndian.Uint64(b[8:16]) != 13 || binary.BigEndian.Uint64(b[16:24]) != uint64(len(b)-66) || string(b[24:66]) != f.expected.Owner {
			t.Fatal("actual coherent policy DATA differs")
		}
		sealed, err := w.source.Read(context.Background(), f.expected.Owner)
		if err != nil {
			t.Fatal(err)
		}
		view, err := sealed.OwnerPolicy()
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(view.PolicyOriginal, b[66:]) {
			t.Fatal("wire reserialized or truncated policy")
		}
		original = bytes.Clone(b[66:])
		current4Expect(t, current4Exchange(t, c, 3, 3, nil), 8, false, 0)
		current4Expect(t, current4Exchange(t, c, 4, 4, nil), 8, false, 0)
		current4Expect(t, current4Exchange(t, c, 5, 5, nil), 12, false, 1)
		current4Expect(t, current4Exchange(t, c, 6, 6, nil), 12, false, 1)
		current4Wait(t, w)
		if w.cause() != nil {
			t.Fatal("clean completion became failure", w.cause())
		}
		if _, err = w.source.Read(context.Background(), f.expected.Owner); err != nil {
			t.Fatal("channel closed shared source", err)
		}
		fd, _ := current4Socketpair(t)
		if next, err := attachPQCurrent4Wire(context.Background(), w.source, fd, pqCurrent4Peer{uint32(os.Getuid()), int32(os.Getpid())}); next != nil || err == nil {
			t.Fatal("same Source acquired replacement channel")
		}
	})
	t.Run("cold_exact_capacity", func(t *testing.T) {
		f.reopen(t)
		w, c := current4Open(t, f, context.Background())
		current4Expect(t, current4Exchange(t, c, 1, 1, current4CaptureBody(f)), 12, false, 1)
		b := current4Exchange(t, c, 2, 2, current4Cap(uint64(len(original))))
		if len(b) != len(original)+66 || !bytes.Equal(b[66:], original) {
			t.Fatal("cold/exact-capacity original differs")
		}
		current4Expect(t, current4Exchange(t, c, 6, 3, nil), 12, false, 1)
		current4Wait(t, w)
	})
	for _, test := range []struct {
		name   string
		mutate func([]byte)
	}{
		{"network_mismatch_partial", func(b []byte) { b[0] ^= 1 }},
		{"noncanonical_owner_partial", func(b []byte) { b[34] = 'A' }},
	} {
		t.Run(test.name, func(t *testing.T) {
			f.reopen(t)
			w, c := current4Open(t, f, context.Background())
			body := current4CaptureBody(f)
			test.mutate(body)
			current4Expect(t, current4Exchange(t, c, 1, 1, body), 12, true, 1)
			first := w.cause()
			current4Expect(t, current4Exchange(t, c, 2, 2, current4Cap(pqCurrent4PolicyMax)), 8, true, 0)
			current4Expect(t, current4Exchange(t, c, 3, 3, nil), 8, true, 0)
			current4Expect(t, current4Exchange(t, c, 4, 4, nil), 8, true, 0)
			current4Expect(t, current4Exchange(t, c, 5, 5, nil), 12, true, 1)
			current4Expect(t, current4Exchange(t, c, 6, 6, nil), 12, true, 1)
			current4Wait(t, w)
			if first == nil || w.cause() != first {
				t.Fatal("first cause was replaced during partial cleanup")
			}
		})
	}
	for name, cap := range map[string]uint64{"zero": 0, "one_short": uint64(len(original) - 1), "above_max": pqCurrent4PolicyMax + 1} {
		t.Run("capacity_"+name, func(t *testing.T) {
			f.reopen(t)
			w, c := current4Open(t, f, context.Background())
			current4Expect(t, current4Exchange(t, c, 1, 1, current4CaptureBody(f)), 12, false, 1)
			current4Expect(t, current4Exchange(t, c, 2, 2, current4Cap(cap)), 8, true, 0)
			current4Expect(t, current4Exchange(t, c, 2, 3, current4Cap(pqCurrent4PolicyMax)), 8, true, 0)
			current4Expect(t, current4Exchange(t, c, 6, 4, nil), 12, true, 1)
			current4Wait(t, w)
		})
	}
	t.Run("post_retire_read_refused", func(t *testing.T) {
		f.reopen(t)
		w, c := current4Open(t, f, context.Background())
		current4Expect(t, current4Exchange(t, c, 1, 1, current4CaptureBody(f)), 12, false, 1)
		current4Expect(t, current4Exchange(t, c, 4, 2, nil), 8, false, 0)
		current4Expect(t, current4Exchange(t, c, 2, 3, current4Cap(pqCurrent4PolicyMax)), 8, true, 0)
		current4Expect(t, current4Exchange(t, c, 6, 4, nil), 12, true, 1)
		current4Wait(t, w)
	})
	t.Run("late_peer_failure_retains_partial_and_slot", func(t *testing.T) {
		f.reopen(t)
		s, err := f.app.WalletPolicyLiveSource()
		if err != nil {
			t.Fatal(err)
		}
		fd, _ := current4Socketpair(t)
		w, err := attachPQCurrent4Wire(context.Background(), s, fd, pqCurrent4Peer{uint32(os.Getuid()), int32(os.Getpid() + 1)})
		if w == nil || !errors.Is(err, errPQCurrent4Peer) {
			t.Fatal("late failure lost partial", err)
		}
		current4Wait(t, w)
		if !errors.Is(w.closeWalletPolicyCurrent4Child(), errPQCurrent4Peer) {
			t.Fatal("cleanup lost first cause")
		}
		fd2, _ := current4Socketpair(t)
		if next, err := attachPQCurrent4Wire(context.Background(), s, fd2, pqCurrent4Peer{uint32(os.Getuid()), int32(os.Getpid())}); next != nil || err == nil {
			t.Fatal("failed acquisition retried on same Source")
		}
	})
	t.Run("context_cancel_waits_actual_read_without_ack", func(t *testing.T) {
		f.reopen(t)
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		w, c := current4Open(t, f, ctx)
		current4Expect(t, current4Exchange(t, c, 1, 1, current4CaptureBody(f)), 12, false, 1)
		f.app.mu.Lock()
		if _, err := c.Write(current4Frame(2, 2, current4Cap(pqCurrent4PolicyMax))); err != nil {
			f.app.mu.Unlock()
			t.Fatal(err)
		}
		current4WaitRead(t, w.source)
		cancel()
		select {
		case <-w.done:
			f.app.mu.Unlock()
			t.Fatal("cancel claimed drain while actual read held")
		case <-time.After(10 * time.Millisecond):
		}
		f.app.mu.Unlock()
		current4Wait(t, w)
		if !errors.Is(w.cause(), context.Canceled) {
			t.Fatal("cancel first cause lost", w.cause())
		}
		b := make([]byte, 24)
		if _, err := io.ReadFull(c, b); err == nil {
			t.Fatal("unknown canceled read fabricated response")
		}
	})
	t.Run("owning_node_stop_drains_before_store_close", func(t *testing.T) {
		f.reopen(t)
		w, c := current4Open(t, f, context.Background())
		current4Expect(t, current4Exchange(t, c, 1, 1, current4CaptureBody(f)), 12, false, 1)
		f.app.mu.Lock()
		if _, err := c.Write(current4Frame(2, 2, current4Cap(pqCurrent4PolicyMax))); err != nil {
			f.app.mu.Unlock()
			t.Fatal(err)
		}
		current4WaitRead(t, w.source)
		stopped := make(chan struct{})
		go func() { f.node.OnStop(); close(stopped) }()
		select {
		case <-stopped:
			f.app.mu.Unlock()
			t.Fatal("node closed stores before actual read drained")
		case <-time.After(10 * time.Millisecond):
		}
		f.app.mu.Unlock()
		select {
		case <-stopped:
		case <-time.After(5 * time.Second):
			t.Fatal("owner stop did not join")
		}
		f.node = nil
		current4Wait(t, w)
		if _, err := w.source.Read(context.Background(), f.expected.Owner); !errors.Is(err, ErrPQWalletPolicyLiveRetired) {
			t.Fatal("owner stop retained source")
		}
	})
}

func TestPQCurrent4WirePUBLICSingleFlightUnknownAndPartialDrain(t *testing.T) {
	f := openPublicTraceObserver(t, os.Getenv("YNX_PUBLIC_REGISTERED_OBSERVER_TRACE"))
	t.Run("detached_source_cannot_acquire_original_lifetime", func(t *testing.T) {
		s, err := f.app.WalletPolicyLiveSource()
		if err != nil {
			t.Fatal(err)
		}
		// Same real public fields in a detached Source are not its installed
		// identity. No mutex is copied and no production Source is replaced.
		detached := &PQWalletPolicyLiveSource{node: s.node, app: s.app, view: s.view}
		fd, _ := current4Socketpair(t)
		w, err := attachPQCurrent4Wire(context.Background(), detached, fd, pqCurrent4Peer{uint32(os.Getuid()), int32(os.Getpid())})
		if w != nil || !errors.Is(err, ErrPQWalletPolicyLiveRetired) || s.current4 != nil || detached.current4 != nil {
			t.Fatal("detached Source acquired lifetime", err)
		}
		if _, err = fd.Stat(); err != nil {
			t.Fatal("pre-adoption refusal consumed caller endpoint")
		}
	})
	t.Run("actual_source_busy_is_sticky_no_queue", func(t *testing.T) {
		w, c := current4Open(t, f, context.Background())
		current4Expect(t, current4Exchange(t, c, 1, 1, current4CaptureBody(f)), 12, false, 1)
		f.app.mu.Lock()
		if _, err := c.Write(current4Frame(2, 2, current4Cap(pqCurrent4PolicyMax))); err != nil {
			f.app.mu.Unlock()
			t.Fatal(err)
		}
		current4WaitRead(t, w.source)
		if out, err := w.source.Read(context.Background(), f.expected.Owner); !errors.Is(err, ErrPQWalletPolicyLiveBusy) || out != nil {
			f.app.mu.Unlock()
			t.Fatal("second original read queued/admitted")
		}
		// Deliberately pipeline a second read while the first actual read is
		// held. It must not execute later or receive an invented known result.
		if _, err := c.Write(current4Frame(2, 3, current4Cap(pqCurrent4PolicyMax))); err != nil {
			f.app.mu.Unlock()
			t.Fatal(err)
		}
		f.app.mu.Unlock()
		current4Wait(t, w)
		if !errors.Is(w.cause(), errPQCurrent4Frame) || w.sequence != 2 {
			t.Fatal("pipelined future operation was admitted", w.cause())
		}
		b := make([]byte, 24)
		if _, err := io.ReadFull(c, b); err == nil {
			t.Fatal("pipelined UNKNOWN became ACK")
		}
	})
	t.Run("capture_repeat_closes_same_child_without_rebind", func(t *testing.T) {
		f.reopen(t)
		w, c := current4Open(t, f, context.Background())
		current4Expect(t, current4Exchange(t, c, 1, 1, current4CaptureBody(f)), 12, false, 1)
		if _, err := c.Write(current4Frame(1, 2, current4CaptureBody(f))); err != nil {
			t.Fatal(err)
		}
		current4Wait(t, w)
		if !errors.Is(w.cause(), errPQCurrent4Frame) || w.sequence != 1 || !w.captured {
			t.Fatal("repeat capture changed original outcome")
		}
	})
	t.Run("truncated_capture_eof_retains_original_partial", func(t *testing.T) {
		f.reopen(t)
		w, c := current4Open(t, f, context.Background())
		frame := current4Frame(1, 1, current4CaptureBody(f))
		if _, err := c.Write(frame[:30]); err != nil {
			t.Fatal(err)
		}
		_ = c.CloseWrite()
		current4Wait(t, w)
		if w.cause() == nil || w.captured || w.sequence != 0 {
			t.Fatal("truncated capture manufactured success")
		}
		if w.source.current4 != w {
			t.Fatal("UNKNOWN lost original installed partial")
		}
		first := w.cause()
		if w.closeWalletPolicyCurrent4Child() != first {
			t.Fatal("same partial cleanup replaced EOF")
		}
	})
	t.Run("external_cancel_during_incomplete_frame_has_real_done", func(t *testing.T) {
		f.reopen(t)
		ctx, cancel := context.WithCancel(context.Background())
		w, c := current4Open(t, f, ctx)
		defer cancel()
		if _, err := c.Write([]byte("YNC4")); err != nil {
			t.Fatal(err)
		}
		cancel()
		current4Wait(t, w)
		if !errors.Is(w.cause(), context.Canceled) {
			t.Fatal("parent canceled frame lost first cause", w.cause())
		}
	})
}
