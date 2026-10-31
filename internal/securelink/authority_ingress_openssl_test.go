//go:build (linux || darwin) && securelink_openssl && cgo

package securelink

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink/native"
	"golang.org/x/sys/unix"
)

type authorityTestBackend struct {
	path        string
	listener    net.Listener
	calls       atomic.Int32
	mu          sync.Mutex
	connections []net.Conn
	wg          sync.WaitGroup
}

func authorityReceiveControl(c *net.UnixConn) (*net.UnixConn, error) {
	var marker [1]byte
	oob := make([]byte, unix.CmsgSpace(4))
	n, on, flags, _, err := c.ReadMsgUnix(marker[:], oob)
	if err != nil {
		return nil, err
	}
	msgs, err := unix.ParseSocketControlMessage(oob[:on])
	if err != nil {
		return nil, err
	}
	var fds []int
	for _, m := range msgs {
		rights, e := unix.ParseUnixRights(&m)
		if e != nil {
			for _, fd := range fds {
				_ = unix.Close(fd)
			}
			return nil, e
		}
		fds = append(fds, rights...)
	}
	defer func() {
		for _, fd := range fds {
			_ = unix.Close(fd)
		}
	}()
	if n != 1 || marker[0] != 'L' || flags&(unix.MSG_CTRUNC|unix.MSG_TRUNC) != 0 || len(fds) != 1 {
		return nil, ErrDenied
	}
	unix.CloseOnExec(fds[0])
	f := os.NewFile(uintptr(fds[0]), "received-authority-control")
	conn, err := net.FileConn(f)
	_ = f.Close()
	fds = nil
	if err != nil {
		return nil, err
	}
	u, ok := conn.(*net.UnixConn)
	if !ok {
		_ = conn.Close()
		return nil, ErrDenied
	}
	return u, nil
}

func authorityControlCurrent(c *net.UnixConn) (AuthorityIngressMetadata, []byte, error) {
	var out AuthorityIngressMetadata
	if _, err := c.Write([]byte{'C'}); err != nil {
		return out, nil, err
	}
	var size [4]byte
	if _, err := io.ReadFull(c, size[:]); err != nil {
		return out, nil, err
	}
	n := binary.BigEndian.Uint32(size[:])
	if n == 0 {
		return out, nil, ErrDenied
	}
	if n < 4 || n > 1024+64<<10 {
		return out, nil, ErrBounds
	}
	frame := make([]byte, n)
	if _, err := io.ReadFull(c, frame); err != nil {
		return out, nil, err
	}
	m := binary.BigEndian.Uint32(frame[:4])
	if m > n-4 {
		return out, nil, ErrBounds
	}
	if err := json.Unmarshal(frame[4:4+m], &out); err != nil {
		return out, nil, err
	}
	if bytes.Contains(frame[4:4+m], []byte("ConnectionID")) || bytes.Contains(frame[4:4+m], []byte("Nonce")) || bytes.Contains(frame[4:4+m], []byte("Source")) {
		return out, nil, ErrDenied
	}
	return out, bytes.Clone(frame[4+m:]), nil
}

func authorityBackend(t *testing.T, handler func(*net.UnixConn, *net.UnixConn, *http.Request)) *authorityTestBackend {
	t.Helper()
	path, l := localTestSocket(t)
	b := &authorityTestBackend{path: path, listener: l}
	acceptDone := make(chan struct{})
	go func() {
		defer close(acceptDone)
		for {
			conn, err := l.Accept()
			if err != nil {
				return
			}
			u, ok := conn.(*net.UnixConn)
			if !ok {
				_ = conn.Close()
				continue
			}
			b.mu.Lock()
			b.connections = append(b.connections, u)
			b.mu.Unlock()
			b.wg.Add(1)
			go func() {
				defer b.wg.Done()
				defer u.Close()
				_ = u.SetDeadline(time.Now().Add(4 * time.Second))
				control, e := authorityReceiveControl(u)
				if e != nil {
					return
				}
				b.mu.Lock()
				b.connections = append(b.connections, control)
				b.mu.Unlock()
				_ = control.SetDeadline(time.Now().Add(4 * time.Second))
				if e = localPeer(control, localTestUID(t), os.Getpid()); e != nil {
					t.Errorf("SCM control has wrong actual Go peer: %v", e)
					return
				}
				req, e := http.ReadRequest(bufio.NewReader(u))
				if e != nil {
					return
				}
				b.calls.Add(1)
				handler(u, control, req)
			}()
		}
	}()
	t.Cleanup(func() {
		_ = l.Close()
		<-acceptDone
		b.mu.Lock()
		for _, c := range b.connections {
			_ = c.Close()
		}
		b.mu.Unlock()
		b.wg.Wait()
	})
	return b
}

