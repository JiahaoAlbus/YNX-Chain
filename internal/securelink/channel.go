package securelink

import (
	"context"
	"io"
	"net/http"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink/native"
)

// AuthenticatedChannel is diagnostic evidence from an actual live TLS endpoint.
// The RFC 9266 exporter is not a master secret, an Agent proof, a Grant, or
// business authorization. A caller-created value confers no authority. Server
// SDK/Auth adapters must obtain a fresh value with ServiceChannelFromRequest at
// their actual request boundary, and apply their own current business policy.
type AuthenticatedChannel struct {
	Peer         Peer
	Exporter     []byte
	LocalSAN     string
	ConnectionID native.ConnectionID
}

// authenticatedChannel is shared by the protected client and server boundaries.
// Neither a State snapshot nor HTTP fields can supply its identity or exporter.
func authenticatedChannel(ctx context.Context, conn *native.Conn, gate *Gate, edge, method, path string) (AuthenticatedChannel, error) {
	if ctx == nil || conn == nil || gate == nil || conn.ID() == (native.ConnectionID{}) {
		return AuthenticatedChannel{}, ErrDenied
	}
	peer, err := gate.AuthenticateServicePeer(ctx, conn, edge, method, path)
	if err != nil {
		return AuthenticatedChannel{}, err
	}
	state := conn.Snapshot()
	exporter, err := conn.ExportKeyingMaterial("EXPORTER-Channel-Binding", nil, 32)
	if err != nil {
		return AuthenticatedChannel{}, err
	}
	if len(exporter) != 32 {
		return AuthenticatedChannel{}, ErrDenied
	}
	// Exporting bytes cannot turn an earlier policy result into a cached permit.
	// Recheck after the native operation, including revocation/expiry and changes
	// to the same edge's policy epoch. There is no authority in a returned value.
	current, err := gate.AuthenticateServicePeer(ctx, conn, edge, method, path)
	if err != nil {
		return AuthenticatedChannel{}, err
	}
	if peer != current || !state.Verified || state.LocalSAN == "" {
		return AuthenticatedChannel{}, ErrDenied
	}
	return AuthenticatedChannel{Peer: current, Exporter: append([]byte(nil), exporter...), LocalSAN: state.LocalSAN, ConnectionID: conn.ID()}, nil
}

type serviceChannelKey struct{}

// This private binding retains its original request and actual native endpoint,
// not a copied Peer/State/exporter. Copying a request's context cannot move the
// channel to a different request, route, connection, or service edge.
type serviceChannelBinding struct {
	request               *http.Request
	conn                  *native.Conn
	gate                  *Gate
	edge                  string
	method, path          string
	url, requestURI, host string
	id                    native.ConnectionID
	body                  io.ReadCloser
	contentLength         int64
	contentTypes          []string
}

// withServiceChannel is called only by the native HTTP server after its Gate
// accepts the actual request. No exported context setter exists.
func withServiceChannel(r *http.Request, conn *native.Conn, gate *Gate, edge string) *http.Request {
	if r == nil || r.URL == nil || conn == nil || gate == nil || conn.ID() == (native.ConnectionID{}) {
		return r
	}
	state := conn.Snapshot()
	if state.LocalEKU != "serverAuth" || state.PeerEKU != "clientAuth" {
		return r
	}
	binding := &serviceChannelBinding{conn: conn, gate: gate, edge: edge, method: r.Method, path: r.URL.EscapedPath(), url: r.URL.String(), requestURI: r.RequestURI, host: r.Host, id: conn.ID(), body: r.Body, contentLength: r.ContentLength, contentTypes: append([]string(nil), r.Header.Values("Content-Type")...)}
	bound := r.WithContext(context.WithValue(r.Context(), serviceChannelKey{}, binding))
	binding.request = bound
	return bound
}

// ServiceChannelFromRequest is the server-side bridge to existing SDK/Auth
// code. It accepts only the exact request privately bound by NewHTTPServer and
// obtains current evidence on every call. Headers, caller-created context values,
// copied requests and earlier AuthenticatedChannel snapshots are never inputs.
func ServiceChannelFromRequest(r *http.Request) (AuthenticatedChannel, error) {
	if r == nil || r.URL == nil || proxyIdentityHeader(r.Header) || r.Method == http.MethodConnect || r.Header.Get("Upgrade") != "" {
		return AuthenticatedChannel{}, ErrDenied
	}
	binding, ok := r.Context().Value(serviceChannelKey{}).(*serviceChannelBinding)
	if !ok || binding == nil || binding.request != r || binding.conn == nil || binding.gate == nil || binding.id == (native.ConnectionID{}) || binding.conn.ID() != binding.id || r.Method != binding.method || r.URL.EscapedPath() != binding.path || r.URL.String() != binding.url || r.RequestURI != binding.requestURI || r.Host != binding.host {
		return AuthenticatedChannel{}, ErrDenied
	}
	channel, err := authenticatedChannel(r.Context(), binding.conn, binding.gate, binding.edge, r.Method, r.URL.EscapedPath())
	if err != nil {
		return AuthenticatedChannel{}, err
	}
	if channel.ConnectionID != binding.id {
		return AuthenticatedChannel{}, ErrDenied
	}
	return channel, nil
}
