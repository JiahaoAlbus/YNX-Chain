//go:build linux || darwin

package securelink

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func taskReadTestConfig(handler http.Handler) LocalCallerServerConfig {
	cfg := LocalCallerServerConfig{Service: taskReadContinuationService, PeerUID: uint32(os.Geteuid()), PeerPID: os.Getpid(), Handler: handler, ReadHeaderTimeout: time.Second, ReadTimeout: time.Second}
	for _, id := range []string{"input", "execute", "query"} {
		cfg.Routes = append(cfg.Routes, LocalCallerRoute{Method: "POST", Path: taskReadContinuationPrefix + id, MaxBodyBytes: 1024, Timeout: 2 * time.Second})
	}
	return cfg
}

func taskReadTestServer(t *testing.T, handler http.Handler, ordinary bool) (*LocalCallerServer, string) {
	t.Helper()
	dir, err := os.MkdirTemp("/tmp", "trc-")
	if err != nil {
		t.Fatal(err)
	}
	name := filepath.Join(dir, "s")
	l, err := ListenPrivate(name, uint32(os.Geteuid()))
	if err != nil {
		t.Fatal(err)
	}
	var s *LocalCallerServer
	if ordinary {
		s, err = NewLocalCallerServer(taskReadTestConfig(handler))
	} else {
		s, err = NewOriginalTaskReadContinuationServer(taskReadTestConfig(handler))
	}
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- s.Serve(l) }()
	t.Cleanup(func() {
		_ = s.Retire()
		_ = l.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := s.Join(ctx); err != nil {
			t.Error("server drain:", err)
		}
		if err := s.Close(); err != nil {
			t.Error("server close:", err)
		}
		select {
		case <-done:
		case <-ctx.Done():
			t.Error("Serve did not return")
		}
		_ = os.RemoveAll(dir)
	})
	return s, name
}