func authorityTLS(t *testing.T, f tlsFixture, b *authorityTestBackend, change func(*AuthorityIPCIngressConfig)) (*AuthorityIPCIngress, *runningHTTP) {
	return authorityTLSMiddleware(t, f, b, change, nil)
}

func authorityTLSMiddleware(t *testing.T, f tlsFixture, b *authorityTestBackend, change func(*AuthorityIPCIngressConfig), middleware func(http.Handler) http.Handler) (*AuthorityIPCIngress, *runningHTTP) {
	t.Helper()
	cfg := AuthorityIPCIngressConfig{Service: "auth-node", SocketPath: b.path, PeerUID: localTestUID(t), PeerPID: os.Getpid(), Routes: []AuthorityIngressRoute{authorityTestRoute()}}
	if change != nil {
		change(&cfg)
	}
	i, err := NewAuthorityIPCIngress(cfg)
	if err != nil {
		t.Fatal(err)
	}
	g, err := NewGate(f.policy(true))
	if err != nil {
		t.Fatal(err)
	}
	var handler http.Handler = i
	if middleware != nil {
		handler = middleware(handler)
	}
	s, err := NewHTTPServer(HTTPServerConfig{TLS: f.config(true), Gate: g, EdgeID: "pay-adapter", Handler: handler})
	if err != nil {
		t.Fatal(err)
	}
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- s.Serve(l) }()
	t.Cleanup(func() {
		_ = i.Close()
		_ = s.Close()
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if e := i.Join(ctx); e != nil {
			t.Errorf("ingress did not drain: %v", e)
		}
		<-done
	})
	return i, &runningHTTP{server: s, gate: g, address: l.Addr().String()}
}

func TestAuthorityIngressRealTLSBodyAndContextSubstitutionDenied(t *testing.T) {
	f := newTLSFixture(t)
	for _, mode := range []string{"copy-request", "new-request", "replace-body", "consume-prefix", "change-length", "change-mime", "missing-mime", "chunked"} {
		t.Run(mode, func(t *testing.T) {
			b := authorityBackend(t, func(data, control *net.UnixConn, r *http.Request) {
				t.Error("substituted original request reached backend")
			})
			_, r := authorityTLSMiddleware(t, f, b, nil, func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					switch mode {
					case "copy-request":
						r = r.Clone(r.Context())
					case "new-request":
						replacement, _ := http.NewRequestWithContext(r.Context(), r.Method, r.URL.String(), r.Body)
						replacement.RequestURI = r.RequestURI
						replacement.Host = r.Host
						replacement.Header = r.Header.Clone()
						replacement.ContentLength = r.ContentLength
						r = replacement
					case "replace-body":
						r.Body = io.NopCloser(strings.NewReader("forged!!"))
					case "consume-prefix":
						var prefix [1]byte
						_, _ = r.Body.Read(prefix[:])
					case "change-length":
						r.ContentLength--
					case "change-mime", "missing-mime":
						r.Header.Set("Content-Type", "application/json")
					}
					next.ServeHTTP(w, r)
				})
			})
			c := dialNative(t, f, r.address)
			req, e := http.NewRequest(http.MethodPost, "https://adapter.ynx.test/settle", strings.NewReader("original"))
			if e != nil {
				t.Fatal(e)
			}
			if mode != "missing-mime" {
				req.Header.Set("Content-Type", "application/json")
			}
			if mode == "change-mime" {
				req.Header.Set("Content-Type", "text/plain")
			}
			if mode == "chunked" {
				req.ContentLength = -1
			}
			if e = req.Write(c); e != nil {
				t.Fatal(e)
			}
			resp, e := http.ReadResponse(bufio.NewReader(c), req)
			if e == nil {
				_, _ = io.Copy(io.Discard, resp.Body)
				_ = resp.Body.Close()
				if resp.StatusCode < 400 {
					t.Fatal("substituted request accepted", resp.StatusCode)
				}
			}
			if b.calls.Load() != 0 {
				t.Fatal("substitution dispatched to Node")
			}
		})
	}
}

