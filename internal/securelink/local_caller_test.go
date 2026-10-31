//go:build linux || darwin

package securelink

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func localTestUID(t *testing.T) uint32 {
	t.Helper()
	uid := uint32(os.Geteuid())
	if uid == 0 {
		t.Skip("nonzero registered OS principal required; root is deliberately refused")
	}
	return uid
}

func localTestSocket(t *testing.T) (string, net.Listener) {
	t.Helper()
	dir, err := os.MkdirTemp("", "lc-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	if err = os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "s")
	l, err := ListenPrivate(path, localTestUID(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = l.Close() })
	return path, l
}

func localTestRoute() LocalCallerRoute {
	return LocalCallerRoute{Method: http.MethodPost, Path: "/authority/prepare", MaxBodyBytes: 1024, Timeout: 2 * time.Second}
}

func localTestServe(t *testing.T, handler http.Handler, route LocalCallerRoute) (*LocalCallerServer, *LocalCallerClient, string) {
	t.Helper()
	path, l := localTestSocket(t)
	s, err := NewLocalCallerServer(LocalCallerServerConfig{Service: "auth-native", PeerUID: localTestUID(t), PeerPID: os.Getpid(), Routes: []LocalCallerRoute{route}, Handler: handler})
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- s.Serve(l) }()
	t.Cleanup(func() {
		_ = s.Close()
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if e := s.Join(ctx); e != nil {
			t.Errorf("real handlers did not drain: %v", e)
		}
		select {
		case e := <-done:
			if e != nil && !errors.Is(e, http.ErrServerClosed) {
				t.Errorf("Serve: %v", e)
			}
		case <-ctx.Done():
			t.Error("Serve did not stop")
		}
	})
	c, err := NewLocalCallerClient(LocalCallerClientConfig{Service: "auth-native", SocketPath: path, PeerUID: localTestUID(t), PeerPID: os.Getpid(), Routes: []LocalCallerRoute{route}})
	if err != nil {
		t.Fatal(err)
	}
	return s, c, path
}

type localCaptured struct {
	caller  *LocalCaller
	request *http.Request
}