func taskReadTestDial(t *testing.T, name, stage string, body []byte, marker byte, count int) (*net.UnixConn, *net.UnixConn, *http.Request) {
	t.Helper()
	data, err := net.DialUnix("unix", nil, &net.UnixAddr{Name: name, Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	_ = data.SetDeadline(time.Now().Add(3 * time.Second))
	t.Cleanup(func() { _ = data.Close() })
	var control *net.UnixConn
	if marker != 0 {
		var pass []int
		for i := 0; i < count; i++ {
			pair, e := unix.Socketpair(unix.AF_UNIX, unix.SOCK_STREAM, 0)
			if e != nil {
				t.Fatal(e)
			}
			f := os.NewFile(uintptr(pair[0]), "PUBLIC-test-control")
			n, e := net.FileConn(f)
			_ = f.Close()
			if e != nil {
				t.Fatal(e)
			}
			if i == 0 {
				control = n.(*net.UnixConn)
			} else {
				_ = n.Close()
			}
			pass = append(pass, pair[1])
		}
		var rights []byte
		if len(pass) > 0 {
			rights = unix.UnixRights(pass...)
		}
		_, _, err = data.WriteMsgUnix([]byte{marker}, rights, nil)
		for _, fd := range pass {
			_ = unix.Close(fd)
		}
		if err != nil {
			t.Fatal(err)
		}
		if control != nil {
			_ = control.SetDeadline(time.Now().Add(3 * time.Second))
			t.Cleanup(func() { _ = control.Close() })
		}
	}
	r, err := http.NewRequest("POST", "http://"+taskReadContinuationService+taskReadContinuationPrefix+stage, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	r.Header.Set("Content-Type", "application/json")
	r.Close = true
	return data, control, r
}

func taskReadTestReply(c *net.UnixConn, hash [32]byte, mode string, commands chan<- byte) error {
	for {
		var frame [41]byte
		if _, err := io.ReadFull(c, frame[:]); err != nil {
			return err
		}
		if binary.BigEndian.Uint32(frame[:4]) != 37 {
			return ErrBounds
		}
		cmd := frame[4]
		commands <- cmd
		payload := append([]byte(nil), frame[4:]...)
		payload = append(payload, 0, 0, 0, 0, 0, 0)
		if !bytes.Equal(frame[9:], hash[:]) {
			return ErrDenied
		}
		if cmd == 'D' {
			payload = append(payload, []byte(`{"PUBLIC":"original detached DATA"}`)...)
		}
		switch mode {
		case "hash":
			payload[5] ^= 1
		case "seq":
			payload[4]++
		case "zero":
			payload[37] = 1
			payload[38] = 1
		case "retained":
			payload[37] = 1
			payload[38] = 2
		case "drop":
			return io.EOF
		case "oversize":
			var b [4]byte
			binary.BigEndian.PutUint32(b[:], 43+taskReadContinuationMaxDATA+1)
			_, err := c.Write(b[:])
			return err
		}
		var size [4]byte
		binary.BigEndian.PutUint32(size[:], uint32(len(payload)))
		if _, err := c.Write(size[:]); err != nil {
			return err
		}
		if _, err := c.Write(payload); err != nil {
			return err
		}
	}
}

func TestOriginalTaskReadContinuationOriginalRequestAndOnceClaim(t *testing.T) {
	body := []byte(`{ "PUBLIC":"same opaque entity" }`)
	result := make(chan error, 1)
	var cap *OriginalTaskReadContinuation
	_, name := taskReadTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var err error
		cap, err = OriginalTaskReadContinuationFromOriginalRequest(r)
		if err == nil {
			var derived *OriginalTaskReadContinuation
			derived, err = OriginalTaskReadContinuationFromContext(context.WithValue(r.Context(), struct{}{}, 1))
			if derived != cap {
				err = ErrDenied
			}
		}
		if _, e := OriginalTaskReadContinuationFromOriginalRequest(r.Clone(r.Context())); e == nil {
			err = ErrDenied
		}
		if err == nil {
			err = cap.Current(r.Context())
		}
		if err == nil {
			var raw []byte
			raw, err = cap.ReadOriginalRequestDATA(r.Context())
			if !bytes.Equal(raw, []byte(`{"PUBLIC":"original detached DATA"}`)) {
				err = ErrDenied
			}
		}
		if err == nil {
			err = cap.ClaimAtOriginalResourceFence(r.Context())
		}
		if err == nil && cap.ClaimAtOriginalResourceFence(r.Context()) == nil {
			err = ErrDenied
		}
		_ = cap.Retire()
		if e := cap.Join(r.Context()); err == nil {
			err = e
		}
		if e := cap.Close(); err == nil {
			err = e
		}
		result <- err
		_, _ = w.Write(body)
	}), false)
	d, c, r := taskReadTestDial(t, name, "execute", body, 'R', 1)
	commands := make(chan byte, 64)
	peerDone := make(chan error, 1)
	go func() { peerDone <- taskReadTestReply(c, sha256.Sum256(body), "", commands) }()
	if err := r.Write(d); err != nil {
		t.Fatal(err)
	}
	response, err := http.ReadResponse(bufio.NewReader(d), r)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := io.ReadAll(response.Body)
	_ = response.Body.Close()
	if err != nil || !bytes.Equal(raw, body) || response.StatusCode != 200 {
		t.Fatal(response.Status, err)
	}
	if err := <-result; err != nil {
		t.Fatal(err)
	}
	if !cap.Lifetime().Closed || !cap.Lifetime().Joined || cap.Lifetime().Sequence != 3 {
		t.Fatal(cap.Lifetime())
	}
	_ = c.Close()
	<-peerDone
	close(commands)
	var got []byte
	for cmd := range commands {
		got = append(got, cmd)
	}
	if string(got) != "CDF" {
		t.Fatalf("commands=%q", got)
	}
}

func TestOriginalTaskReadContinuationPurposeAndSCMRefusal(t *testing.T) {
	for _, tc := range []struct {
		name, stage     string
		marker          byte
		fds             int
		ordinary, admit bool
	}{{"plaininput", "input", 0, 0, false, true}, {"plainquery", "query", 0, 0, false, true}, {"plainexecute", "execute", 0, 0, false, false}, {"Rinput", "input", 'R', 1, false, false}, {"noFD", "execute", 'R', 0, false, false}, {"extraFD", "execute", 'R', 2, false, false}, {"PwithFD", "input", 'P', 1, false, false}, {"ordinaryplain", "execute", 0, 0, true, true}, {"ordinaryR", "execute", 'R', 1, true, false}} {
		t.Run(tc.name, func(t *testing.T) {
			var called atomic.Int32
			_, name := taskReadTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				called.Add(1)
				if _, err := OriginalTaskReadContinuationFromOriginalRequest(r); err == nil {
					t.Error("plain/ordinary minted continuation")
				}
				_, _ = w.Write([]byte(`{}`))
			}), tc.ordinary)
			d, _, r := taskReadTestDial(t, name, tc.stage, []byte(`{}`), tc.marker, tc.fds)
			_ = r.Write(d)
			resp, err := http.ReadResponse(bufio.NewReader(d), r)
			if err == nil {
				_, _ = io.Copy(io.Discard, resp.Body)
				_ = resp.Body.Close()
			}
			if tc.admit {
				if err != nil || resp.StatusCode != 200 || called.Load() != 1 {
					t.Fatal(err, called.Load())
				}
			} else if called.Load() != 0 {
				t.Fatal("invalid protocol entered handler")
			}
		})
	}
}