func authorityWriteRequest(c *native.Conn, body []byte) (*http.Response, error) {
	r, err := http.NewRequest(http.MethodPost, "https://adapter.ynx.test/settle", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	r.Header.Set("Content-Type", "application/json")
	if err = r.Write(c); err != nil {
		return nil, err
	}
	return http.ReadResponse(bufio.NewReader(c), r)
}

func authorityBackendResponse(c net.Conn, status int, body []byte) error {
	_, err := fmt.Fprintf(c, "HTTP/1.1 %d Original\r\nContent-Type: application/json\r\nContent-Length: %d\r\nConnection: close\r\n\r\n", status, len(body))
	if err != nil {
		return err
	}
	_, err = c.Write(body)
	return err
}

func TestAuthorityIngressActualPQSCMBodyExporterAndRequestReplay(t *testing.T) {
	f := newTLSFixture(t)
	controls := make(chan *net.UnixConn, 2)
	materials := make(chan AuthorityIngressMetadata, 2)
	bodySeen := make(chan []byte, 2)
	b := authorityBackend(t, func(data, control *net.UnixConn, r *http.Request) {
		body, e := io.ReadAll(r.Body)
		if e != nil {
			t.Error(e)
			return
		}
		if r.Host != "auth-node" || r.RequestURI != "/settle" || r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("unregistered Node carrier: %s %s", r.Host, r.RequestURI)
		}
		for n := 0; n < 2; n++ {
			m, original, e := authorityControlCurrent(control)
			if e != nil {
				t.Error(e)
				return
			}
			if !bytes.Equal(body, original) {
				t.Error("SCM body differs from exact HTTP opaque body")
			}
			if n == 0 {
				materials <- m
				bodySeen <- original
			}
		}
		controls <- control
		if e = authorityBackendResponse(data, 201, []byte(" { \"originalResponse\" : true }\n")); e != nil {
			t.Error(e)
		}
	})
	_, r := authorityTLS(t, f, b, nil)
	c := dialNative(t, f, r.address)
	exporter, e := c.ExportKeyingMaterial("EXPORTER-Channel-Binding", nil, 32)
	if e != nil {
		t.Fatal(e)
	}
	for _, body := range [][]byte{[]byte(" { \"original\" : [1, 2] }\n"), []byte("{\"second\":true}")} {
		resp, e := authorityWriteRequest(c, body)
		if e != nil {
			t.Fatal(e)
		}
		response, e := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if e != nil || resp.StatusCode != 201 || string(response) != " { \"originalResponse\" : true }\n" {
			t.Fatal("Node response changed", resp.StatusCode, string(response), e)
		}
		m := <-materials
		if m.Service != "auth-node" || m.Host != "adapter.ynx.test" || m.Method != http.MethodPost || m.Path != "/settle" || m.ContentLength != int64(len(body)) || m.ContentType != "application/json" || m.Channel.LocalSAN != "adapter.ynx.test" || m.Channel.Peer.SubjectAltName != "pay.ynx.test" || !bytes.Equal(m.Channel.Exporter, exporter) {
			t.Fatalf("actual TLS material mismatch: %+v", m)
		}
		if original := <-bodySeen; !bytes.Equal(original, body) {
			t.Fatal("original body rewritten")
		}
		old := <-controls
		if _, _, e = authorityControlCurrent(old); e == nil {
			t.Fatal("ended control capability replayed across requests")
		}
	}
	if b.calls.Load() != 2 {
		t.Fatal("request retried", b.calls.Load())
	}
}

