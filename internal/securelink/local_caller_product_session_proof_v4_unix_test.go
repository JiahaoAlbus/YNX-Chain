//go:build linux || (darwin && cgo)

package securelink

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

// All expectations, headers and business paths in these controls are PUBLIC
// transport fixtures. They supply no SDK proof, Root or Source approval.
func newPublicShopV4Server(t *testing.T, handler http.HandlerFunc) *publicShopProofServer {
	t.Helper()
	directory := publicOriginalPeerSocketDirectory(t, "lv4-")
	socket := filepath.Join(directory, "s")
	listener, err := ListenPrivate(socket, localTestUID(t))
	if err != nil {
		t.Fatal(err)
	}
	route := LocalCallerRoute{Method: http.MethodGet, Path: publicShopProofPath, MaxBodyBytes: 0, Timeout: 3 * time.Second}
	server, err := NewProductSessionProofV4LocalCallerServer(LocalCallerServerConfig{Service: "ynx-shop-source", PeerUID: localTestUID(t), PeerPID: os.Getpid(), Routes: []LocalCallerRoute{route}, Handler: handler})
	if err != nil {
		_ = listener.Close()
		t.Fatal(err)
	}
	client, err := NewLocalCallerClient(LocalCallerClientConfig{SocketPath: socket, Service: "ynx-shop-source", PeerUID: localTestUID(t), PeerPID: os.Getpid(), Routes: []LocalCallerRoute{route}, Timeout: 3 * time.Second})
	if err != nil {
		_ = server.Close()
		_ = listener.Close()
		t.Fatal(err)
	}
	p := &publicShopProofServer{client: client, server: server, done: make(chan error, 1)}
	go func() { p.done <- server.Serve(listener) }()
	t.Cleanup(func() { p.stop(t) })
	return p
}

func TestOriginalLocalCallerShopProofV4ServerProfile(t *testing.T) {
	base := LocalCallerServerConfig{Service: "ynx-shop-source", PeerUID: localTestUID(t), PeerPID: os.Getpid(), Routes: []LocalCallerRoute{{Method: http.MethodGet, Path: publicShopProofPath, MaxBodyBytes: 0, Timeout: time.Second}}, Handler: http.NotFoundHandler()}
	for _, max := range []int{0, MaxProductSessionProofV4RequestHeaderBytes} {
		cfg := base
		cfg.MaxHeaderBytes = max
		s, err := NewProductSessionProofV4LocalCallerServer(cfg)
		if err != nil || s == nil || !s.proofV4Required || s.cfg.MaxHeaderBytes != MaxProductSessionProofV4RequestHeaderBytes {
			t.Fatal("fixed V4 profile", max, err)
		}
		if err := s.Close(); err != nil {
			t.Fatal(err)
		}
	}
	for _, max := range []int{-1, 1, 64 << 10, MaxProductSessionProofV4RequestHeaderBytes - 1, MaxProductSessionProofV4RequestHeaderBytes + 1} {
		cfg := base
		cfg.MaxHeaderBytes = max
		if s, err := NewProductSessionProofV4LocalCallerServer(cfg); s != nil || !errors.Is(err, ErrBounds) {
			t.Fatal("adjustable V4 header bound", max, err)
		}
	}
	for _, route := range []LocalCallerRoute{{Method: http.MethodPost, Path: publicShopProofPath, MaxBodyBytes: 1, Timeout: time.Second}, {Method: http.MethodGet, Path: publicShopProofPath, MaxBodyBytes: 1, Timeout: time.Second}, {Method: http.MethodGet, Path: publicShopProofPath + "?q=x", MaxBodyBytes: 0, Timeout: time.Second}} {
		cfg := base
		cfg.Routes = []LocalCallerRoute{route}
		if s, err := NewProductSessionProofV4LocalCallerServer(cfg); s != nil || err == nil {
			t.Fatal("V4 admitted nonempty/canonical GET registration", err)
		}
	}
	legacy, err := NewLocalCallerServer(base)
	if err != nil || legacy.proofV4Required || legacy.cfg.MaxHeaderBytes != 16<<10 {
		t.Fatal("legacy default changed", err)
	}
	_ = legacy.Close()
	base.MaxHeaderBytes = MaxProductSessionProofV4RequestHeaderBytes
	if legacy, err = NewLocalCallerServer(base); legacy != nil || !errors.Is(err, ErrBounds) {
		t.Fatal("legacy 64KiB gate enlarged", err)
	}
}

