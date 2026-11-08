//go:build linux || (darwin && cgo)

package securelink

import (
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
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const publicShopProofPath = "/v5/shop/source/shop.order/invoice-intents/PUBLIC-order"

type publicShopProofServer struct {
	client *LocalCallerClient
	server *LocalCallerServer
	done   chan error
	once   sync.Once
}

func newPublicShopProofServer(t *testing.T, handler http.HandlerFunc) *publicShopProofServer {
	t.Helper()
	directory := publicOriginalPeerSocketDirectory(t, "lh-")
	socket := filepath.Join(directory, "s")
	listener, err := ListenPrivate(socket, localTestUID(t))
	if err != nil {
		t.Fatal(err)
	}
	route := LocalCallerRoute{Method: http.MethodGet, Path: publicShopProofPath, MaxBodyBytes: 0, Timeout: 3 * time.Second}
	server, err := NewLocalCallerServer(LocalCallerServerConfig{Service: "ynx-shop-source", PeerUID: localTestUID(t), PeerPID: os.Getpid(), Routes: []LocalCallerRoute{route}, Handler: handler, MaxHeaderBytes: 64 << 10})
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

func (p *publicShopProofServer) stop(t *testing.T) {
	t.Helper()
	p.once.Do(func() {
		if err := p.server.Close(); err != nil && !errors.Is(err, ErrLocalCallerDraining) {
			t.Error(err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if err := p.server.Join(ctx); err != nil {
			t.Error("actual server drain", err)
		}
		select {
		case err := <-p.done:
			if err != nil && !errors.Is(err, http.ErrServerClosed) {
				t.Error(err)
			}
		case <-ctx.Done():
			t.Error("actual server Serve still in flight")
		}
	})
}

func TestOriginalLocalCallerShopProofV2OwnedWire(t *testing.T) {
	expected := publicOriginalLocalCallerExpected(t)
	for _, size := range []int{2, MaxProductSessionProofV2HeaderBytes, 0} {
		t.Run(fmt.Sprint(size), func(t *testing.T) {
			// PUBLIC carrier DATA deliberately has no valid proof semantics.
			value := strings.Repeat("A", size)
			var calls atomic.Int32
			p := newPublicShopProofServer(t, func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				caller, err := LocalCallerFromRequest(r)
				if err != nil {
					t.Error(err)
					return
				}
				material, err := caller.Current(r.Context())
				if err != nil || caller.CurrentOriginalCaller(r) != nil || material.Method != http.MethodGet || material.Path != publicShopProofPath || len(material.RequestBody) != 0 || material.ContentType != "" || r.Header.Get("Content-Type") != "" || r.URL.RawQuery != "" {
					t.Errorf("not SAME original fixed empty GET: %v", err)
					return
				}
				values := r.Header.Values(ProductSessionProofV2Header)
				if size == 0 {
					if len(values) != 0 {
						t.Error("legacy API acquired proof header")
						return
					}
				} else if len(values) != 1 || values[0] != value {
					t.Error("original proof header bytes changed or duplicated")
					return
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, "{\"PUBLIC\":true}\n")
			})
			var x *OriginalLocalCallerExchange
			var out LocalCallerResponse
			var err error
			if size == 0 {
				x, out, err = p.client.CallOriginalOwned(context.Background(), http.MethodGet, publicShopProofPath, "", nil, expected)
			} else {
				x, out, err = p.client.CallOriginalShopGETOwned(context.Background(), publicShopProofPath, ProductSessionProofV2DATA{HeaderValue: value}, expected)
			}
			if x != nil {
				t.Cleanup(func() { publicOwnedExchangeClose(t, x) })
			}
			if err != nil || x == nil || !out.PacketPresent || !out.BodyComplete || out.StatusCode != 200 || !bytes.Equal(out.Body, []byte("{\"PUBLIC\":true}\n")) {
				t.Fatalf("original packet/owned partial lost: %v %+v", err, out)
			}
			p.stop(t) // Real FIN and actual receiver drain, with no sleep extension.
			if err = x.Current(context.Background()); err != nil {
				t.Fatal("terminal original DATA Current", err)
			}
			life := x.Lifetime()
			if !life.Peer.SameOriginalConnection || !life.Peer.ProcessIdentityAvailable || !life.Peer.TerminalEOFObserved || life.Peer.LivenessProved || life.Closed || calls.Load() != 1 {
				t.Fatalf("attempt/FIN/debt changed: %+v calls=%d", life, calls.Load())
			}
			publicOwnedExchangeClose(t, x)
			publicOwnedExchangeEvidence(t, expected, x, out)
		})
	}
}

func TestOriginalLocalCallerShopProofV2Preflight(t *testing.T) {
	expected := publicOriginalLocalCallerExpected(t)
	for _, mode := range []string{"empty", "short", "CRLF", "comma", "oversize", "total-header"} {
		t.Run(mode, func(t *testing.T) {
			path, listener := localTestSocket(t)
			requestPath, value := publicShopProofPath, "Aa"
			switch mode {
			case "empty":
				value = ""
			case "short":
				value = "A"
			case "CRLF":
				value = "AA\r\nX-Other: injected"
			case "comma":
				value = "AA,BB"
			case "oversize":
				value = strings.Repeat("A", MaxProductSessionProofV2HeaderBytes+1)
			case "total-header":
				requestPath = "/" + strings.Repeat("a", MaxProductSessionProofV2RequestHeaderBytes)
			}
			client, err := NewLocalCallerClient(LocalCallerClientConfig{SocketPath: path, Service: "ynx-shop-source", PeerUID: localTestUID(t), PeerPID: os.Getpid(), Routes: []LocalCallerRoute{{Method: http.MethodGet, Path: requestPath, MaxBodyBytes: 0, Timeout: time.Second}}})
			if err != nil {
				t.Fatal(err)
			}
			x, out, err := client.CallOriginalShopGETOwned(context.Background(), requestPath, ProductSessionProofV2DATA{HeaderValue: value}, expected)
			if x != nil {
				t.Cleanup(func() { publicOwnedExchangeClose(t, x) })
			}
			if err == nil || x == nil || out.PacketPresent || x.Lifetime().DispatchPossible || x.state.peer != nil || x.state.socketFD >= 0 {
				t.Fatalf("carrier preflight selected process/socket/HTTP: %v", err)
			}
			private := listener.(*privateListener).Listener.(*net.UnixListener)
			if err = private.SetDeadline(time.Now()); err != nil {
				t.Fatal(err)
			}
			if conn, acceptErr := private.AcceptUnix(); acceptErr == nil {
				_ = conn.Close()
				t.Fatal("bad carrier caused an actual connection")
			} else if e, ok := acceptErr.(net.Error); !ok || !e.Timeout() {
				t.Fatal("not a real no-connection observation", acceptErr)
			}
			publicOwnedExchangeClose(t, x)
		})
	}
}

func TestOriginalLocalCallerShopProofV2RequestCurrent(t *testing.T) {
	expected := publicOriginalLocalCallerExpected(t)
	for _, mode := range []string{"change", "delete", "multiple", "case-duplicate", "absent-add", "absent-empty-values"} {
		t.Run(mode, func(t *testing.T) {
			var checked atomic.Bool
			p := newPublicShopProofServer(t, func(w http.ResponseWriter, r *http.Request) {
				caller, err := LocalCallerFromRequest(r)
				if err != nil {
					t.Error(err)
					return
				}
				if _, err = caller.Current(r.Context()); err != nil || caller.CurrentOriginalCaller(r) != nil {
					t.Error("original current before mutation", err)
					return
				}
				switch mode {
				case "change":
					r.Header.Set(ProductSessionProofV2Header, "Bb")
				case "delete":
					r.Header.Del(ProductSessionProofV2Header)
				case "multiple":
					r.Header[http.CanonicalHeaderKey(ProductSessionProofV2Header)] = []string{"Aa", "Aa"}
				case "case-duplicate":
					r.Header[strings.ToLower(ProductSessionProofV2Header)] = []string{"Aa"}
				case "absent-add":
					r.Header.Set(ProductSessionProofV2Header, "Aa")
				case "absent-empty-values":
					r.Header[ProductSessionProofV2Header] = nil
				}
				_, fullErr := caller.Current(r.Context())
				localErr := caller.CurrentOriginalCaller(r)
				if !errors.Is(fullErr, ErrDenied) || !errors.Is(localErr, ErrDenied) {
					t.Errorf("changed SAME request proof escaped current: %v %v", fullErr, localErr)
					return
				}
				checked.Store(true)
				w.WriteHeader(http.StatusForbidden)
			})
			var x *OriginalLocalCallerExchange
			var out LocalCallerResponse
			var err error
			if strings.HasPrefix(mode, "absent-") {
				x, out, err = p.client.CallOriginalOwned(context.Background(), http.MethodGet, publicShopProofPath, "", nil, expected)
			} else {
				x, out, err = p.client.CallOriginalShopGETOwned(context.Background(), publicShopProofPath, ProductSessionProofV2DATA{HeaderValue: "Aa"}, expected)
			}
			if x != nil {
				t.Cleanup(func() { publicOwnedExchangeClose(t, x) })
			}
			if err != nil || !out.BodyComplete || out.StatusCode != http.StatusForbidden || !checked.Load() {
				t.Fatalf("actual current mutation control missed: %v %+v", err, out)
			}
		})
	}
}

func TestOriginalLocalCallerShopProofV2IncomingRejection(t *testing.T) {
	for _, mode := range []string{"duplicate", "case-duplicate", "comma", "empty", "oversize"} {
		t.Run(mode, func(t *testing.T) {
			var calls atomic.Int32
			p := newPublicShopProofServer(t, func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(http.StatusOK) })
			value := "Aa"
			if mode == "comma" {
				value = "AA,BB"
			}
			if mode == "empty" {
				value = ""
			}
			if mode == "oversize" {
				value = strings.Repeat("A", MaxProductSessionProofV2HeaderBytes+1)
			}
			header := ProductSessionProofV2Header + ": " + value + "\r\n"
			if mode == "duplicate" {
				header += ProductSessionProofV2Header + ": Aa\r\n"
			}
			if mode == "case-duplicate" {
				header += strings.ToLower(ProductSessionProofV2Header) + ": Aa\r\n"
			}
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			conn, err := DialPrivate(ctx, p.client.cfg.SocketPath, p.client.cfg.PeerUID)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = conn.Close() })
			if err = conn.SetDeadline(time.Now().Add(3 * time.Second)); err != nil {
				t.Fatal(err)
			}
			if _, err = fmt.Fprintf(conn, "GET %s HTTP/1.1\r\nHost: ynx-shop-source\r\n%sContent-Length: 0\r\nConnection: close\r\n\r\n", publicShopProofPath, header); err != nil {
				t.Fatal(err)
			}
			req, _ := http.NewRequest(http.MethodGet, "http://ynx-shop-source"+publicShopProofPath, nil)
			out, _, err := readBoundedLocalCallerResponse(conn, req, 16<<10, 1<<20)
			if err != nil || !out.BodyComplete || out.StatusCode != http.StatusBadRequest || calls.Load() != 0 {
				t.Fatalf("ambiguous/malformed field reached original handler: %v %+v calls=%d", err, out, calls.Load())
			}
		})
	}
}