func TestAuthorityIngressCurrentRevocationAndDisconnect(t *testing.T) {
	for _, mode := range []string{"revoke", "tls-disconnect", "node-disconnect"} {
		t.Run(mode, func(t *testing.T) {
			f := newTLSFixture(t)
			ready := make(chan *net.UnixConn, 1)
			release := make(chan struct{})
			denied := make(chan error, 1)
			b := authorityBackend(t, func(data, control *net.UnixConn, r *http.Request) {
				_, _ = io.Copy(io.Discard, r.Body)
				if _, _, e := authorityControlCurrent(control); e != nil {
					denied <- e
					return
				}
				ready <- control
				<-release
				if mode == "node-disconnect" {
					_ = data.Close()
				}
				_, _, e := authorityControlCurrent(control)
				denied <- e
			})
			ingress, r := authorityTLS(t, f, b, nil)
			c := dialNative(t, f, r.address)
			done := make(chan error, 1)
			go func() {
				resp, e := authorityWriteRequest(c, []byte("original"))
				if e == nil {
					_ = resp.Body.Close()
				}
				done <- e
			}()
			<-ready
			if mode == "revoke" {
				if _, e := r.gate.RevokeService("pay.ynx.test", 1); e != nil {
					t.Fatal(e)
				}
			} else if mode == "tls-disconnect" {
				// Closing the client is asynchronous across TCP and this separate
				// control socket. First observe the real server's EOF cancellation;
				// a remote Close call is not a synchronous server notification.
				ingress.mu.Lock()
				var originalContext context.Context
				for s := range ingress.active {
					originalContext = s.request.Context()
				}
				ingress.mu.Unlock()
				if originalContext == nil {
					t.Fatal("active original server request missing")
				}
				_ = c.Close()
				select {
				case <-originalContext.Done():
				case <-time.After(time.Second):
					t.Fatal("real server did not observe TCP EOF")
				}
			}
			close(release)
			if e := <-denied; e == nil {
				t.Fatal("revoked/disconnected request retained materials")
			}
			if e := <-done; e == nil {
				t.Fatal("aborted request manufactured a response")
			}
		})
	}
}

func TestAuthorityIngressRechecksTLSBeforeForwardingOriginalResponse(t *testing.T) {
	f := newTLSFixture(t)
	ready := make(chan struct{})
	release := make(chan struct{})
	b := authorityBackend(t, func(data, control *net.UnixConn, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		if _, _, e := authorityControlCurrent(control); e != nil {
			t.Error(e)
			return
		}
		close(ready)
		<-release
		_ = authorityBackendResponse(data, 200, []byte("{\"originalResponse\":true}"))
	})
	_, r := authorityTLS(t, f, b, nil)
	c := dialNative(t, f, r.address)
	type result struct {
		status int
		body   string
		err    error
	}
	done := make(chan result, 1)
	go func() {
		resp, e := authorityWriteRequest(c, []byte("original"))
		if e != nil {
			done <- result{err: e}
			return
		}
		body, e := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		done <- result{status: resp.StatusCode, body: string(body), err: e}
	}()
	<-ready
	if _, e := r.gate.RevokeService("pay.ynx.test", 1); e != nil {
		t.Fatal(e)
	}
	close(release)
	out := <-done
	if out.err == nil && (out.status < 400 || strings.Contains(out.body, "originalResponse")) {
		t.Fatal("old gate result forwarded original response after revoke", out)
	}
}

