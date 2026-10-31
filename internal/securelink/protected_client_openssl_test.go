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
	"sync/atomic"
	"testing"
	"time"
)

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