func TestLocalCallerActualUnixOpaqueBodyAndCapability(t *testing.T) {
	captured := make(chan localCaptured, 1)
	release := make(chan struct{})
	_, client, _ := localTestServe(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		caller, e := LocalCallerFromRequest(r)
		if e != nil {
			t.Errorf("real boundary: %v", e)
			http.Error(w, "denied", 500)
			return
		}
		body, e := io.ReadAll(r.Body)
		if e != nil || string(body) != "{\"opaque\":\"original\"}" {
			t.Errorf("body changed: %q %v", body, e)
		}
		// Mutating the handler's independent reader does not change the privately
		// captured source bytes that Auth will compare against its own codec.
		r.Body = io.NopCloser(strings.NewReader("replacement"))
		captured <- localCaptured{caller, r}
		<-release
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, "{\"opaque\":\"response\"}")
	}), localTestRoute())
	done := make(chan error, 1)
	go func() {
		out, e := client.Call(context.Background(), http.MethodPost, "/authority/prepare", "application/json", []byte("{\"opaque\":\"original\"}"))
		if e == nil && (out.StatusCode != 200 || string(out.Body) != "{\"opaque\":\"response\"}") {
			e = fmt.Errorf("opaque response changed: %+v", out)
		}
		done <- e
	}()
	cap := <-captured
	ctx := cap.request.Context()
	m, e := cap.caller.Current(ctx)
	if e != nil || m.PeerUID != uint32(os.Geteuid()) || m.PeerPID != os.Getpid() || m.Service != "auth-native" || m.Method != http.MethodPost || m.Path != "/authority/prepare" || m.ContentType != "application/json" || m.ContentLength != int64(len(m.RequestBody)) {
		t.Fatalf("actual peer/route/body: %+v %v", m, e)
	}
	if string(m.RequestBody) != "{\"opaque\":\"original\"}" {
		t.Fatal("handler changed original source bytes")
	}
	m.RequestBody[0] = '!'
	m.Service = "forged"
	again, e := cap.caller.Current(ctx)
	if e != nil || string(again.RequestBody) != "{\"opaque\":\"original\"}" || again.Service != "auth-native" {
		t.Fatal("material was not an owned copy", e)
	}
	alias := *cap.caller
	if _, e = alias.Current(ctx); e != nil {
		t.Fatal("value copy lost shared real lifetime", e)
	}
	derived, cancel := context.WithTimeout(ctx, time.Second)
	if got, e := LocalCallerFromContext(derived); e != nil || got != cap.caller {
		t.Fatal("private Auth derived context unavailable", e)
	}
	cancel()
	if _, e = cap.caller.Current(derived); e == nil {
		t.Fatal("cancelled derived ctx accepted")
	}
	if _, e = cap.caller.Current(context.Background()); e == nil {
		t.Fatal("unrelated ctx accepted")
	}
	copy := *cap.request
	if _, e = LocalCallerFromRequest(&copy); e == nil {
		t.Fatal("value copied request accepted")
	}
	if _, e = LocalCallerFromRequest(cap.request.Clone(ctx)); e == nil {
		t.Fatal("cloned request accepted")
	}
	newr := httptest.NewRequest(http.MethodPost, "http://auth-native/authority/prepare", nil).WithContext(ctx)
	if _, e = LocalCallerFromRequest(newr); e == nil {
		t.Fatal("original context authenticated a new request")
	}
	oldHost := cap.request.Host
	cap.request.Host = "forged"
	if _, e = cap.caller.Current(ctx); e == nil {
		t.Fatal("mutated actual Host accepted")
	}
	cap.request.Host = oldHost
	close(release)
	if e = <-done; e != nil {
		t.Fatal(e)
	}
	if _, e = alias.Current(ctx); e == nil {
		t.Fatal("handle copy survived handler return")
	}
	if _, e = LocalCallerFromContext(ctx); e == nil {
		t.Fatal("retained handler context survived return")
	}
}

func TestLocalCallerRejectsUnmintedAndRegistration(t *testing.T) {
	if _, e := (*LocalCaller)(nil).Current(context.Background()); e == nil {
		t.Fatal("nil caller accepted")
	}
	if _, e := new(LocalCaller).Current(context.Background()); e == nil {
		t.Fatal("zero caller accepted")
	}
	r := httptest.NewRequest(http.MethodPost, "http://auth-native/authority/prepare", nil)
	r.Header.Set("X-Caller-UID", strconv.Itoa(os.Geteuid()))
	r.Header.Set("X-Caller-PID", strconv.Itoa(os.Getpid()))
	if _, e := LocalCallerFromRequest(r); e == nil {
		t.Fatal("headers minted a caller")
	}
	if _, e := LocalCallerFromContext(context.Background()); e == nil {
		t.Fatal("plain ctx minted a caller")
	}
	base := LocalCallerServerConfig{Service: "auth-native", PeerUID: 123, PeerPID: 123, Routes: []LocalCallerRoute{localTestRoute()}, Handler: http.NotFoundHandler()}
	for name, change := range map[string]func(*LocalCallerServerConfig){
		"zero uid":       func(c *LocalCallerServerConfig) { c.PeerUID = 0 },
		"zero pid":       func(c *LocalCallerServerConfig) { c.PeerPID = 0 },
		"unbounded body": func(c *LocalCallerServerConfig) { c.Routes[0].MaxBodyBytes = 0 },
		"unbounded time": func(c *LocalCallerServerConfig) { c.Routes[0].Timeout = 0 },
		"query route":    func(c *LocalCallerServerConfig) { c.Routes[0].Path = "/authority/prepare?x=1" },
		"escaped route":  func(c *LocalCallerServerConfig) { c.Routes[0].Path = "/authority/%70repare" },
		"absolute route": func(c *LocalCallerServerConfig) { c.Routes[0].Path = "http://auth-native/authority/prepare" },
		"header size":    func(c *LocalCallerServerConfig) { c.MaxHeaderBytes = 1 << 20 },
	} {
		t.Run(name, func(t *testing.T) {
			c := base
			c.Routes = append([]LocalCallerRoute(nil), base.Routes...)
			change(&c)
			if s, e := NewLocalCallerServer(c); e == nil {
				_ = s.Close()
				t.Fatal("invalid registration accepted")
			}
		})
	}
}

