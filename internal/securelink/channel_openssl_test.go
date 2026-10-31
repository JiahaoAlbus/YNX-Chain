//go:build securelink_openssl && cgo

package securelink

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink/native"
)

const channelToolPath = "/api/tools/shop.order.read"

// Reuse the existing isolated ML-DSA TLS fixture and normal native HTTP server.
// The POST route stays outside the GET/HEAD-only read cache: business approval
// remains the original SDK/Auth responsibility, not an HTTP verb inference.
func channelPolicy(f tlsFixture, server bool) Policy {
	p := f.policy(server)
	p.Edges[0].Routes = append(p.Edges[0].Routes, Route{Method: http.MethodPost, Path: channelToolPath, Risk: "write"})
	return p
}

func startChannelHTTP(t *testing.T, f tlsFixture, handler http.HandlerFunc) *runningHTTP {
	t.Helper()
	gate, err := NewGate(channelPolicy(f, true))
	if err != nil {
		t.Fatal(err)
	}
	r := &runningHTTP{gate: gate, conns: make(chan *native.Conn, 32)}
	s, err := NewHTTPServer(HTTPServerConfig{TLS: f.config(true), Gate: gate, EdgeID: "pay-adapter", Handler: http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		r.calls.Add(1)
		if pending, ok := req.Context().Value(connKey{}).(*pendingConn); ok {
			if conn, err := pending.secure(); err == nil {
				r.conns <- conn
			}
		}
		handler(w, req)
	})})
	if err != nil {
		t.Fatal(err)
	}
	r.server = s
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		_ = s.Close()
		t.Fatal(err)
	}
	r.address = listener.Addr().String()
	done := make(chan error, 1)
	go func() { done <- s.Serve(listener) }()
	t.Cleanup(func() { _ = s.Close(); <-done })
	return r
}

func channelRoundTrip(conn *native.Conn, method, path string, header bool) (int, error) {
	req, err := http.NewRequest(method, "https://adapter.ynx.test"+path, nil)
	if err != nil {
		return 0, err
	}
	if header {
		req.Header.Set("X-YNX-Service-ID", "pay.ynx.test")
	}
	if err := req.Write(conn); err != nil {
		return 0, err
	}
	resp, err := http.ReadResponse(bufio.NewReader(conn), req)
	if err != nil {
		return 0, err
	}
	_, readErr := io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	return resp.StatusCode, readErr
}

func TestServiceChannelActualEndpointsAndOwnedCopies(t *testing.T) {
	f := newTLSFixture(t)
	type result struct {
		channel  AuthenticatedChannel
		failures []string
	}
	results := make(chan result, 2)
	r := startChannelHTTP(t, f, func(w http.ResponseWriter, req *http.Request) {
		channel, err := ServiceChannelFromRequest(req)
		if err != nil {
			results <- result{failures: []string{fmt.Sprintf("actual request channel: %v", err)}}
			http.Error(w, "channel denied", 403)
			return
		}
		failures := []string{}
		original := append([]byte(nil), channel.Exporter...)
		channel.Exporter[0] ^= 0xff
		channel.Peer.CertDigest = "caller mutation"
		again, err := ServiceChannelFromRequest(req)
		if err != nil || !bytes.Equal(again.Exporter, original) || again.Peer.CertDigest == "caller mutation" {
			failures = append(failures, "returned snapshot/exporter modified the actual source")
		}
		type foreignKey struct{}
		copies := []*http.Request{req.Clone(req.Context()), req.WithContext(context.WithValue(req.Context(), foreignKey{}, channel)), httptest.NewRequestWithContext(req.Context(), req.Method, req.URL.String(), nil)}
		for _, copy := range copies {
			if _, err := ServiceChannelFromRequest(copy); err == nil {
				failures = append(failures, "copied request/context transferred service channel")
			}
		}
		oldMethod := req.Method
		req.Method = http.MethodGet
		if _, err := ServiceChannelFromRequest(req); err == nil {
			failures = append(failures, "changed request method retained service channel")
		}
		req.Method = oldMethod
		oldURL := req.URL
		replacement := *oldURL
		replacement.Path = "/settlement"
		req.URL = &replacement
		if _, err := ServiceChannelFromRequest(req); err == nil {
			failures = append(failures, "changed request path retained service channel")
		}
		req.URL = oldURL
		queryURL := *oldURL
		queryURL.RawQuery = "other=resource"
		req.URL = &queryURL
		if _, err := ServiceChannelFromRequest(req); err == nil {
			failures = append(failures, "changed query retained service channel")
		}
		req.URL = oldURL
		oldHost := req.Host
		req.Host = "unrelated.ynx.test"
		if _, err := ServiceChannelFromRequest(req); err == nil {
			failures = append(failures, "changed host retained service channel")
		}
		req.Host = oldHost
		oldTarget := req.RequestURI
		req.RequestURI = "/other-target"
		if _, err := ServiceChannelFromRequest(req); err == nil {
			failures = append(failures, "changed raw target retained service channel")
		}
		req.RequestURI = oldTarget
		req.Header.Set("X-YNX-Service-ID", "pay.ynx.test")
		if _, err := ServiceChannelFromRequest(req); err == nil {
			failures = append(failures, "injected identity header retained service channel")
		}
		req.Header.Del("X-YNX-Service-ID")
		results <- result{channel: again, failures: failures}
		_, _ = io.WriteString(w, "isolated-channel-response")
	})
	conn := dialNative(t, f, r.address)
	clientGate, err := NewGate(channelPolicy(f, false))
	if err != nil {
		t.Fatal(err)
	}
	client, err := authenticatedChannel(context.Background(), conn, clientGate, "pay-adapter", http.MethodPost, channelToolPath)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		status, err := channelRoundTrip(conn, http.MethodPost, channelToolPath, false)
		if err != nil || status != 200 {
			t.Fatalf("actual protected endpoint status=%d error=%v", status, err)
		}
		got := <-results
		if len(got.failures) != 0 {
			t.Fatal(strings.Join(got.failures, "; "))
		}
		if !bytes.Equal(got.channel.Exporter, client.Exporter) || len(got.channel.Exporter) != 32 {
			t.Fatal("two actual TLS endpoints disagreed on standard exporter")
		}
		if got.channel.Peer.ServiceID != "pay.ynx.test" || got.channel.LocalSAN != "adapter.ynx.test" || client.Peer.ServiceID != "adapter.ynx.test" || client.LocalSAN != "pay.ynx.test" {
			t.Fatal("actual two-sided service identity binding was lost")
		}
		if got.channel.ConnectionID == (native.ConnectionID{}) || client.ConnectionID != conn.ID() {
			t.Fatal("bridge omitted actual native endpoint ID")
		}
	}
}

