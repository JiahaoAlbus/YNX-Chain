//go:build linux || (darwin && cgo)

package securelink

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// These expectations are selected by a PUBLIC test fixture from the actual
// kernel process/test executable. They are never a normal Source/Root row.
// Production callers must supply independently selected expected originals.
type publicOwnedExchangePeer struct {
	client *LocalCallerClient
	done   chan error
	once   sync.Once
	err    error
}

func publicOwnedExchangeServe(t *testing.T, serve func(net.Conn, *http.Request) error) *publicOwnedExchangePeer {
	t.Helper()
	path, listener := localTestSocket(t)
	route := LocalCallerRoute{Method: "GET", Path: "/PUBLIC/original-read", Timeout: 3 * time.Second}
	client, err := NewLocalCallerClient(LocalCallerClientConfig{SocketPath: path, Service: "public-owned-exchange", PeerUID: localTestUID(t), PeerPID: os.Getpid(), Routes: []LocalCallerRoute{route}, Timeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	p := &publicOwnedExchangePeer{client: client, done: make(chan error, 1)}
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			p.done <- err
			return
		}
		_ = conn.SetDeadline(time.Now().Add(4 * time.Second))
		request, err := http.ReadRequest(bufio.NewReader(conn))
		if err == nil {
			body, readErr := io.ReadAll(request.Body)
			_ = request.Body.Close()
			if readErr != nil || len(body) != 0 || request.Method != "GET" || request.RequestURI != route.Path || request.Host != "public-owned-exchange" || request.Header.Get("Content-Type") != "" {
				err = errors.Join(ErrDenied, readErr)
			}
		}
		if err == nil {
			err = serve(conn, request)
		}
		closeErr := conn.Close() // actual one close of this PUBLIC server endpoint
		p.done <- errors.Join(err, closeErr)
	}()
	t.Cleanup(func() {
		_ = listener.Close()
		p.wait(t)
	})
	return p
}

func (p *publicOwnedExchangePeer) wait(t *testing.T) {
	t.Helper()
	p.once.Do(func() {
		select {
		case p.err = <-p.done:
		case <-time.After(5 * time.Second):
			p.err = errors.New("PUBLIC original server did not physically drain")
		}
	})
	if p.err != nil {
		t.Error(p.err)
	}
}

func publicOwnedExchangeEvidence(t *testing.T, expected LocalCallerExpectedProcess, x *OriginalLocalCallerExchange, out LocalCallerResponse) {
	t.Helper()
	value := struct {
		Expected             LocalCallerExpectedProcess
		Lifetime             OriginalLocalCallerExchangeLifetime
		Packet, BodyComplete bool
		Method, Path         string
		Status, BodyBytes    int
		RootAdmission        bool
		SourceAdmission      bool
	}{Expected: expected, Lifetime: x.Lifetime(), Packet: out.PacketPresent, BodyComplete: out.BodyComplete, Method: out.Method, Path: out.RequestPath, Status: out.StatusCode, BodyBytes: len(out.Body)}
	root := os.Getenv("YNX_LINK_OWNED_LOCAL_CLIENT_TEST_EVIDENCE")
	if root == "" {
		t.Logf("PUBLIC owned exchange: %+v", value)
		return
	}
	if !filepath.IsAbs(root) || filepath.Clean(root) != root {
		t.Fatal("owned test evidence must be an absolute canonical directory")
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		t.Fatal(err)
	}
	dir, err := os.MkdirTemp(root, "owned-")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(dir, strings.ReplaceAll(t.Name(), "/", "__")+".json"), append(raw, '\n'), 0600); err != nil {
		t.Fatal(err)
	}
}

func publicOwnedExchangeClose(t *testing.T, x *OriginalLocalCallerExchange) {
	t.Helper()
	if x == nil {
		t.Error("actual owned partial was lost")
		return
	}
	_ = x.Retire() // preserved operation cause is separate from real cleanup
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = x.Join(ctx)
	_ = x.Close()
	if err := x.AssertOriginalClosed(); err != nil {
		t.Errorf("original socket/process/cancel debt retained: %v, %+v", err, x.Lifetime())
	}
}