func localRawRequest(t *testing.T, path, wire string) int {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	c, e := DialPrivate(ctx, path, localTestUID(t))
	if e != nil {
		t.Fatal(e)
	}
	defer c.Close()
	_ = c.SetDeadline(time.Now().Add(time.Second))
	if _, e = io.WriteString(c, wire); e != nil {
		t.Fatal(e)
	}
	resp, e := http.ReadResponse(bufio.NewReader(c), nil)
	if e != nil {
		return 0
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	return resp.StatusCode
}

func TestLocalCallerExactRouteHeadersAndBodyBeforeHandler(t *testing.T) {
	var called atomic.Int32
	route := localTestRoute()
	route.MaxBodyBytes = 8
	_, client, path := localTestServe(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called.Add(1); w.WriteHeader(200) }), route)
	for name, wire := range map[string]string{
		"method":      "GET /authority/prepare HTTP/1.1\r\nHost: auth-native\r\n\r\n",
		"path":        "POST /authority/other HTTP/1.1\r\nHost: auth-native\r\nContent-Length: 0\r\n\r\n",
		"host":        "POST /authority/prepare HTTP/1.1\r\nHost: other\r\nContent-Length: 0\r\n\r\n",
		"absolute":    "POST http://auth-native/authority/prepare HTTP/1.1\r\nHost: auth-native\r\nContent-Length: 0\r\n\r\n",
		"query":       "POST /authority/prepare?x=1 HTTP/1.1\r\nHost: auth-native\r\nContent-Length: 0\r\n\r\n",
		"escape":      "POST /authority/%70repare HTTP/1.1\r\nHost: auth-native\r\nContent-Length: 0\r\n\r\n",
		"identity":    "POST /authority/prepare HTTP/1.1\r\nHost: auth-native\r\nX-Caller-PID: 123\r\nContent-Length: 0\r\n\r\n",
		"proxy":       "POST /authority/prepare HTTP/1.1\r\nHost: auth-native\r\nX-Forwarded-For: localhost\r\nContent-Length: 0\r\n\r\n",
		"upgrade":     "POST /authority/prepare HTTP/1.1\r\nHost: auth-native\r\nUpgrade: native\r\nContent-Length: 0\r\n\r\n",
		"too large":   "POST /authority/prepare HTTP/1.1\r\nHost: auth-native\r\nContent-Length: 9\r\n\r\n123456789",
		"chunk bound": "POST /authority/prepare HTTP/1.1\r\nHost: auth-native\r\nTransfer-Encoding: chunked\r\n\r\n9\r\n123456789\r\n0\r\n\r\n",
	} {
		t.Run(name, func(t *testing.T) {
			if status := localRawRequest(t, path, wire); status == 200 {
				t.Fatal("invalid carrier accepted")
			}
		})
	}
	if called.Load() != 0 {
		t.Fatal("invalid carrier reached handler")
	}
	if _, e := client.Call(context.Background(), http.MethodGet, "/authority/prepare", "", nil); e == nil {
		t.Fatal("client emitted unregistered route")
	}
	if _, e := client.Call(context.Background(), http.MethodPost, "/authority/prepare", "", make([]byte, 9)); e == nil {
		t.Fatal("client emitted over-budget body")
	}
}