func TestAuthorityIngressQueryBoundUnknownByteAndRetire(t *testing.T) {
	for _, mode := range []string{"queries", "unknown", "retire"} {
		t.Run(mode, func(t *testing.T) {
			f := newTLSFixture(t)
			ready := make(chan struct{})
			release := make(chan struct{})
			result := make(chan error, 1)
			b := authorityBackend(t, func(data, control *net.UnixConn, r *http.Request) {
				_, _ = io.Copy(io.Discard, r.Body)
				if mode == "queries" {
					for n := 0; n < 64; n++ {
						if _, _, e := authorityControlCurrent(control); e != nil {
							result <- fmt.Errorf("query %d: %w", n, e)
							return
						}
					}
					_, _, e := authorityControlCurrent(control)
					if e == nil {
						result <- errors.New("65th query accepted")
					} else {
						result <- nil
					}
					return
				}
				if mode == "unknown" {
					_, _ = control.Write([]byte{'X'})
					var zero [4]byte
					_, e := io.ReadFull(control, zero[:])
					if e == nil && binary.BigEndian.Uint32(zero[:]) == 0 {
						result <- nil
					} else {
						result <- fmt.Errorf("invalid query not explicitly rejected: %v", e)
					}
					return
				}
				close(ready)
				<-release
				_, _, e := authorityControlCurrent(control)
				if e == nil {
					result <- errors.New("retired capability current")
				} else {
					result <- nil
				}
			})
			i, r := authorityTLS(t, f, b, nil)
			c := dialNative(t, f, r.address)
			done := make(chan error, 1)
			go func() {
				resp, e := authorityWriteRequest(c, []byte("original"))
				if e == nil {
					_ = resp.Body.Close()
				}
				done <- e
			}()
			if mode == "retire" {
				<-ready
				_ = i.Retire()
				close(release)
				ctx, cancel := context.WithTimeout(context.Background(), time.Second)
				defer cancel()
				if e := i.Join(ctx); e != nil {
					t.Fatal(e)
				}
			}
			if e := <-result; e != nil {
				t.Fatal(e)
			}
			if e := <-done; e == nil {
				t.Fatal("failed capability emitted success")
			}
		})
	}
}

func TestAuthorityIngressPeerRouteResponseBudgetsAndNoRetry(t *testing.T) {
	for _, mode := range []string{"wrong-pid", "request-budget", "response-budget", "mime", "headers", "timeout"} {
		t.Run(mode, func(t *testing.T) {
			f := newTLSFixture(t)
			b := authorityBackend(t, func(data, control *net.UnixConn, r *http.Request) {
				_, _ = io.Copy(io.Discard, r.Body)
				if mode == "timeout" {
					var buf [1]byte
					_, _ = control.Read(buf[:])
					return
				}
				if mode == "mime" {
					_, _ = io.WriteString(data, "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 1\r\n\r\nx")
					return
				}
				if mode == "headers" {
					_, _ = io.WriteString(data, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nX-Large: "+strings.Repeat("x", 8192)+"\r\nContent-Length: 1\r\n\r\nx")
					return
				}
				_ = authorityBackendResponse(data, 200, []byte(strings.Repeat("x", 128)))
			})
			_, r := authorityTLS(t, f, b, func(c *AuthorityIPCIngressConfig) {
				if mode == "wrong-pid" {
					c.PeerPID += 10000
				}
				if mode == "request-budget" {
					c.Routes[0].MaxRequestBytes = 4
				}
				if mode == "response-budget" {
					c.Routes[0].MaxResponseBytes = 4
				}
				if mode == "headers" {
					c.MaxHeaderBytes = 512
				}
				if mode == "timeout" {
					c.Routes[0].Timeout = 70 * time.Millisecond
				}
			})
			c := dialNative(t, f, r.address)
			resp, e := authorityWriteRequest(c, []byte("original"))
			if e == nil {
				body, _ := io.ReadAll(resp.Body)
				_ = resp.Body.Close()
				if resp.StatusCode < 400 {
					t.Fatal("invalid backend accepted", resp.StatusCode, string(body))
				}
			}
			if (mode == "wrong-pid" || mode == "request-budget") && b.calls.Load() != 0 {
				t.Fatal("rejected carrier dispatched")
			}
			if b.calls.Load() > 1 {
				t.Fatal("backend failure retried")
			}
		})
	}
}