func TestOriginalLocalCallerExchangeCompleteFINAndDebt(t *testing.T) {
	expected := publicOriginalLocalCallerExpected(t)
	body := []byte("{ \"PUBLIC\": \"original bytes\", \"n\":9007199254740993 }\n")
	p := publicOwnedExchangeServe(t, func(c net.Conn, _ *http.Request) error {
		_, err := fmt.Fprintf(c, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nX-Public-Multi: first\r\nX-Public-Multi: second\r\nContent-Length: %d\r\nConnection: close\r\n\r\n%s", len(body), body)
		return err
	})
	x, out, err := p.client.CallOriginalOwned(context.Background(), "GET", "/PUBLIC/original-read", "", nil, expected)
	if x != nil {
		t.Cleanup(func() { publicOwnedExchangeClose(t, x) })
	}
	if err != nil || x == nil || !out.PacketPresent || !out.BodyComplete || out.StatusCode != 200 || !bytes.Equal(out.Body, body) || strings.Join(out.Header.Values("X-Public-Multi"), ",") != "first,second" {
		t.Fatalf("complete original packet: %+v %v", out, err)
	}
	p.wait(t) // actual peer close, no delay or keepalive extension hides FIN
	if err = x.Current(context.Background()); err != nil {
		t.Fatal("valid original complete FIN DATA was denied", err)
	}
	life := x.Lifetime()
	if !life.Peer.SameOriginalConnection || !life.Peer.ProcessIdentityAvailable || !life.Peer.TerminalEOFObserved || life.Peer.LivenessProved || life.Closed || life.Joined {
		t.Fatalf("terminal DATA/liveness/physical debt conflated: %+v", life)
	}
	if err = x.AssertOriginalClosed(); !errors.Is(err, ErrLocalCallerDraining) {
		t.Fatal("packet success fabricated physical close", err)
	}
	if err = x.Close(); !errors.Is(err, ErrLocalCallerDraining) || x.FirstCause() != nil {
		t.Fatal("ordinary close progress became first failure", err, x.FirstCause())
	}
	publicOwnedExchangeClose(t, x)
	if err = x.Close(); err != nil || x.AssertOriginalClosed() != nil {
		t.Fatal("known close was replayed or lost", err)
	}
	publicOwnedExchangeEvidence(t, expected, x, out)
}

func TestOriginalLocalCallerExchangePreflightNoSocket(t *testing.T) {
	expected := publicOriginalLocalCallerExpected(t)
	for _, mode := range []string{"missing-image", "wrong-client-uid", "wrong-client-pid", "unregistered-route", "nonempty-get"} {
		t.Run(mode, func(t *testing.T) {
			path, _ := localTestSocket(t)
			client, err := NewLocalCallerClient(LocalCallerClientConfig{SocketPath: path, Service: "public-owned-exchange", PeerUID: localTestUID(t), PeerPID: os.Getpid(), Routes: []LocalCallerRoute{{Method: "GET", Path: "/PUBLIC/original-read", Timeout: time.Second}}})
			if err != nil {
				t.Fatal(err)
			}
			bad, route, body := expected, "/PUBLIC/original-read", []byte(nil)
			switch mode {
			case "missing-image":
				bad.ImageSHA256 = [32]byte{}
			case "wrong-client-uid":
				bad.UID++
			case "wrong-client-pid":
				bad.PID++
			case "unregistered-route":
				route = "/PUBLIC/other"
			case "nonempty-get":
				body = []byte("not empty")
			}
			x, out, err := client.CallOriginalOwned(context.Background(), "GET", route, "", body, bad)
			if x == nil {
				t.Fatal("failed acquisition partial lost")
			}
			t.Cleanup(func() { publicOwnedExchangeClose(t, x) })
			var dispatch *DispatchError
			if err == nil || !errors.As(err, &dispatch) || dispatch.DispatchPossible || out.PacketPresent || x.state.socketFD >= 0 {
				t.Fatalf("invalid preflight created a socket or dispatch: %v %+v", err, out)
			}
			publicOwnedExchangeClose(t, x)
			publicOwnedExchangeEvidence(t, bad, x, out)
		})
	}
}

func TestOriginalLocalCallerExchangePartialAndBounds(t *testing.T) {
	expected := publicOriginalLocalCallerExpected(t)
	for _, mode := range []string{"partial", "body-bound"} {
		t.Run(mode, func(t *testing.T) {
			p := publicOwnedExchangeServe(t, func(c net.Conn, _ *http.Request) error {
				_, err := io.WriteString(c, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 20\r\nConnection: close\r\n\r\n{\"x\":")
				return err
			})
			if mode == "body-bound" {
				p.client.cfg.MaxResponseBytes = 4 // PUBLIC pre-call fixed fixture budget
			}
			x, out, err := p.client.CallOriginalOwned(context.Background(), "GET", "/PUBLIC/original-read", "", nil, expected)
			if x == nil {
				t.Fatal("partial owner lost")
			}
			t.Cleanup(func() { publicOwnedExchangeClose(t, x) })
			want := error(io.ErrUnexpectedEOF)
			if mode == "body-bound" {
				want = ErrBounds
			}
			var dispatch *DispatchError
			if !errors.Is(err, want) || !errors.As(err, &dispatch) || !dispatch.DispatchPossible || !out.PacketPresent || out.BodyComplete || !errors.Is(x.FirstCause(), want) {
				t.Fatalf("late original packet/first cause: %+v %v %+v", out, err, x.Lifetime())
			}
			if mode == "partial" && (!bytes.Equal(out.Body, []byte("{\"x\":")) || dispatch.PartialResponseBytes != 5) {
				t.Fatal("exact received prefix lost", out, dispatch)
			}
			p.wait(t)
			publicOwnedExchangeClose(t, x)
			if !errors.Is(x.Close(), want) || x.AssertOriginalClosed() != nil {
				t.Fatal("operation failure was confused with physical closure")
			}
			publicOwnedExchangeEvidence(t, expected, x, out)
		})
	}
}

func TestOriginalLocalCallerExchangeCancellationJoinsCallback(t *testing.T) {
	expected := publicOriginalLocalCallerExpected(t)
	entered := make(chan struct{})
	p := publicOwnedExchangeServe(t, func(c net.Conn, _ *http.Request) error {
		close(entered)
		_, err := io.Copy(io.Discard, c) // cancellation must close the actual client fd
		return err
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	type result struct {
		x   *OriginalLocalCallerExchange
		out LocalCallerResponse
		err error
	}
	done := make(chan result, 1)
	go func() {
		x, out, err := p.client.CallOriginalOwned(ctx, "GET", "/PUBLIC/original-read", "", nil, expected)
		done <- result{x, out, err}
	}()
	select {
	case <-entered:
	case <-time.After(4 * time.Second):
		t.Fatal("actual original GET did not arrive")
	}
	cancel()
	var got result
	select {
	case got = <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("owned cancellation did not wake actual read")
	}
	if got.x == nil {
		t.Fatal("canceled original partial lost")
	}
	t.Cleanup(func() { publicOwnedExchangeClose(t, got.x) })
	if !errors.Is(got.err, context.Canceled) || !got.x.Lifetime().DispatchPossible || got.out.PacketPresent {
		t.Fatal("cancellation first/progress lost", got.err, got.out)
	}
	p.wait(t)
	publicOwnedExchangeClose(t, got.x)
	if !got.x.Lifetime().Joined || !got.x.Lifetime().Closed || !errors.Is(got.x.FirstCause(), context.Canceled) {
		t.Fatal("callback/call drain or first cancellation lost", got.x.Lifetime())
	}
	publicOwnedExchangeEvidence(t, expected, got.x, got.out)
}

func TestOriginalLocalCallerExchangeConcurrentCurrentAndCleanup(t *testing.T) {
	expected := publicOriginalLocalCallerExpected(t)
	p := publicOwnedExchangeServe(t, func(c net.Conn, _ *http.Request) error {
		_, err := io.WriteString(c, "HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n")
		return err
	})
	x, out, err := p.client.CallOriginalOwned(context.Background(), "GET", "/PUBLIC/original-read", "", nil, expected)
	if x == nil || err != nil {
		if x != nil {
			publicOwnedExchangeClose(t, x)
		}
		t.Fatal(err)
	}
	t.Cleanup(func() { publicOwnedExchangeClose(t, x) })
	p.wait(t)
	var workers sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < 3; i++ {
		workers.Add(2)
		go func() { defer workers.Done(); <-start; _ = x.Current(context.Background()) }()
		go func() {
			defer workers.Done()
			<-start
			_ = x.Retire()
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			_ = x.Join(ctx)
			_ = x.Close() // concurrent progress may refuse, never becomes first cause
		}()
	}
	close(start)
	workers.Wait()
	publicOwnedExchangeClose(t, x)
	if x.Lifetime().Active != 0 || !x.Lifetime().Closed || x.Lifetime().CleanupUnknown {
		t.Fatal("concurrent current/retire/close lost original debt", x.Lifetime())
	}
	publicOwnedExchangeEvidence(t, expected, x, out)
}

func TestOriginalLocalCallerExchangeCloseUnknownRetainsOriginal(t *testing.T) {
	expected := publicOriginalLocalCallerExpected(t)
	p := publicOwnedExchangeServe(t, func(c net.Conn, _ *http.Request) error {
		_, err := io.WriteString(c, "HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n")
		return err
	})
	x, out, err := p.client.CallOriginalOwned(context.Background(), "GET", "/PUBLIC/original-read", "", nil, expected)
	if x == nil || err != nil {
		if x != nil {
			publicOwnedExchangeClose(t, x)
		}
		t.Fatal(err)
	}
	p.wait(t)
	// Explicit PUBLIC ownership-violation fault: the original os.File is closed
	// outside its owner. The owner's selected Close must refuse to claim a fresh
	// physical witness, retain the actual process/FD debt and never re-close it.
	if err = x.state.conn.Close(); err != nil {
		t.Fatal(err)
	}
	_ = x.Retire()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_ = x.Join(ctx)
	first := x.Close()
	if !errors.Is(first, ErrOriginalLocalCallerCloseUnknown) || !errors.Is(x.AssertOriginalClosed(), ErrOriginalLocalCallerCloseUnknown) || !x.Lifetime().CleanupUnknown || x.Lifetime().Closed {
		t.Fatal("unknown selected close was fabricated complete", first, x.Lifetime())
	}
	_ = x.Close()
	originalLocalCallerExchangeCustody.Lock()
	_, retained := originalLocalCallerExchangeCustody.owners[x.state]
	originalLocalCallerExchangeCustody.Unlock()
	if !retained || x.state.peer.closed() {
		t.Fatal("unknown original owner/auxiliary FD debt was freed")
	}
	publicOwnedExchangeEvidence(t, expected, x, out)
	// Deliberately retained until this PUBLIC test process ends. No fake ACK,
	// registry removal, GC finalizer cleanup, retry or replacement acquisition.
}