func TestOriginalLocalCallerShopProofV4OwnedWire(t *testing.T) {
	expected := publicOriginalLocalCallerExpected(t)
	for _, size := range []int{2, MaxProductSessionProofV4HeaderBytes} {
		t.Run(fmt.Sprint(size), func(t *testing.T) {
			value := strings.Repeat("A", size)
			var calls atomic.Int32
			p := newPublicShopV4Server(t, func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				caller, err := LocalCallerFromRequest(r)
				if err != nil {
					t.Error(err)
					return
				}
				material, err := caller.Current(r.Context())
				if err != nil || caller.CurrentOriginalCaller(r) != nil || material.Method != http.MethodGet || material.Path != publicShopProofPath || len(material.RequestBody) != 0 || material.ContentLength != 0 || material.ContentType != "" || r.Body != http.NoBody || r.Header.Get(ProductSessionProofV4Header) != value || len(r.Header.Values(ProductSessionProofV4Header)) != 1 || r.Header.Get(ProductSessionProofV2Header) != "" {
					t.Error("SAME original empty V4 GET changed", err)
					return
				}
				if _, err := LocalCallerFromRequest(r.Clone(r.Context())); !errors.Is(err, ErrDenied) {
					t.Error("clone minted original V4 caller", err)
					return
				}
				if c, err := LocalCallerFromContext(r.Context()); err != nil || c != caller {
					t.Error("original context caller lost", err)
					return
				}
				_, _ = w.Write([]byte{0, 'P', 'U', 'B', 'L', 'I', 'C', '\n'})
			})
			x, out, err := p.client.CallOriginalShopGETV4Owned(context.Background(), publicShopProofPath, ProductSessionProofV4DATA{HeaderValue: value}, expected)
			if x != nil {
				t.Cleanup(func() { publicOwnedExchangeClose(t, x) })
			}
			if err != nil || x == nil || !out.PacketPresent || !out.BodyComplete || out.StatusCode != 200 || !bytes.Equal(out.Body, []byte{0, 'P', 'U', 'B', 'L', 'I', 'C', '\n'}) || calls.Load() != 1 {
				t.Fatalf("owned V4 response/error lost: %v %+v calls=%d", err, out, calls.Load())
			}
			p.stop(t)
			if err = x.Current(context.Background()); err != nil {
				t.Fatal("terminal original DATA current", err)
			}
			life := x.Lifetime()
			if !life.Peer.SameOriginalConnection || !life.Peer.ProcessIdentityAvailable || !life.Peer.TerminalEOFObserved || life.Peer.LivenessProved || life.Closed {
				t.Fatalf("FIN claimed fresh live or dropped debt: %+v", life)
			}
			publicOwnedExchangeClose(t, x)
			publicOwnedExchangeEvidence(t, expected, x, out)
		})
	}
}

