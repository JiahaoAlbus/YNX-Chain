package securelink

import "time"

// AuthorityIngressRoute is fixed operator registration. LINK transports the
// original opaque Auth body; it does not interpret an effect, query or proof.
// This finite JSON profile requires an explicit original Content-Length;
// chunked requests and requests already partially consumed are denied.
type AuthorityIngressRoute struct {
	Method, Path                      string
	MaxRequestBytes, MaxResponseBytes int64
	Timeout                           time.Duration
}

type AuthorityIPCIngressConfig struct {
	Service, SocketPath   string
	PeerUID               uint32
	PeerPID               int
	Routes                []AuthorityIngressRoute
	MaxHeaderBytes        int
	MaxConcurrentRequests int
}

// AuthorityIngressMetadata is diagnostic transport data, obtained only over a
// per-request private SCM_RIGHTS control fd. The JSON shape is deliberately NOT
// an Auth Source, caller approval, Root, business principal or receipt. The
// original Auth owner must parse and verify its own untouched request/proofs.
// ConnectionID is private Go state and never serialized as a misleading {}.
type AuthorityIngressMetadata struct {
	Service, Method, Path, Host string
	ContentType                 string
	ContentLength               int64
	Channel                     AuthorityIngressChannel
}

type AuthorityIngressChannel struct {
	Peer     Peer
	Exporter []byte
	LocalSAN string
}