func TestServiceChannelWrongMethodPathAndHeadersNeverReachHandler(t *testing.T) {
	f := newTLSFixture(t)
	r := startChannelHTTP(t, f, func(w http.ResponseWriter, req *http.Request) {
		_, err := ServiceChannelFromRequest(req)
		if err != nil {
			http.Error(w, "channel denied", 403)
			return
		}
		_, _ = io.WriteString(w, "isolated-channel-response")
	})
	conn := dialNative(t, f, r.address)
	for _, tc := range []struct {
		method, path string
		header       bool
	}{{http.MethodDelete, channelToolPath, false}, {http.MethodPost, "/api/tools/other", false}, {http.MethodPost, channelToolPath, true}} {
		status, err := channelRoundTrip(conn, tc.method, tc.path, tc.header)
		if err != nil || status != 403 {
			t.Fatalf("unapproved request status=%d err=%v", status, err)
		}
	}
	if r.calls.Load() != 0 {
		t.Fatal("unapproved request reached service bridge/business handler")
	}
}

func TestServiceChannelRechecksOriginalRequestAfterAuthorityChanges(t *testing.T) {
	f := newTLSFixture(t)
	for _, kind := range []string{"service-revoked", "certificate-revoked", "connection-closed", "root-window-expired", "route-removed"} {
		t.Run(kind, func(t *testing.T) {
			type admitted struct {
				request *http.Request
				channel AuthenticatedChannel
				err     error
			}
			entered := make(chan admitted, 1)
			release := make(chan struct{})
			var once sync.Once
			defer once.Do(func() { close(release) })
			r := startChannelHTTP(t, f, func(w http.ResponseWriter, req *http.Request) {
				channel, err := ServiceChannelFromRequest(req)
				entered <- admitted{req, channel, err}
				<-release
				_, _ = io.WriteString(w, "isolated-channel-response")
			})
			conn := dialNative(t, f, r.address)
			finished := make(chan error, 1)
			go func() { _, err := channelRoundTrip(conn, http.MethodPost, channelToolPath, false); finished <- err }()
			var initial admitted
			select {
			case initial = <-entered:
			case <-time.After(3 * time.Second):
				t.Fatal("actual native request never reached handler")
			}
			if initial.err != nil {
				t.Fatal(initial.err)
			}
			serverConn := <-r.conns
			switch kind {
			case "service-revoked":
				if _, err := r.gate.RevokeService("pay.ynx.test", 1); err != nil {
					t.Fatal(err)
				}
			case "certificate-revoked":
				if _, err := r.gate.RevokeCertificate(initial.channel.Peer.CertDigest); err != nil {
					t.Fatal(err)
				}
			case "connection-closed":
				if err := serverConn.Close(); err != nil {
					t.Fatal(err)
				}
			case "root-window-expired":
				r.gate.mu.Lock()
				edge := r.gate.edges["pay-adapter"]
				edge.Roots[0].Until = time.Now().Add(-time.Second)
				r.gate.edges["pay-adapter"] = edge
				r.gate.mu.Unlock()
			case "route-removed":
				r.gate.mu.Lock()
				edge := r.gate.edges["pay-adapter"]
				edge.Routes = []Route{{Method: "GET", Path: "/settlement", Risk: "read"}}
				r.gate.edges["pay-adapter"] = edge
				r.gate.mu.Unlock()
			}
			if _, err := ServiceChannelFromRequest(initial.request); err == nil {
				t.Fatal("earlier request bypassed current live channel/authority checks")
			}
			if _, err := authenticatedChannel(context.Background(), serverConn, r.gate, "pay-adapter", http.MethodPost, channelToolPath); err == nil {
				t.Fatal("client/server helper cached earlier channel authorization")
			}
			once.Do(func() { close(release) })
			select {
			case <-finished:
			case <-time.After(3 * time.Second):
				t.Fatal("protected fixture did not finish after authority change")
			}
		})
	}
}
