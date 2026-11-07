//go:build securelink_openssl && cgo

package securelink

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func fixedMediaClientFixture(t *testing.T, f tlsFixture, address string, p FixedPeerProfile) *FixedPeerClient {
	t.Helper()
	p.EdgeID = "pay-adapter"
	p.Address = address
	p.Roots[0].Fingerprint = f.root
	c, err := NewFixedPeerClient(FixedPeerClientConfig{Profile: p, TLS: f.config(false), Timeout: 5 * time.Second, MaxConnections: 2})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.Close() })
	return c
}

func TestFixedPeerMediaShopE5OpaqueBytesAndActualChannel(t *testing.T) {
	f := newTLSFixture(t)
	// Opaque binary fixture exercises NUL/non-UTF8 and more than the old 32 KiB
	// request limit. This is not an SDK E5 encoder or a genuine proof fixture.
	wire := bytes.Repeat([]byte{0, 0, 0, 5, 0xff, 0, 0x80, 1}, 8192)
	responseWire := []byte(`{"dataOnly":true,"operationVerified":false,"sourceVerified":false}`)
	var calls atomic.Int32
	serverChannels := make(chan AuthenticatedChannel, 1)
	address, _ := fixedServerFixture(t, f, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		actual, err := ServiceChannelFromRequest(r)
		if err != nil {
			t.Error(err)
			http.Error(w, "channel unavailable", 503)
			return
		}
		serverChannels <- actual
		body, err := io.ReadAll(r.Body)
		if err != nil || !bytes.Equal(body, wire) || r.Header.Get("Content-Type") != shopOrderReadRequestMedia || r.Header.Get("Accept") != "application/json" {
			t.Error("registered E5 carrier/body changed", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(responseWire)
	}))
	p := shopOrderReadMediaProfileFixture()
	client := fixedMediaClientFixture(t, f, address, p)
	p.Operations[0].MediaProfile = MediaProfileJSONCBOR
	copyProfile := client.Profile()
	copyProfile.Operations[0].MediaProfile = MediaProfileJSONCBOR
	copyProfile.Operations[0].MaxRequestBytes = 16 << 20
	var exporter []byte
	result, err := client.Exchange(context.Background(), "shop.order.read", func(ctx context.Context, actual AuthenticatedChannel) (WireRequest, error) {
		if actual.Peer.SubjectAltName != "adapter.ynx.test" || len(actual.Exporter) != 32 {
			return WireRequest{}, ErrDenied
		}
		exporter = bytes.Clone(actual.Exporter)
		return WireRequest{Body: wire, ContentType: shopOrderReadRequestMedia}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	serverChannel := <-serverChannels
	if calls.Load() != 1 || result.StatusCode != 200 || result.ContentType != "application/json" || !bytes.Equal(result.Body, responseWire) || !bytes.Equal(result.Channel.Exporter, exporter) || !bytes.Equal(serverChannel.Exporter, exporter) {
		t.Fatal("registered E5 bytes/response or same actual TLS channel changed")
	}
}

func TestFixedPeerMediaUnregisteredOrMislabeledRequestNeverDispatches(t *testing.T) {
	f := newTLSFixture(t)
	var calls atomic.Int32
	address, _ := fixedServerFixture(t, f, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{}`)
	}))
	for _, test := range []struct {
		name    string
		profile FixedPeerProfile
		media   string
	}{
		{"unregistered-vendor", fixedProfileFixture(), shopOrderReadRequestMedia},
		{"e5-labeled-json", shopOrderReadMediaProfileFixture(), "application/json"},
		{"e5-labeled-cbor", shopOrderReadMediaProfileFixture(), "application/cbor"},
		{"parameter", shopOrderReadMediaProfileFixture(), shopOrderReadRequestMedia + "; charset=utf-8"},
		{"case", shopOrderReadMediaProfileFixture(), "Application/vnd.ynx.shop-order-read.v1"},
	} {
		t.Run(test.name, func(t *testing.T) {
			client := fixedMediaClientFixture(t, f, address, test.profile)
			_, err := client.Exchange(context.Background(), "shop.order.read", func(context.Context, AuthenticatedChannel) (WireRequest, error) {
				return WireRequest{Body: []byte{0, 0, 0, 5, 0xff}, ContentType: test.media}, nil
			})
			if !errors.Is(err, ErrDenied) || calls.Load() != 0 {
				t.Fatal("unregistered/mislabeled E5 request reached producer", err, calls.Load())
			}
		})
	}
}

func TestFixedPeerMediaPreparationCurrentGateStillPreventsDispatch(t *testing.T) {
	f := newTLSFixture(t)
	var calls atomic.Int32
	address, _ := fixedServerFixture(t, f, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{}`)
	}))
	for _, name := range []string{"service-revoked-during-prepare", "cancelled-during-prepare"} {
		t.Run(name, func(t *testing.T) {
			client := fixedMediaClientFixture(t, f, address, shopOrderReadMediaProfileFixture())
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			prepared := 0
			_, err := client.Exchange(ctx, "shop.order.read", func(ctx context.Context, actual AuthenticatedChannel) (WireRequest, error) {
				prepared++
				if actual.Peer.SubjectAltName != "adapter.ynx.test" || len(actual.Exporter) != 32 {
					return WireRequest{}, ErrDenied
				}
				if name == "service-revoked-during-prepare" {
					closed, e := client.RevokeService("adapter.ynx.test", 1)
					if e != nil || closed != 1 {
						t.Error("actual prepared connection was not revoked", closed, e)
						return WireRequest{}, ErrUnavailable
					}
				} else {
					cancel()
				}
				return WireRequest{Body: []byte{0, 0, 0, 5, 0xff}, ContentType: shopOrderReadRequestMedia}, nil
			})
			if err == nil || prepared != 1 || calls.Load() != 0 {
				t.Fatal("new registered E5 flow emitted bytes after preparation lost current authority/channel", err, prepared, calls.Load())
			}
			if name == "cancelled-during-prepare" && !errors.Is(err, context.Canceled) {
				t.Fatal("original cancellation was not preserved", err)
			}
		})
	}
}