func TestOriginalLocalCallerShopProofV4Preflight(t *testing.T) {
	expected := publicOriginalLocalCallerExpected(t)
	for _, mode := range []string{"empty", "short", "CRLF", "comma", "oversize", "total-header", "unregistered", "body-route", "wrong-peer", "wrong-start", "wrong-image", "mixed-private", "body-private", "content-type-private"} {
		t.Run(mode, func(t *testing.T) {
			path, listener := localTestSocket(t)
			requestPath, value, want := publicShopProofPath, "Aa", expected
			maxBody := int64(0)
			switch mode {
			case "empty":
				value = ""
			case "short":
				value = "A"
			case "CRLF":
				value = "AA\r\nInjected: x"
			case "comma":
				value = "AA,BB"
			case "oversize":
				value = strings.Repeat("A", MaxProductSessionProofV4HeaderBytes+1)
			case "total-header":
				requestPath = "/" + strings.Repeat("a", MaxProductSessionProofV4RequestHeaderBytes)
			case "body-route":
				maxBody = 1
			case "wrong-peer":
				want.UID++
			case "wrong-start":
				want.StartA++
			case "wrong-image":
				want.ImageSHA256[0] ^= 1
			}
			client, err := NewLocalCallerClient(LocalCallerClientConfig{SocketPath: path, Service: "ynx-shop-source", PeerUID: localTestUID(t), PeerPID: os.Getpid(), Routes: []LocalCallerRoute{{Method: http.MethodGet, Path: requestPath, MaxBodyBytes: maxBody, Timeout: time.Second}}})
			if err != nil {
				t.Fatal(err)
			}
			if mode == "unregistered" {
				requestPath += "-other"
			}
			var x *OriginalLocalCallerExchange
			var out LocalCallerResponse
			proof := ProductSessionProofV4DATA{HeaderValue: value}
			switch mode {
			case "mixed-private":
				x, out, err = client.callOriginalOwned(context.Background(), http.MethodGet, requestPath, "", nil, want, &ProductSessionProofV2DATA{HeaderValue: "Aa"}, &proof)
			case "body-private":
				x, out, err = client.callOriginalOwned(context.Background(), http.MethodGet, requestPath, "", []byte{'x'}, want, nil, &proof)
			case "content-type-private":
				x, out, err = client.callOriginalOwned(context.Background(), http.MethodGet, requestPath, "application/json", nil, want, nil, &proof)
			default:
				x, out, err = client.CallOriginalShopGETV4Owned(context.Background(), requestPath, proof, want)
			}
			if x != nil {
				t.Cleanup(func() { publicOwnedExchangeClose(t, x) })
			}
			if err == nil || x == nil || out.PacketPresent || x.Lifetime().DispatchPossible || x.state.socketFD >= 0 {
				t.Fatalf("invalid V4 preflight selected HTTP: %v %+v", err, out)
			}
			private := listener.(*privateListener).Listener.(*net.UnixListener)
			if err := private.SetDeadline(time.Now()); err != nil {
				t.Fatal(err)
			}
			if c, err := private.AcceptUnix(); err == nil {
				_ = c.Close()
				t.Fatal("invalid V4 preflight dialed")
			} else if e, ok := err.(net.Error); !ok || !e.Timeout() {
				t.Fatal("no real no-connection observation", err)
			}
			publicOwnedExchangeClose(t, x)
		})
	}
}

func publicV4RawRequest(t *testing.T, p *publicShopProofServer, raw string) (LocalCallerResponse, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	c, err := DialPrivate(ctx, p.client.cfg.SocketPath, p.client.cfg.PeerUID)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := c.Close(); err != nil {
			t.Error("actual raw peer close", err)
		}
	}()
	if err = c.SetDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, err = io.WriteString(c, raw); err != nil {
		return LocalCallerResponse{}, err
	}
	req, _ := http.NewRequest(http.MethodGet, "http://ynx-shop-source"+publicShopProofPath, nil)
	out, _, err := readBoundedLocalCallerResponse(c, req, 16<<10, 1<<20)
	return out, err
}

