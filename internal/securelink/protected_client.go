package securelink

import (
	"bytes"
	"context"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink/native"
)

// FixedPeerProfile is registered deployment DATA, not an Auth Grant, SDK wire
// or model-selectable destination. The caller compares its registered Sink to
// this exact immutable profile before using Exchange. No example service
// identity, CA or credential is installed by LINK.
type FixedPeerProfile struct {
	ID, Revision, Service, EdgeID      string
	LocalSAN, PeerSAN, Origin, Address string
	Epoch                              uint64
	Roots                              []Root
	Operations                         []ServiceOperation
}

// ServiceOperation has one exact carrier route and explicit budgets. A business
// read using POST is fully authenticated per request; this client never enters
// the GET-only read fast path or any static verification/authority cache.
type ServiceOperation struct {
	ID, Method, Path                  string
	MaxRequestBytes, MaxResponseBytes int64
}

type FixedPeerClientConfig struct {
	Profile          FixedPeerProfile
	TLS              native.Config
	Timeout, IdleTTL time.Duration
	MaxConnections   int
}

// WireRequest/Response carry the original SDK's exact opaque bytes. LINK does
// not encode, decode, verify or synthesize a Grant/Source/result/remoteRef.
type WireRequest struct {
	Body        []byte
	ContentType string
}
type WireResponse struct {
	Body        []byte
	ContentType string
	StatusCode  int
	Channel     AuthenticatedChannel
}
type PrepareWire func(context.Context, AuthenticatedChannel) (WireRequest, error)

type FixedPeerClient struct {
	profile    FixedPeerProfile
	operations map[string]ServiceOperation
	transport  *Transport
	timeout    time.Duration
}

func validateFixedPeerProfile(p FixedPeerProfile) (FixedPeerProfile, map[string]ServiceOperation, int64, error) {
	if !profileName(p.ID) || !profileName(p.Service) || p.EdgeID == "" || !exactSAN(p.LocalSAN) || !exactSAN(p.PeerSAN) || p.Epoch == 0 {
		return FixedPeerProfile{}, nil, 0, ErrUnavailable
	}
	if rev, err := canonicalU(p.Revision); err != nil || rev == 0 {
		return FixedPeerProfile{}, nil, 0, ErrDenied
	}
	u, err := url.Parse(p.Origin)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Host == "" || u.Hostname() != p.PeerSAN || u.Path != "" || u.RawPath != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.Opaque != "" {
		return FixedPeerProfile{}, nil, 0, ErrDenied
	}
	if port := u.Port(); port != "" {
		n, e := strconv.ParseUint(port, 10, 16)
		if e != nil || n == 0 || strconv.FormatUint(n, 10) != port {
			return FixedPeerProfile{}, nil, 0, ErrDenied
		}
	}
	host, port, err := net.SplitHostPort(p.Address)
	if err != nil || host == "" || strings.ContainsAny(host, "\x00\r\n\t /\\") {
		return FixedPeerProfile{}, nil, 0, ErrDenied
	}
	n, err := strconv.ParseUint(port, 10, 16)
	if err != nil || n == 0 || strconv.FormatUint(n, 10) != port {
		return FixedPeerProfile{}, nil, 0, ErrDenied
	}
	if len(p.Operations) == 0 || len(p.Operations) > 64 {
		return FixedPeerProfile{}, nil, 0, ErrBounds
	}
	operations := make(map[string]ServiceOperation, len(p.Operations))
	routes := make([]Route, 0, len(p.Operations))
	var maxResponse int64
	for _, op := range p.Operations {
		if !profileName(op.ID) || op.MaxRequestBytes < 0 || op.MaxRequestBytes > 16<<20 || op.MaxResponseBytes < 1 || op.MaxResponseBytes > 16<<20 || !validRoute(Route{Method: op.Method, Path: op.Path, Risk: "write"}) {
			return FixedPeerProfile{}, nil, 0, ErrDenied
		}
		if op.MaxRequestBytes == 0 && op.Method != http.MethodGet && op.Method != http.MethodHead {
			return FixedPeerProfile{}, nil, 0, ErrDenied
		}
		parsed, e := url.ParseRequestURI(op.Path)
		if e != nil || parsed.Path != op.Path || parsed.RawPath != "" || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" {
			return FixedPeerProfile{}, nil, 0, ErrDenied
		}
		if _, ok := operations[op.ID]; ok {
			return FixedPeerProfile{}, nil, 0, ErrDenied
		}
		operations[op.ID] = op
		routes = append(routes, Route{Method: op.Method, Path: op.Path, Risk: "write"})
		if op.MaxResponseBytes > maxResponse {
			maxResponse = op.MaxResponseBytes
		}
	}
	if _, err = validatePolicy(Policy{Edges: []Edge{{ID: p.EdgeID, LocalSAN: p.LocalSAN, PeerSAN: p.PeerSAN, Epoch: p.Epoch, Roots: p.Roots, Routes: routes}}}); err != nil {
		return FixedPeerProfile{}, nil, 0, err
	}
	p.Roots = append([]Root(nil), p.Roots...)
	p.Operations = append([]ServiceOperation(nil), p.Operations...)
	return p, operations, maxResponse, nil
}
func profileName(s string) bool {
	if len(s) == 0 || len(s) > 256 {
		return false
	}
	for _, c := range s {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || strings.ContainsRune("._:-", c)) {
			return false
		}
	}
	return true
}

