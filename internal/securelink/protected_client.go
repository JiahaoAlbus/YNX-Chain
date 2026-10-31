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
	MediaProfile                      OperationMediaProfile
}

// OperationMediaProfile selects a finite, independently registered pair of
// request/response media rules. It is deployment DATA, not a per-call override.
// The empty value preserves the original JSON/CBOR caller's behavior.
type OperationMediaProfile string

const (
	MediaProfileJSONCBOR        OperationMediaProfile = "json-cbor"
	MediaProfileShopOrderReadV1 OperationMediaProfile = "shop-order-read-v1"
	shopOrderReadRequestMedia                         = "application/vnd.ynx.shop-order-read.v1"
)

func validateOperationMediaProfile(op ServiceOperation) error {
	switch op.MediaProfile {
	case "", MediaProfileJSONCBOR:
		return nil
	case MediaProfileShopOrderReadV1:
		// The new E5 DATA contract has this exact registered carrier and two
		// independent 1 MiB ceilings. Registration never increases a smaller
		// operation budget, nor permits this request MIME on other operations.
		if op.ID != "shop.order.read" || op.Method != http.MethodPost || op.Path != "/api/tools/shop.order.read" || op.MaxRequestBytes > 1<<20 || op.MaxResponseBytes > 1<<20 {
			return ErrDenied
		}
		return nil
	default:
		return ErrDenied
	}
}

func (op ServiceOperation) requestContentTypeAllowed(value string) bool {
	if op.MediaProfile == MediaProfileShopOrderReadV1 {
		return value == shopOrderReadRequestMedia
	}
	return value == "application/json" || value == "application/cbor"
}

func (op ServiceOperation) responseContentTypeAllowed(header http.Header) bool {
	if op.MediaProfile == MediaProfileShopOrderReadV1 {
		values := header.Values("Content-Type")
		return len(values) == 1 && values[0] == "application/json"
	}
	// Preserve the original JSON/CBOR profile's response MIME parameter
	// compatibility. The registered E5 profile deliberately does not use this
	// normalization: request E5 and response JSON are separate exact contracts.
	media, _, err := mime.ParseMediaType(header.Get("Content-Type"))
	return err == nil && (media == "application/json" || media == "application/cbor")
}

func (op ServiceOperation) responseAccept() string {
	if op.MediaProfile == MediaProfileShopOrderReadV1 {
		return "application/json"
	}
	return "application/json, application/cbor"
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
	material    *ProtectedExchange
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
		if err := validateOperationMediaProfile(op); err != nil {
			return FixedPeerProfile{}, nil, 0, err
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

func (c *FixedPeerClient) Exchange(ctx context.Context, operation string, prepare PrepareWire) (result WireResponse, err error) {
	if c == nil || c.transport == nil || ctx == nil || prepare == nil {
		return result, ErrUnavailable
	}
	op, ok := c.operations[operation]
	if !ok {
		return result, ErrDenied
	}
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	capture := &exchangeCapture{}
	defer func() {
		if err != nil {
			err = &DispatchError{Cause: err, DispatchPossible: capture.dispatchPossible.Load(), PartialResponseBytes: capture.partialResponseBytes}
		}
	}()
	// An absent local caller preserves the ordinary wire API. A real caller
	// that has ceased to be current must never downgrade into that mode.
	if ctx.Value(localCallerKey{}) != nil {
		capture.caller, err = LocalCallerFromContext(ctx)
		if err != nil {
			return result, err
		}
	}
	ctx = context.WithValue(ctx, exchangeCaptureKey{}, capture)
	req, err := http.NewRequestWithContext(ctx, op.Method, c.profile.Origin+op.Path, nil)
	if err != nil {
		return result, ErrDenied
	}
	req.Header.Set("Accept", op.responseAccept())
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
		} else if !op.requestContentTypeAllowed(wire.ContentType) {
			return WireRequest{}, ErrDenied
		}
		wire.Body = bytes.Clone(wire.Body)
		if capture.caller != nil {
			capture.conn = conn
			capture.request = WireRequest{Body: bytes.Clone(wire.Body), ContentType: wire.ContentType}
		}
		return wire, nil
	})
	if err != nil {
		return result, err
	}
	defer response.Body.Close()
	result.StatusCode = response.StatusCode
	if !op.responseContentTypeAllowed(response.Header) {
		return result, ErrDenied
	}
	if response.ContentLength > op.MaxResponseBytes {
		return result, ErrBounds
	}
	body, e := io.ReadAll(io.LimitReader(response.Body, op.MaxResponseBytes+1))
	capture.partialResponseBytes = int64(len(body))
	if e != nil {
		return result, e
	}
	if int64(len(body)) > op.MaxResponseBytes {
		return result, ErrBounds
	}
	result.Body = body
	result.ContentType = response.Header.Get("Content-Type")
	result.Channel = channel
	if capture.caller != nil {
		material := &ProtectedExchange{caller: capture.caller, client: c, conn: capture.conn, operation: op,
			request: capture.request, responseBody: bytes.Clone(body), responseContentType: result.ContentType,
			statusCode: result.StatusCode, channel: cloneAuthenticatedChannel(channel)}
		material.self = material
		result.material = material
	}
	// Even HTTP 200 is only a completed transport exchange. The original SDK
	// must verify operation/Source/proofs; LINK never returns business COMMITTED.
	return result, nil
}