func TestOriginalLocalCallerShopProofV4IncomingRejection(t *testing.T) {
	for _, mode := range []string{"missing", "V2-only", "mixed", "mixed-empty", "duplicate", "case-duplicate", "comma", "empty", "oversize", "content-type", "content-type-empty", "body", "chunked", "trailer"} {
		t.Run(mode, func(t *testing.T) {
			var calls atomic.Int32
			p := newPublicShopV4Server(t, func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(http.StatusOK) })
			value := "Aa"
			if mode == "oversize" {
				value = strings.Repeat("A", MaxProductSessionProofV4HeaderBytes+1)
			}
			if mode == "empty" {
				value = ""
			}
			if mode == "comma" {
				value = "AA,BB"
			}
			header := ProductSessionProofV4Header + ": " + value + "\r\n"
			body := ""
			framing := "Content-Length: 0\r\n"
			switch mode {
			case "missing":
				header = ""
			case "V2-only":
				header = ProductSessionProofV2Header + ": Aa\r\n"
			case "mixed":
				header += ProductSessionProofV2Header + ": Aa\r\n"
			case "mixed-empty":
				header += ProductSessionProofV2Header + ":\r\n"
			case "duplicate":
				header += ProductSessionProofV4Header + ": Aa\r\n"
			case "case-duplicate":
				header += strings.ToLower(ProductSessionProofV4Header) + ": Aa\r\n"
			case "content-type":
				header += "Content-Type: application/json\r\n"
			case "content-type-empty":
				header += "Content-Type:\r\n"
			case "body":
				framing = "Content-Length: 1\r\n"
				body = "x"
			case "chunked":
				framing = "Transfer-Encoding: chunked\r\n"
				body = "0\r\n\r\n"
			case "trailer":
				framing = "Transfer-Encoding: chunked\r\nTrailer: X-YNX-Product-Session-Proof-V4\r\n"
				body = "0\r\nX-YNX-Product-Session-Proof-V4: Aa\r\n\r\n"
			}
			raw := fmt.Sprintf("GET %s HTTP/1.1\r\nHost: ynx-shop-source\r\n%s%sConnection: close\r\n\r\n%s", publicShopProofPath, header, framing, body)
			out, err := publicV4RawRequest(t, p, raw)
			if err != nil || !out.BodyComplete || out.StatusCode < 400 || calls.Load() != 0 {
				t.Fatalf("invalid V4 carrier reached original handler: %v %+v calls=%d", err, out, calls.Load())
			}
		})
	}
	for _, mode := range []string{"bare-LF", "mixed-LF", "LF-background-terminator"} {
		t.Run(mode, func(t *testing.T) {
			var calls atomic.Int32
			p := newPublicShopV4Server(t, func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(http.StatusOK) })
			raw := fmt.Sprintf("GET %s HTTP/1.1\r\nHost: ynx-shop-source\r\n%s: Aa\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", publicShopProofPath, ProductSessionProofV4Header)
			switch mode {
			case "bare-LF":
				raw = strings.ReplaceAll(raw, "\r\n", "\n")
			case "mixed-LF":
				raw = strings.Replace(raw, "Host: ynx-shop-source\r\n", "Host: ynx-shop-source\n", 1)
			case "LF-background-terminator":
				raw = strings.ReplaceAll(raw, "\r\n", "\n") + "\r\n\r\n"
			}
			out, err := publicV4RawRequest(t, p, raw)
			p.stop(t)
			if calls.Load() != 0 || err == nil && (!out.BodyComplete || out.StatusCode < 400) {
				t.Fatalf("non-CRLF request dispatched: %v %+v calls=%d", err, out, calls.Load())
			}
			if err != nil && !errors.Is(err, io.EOF) && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, syscall.ECONNRESET) && !errors.Is(err, syscall.EPIPE) {
				t.Fatal("framing refusal did not physically finish", err)
			}
		})
	}
}