func TestFixedPeerMediaResponseRegistrationIsNotSymmetric(t *testing.T) {
	f := newTLSFixture(t)
	for _, values := range [][]string{{shopOrderReadRequestMedia}, {"application/cbor"}, {"application/json; charset=utf-8"}, {"Application/JSON"}, {"application/x-json"}, {"application/json", "application/json"}, {}} {
		name := strings.Join(values, ",")
		if name == "" {
			name = "missing"
		}
		t.Run(name, func(t *testing.T) {
			var calls atomic.Int32
			address, _ := fixedServerFixture(t, f, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				_, _ = io.Copy(io.Discard, r.Body)
				// A nil value suppresses net/http's content sniffing in the missing
				// header case, so the real response genuinely has no Content-Type.
				w.Header()["Content-Type"] = values
				_, _ = io.WriteString(w, `{}`)
			}))
			client := fixedMediaClientFixture(t, f, address, shopOrderReadMediaProfileFixture())
			result, err := client.Exchange(context.Background(), "shop.order.read", func(context.Context, AuthenticatedChannel) (WireRequest, error) {
				return WireRequest{Body: []byte{0, 0, 0, 5}, ContentType: shopOrderReadRequestMedia}, nil
			})
			if !errors.Is(err, ErrDenied) || calls.Load() != 1 || len(result.Body) != 0 {
				t.Fatal("registered request MIME authorized an unregistered response MIME", err, calls.Load())
			}
		})
	}
}

func TestFixedPeerMediaIndependentBudgetsAndExactCeilings(t *testing.T) {
	f := newTLSFixture(t)
	for _, test := range []struct {
		name                                                     string
		requestLimit, responseLimit, requestBytes, responseBytes int64
		wantErr                                                  error
		wantCalls                                                int32
	}{
		{"both-exact-contract-ceilings", 1 << 20, 1 << 20, 1 << 20, 1 << 20, nil, 1},
		{"smaller-independent-budgets", 64, 32, 64, 32, nil, 1},
		{"request-over-smaller-budget", 64, 32, 65, 32, ErrBounds, 0},
		{"response-over-smaller-budget", 64, 32, 64, 33, ErrBounds, 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			var calls atomic.Int32
			responseWire := []byte(`{"x":"` + strings.Repeat("r", int(test.responseBytes)-8) + `"}`)
			requestWire := bytes.Repeat([]byte{0xff}, int(test.requestBytes))
			address, _ := fixedServerFixture(t, f, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				body, err := io.ReadAll(r.Body)
				if err != nil || !bytes.Equal(body, requestWire) {
					t.Error("request bytes changed", err)
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write(responseWire)
			}))
			p := shopOrderReadMediaProfileFixture()
			p.Operations[0].MaxRequestBytes, p.Operations[0].MaxResponseBytes = test.requestLimit, test.responseLimit
			// A separate operation's larger response limit is the physical pool
			// limit; it must not replace this operation's smaller response budget.
			p.Operations = append(p.Operations, ServiceOperation{ID: "other.read", Method: "POST", Path: "/api/tools/other.read", MaxRequestBytes: 32 << 10, MaxResponseBytes: 2 << 20})
			client := fixedMediaClientFixture(t, f, address, p)
			result, err := client.Exchange(context.Background(), "shop.order.read", func(context.Context, AuthenticatedChannel) (WireRequest, error) {
				return WireRequest{Body: requestWire, ContentType: shopOrderReadRequestMedia}, nil
			})
			if !errors.Is(err, test.wantErr) || calls.Load() != test.wantCalls {
				t.Fatal("operation budget changed", err, calls.Load())
			}
			if err == nil && !bytes.Equal(result.Body, responseWire) {
				t.Fatal("response bytes changed at exact limit")
			}
		})
	}
}