func TestOriginalTaskReadContinuationFrameFailureAndRawZero(t *testing.T) {
	for _, mode := range []string{"hash", "seq", "zero", "retained", "drop", "oversize"} {
		t.Run(mode, func(t *testing.T) {
			body := []byte(`{}`)
			result := make(chan error, 1)
			var held *OriginalTaskReadContinuation
			_, name := taskReadTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				held, _ = OriginalTaskReadContinuationFromOriginalRequest(r)
				err := held.ClaimAtOriginalResourceFence(r.Context())
				if err == nil {
					result <- ErrDenied
					return
				}
				if mode == "zero" || mode == "retained" {
					var remote *OriginalTaskReadContinuationRemoteError
					if !errors.As(err, &remote) || remote.Code != 0 {
						result <- ErrDenied
						return
					}
				}
				if again := held.ClaimAtOriginalResourceFence(r.Context()); again == nil {
					result <- ErrDenied
					return
				}
				_ = held.Retire()
				_ = held.Join(r.Context())
				_ = held.Close()
				result <- nil
				w.WriteHeader(503)
			}), false)
			d, c, r := taskReadTestDial(t, name, "execute", body, 'R', 1)
			commands := make(chan byte, 64)
			done := make(chan error, 1)
			go func() { defer c.Close(); done <- taskReadTestReply(c, sha256.Sum256(body), mode, commands) }()
			if err := r.Write(d); err != nil {
				t.Fatal(err)
			}
			resp, err := http.ReadResponse(bufio.NewReader(d), r)
			if err == nil {
				_, _ = io.Copy(io.Discard, resp.Body)
				_ = resp.Body.Close()
			}
			if err := <-result; err != nil {
				t.Fatal(err)
			}
			if !held.Lifetime().ClaimSelected || !held.Lifetime().Joined {
				t.Fatal(held.Lifetime())
			}
			_ = c.Close()
			<-done
			close(commands)
			var n int
			for range commands {
				n++
			}
			if n != 1 {
				t.Fatal("replayed F", n)
			}
		})
	}
}

func TestOriginalTaskReadContinuationSequenceLimit(t *testing.T) {
	body := []byte(`{}`)
	result := make(chan error, 1)
	_, name := taskReadTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cap, _ := OriginalTaskReadContinuationFromOriginalRequest(r)
		for i := 0; i < 64; i++ {
			if err := cap.Current(r.Context()); err != nil {
				result <- err
				return
			}
		}
		if cap.Current(r.Context()) == nil {
			result <- ErrDenied
			return
		}
		_ = cap.Retire()
		_ = cap.Join(r.Context())
		_ = cap.Close()
		result <- nil
		_, _ = w.Write(body)
	}), false)
	d, c, r := taskReadTestDial(t, name, "execute", body, 'R', 1)
	commands := make(chan byte, 128)
	done := make(chan error, 1)
	go func() { done <- taskReadTestReply(c, sha256.Sum256(body), "", commands) }()
	if err := r.Write(d); err != nil {
		t.Fatal(err)
	}
	resp, err := http.ReadResponse(bufio.NewReader(d), r)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	if err := <-result; err != nil {
		t.Fatal(err)
	}
	_ = c.Close()
	<-done
	close(commands)
	var n int
	for range commands {
		n++
	}
	if n != 64 {
		t.Fatal(n)
	}
}