func TestOriginalLocalCallerShopProofV4RequestSnapshot(t *testing.T) {
	expected := publicOriginalLocalCallerExpected(t)
	for _, mode := range []string{"change", "delete", "multiple", "case-duplicate", "case-rename", "add-V2", "add-other", "delete-other", "change-other", "body", "content-type", "transfer-encoding", "trailer"} {
		t.Run(mode, func(t *testing.T) {
			var checked atomic.Bool
			p := newPublicShopV4Server(t, func(w http.ResponseWriter, r *http.Request) {
				caller, err := LocalCallerFromRequest(r)
				if err != nil {
					t.Error(err)
					return
				}
				if _, err = caller.Current(r.Context()); err != nil || caller.CurrentOriginalCaller(r) != nil {
					t.Error("original pre-mutation current", err)
					return
				}
				switch mode {
				case "change":
					r.Header.Set(ProductSessionProofV4Header, "Bb")
				case "delete":
					r.Header.Del(ProductSessionProofV4Header)
				case "multiple":
					r.Header[http.CanonicalHeaderKey(ProductSessionProofV4Header)] = []string{"Aa", "Aa"}
				case "case-duplicate":
					r.Header[strings.ToLower(ProductSessionProofV4Header)] = []string{"Aa"}
				case "case-rename":
					v := r.Header.Values(ProductSessionProofV4Header)
					r.Header.Del(ProductSessionProofV4Header)
					r.Header[strings.ToLower(ProductSessionProofV4Header)] = v
				case "add-V2":
					r.Header.Set(ProductSessionProofV2Header, "Aa")
				case "add-other":
					r.Header["X-Public-Added"] = nil
				case "delete-other":
					r.Header.Del("Connection")
				case "change-other":
					r.Header.Set("User-Agent", "changed PUBLIC DATA")
				case "body":
					r.Body = io.NopCloser(strings.NewReader("x"))
				case "content-type":
					r.Header["content-type"] = nil
				case "transfer-encoding":
					r.TransferEncoding = []string{"chunked"}
				case "trailer":
					r.Trailer = http.Header{"X-Public-Trailer": nil}
				}
				_, fullErr := caller.Current(r.Context())
				localErr := caller.CurrentOriginalCaller(r)
				if !errors.Is(fullErr, ErrDenied) || !errors.Is(localErr, ErrDenied) {
					t.Errorf("changed SAME V4 request current: %v %v", fullErr, localErr)
					return
				}
				checked.Store(true)
				w.WriteHeader(http.StatusForbidden)
			})
			x, out, err := p.client.CallOriginalShopGETV4Owned(context.Background(), publicShopProofPath, ProductSessionProofV4DATA{HeaderValue: "Aa"}, expected)
			if x != nil {
				t.Cleanup(func() { publicOwnedExchangeClose(t, x) })
			}
			if err != nil || !out.BodyComplete || out.StatusCode != http.StatusForbidden || !checked.Load() {
				t.Fatalf("actual V4 snapshot control missed: %v %+v", err, out)
			}
		})
	}
}