func TestFixedPeerMediaLegacyResponseParametersRemainCompatible(t *testing.T) {
	f := newTLSFixture(t)
	address, _ := fixedServerFixture(t, f, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		if r.Header.Get("Accept") != "application/json, application/cbor" {
			t.Error("legacy response negotiation changed")
		}
		w.Header().Set("Content-Type", "Application/JSON; charset=utf-8")
		_, _ = io.WriteString(w, `{}`)
	}))
	client := fixedMediaClientFixture(t, f, address, fixedProfileFixture())
	result, err := client.Exchange(context.Background(), "shop.order.read", func(context.Context, AuthenticatedChannel) (WireRequest, error) {
		return WireRequest{Body: []byte(`{}`), ContentType: "application/json"}, nil
	})
	if err != nil || result.ContentType != "Application/JSON; charset=utf-8" || string(result.Body) != `{}` {
		t.Fatal("legacy response normalization changed", err)
	}
}

func TestFixedPeerMediaSiblingOperationsStayIsolatedOnSharedConnection(t *testing.T) {
	f := newTLSFixture(t)
	const legacyOperation = "legacy.read"
	const legacyPath = "/api/tools/legacy.read"
	e5Wire := []byte{0, 0, 0, 5, 0xff}
	cborWire := []byte{0xa1, 0x61, 0x78, 0x01}
	var calls atomic.Int32
	channels := make(chan AuthenticatedChannel, 2)
	policy := f.policy(true)
	policy.Edges[0].Routes = []Route{{Method: "POST", Path: "/api/tools/shop.order.read", Risk: "write"}, {Method: "POST", Path: legacyPath, Risk: "write"}}
	gate, err := NewGate(policy)
	if err != nil {
		t.Fatal(err)
	}
	server, err := NewHTTPServer(HTTPServerConfig{TLS: f.config(true), Gate: gate, EdgeID: "pay-adapter", Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		actual, e := ServiceChannelFromRequest(r)
		if e != nil {
			t.Error(e)
			http.Error(w, "channel unavailable", 503)
			return
		}
		channels <- actual
		body, e := io.ReadAll(r.Body)
		if e != nil {
			t.Error(e)
		}
		if r.URL.Path == legacyPath {
			if string(body) != `{}` || r.Header.Get("Content-Type") != "application/json" || r.Header.Get("Accept") != "application/json, application/cbor" {
				t.Error("sibling legacy request inherited E5 media rules")
			}
			w.Header().Set("Content-Type", "application/cbor")
			_, _ = w.Write(cborWire)
		} else {
			if !bytes.Equal(body, e5Wire) || r.Header.Get("Content-Type") != shopOrderReadRequestMedia || r.Header.Get("Accept") != "application/json" {
				t.Error("E5 operation inherited sibling media rules")
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{}`)
		}
	})})
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		_ = server.Close()
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	t.Cleanup(func() { _ = server.Close(); <-done })
	p := shopOrderReadMediaProfileFixture()
	p.Operations = append(p.Operations, ServiceOperation{ID: legacyOperation, Method: "POST", Path: legacyPath, MaxRequestBytes: 32 << 10, MaxResponseBytes: 1 << 20, MediaProfile: MediaProfileJSONCBOR})
	client := fixedMediaClientFixture(t, f, listener.Addr().String(), p)
	first, err := client.Exchange(context.Background(), "shop.order.read", func(context.Context, AuthenticatedChannel) (WireRequest, error) {
		return WireRequest{Body: e5Wire, ContentType: shopOrderReadRequestMedia}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	second, err := client.Exchange(context.Background(), legacyOperation, func(context.Context, AuthenticatedChannel) (WireRequest, error) {
		return WireRequest{Body: []byte(`{}`), ContentType: "application/json"}, nil
	})
	if err != nil || second.ContentType != "application/cbor" || !bytes.Equal(second.Body, cborWire) || !bytes.Equal(first.Channel.Exporter, second.Channel.Exporter) {
		t.Fatal("same TLS connection mixed operation media profiles or changed legacy CBOR", err)
	}
	firstServer, secondServer := <-channels, <-channels
	if !bytes.Equal(firstServer.Exporter, secondServer.Exporter) || !bytes.Equal(firstServer.Exporter, first.Channel.Exporter) {
		t.Fatal("flow did not exercise the same actual authenticated connection")
	}
	_, err = client.Exchange(context.Background(), legacyOperation, func(context.Context, AuthenticatedChannel) (WireRequest, error) {
		return WireRequest{Body: e5Wire, ContentType: shopOrderReadRequestMedia}, nil
	})
	if !errors.Is(err, ErrDenied) || calls.Load() != 2 {
		t.Fatal("E5 registration leaked to its sibling operation", err, calls.Load())
	}
}

func fixedServerFixture(t *testing.T, f tlsFixture, handler http.Handler) (string, *Gate) {
	t.Helper()
	p := f.policy(true)
	p.Edges[0].Routes = []Route{{Method: "POST", Path: "/api/tools/shop.order.read", Risk: "write"}}
	g, err := NewGate(p)
	if err != nil {
		t.Fatal(err)
	}
	s, err := NewHTTPServer(HTTPServerConfig{TLS: f.config(true), Gate: g, EdgeID: p.Edges[0].ID, Handler: handler})
	if err != nil {
		t.Fatal(err)
	}
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- s.Serve(l) }()
	t.Cleanup(func() { _ = s.Close(); <-done })
	return l.Addr().String(), g
}
func fixedClientFixture(t *testing.T, f tlsFixture, address string) *FixedPeerClient {
	t.Helper()
	p := fixedProfileFixture()
	p.EdgeID = "pay-adapter"
	p.Address = address
	p.Roots[0].Fingerprint = f.root
	c, err := NewFixedPeerClient(FixedPeerClientConfig{Profile: p, TLS: f.config(false), Timeout: 3 * time.Second, MaxConnections: 2})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.Close() })
	return c
}

// The test's opaque SDK wire/handler result are isolated fixtures. Actual TLS
// channels and exact byte transport are real; no Grant/Source is fabricated.
func TestFixedPeerActualChannelBeforeEncodingAndExactCarrier(t *testing.T) {
	f := newTLSFixture(t)
	var calls atomic.Int32
	serverChannels := make(chan AuthenticatedChannel, 1)
	wire := []byte("{\"originalOperationId\":\"isolated-original-op\", \"signed\":\"opaque SDK fixture\"}")
	address, _ := fixedServerFixture(t, f, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		ch, err := ServiceChannelFromRequest(r)
		if err != nil {
			t.Error(err)
			http.Error(w, "channel unavailable", 503)
			return
		}
		serverChannels <- ch
		body, err := io.ReadAll(r.Body)
		if err != nil || !bytes.Equal(body, wire) {
			t.Error("original SDK bytes changed", err)
		}
		if r.URL.Path != "/api/tools/shop.order.read" || r.Method != "POST" || r.URL.RawQuery != "" {
			t.Error("fixed carrier changed")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"class":"isolated","source":"not-verified-by-LINK"}`)
	}))
	client := fixedClientFixture(t, f, address)
	// Returned and original config copies cannot change the client destination.
	copyProfile := client.Profile()
	copyProfile.Operations[0].Path = "/unregistered"
	copyProfile.Roots[0].Fingerprint = ""
	var originalExporter []byte
	result, err := client.Exchange(context.Background(), "shop.order.read", func(ctx context.Context, ch AuthenticatedChannel) (WireRequest, error) {
		if ch.Peer.SubjectAltName != "adapter.ynx.test" || len(ch.Exporter) != 32 {
			t.Fatal("encoder did not receive real authenticated peer/channel")
		}
		originalExporter = bytes.Clone(ch.Exporter)
		ch.Exporter[0] ^= 0xff
		return WireRequest{Body: wire, ContentType: "application/json"}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	serverChannel := <-serverChannels
	if calls.Load() != 1 || result.StatusCode != 200 || !bytes.Equal(result.Channel.Exporter, originalExporter) || !bytes.Equal(serverChannel.Exporter, originalExporter) {
		t.Fatal("prepare and server were not on the same live TLS channel")
	}
	if !bytes.Equal(result.Body, []byte(`{"class":"isolated","source":"not-verified-by-LINK"}`)) {
		t.Fatal("response wire changed")
	}
	called := false
	if _, err = client.Exchange(context.Background(), "query-original", func(context.Context, AuthenticatedChannel) (WireRequest, error) {
		called = true
		return WireRequest{}, nil
	}); !errors.Is(err, ErrDenied) || called || calls.Load() != 1 {
		t.Fatal("unknown query was dispatched as new Shop read", err)
	}
	if _, err = client.Exchange(context.Background(), "shop.order.read", nil); !errors.Is(err, ErrUnavailable) || calls.Load() != 1 {
		t.Fatal("missing SDK preparation dispatched")
	}
}

func TestFixedPeerPreparationFailureRevocationAndBudgetsHaveNoDispatch(t *testing.T) {
	f := newTLSFixture(t)
	var calls atomic.Int32
	address, _ := fixedServerFixture(t, f, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{}`)
	}))
	for _, name := range []string{"original-authority-unavailable", "oversized-wire", "wrong-media", "revoked-during-encode", "cancelled-during-encode"} {
		t.Run(name, func(t *testing.T) {
			client := fixedClientFixture(t, f, address)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			_, err := client.Exchange(ctx, "shop.order.read", func(ctx context.Context, ch AuthenticatedChannel) (WireRequest, error) {
				switch name {
				case "original-authority-unavailable":
					return WireRequest{}, ErrUnavailable
				case "oversized-wire":
					return WireRequest{Body: make([]byte, (32<<10)+1), ContentType: "application/json"}, nil
				case "wrong-media":
					return WireRequest{Body: []byte("x"), ContentType: "text/plain"}, nil
				case "revoked-during-encode":
					_, e := client.RevokeService("adapter.ynx.test", 1)
					if e != nil {
						return WireRequest{}, e
					}
				case "cancelled-during-encode":
					cancel()
				}
				return WireRequest{Body: []byte(`{}`), ContentType: "application/json"}, nil
			})
			if err == nil {
				t.Fatal("invalid preparation emitted a request")
			}
			if calls.Load() != 0 {
				t.Fatal("failed authority/budget/current channel reached handler")
			}
		})
	}
}

func TestFixedPeerLostResponseIsNotRetried(t *testing.T) {
	f := newTLSFixture(t)
	var calls atomic.Int32
	address, _ := fixedServerFixture(t, f, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		_, _ = io.Copy(io.Discard, r.Body)
		conn, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		_ = conn.Close()
	}))
	client := fixedClientFixture(t, f, address)
	_, err := client.Exchange(context.Background(), "shop.order.read", func(context.Context, AuthenticatedChannel) (WireRequest, error) {
		return WireRequest{Body: []byte(`{"op":"original-only"}`), ContentType: "application/json"}, nil
	})
	if err == nil || calls.Load() != 1 {
		t.Fatal("lost response retried or reported transport success", err, calls.Load())
	}
}

func TestFixedPeerRedirectAndErrorStatusDoNotBecomeAuthority(t *testing.T) {
	f := newTLSFixture(t)
	var calls atomic.Int32
	address, _ := fixedServerFixture(t, f, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		if n == 1 {
			w.Header().Set("Location", "http://127.0.0.1:1/forbidden")
			w.WriteHeader(307)
		} else {
			w.WriteHeader(403)
		}
		_, _ = io.WriteString(w, `{"diagnostic":"not a Source"}`)
	}))
	client := fixedClientFixture(t, f, address)
	for _, status := range []int{307, 403} {
		result, err := client.Exchange(context.Background(), "shop.order.read", func(context.Context, AuthenticatedChannel) (WireRequest, error) {
			return WireRequest{Body: []byte(`{}`), ContentType: "application/json"}, nil
		})
		if err != nil || result.StatusCode != status {
			t.Fatal("raw status not preserved", result.StatusCode, err)
		}
		var raw map[string]string
		if json.Unmarshal(result.Body, &raw) != nil || raw["diagnostic"] != "not a Source" {
			t.Fatal("raw error body changed")
		}
	}
	if calls.Load() != 2 {
		t.Fatal("redirect followed or request retried")
	}
}