func NewFixedPeerClient(cfg FixedPeerClientConfig) (*FixedPeerClient, error) {
	p, ops, maxResponse, err := validateFixedPeerProfile(cfg.Profile)
	if err != nil {
		return nil, err
	}
	if cfg.TLS.Server || cfg.TLS.PeerSAN != p.PeerSAN {
		return nil, ErrDenied
	}
	if cfg.TLS.CertFile == "" || cfg.TLS.KeyFile == "" || cfg.TLS.CAFile == "" {
		return nil, ErrUnavailable
	}
	if cfg.Timeout == 0 {
		cfg.Timeout = 30 * time.Second
	}
	if cfg.Timeout <= 0 || cfg.Timeout > 5*time.Minute {
		return nil, ErrBounds
	}
	routes := make([]Route, 0, len(ops))
	for _, op := range p.Operations {
		routes = append(routes, Route{Method: op.Method, Path: op.Path, Risk: "write"})
	}
	gate, err := NewGate(Policy{Edges: []Edge{{ID: p.EdgeID, LocalSAN: p.LocalSAN, PeerSAN: p.PeerSAN, Epoch: p.Epoch, Roots: p.Roots, Routes: routes}}})
	if err != nil {
		return nil, err
	}
	t, err := NewTransport(HTTPClientConfig{TLS: cfg.TLS, Gate: gate, EdgeID: p.EdgeID, Address: p.Address, Origin: p.Origin, IdleTTL: cfg.IdleTTL, MaxConnections: cfg.MaxConnections, MaxResponseBytes: maxResponse})
	if err != nil {
		return nil, err
	}
	return &FixedPeerClient{profile: p, operations: ops, transport: t, timeout: cfg.Timeout}, nil
}

func (c *FixedPeerClient) Profile() FixedPeerProfile {
	if c == nil {
		return FixedPeerProfile{}
	}
	p := c.profile
	p.Roots = append([]Root(nil), p.Roots...)
	p.Operations = append([]ServiceOperation(nil), p.Operations...)
	return p
}
func (c *FixedPeerClient) Close() error {
	if c == nil || c.transport == nil {
		return nil
	}
	return c.transport.Close()
}
func (c *FixedPeerClient) RevokeCertificate(fingerprint string) (int, error) {
	if c == nil || c.transport == nil {
		return 0, ErrUnavailable
	}
	return c.transport.gate.RevokeCertificate(fingerprint)
}
func (c *FixedPeerClient) RevokeService(san string, epoch uint64) (int, error) {
	if c == nil || c.transport == nil {
		return 0, ErrUnavailable
	}
	return c.transport.gate.RevokeService(san, epoch)
}

func (c *FixedPeerClient) Exchange(ctx context.Context, operation string, prepare PrepareWire) (WireResponse, error) {
	var result WireResponse
	if c == nil || c.transport == nil || ctx == nil || prepare == nil {
		return result, ErrUnavailable
	}
	op, ok := c.operations[operation]
	if !ok {
		return result, ErrDenied
	}
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, op.Method, c.profile.Origin+op.Path, nil)
	if err != nil {
		return result, ErrDenied
	}
	req.Header.Set("Accept", "application/json, application/cbor")
	var channel AuthenticatedChannel
	response, err := c.transport.roundTrip(req, func(ctx context.Context, conn *native.Conn) (WireRequest, error) {
		actual, e := authenticatedChannel(ctx, conn, c.transport.gate, c.profile.EdgeID, op.Method, op.Path)
		if e != nil {
			return WireRequest{}, e
		}
		// Keep a detached record of the actual channel used for this request;
		// preparation receives its own copy, never mutable shared TLS state.
		channel = actual
		channel.Exporter = bytes.Clone(actual.Exporter)
		wire, e := prepare(ctx, actual)
		if e != nil {
			return WireRequest{}, e
		}
		if int64(len(wire.Body)) > op.MaxRequestBytes {
			return WireRequest{}, ErrBounds
		}
		if len(wire.Body) == 0 {
			if (op.Method != http.MethodGet && op.Method != http.MethodHead) || wire.ContentType != "" {
				return WireRequest{}, ErrDenied
			}
		} else if wire.ContentType != "application/json" && wire.ContentType != "application/cbor" {
			return WireRequest{}, ErrDenied
		}
		wire.Body = bytes.Clone(wire.Body)
		return wire, nil
	})
	if err != nil {
		return result, err
	}
	defer response.Body.Close()
	result.StatusCode = response.StatusCode
	media, _, e := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if e != nil || (media != "application/json" && media != "application/cbor") {
		return result, ErrDenied
	}
	if response.ContentLength > op.MaxResponseBytes {
		return result, ErrBounds
	}
	body, e := io.ReadAll(io.LimitReader(response.Body, op.MaxResponseBytes+1))
	if e != nil {
		return result, e
	}
	if int64(len(body)) > op.MaxResponseBytes {
		return result, ErrBounds
	}
	result.Body = body
	result.ContentType = response.Header.Get("Content-Type")
	result.Channel = channel
	// Even HTTP 200 is only a completed transport exchange. The original SDK
	// must verify operation/Source/proofs; LINK never returns business COMMITTED.
	return result, nil
}