func TestOriginalLocalCallerShopProofV4RawHeaderBudget(t *testing.T) {
	for _, extra := range []int{0, 1} {
		t.Run(fmt.Sprint(extra), func(t *testing.T) {
			var calls atomic.Int32
			p := newPublicShopV4Server(t, func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				caller, err := LocalCallerFromRequest(r)
				if err != nil {
					t.Error(err)
					return
				}
				if caller.state.conn.proofV4Header.bytes != MaxProductSessionProofV4RequestHeaderBytes {
					t.Error("actual accepted raw-header count differs")
				}
				w.WriteHeader(http.StatusNoContent)
			})
			prefix := fmt.Sprintf("GET %s HTTP/1.1\r\nHost: ynx-shop-source\r\n%s: %s\r\nX-Public-Padding: ", publicShopProofPath, ProductSessionProofV4Header, strings.Repeat("A", MaxProductSessionProofV4HeaderBytes))
			suffix := "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
			// This PUBLIC padding is not proof DATA. It makes the complete
			// request-line+headers exactly the declared limit, or exactly +1.
			raw := prefix + strings.Repeat("p", MaxProductSessionProofV4RequestHeaderBytes-len(prefix)-len(suffix)+extra) + suffix
			if len(raw) != MaxProductSessionProofV4RequestHeaderBytes+extra {
				t.Fatal("fixture raw count")
			}
			out, err := publicV4RawRequest(t, p, raw)
			p.stop(t)
			if extra == 0 {
				if err != nil || !out.BodyComplete || out.StatusCode != http.StatusNoContent || calls.Load() != 1 {
					t.Fatalf("exact raw header bound rejected: %v %+v calls=%d", err, out, calls.Load())
				}
			} else if calls.Load() != 0 || err == nil && out.StatusCode < 400 {
				t.Fatalf("parser slack enlarged fixed raw header budget: %v %+v calls=%d", err, out, calls.Load())
			}
		})
	}
	t.Run("keepalive-pipelined-second-request", func(t *testing.T) {
		var calls atomic.Int32
		p := newPublicShopV4Server(t, func(w http.ResponseWriter, r *http.Request) {
			calls.Add(1)
			if _, err := LocalCallerFromRequest(r); err != nil {
				t.Error("original pipelined first request", err)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		})
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		conn, err := DialPrivate(ctx, p.client.cfg.SocketPath, p.client.cfg.PeerUID)
		if err != nil {
			t.Fatal(err)
		}
		defer func() {
			if err := conn.Close(); err != nil {
				t.Error("actual pipeline peer close", err)
			}
		}()
		if err = conn.SetDeadline(time.Now().Add(3 * time.Second)); err != nil {
			t.Fatal(err)
		}
		first := fmt.Sprintf("GET %s HTTP/1.1\r\nHost: ynx-shop-source\r\n%s: Aa\r\nContent-Length: 0\r\nConnection: keep-alive\r\n\r\n", publicShopProofPath, ProductSessionProofV4Header)
		second := strings.Replace(first, ": Aa\r\n", ": Bb\r\n", 1)
		// Both complete valid requests are pipelined in one actual write. A
		// broken keepalive policy would dispatch the second through the already
		// complete first-header counter. No second connection or retry is used.
		if _, err = io.WriteString(conn, first+second); err != nil {
			t.Fatal(err)
		}
		reader := bufio.NewReader(conn)
		req, _ := http.NewRequest(http.MethodGet, "http://ynx-shop-source"+publicShopProofPath, nil)
		response, err := http.ReadResponse(reader, req)
		if err != nil {
			t.Fatal("first pipeline response", err)
		}
		_, bodyErr := io.Copy(io.Discard, response.Body)
		closeErr := response.Body.Close()
		if bodyErr != nil || closeErr != nil || response.StatusCode != http.StatusNoContent || !response.Close {
			t.Fatalf("fixed V4 connection did not finish after its first response: %v %v %+v", bodyErr, closeErr, response)
		}
		if secondResponse, secondErr := http.ReadResponse(reader, req); secondErr == nil {
			_ = secondResponse.Body.Close()
			t.Fatal("pipelined second request produced a response")
		} else if !errors.Is(secondErr, io.EOF) && !errors.Is(secondErr, syscall.ECONNRESET) {
			t.Fatal("second request was not rejected by actual connection closure", secondErr)
		}
		p.stop(t)
		if calls.Load() != 1 {
			t.Fatal("first-header budget reused by another dispatch", calls.Load())
		}
	})
}

func TestOriginalLocalCallerShopProofV4PartialResponse(t *testing.T) {
	expected := publicOriginalLocalCallerExpected(t)
	var calls atomic.Int32
	p := newPublicShopV4Server(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Length", "10")
		_, _ = io.WriteString(w, "abc")
	})
	x, out, err := p.client.CallOriginalShopGETV4Owned(context.Background(), publicShopProofPath, ProductSessionProofV4DATA{HeaderValue: "Aa"}, expected)
	if x != nil {
		t.Cleanup(func() { publicOwnedExchangeClose(t, x) })
	}
	var dispatch *DispatchError
	if x == nil || !errors.As(err, &dispatch) || !dispatch.DispatchPossible || !out.PacketPresent || out.BodyComplete || string(out.Body) != "abc" || dispatch.PartialResponseBytes != 3 || calls.Load() != 1 {
		t.Fatalf("original V4 partial/UNKNOWN lost: %v %+v", err, out)
	}
	first := x.FirstCause()
	publicOwnedExchangeClose(t, x)
	if !errors.Is(x.FirstCause(), first) || x.AssertOriginalClosed() != nil || !x.Lifetime().Closed || calls.Load() != 1 {
		t.Fatal("physical close erased first/reissued HTTP", x.Lifetime())
	}
	publicOwnedExchangeEvidence(t, expected, x, out)
}
