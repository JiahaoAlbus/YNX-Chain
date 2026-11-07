//go:build cgo && (linux || darwin)

package securelink

import (
	"bytes"
	"net/http"
	"path/filepath"
	"time"
	"unicode/utf8"
)

// Private owned DATA copied from Auth's exact C header. This is not a Root
// constructor or binary cast. Only the dedicated strong-Auth entry can publish
// its decoded profile into the normal startup owner.
type payNativeTransportRoute struct {
	enabled                     uint8
	method                      [5]byte
	path                        [2049]byte
	contentType                 [17]byte
	maximumBodyBytes, timeoutMS uint64
}
type payNativeTransportProfile struct {
	version, size                                       uint32
	resourceRef                                         [129]byte
	socketPath                                          [104]byte
	service                                             [129]byte
	peerUID                                             uint32
	peerPID                                             int32
	timeoutMS, maximumHeaderBytes, maximumResponseBytes uint64
	routes                                              [5]payNativeTransportRoute
}

func payNativeCString(data []byte) (string, error) {
	end := bytes.IndexByte(data, 0)
	if end < 0 || !utf8.Valid(data[:end]) {
		return "", ErrBounds
	}
	for _, b := range data[end:] {
		if b != 0 {
			return "", ErrDenied
		}
	}
	return string(data[:end]), nil
}

func decodePayNativeTransportProfile(p payNativeTransportProfile, expectedSize uint32) (cfg LocalCallerClientConfig, bindings [5]NativeLocalCallerBinding, err error) {
	if p.version != 1 || expectedSize == 0 || p.size != expectedSize {
		return cfg, bindings, ErrDenied
	}
	ref, e := payNativeCString(p.resourceRef[:])
	if e != nil || ref == "" {
		return cfg, bindings, ErrDenied
	}
	socket, e := payNativeCString(p.socketPath[:])
	if e != nil || !filepath.IsAbs(socket) {
		return cfg, bindings, ErrDenied
	}
	service, e := payNativeCString(p.service[:])
	if e != nil || !localService(service) {
		return cfg, bindings, ErrDenied
	}
	if p.peerUID == 0 || p.peerPID <= 0 || p.timeoutMS == 0 || p.timeoutMS > 30000 || p.maximumHeaderBytes == 0 || p.maximumHeaderBytes > 65536 || p.maximumResponseBytes == 0 || p.maximumResponseBytes > 1<<20 {
		return cfg, bindings, ErrBounds
	}
	var routes []LocalCallerRoute
	for i, r := range p.routes {
		if r.enabled > 1 {
			return cfg, bindings, ErrDenied
		}
		method, e := payNativeCString(r.method[:])
		if e != nil {
			return cfg, bindings, e
		}
		path, e := payNativeCString(r.path[:])
		if e != nil {
			return cfg, bindings, e
		}
		contentType, e := payNativeCString(r.contentType[:])
		if e != nil {
			return cfg, bindings, e
		}
		if r.maximumBodyBytes > 1<<20 || r.timeoutMS > p.timeoutMS {
			return cfg, bindings, ErrBounds
		}
		// Disabled slots may retain the original registered strings/budgets;
		// Auth's getter also fills POST MIME for them. They never create a Go
		// binding or route, and cannot be enabled by any conversion/default.
		if r.enabled == 0 {
			continue
		}
		expectedMethod, expectedMIME := http.MethodPost, "application/json"
		if i >= 3 {
			expectedMethod, expectedMIME = http.MethodGet, ""
		}
		if method != expectedMethod || contentType != expectedMIME || r.timeoutMS == 0 {
			return cfg, bindings, ErrDenied
		}
		if (i >= 3 && r.maximumBodyBytes != 0) || (i < 3 && r.maximumBodyBytes == 0) {
			return cfg, bindings, ErrBounds
		}
		routes = append(routes, LocalCallerRoute{Method: method, Path: path, MaxBodyBytes: int64(r.maximumBodyBytes), Timeout: time.Duration(r.timeoutMS) * time.Millisecond})
		bindings[i] = NativeLocalCallerBinding{Method: method, Path: path, ContentType: contentType}
	}
	if _, e := localRoutes(routes); e != nil {
		return cfg, [5]NativeLocalCallerBinding{}, e
	}
	cfg = LocalCallerClientConfig{SocketPath: socket, Service: service, PeerUID: p.peerUID, PeerPID: int(p.peerPID), Routes: routes, Timeout: time.Duration(p.timeoutMS) * time.Millisecond, MaxHeaderBytes: int(p.maximumHeaderBytes), MaxResponseBytes: int64(p.maximumResponseBytes)}
	return cfg, bindings, nil
}