func TestLocalCallerRetireCloseAndActualDrain(t *testing.T) {
	captured := make(chan localCaptured, 1)
	release := make(chan struct{})
	s, client, _ := localTestServe(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, e := LocalCallerFromRequest(r)
		if e != nil {
			t.Error(e)
			return
		}
		captured <- localCaptured{c, r}
		<-release
	}), localTestRoute())
	done := make(chan error, 1)
	go func() {
		_, e := client.Call(context.Background(), http.MethodPost, "/authority/prepare", "", nil)
		done <- e
	}()
	cap := <-captured
	if e := s.Close(); !errors.Is(e, ErrLocalCallerDraining) {
		t.Fatalf("Close falsely claimed drain: %v", e)
	}
	if _, e := cap.caller.Current(cap.request.Context()); e == nil {
		t.Fatal("closed server retained caller")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	if e := s.Join(ctx); !errors.Is(e, context.DeadlineExceeded) {
		t.Fatal("blocked handler falsely drained", e)
	}
	cancel()
	close(release)
	ctx, cancel = context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if e := s.Join(ctx); e != nil {
		t.Fatal(e)
	}
	if e := s.Close(); e != nil {
		t.Fatal("drained Close", e)
	}
	<-done
	if _, e := client.Call(ctx, http.MethodPost, "/authority/prepare", "", nil); e == nil {
		t.Fatal("retired endpoint dispatched")
	}
}

func TestLocalCallerCancellationAndRouteTimeout(t *testing.T) {
	for _, cancelClient := range []bool{true, false} {
		t.Run(fmt.Sprint(cancelClient), func(t *testing.T) {
			captured := make(chan localCaptured, 1)
			invalid := make(chan error, 1)
			route := localTestRoute()
			if !cancelClient {
				route.Timeout = 70 * time.Millisecond
			}
			_, client, _ := localTestServe(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				c, e := LocalCallerFromRequest(r)
				if e != nil {
					invalid <- e
					return
				}
				captured <- localCaptured{c, r}
				<-r.Context().Done()
				_, e = c.Current(r.Context())
				invalid <- e
			}), route)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := make(chan error, 1)
			go func() { _, e := client.Call(ctx, http.MethodPost, route.Path, "", nil); done <- e }()
			cap := <-captured
			if cancelClient {
				cancel()
			}
			select {
			case e := <-invalid:
				if e == nil {
					t.Fatal("cancel/timeout retained caller")
				}
			case <-time.After(time.Second):
				t.Fatal("actual disconnect did not cancel handler")
			}
			if _, e := cap.caller.Current(cap.request.Context()); e == nil {
				t.Fatal("captured caller survived timeout/disconnect")
			}
			if e := <-done; e == nil {
				t.Fatal("timed out/cancelled request reported success")
			}
		})
	}
}