func TestOriginalTaskReadContinuationRetireInflightAndServerHandlerDrain(t *testing.T) {
	type call struct {
		cap *OriginalTaskReadContinuation
		ctx context.Context
	}
	entered := make(chan call, 1)
	release := make(chan struct{})
	handlerDone := make(chan struct{})
	callsDone := make(chan error, 1)
	s, name := taskReadTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer close(handlerDone)
		cap, err := OriginalTaskReadContinuationFromOriginalRequest(r)
		if err != nil {
			callsDone <- err
			return
		}
		entered <- call{cap, r.Context()}
		go func() { callsDone <- cap.Current(r.Context()) }()
		<-release
		_, _ = w.Write([]byte(`{}`))
	}), false)
	var releaseOnce atomic.Bool
	unblock := func() {
		if releaseOnce.CompareAndSwap(false, true) {
			close(release)
		}
	}
	t.Cleanup(unblock)
	d, c, r := taskReadTestDial(t, name, "execute", []byte(`{}`), 'R', 1)
	if err := r.Write(d); err != nil {
		t.Fatal(err)
	}
	held := <-entered
	var frame [41]byte
	if _, err := io.ReadFull(c, frame[:]); err != nil {
		t.Fatal(err)
	}
	if held.cap.Lifetime().Calls != 1 {
		t.Fatal(held.cap.Lifetime())
	}
	if !errors.Is(held.cap.ClaimAtOriginalResourceFence(held.ctx), ErrLocalCallerDraining) {
		t.Fatal("fence waited for asynchronous Current")
	}
	if !held.cap.Lifetime().ClaimSelected || held.cap.Lifetime().Sequence != 1 {
		t.Fatal("busy F was rearmed or emitted a frame", held.cap.Lifetime())
	}
	_ = held.cap.Retire()
	if err := <-callsDone; err == nil {
		t.Fatal("inflight Current emitted success")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_ = held.cap.Join(ctx)
	_ = held.cap.Close()
	if !held.cap.Lifetime().Closed || !held.cap.Lifetime().Joined {
		t.Fatal(held.cap.Lifetime())
	}
	// The control child does not close the parent's actual HTTP fd or await its
	// own handler. Server Join, separately, must still retain that handler debt.
	_ = d.SetReadDeadline(time.Now().Add(20 * time.Millisecond))
	var b [1]byte
	_, err := d.Read(b[:])
	var timeout net.Error
	if !errors.As(err, &timeout) || !timeout.Timeout() {
		t.Fatal("control retire closed borrowed data fd", err)
	}
	_ = s.Retire()
	probe, cancelProbe := context.WithCancel(context.Background())
	cancelProbe()
	if !errors.Is(s.Join(probe), context.Canceled) {
		t.Fatal("server fabricated handler drain")
	}
	unblock()
	<-handlerDone
	if err := s.Join(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestOriginalTaskReadContinuationConstructorClosedSet(t *testing.T) {
	base := taskReadTestConfig(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	for _, mutate := range []func(*LocalCallerServerConfig){func(c *LocalCallerServerConfig) { c.Service = "other" }, func(c *LocalCallerServerConfig) { c.Routes = c.Routes[:2] }, func(c *LocalCallerServerConfig) { c.Routes[0].Method = "GET" }, func(c *LocalCallerServerConfig) { c.Routes[0].MaxBodyBytes = taskReadContinuationMaxDATA + 1 }, func(c *LocalCallerServerConfig) { c.Routes[0].Path += "?alias" }} {
		cfg := base
		cfg.Routes = append([]LocalCallerRoute(nil), base.Routes...)
		mutate(&cfg)
		if _, err := NewOriginalTaskReadContinuationServer(cfg); err == nil {
			t.Fatal("unregistered continuation profile accepted")
		}
	}
}

func TestOriginalTaskReadContinuationConcurrentClaim(t *testing.T) {
	body := []byte(`{}`)
	result := make(chan error, 1)
	_, name := taskReadTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cap, err := OriginalTaskReadContinuationFromOriginalRequest(r)
		if err != nil {
			result <- err
			return
		}
		start := make(chan struct{})
		completed := make(chan error, 2)
		for i := 0; i < 2; i++ {
			go func() { <-start; completed <- cap.ClaimAtOriginalResourceFence(r.Context()) }()
		}
		close(start)
		a, b := <-completed, <-completed
		if (a == nil) == (b == nil) {
			result <- ErrDenied
			return
		}
		if cap.Lifetime().Sequence != 1 {
			result <- ErrDenied
			return
		}
		_ = cap.Retire()
		_ = cap.Join(r.Context())
		_ = cap.Close()
		result <- nil
		_, _ = w.Write(body)
	}), false)
	d, c, r := taskReadTestDial(t, name, "execute", body, 'R', 1)
	commands := make(chan byte, 64)
	done := make(chan error, 1)
	go func() { done <- taskReadTestReply(c, sha256.Sum256(body), "", commands) }()
	if err := r.Write(d); err != nil {
		t.Fatal(err)
	}
	response, err := http.ReadResponse(bufio.NewReader(d), r)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, response.Body)
	_ = response.Body.Close()
	if err := <-result; err != nil {
		t.Fatal(err)
	}
	_ = c.Close()
	<-done
	close(commands)
	var got []byte
	for cmd := range commands {
		got = append(got, cmd)
	}
	if string(got) != "F" {
		t.Fatalf("concurrent F replayed %q", got)
	}
}