func TestLocalCallerBodyCaptureDeadlineAndHeaderBound(t *testing.T) {
	var called atomic.Int32
	route := localTestRoute()
	route.Timeout = 70 * time.Millisecond
	_, _, path := localTestServe(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called.Add(1) }), route)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	c, err := DialPrivate(ctx, path, localTestUID(t))
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	_ = c.SetDeadline(time.Now().Add(time.Second))
	start := time.Now()
	_, err = io.WriteString(c, "POST /authority/prepare HTTP/1.1\r\nHost: auth-native\r\nContent-Length: 8\r\n\r\nx")
	if err != nil {
		t.Fatal(err)
	}
	// A partial opaque body must expire BEFORE a LocalCaller/handler exists.
	_, _ = http.ReadResponse(bufio.NewReader(c), nil)
	if time.Since(start) > 500*time.Millisecond {
		t.Fatal("partial body escaped route deadline")
	}
	if called.Load() != 0 {
		t.Fatal("partial body reached handler")
	}
	path2, l := localTestSocket(t)
	s, err := NewLocalCallerServer(LocalCallerServerConfig{Service: "auth-native", PeerUID: localTestUID(t), PeerPID: os.Getpid(), Routes: []LocalCallerRoute{localTestRoute()}, MaxHeaderBytes: 256, ReadHeaderTimeout: 70 * time.Millisecond, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called.Add(1) })})
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- s.Serve(l) }()
	t.Cleanup(func() { _ = s.Close(); <-done })
	status := localRawRequest(t, path2, "POST /authority/prepare HTTP/1.1\r\nHost: auth-native\r\nX-Large: "+strings.Repeat("x", 8192)+"\r\nContent-Length: 0\r\n\r\n")
	if status == http.StatusOK || called.Load() != 0 {
		t.Fatal("over-budget headers reached handler")
	}
	// A bare net.Listener does not prove the original private-directory boundary.
	tcp, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer tcp.Close()
	other, err := NewLocalCallerServer(LocalCallerServerConfig{Service: "auth-native", PeerUID: localTestUID(t), PeerPID: os.Getpid(), Routes: []LocalCallerRoute{localTestRoute()}, Handler: http.NotFoundHandler()})
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	if err = other.Serve(tcp); err == nil {
		t.Fatal("non-ListenPrivate listener accepted")
	}
}

func TestLocalCallerClientPeerResponseBoundsAndNoRedirect(t *testing.T) {
	var called atomic.Int32
	_, client, path := localTestServe(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called.Add(1)
		body, _ := io.ReadAll(r.Body)
		if string(body) == "redirect" {
			w.Header().Set("Location", "http://unregistered/authority/prepare")
			w.WriteHeader(http.StatusTemporaryRedirect)
			return
		}
		if string(body) == "headers" {
			w.Header().Set("X-Large", strings.Repeat("x", 8192))
			return
		}
		_, _ = io.WriteString(w, strings.Repeat("x", 64))
	}), localTestRoute())
	wrong, err := NewLocalCallerClient(LocalCallerClientConfig{SocketPath: path, Service: "auth-native", PeerUID: localTestUID(t), PeerPID: os.Getpid() + 10000, Routes: []LocalCallerRoute{localTestRoute()}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = wrong.Call(context.Background(), http.MethodPost, "/authority/prepare", "", nil); err == nil {
		t.Fatal("wrong server PID accepted")
	}
	if called.Load() != 0 {
		t.Fatal("wrong server PID still emitted body")
	}
	out, err := client.Call(context.Background(), http.MethodPost, "/authority/prepare", "", []byte("redirect"))
	if err != nil || out.StatusCode != http.StatusTemporaryRedirect || called.Load() != 1 {
		t.Fatal("redirect was followed or retried", out.StatusCode, err, called.Load())
	}
	bounded, err := NewLocalCallerClient(LocalCallerClientConfig{SocketPath: path, Service: "auth-native", PeerUID: localTestUID(t), PeerPID: os.Getpid(), Routes: []LocalCallerRoute{localTestRoute()}, MaxResponseBytes: 8, MaxHeaderBytes: 512})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = bounded.Call(context.Background(), http.MethodPost, "/authority/prepare", "", nil); err == nil {
		t.Fatal("oversized response body accepted")
	}
	if _, err = bounded.Call(context.Background(), http.MethodPost, "/authority/prepare", "", []byte("headers")); err == nil {
		t.Fatal("oversized response headers accepted")
	}
	if called.Load() != 3 {
		t.Fatal("bounded failures retried", called.Load())
	}
}

func TestLocalCallerProcessHelper(t *testing.T) {
	if os.Getenv("YNX_LOCAL_CALLER_HELPER") != "1" {
		return
	}
	if _, e := bufio.NewReader(os.Stdin).ReadString('\n'); e != nil {
		t.Fatal(e)
	}
	uid, _ := strconv.ParseUint(os.Getenv("YNX_LOCAL_UID"), 10, 32)
	pid, _ := strconv.Atoi(os.Getenv("YNX_LOCAL_SERVER_PID"))
	c, e := NewLocalCallerClient(LocalCallerClientConfig{SocketPath: os.Getenv("YNX_LOCAL_SOCKET"), Service: "auth-native", PeerUID: uint32(uid), PeerPID: pid, Routes: []LocalCallerRoute{localTestRoute()}})
	if e != nil {
		t.Fatal(e)
	}
	out, e := c.Call(context.Background(), http.MethodPost, "/authority/prepare", "application/json", []byte("{\"native\":true}"))
	if os.Getenv("YNX_LOCAL_EXPECT_DENIED") == "1" {
		if e == nil {
			t.Fatal("wrong PID accepted")
		}
		return
	}
	if e != nil || out.StatusCode != 200 || string(out.Body) != "original-response" {
		t.Fatalf("real cross-process exchange: %+v %v", out, e)
	}
}

func TestLocalCallerRealCrossProcessPIDAndNoUIDSpoof(t *testing.T) {
	for _, allow := range []bool{true, false} {
		t.Run(fmt.Sprint(allow), func(t *testing.T) {
			path, l := localTestSocket(t)
			cmd := exec.Command(os.Args[0], "-test.run=^TestLocalCallerProcessHelper$")
			cmd.Env = []string{"YNX_LOCAL_CALLER_HELPER=1", "YNX_LOCAL_SOCKET=" + path, "YNX_LOCAL_UID=" + strconv.Itoa(os.Geteuid()), "YNX_LOCAL_SERVER_PID=" + strconv.Itoa(os.Getpid())}
			if !allow {
				cmd.Env = append(cmd.Env, "YNX_LOCAL_EXPECT_DENIED=1")
			}
			stdin, e := cmd.StdinPipe()
			if e != nil {
				t.Fatal(e)
			}
			var childOutput strings.Builder
			cmd.Stdout = &childOutput
			cmd.Stderr = &childOutput
			if e = cmd.Start(); e != nil {
				t.Fatal(e)
			}
			t.Cleanup(func() {
				if cmd.ProcessState == nil {
					_ = cmd.Process.Kill()
					_ = cmd.Wait()
				}
			})
			pid := cmd.Process.Pid
			if !allow {
				pid = os.Getpid()
			}
			var called atomic.Int32
			s, e := NewLocalCallerServer(LocalCallerServerConfig{Service: "auth-native", PeerUID: localTestUID(t), PeerPID: pid, Routes: []LocalCallerRoute{localTestRoute()}, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				called.Add(1)
				c, e := LocalCallerFromRequest(r)
				if e != nil {
					t.Error(e)
					return
				}
				m, e := c.Current(r.Context())
				if e != nil || m.PeerPID != cmd.Process.Pid || string(m.RequestBody) != "{\"native\":true}" {
					t.Errorf("actual cross-process material: %+v %v", m, e)
				}
				_, _ = io.WriteString(w, "original-response")
			})})
			if e != nil {
				t.Fatal(e)
			}
			done := make(chan error, 1)
			go func() { done <- s.Serve(l) }()
			_, _ = io.WriteString(stdin, "go\n")
			_ = stdin.Close()
			if e = cmd.Wait(); e != nil {
				t.Fatalf("child failed: %v %s", e, childOutput.String())
			}
			if allow && called.Load() != 1 {
				t.Fatal("actual child did not reach handler")
			}
			if !allow && called.Load() != 0 {
				t.Fatal("same UID spoofed registered PID")
			}
			_ = s.Close()
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			if e = s.Join(ctx); e != nil {
				t.Fatal(e)
			}
			if e = <-done; e != nil && !errors.Is(e, http.ErrServerClosed) {
				t.Fatal(e)
			}
		})
	}
}
