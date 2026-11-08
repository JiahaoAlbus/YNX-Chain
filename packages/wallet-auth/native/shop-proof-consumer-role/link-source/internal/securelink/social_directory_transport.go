package securelink

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"reflect"
	"strings"
	"sync/atomic"
	"time"
)

var ErrSocialDirectoryUnknown = errors.New("Social original response closure unknown")

// Remote error DATA retains the R2 error-present bit, including numeric zero.
// Kind 2 names a cause retained by Node; it cannot reconstruct that raw value.
type SocialDirectoryRemoteError struct {
	Kind byte
	Code int32
}

func (e SocialDirectoryRemoteError) Error() string {
	return fmt.Sprintf("Social original remote error kind=%d code=%d", e.Kind, e.Code)
}

// Original bytes supplied by Main's actual qualified read scope. LINK owns
// copies, transports them unchanged and does not interpret expected17, a Source
// or a Principal. RequestOriginal must come from the sole SDK original codec.
type SocialDirectoryOriginals struct {
	RequestOriginal, SourceBindingOriginal, SourceWindowOriginal []byte
}

type SocialDirectoryOperation string

const (
	SocialDirectoryCurrent SocialDirectoryOperation = "currentExistingSocialDeviceDirectoryPrincipalV4"
	SocialDirectoryRecheck SocialDirectoryOperation = "recheckExistingSocialDeviceDirectoryPrincipalV4"
)

// SocialDirectoryReadBinding is a borrowed actual Main Source/read-scope
// lifetime, not a LINK authority provider. Only the original normal bootstrap
// supplies its actual implementation. InspectOriginalRootResponse must use
// Main's original Root verifier and return Qualified9.requestOriginalSHA256;
// a Go/meta remarshal of request6 cannot supply that hash.
type SocialDirectoryReadBinding interface {
	Current(context.Context) error
	Originals(context.Context) (SocialDirectoryOriginals, error)
	InspectOriginalRootResponse(context.Context, []byte) ([32]byte, error)
	Retire()
	Join(context.Context) error
	Close() (bool, error)
}

type SocialDirectoryReadBindingOpener func(context.Context, *http.Request, *OriginalSocialDirectoryCaller, SocialDirectoryOperation) (SocialDirectoryReadBinding, error)

// Transport registration DATA only. This private bootstrap API installs no
// global Source/provider, permits no per-request destination and grants no
// Node Host/Principal. Main/Auth owns the separate normal zero-input factory.
type SocialDirectoryForwarderConfig struct {
	Service, SocketPath     string
	PeerUID                 uint32
	PeerPID                 int
	Timeout                 time.Duration
	MaxConcurrentRequests   int
	OpenOriginalReadBinding SocialDirectoryReadBindingOpener
}

type SocialDirectoryResponseDATA struct {
	StatusCode   int
	Header       http.Header
	Body         []byte
	BodyComplete bool
}

type SocialDirectoryTransportLifetime struct {
	Retired, DispatchPossible, BodyComplete bool
	ReadReleaseWritten, ClosedACK           bool
	RemotePhysicalClosed, LocalPhysicalDone bool
	BindingPhysicalClosed, Closed           bool
	Unknown, Usable                         bool
}

const (
	SocialDirectoryTransportKind = "localOSpeer"
	SocialDirectoryPath          = "/v4/devices/directory"
	SocialDirectoryM1QAPath      = "/m1qa/v4/devices/directory"
	SocialDirectoryProofHeader   = "X-Ynx-Product-Session-Proof-V4"
	SocialDirectoryMaxProofBytes = 196608
	SocialDirectoryMaxHeaders    = 262144
)

// OriginalSocialDirectoryCaller is a private observed request lifetime, not a
// Node Host credential, Principal, Source, TLS channel or proof of authority.
// A transport worker alone can attach its real kernel connection. Main must
// separately retain its original qualified Source/read scope; Node remains the
// sole Host/nonce/Principal owner. No context/header/JSON setter mints this type.
type OriginalSocialDirectoryCaller struct {
	request *socialDirectoryOriginalRequest
}

type socialDirectoryOriginalRequest struct {
	original        *http.Request
	originalContext context.Context
	ctx             context.Context // Our standard child, never caller callbacks.
	cancel          context.CancelCauseFunc
	url             *url.URL
	path, target    string
	host            string
	body            io.ReadCloser
	headers         http.Header
	active          atomic.Bool
	retired         atomic.Bool
	peer            atomic.Pointer[socialDirectoryPeerConnection]
}

func socialDirectoryPath(path string) bool {
	return path == SocialDirectoryPath || path == SocialDirectoryM1QAPath
}

func socialDirectorySameContext(a, b context.Context) bool {
	if a == nil || b == nil {
		return false
	}
	v := reflect.ValueOf(a)
	if (v.Kind() == reflect.Pointer || v.Kind() == reflect.Interface) && v.IsNil() {
		return false
	}
	return v.Type().Comparable() && v.Type() == reflect.TypeOf(b) && a == b
}

func socialDirectoryEmptyGET(r *http.Request) bool {
	if r == nil || r.URL == nil || r.Method != http.MethodGet || !socialDirectoryPath(r.RequestURI) || r.URL.String() != r.RequestURI || r.URL.EscapedPath() != r.RequestURI || r.URL.RawQuery != "" || r.URL.ForceQuery || r.URL.Fragment != "" || r.URL.Host != "" || r.URL.IsAbs() || r.ContentLength != 0 || !socialDirectoryNoBody(r.Body) || len(r.TransferEncoding) != 0 || len(r.Trailer) != 0 || r.GetBody != nil || socialDirectoryIdentityHeader(r.Header) {
		return false
	}
	if r.Header.Get("Content-Type") != "" || len(r.Header.Values("Content-Type")) != 0 || r.Header.Get("Content-Encoding") != "" || len(r.Header.Values("Content-Encoding")) != 0 || len(r.Header.Values("Transfer-Encoding")) != 0 || r.Header.Get("Expect") != "" {
		return false
	}
	proof := r.Header.Values(SocialDirectoryProofHeader)
	return len(proof) == 1 && len(proof[0]) >= 1 && len(proof[0]) <= SocialDirectoryMaxProofBytes && !strings.ContainsAny(proof[0], "\x00\r\n")
}

func socialDirectoryNoBody(body io.ReadCloser) bool {
	// Never compare an arbitrary interface containing an uncomparable body.
	return body == nil || reflect.TypeOf(body) == reflect.TypeOf(http.NoBody)
}

func socialDirectoryIdentityHeader(h http.Header) bool {
	if proxyIdentityHeader(h) || h.Get("Upgrade") != "" {
		return true
	}
	for name := range h {
		key := strings.ToLower(name)
		if strings.HasPrefix(key, "x-ynx-caller-") || key == "x-peer-uid" || key == "x-peer-pid" || key == "x-caller-uid" || key == "x-caller-pid" {
			return true
		}
	}
	return false
}

// Capture occurs before async transport and outside a resource/Store lock.
// This only bounds and owns original header DATA; SDK/Auth alone interpret V4
// proof, accepted request6, expected17, Source binding and Source window.
func captureSocialDirectoryOriginalRequest(ctx context.Context, r *http.Request) (*socialDirectoryOriginalRequest, error) {
	if r == nil || !socialDirectorySameContext(ctx, r.Context()) {
		return nil, ErrDenied
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	remaining := SocialDirectoryMaxHeaders - len(r.Method) - len(r.RequestURI) - len(r.Host) - 16
	for key, values := range r.Header {
		if len(key)+4 > remaining {
			return nil, ErrBounds
		}
		remaining -= len(key) + 4
		for _, value := range values {
			if len(value)+2 > remaining {
				return nil, ErrBounds
			}
			remaining -= len(value) + 2
		}
	}
	if !socialDirectoryEmptyGET(r) {
		return nil, ErrDenied
	}
	private, cancel := context.WithCancelCause(ctx)
	b := &socialDirectoryOriginalRequest{original: r, originalContext: ctx, ctx: private, cancel: cancel, url: r.URL, path: r.RequestURI, target: r.URL.String(), host: r.Host, body: r.Body, headers: r.Header.Clone()}
	b.active.Store(true)
	return b, nil
}

func (b *socialDirectoryOriginalRequest) localCurrent(r *http.Request) error {
	if b == nil || r == nil || r != b.original || !b.active.Load() || b.retired.Load() || !socialDirectorySameContext(r.Context(), b.originalContext) || r.URL != b.url || r.URL == nil || r.Method != http.MethodGet || r.RequestURI != b.path || r.URL.String() != b.target || r.Host != b.host || r.ContentLength != 0 || !socialDirectoryNoBody(r.Body) || (r.Body == nil) != (b.body == nil) || len(r.TransferEncoding) != 0 || len(r.Trailer) != 0 || r.GetBody != nil || len(r.Header) != len(b.headers) {
		return ErrDenied
	}
	// Walk only our already bounded snapshot; mutated request DATA cannot make
	// this synchronous local fence traverse an unbounded new header inventory.
	for key, values := range b.headers {
		current, found := r.Header[key]
		if !found || len(current) != len(values) {
			return ErrDenied
		}
		for i, value := range values {
			if current[i] != value {
				return ErrDenied
			}
		}
	}
	// This is our private standard WithCancelCause context, not r.Context().Err
	// or a request-supplied callback invoked under a Source/Store lock.
	if b.ctx.Err() != nil {
		return context.Cause(b.ctx)
	}
	return nil
}

// CurrentOriginalRequest returns only an error. It performs no socket/FD/OS
// operation, Source callback, proof parsing, body/header clone or remote query.
// It cannot attest an unobserved peer disconnect or cross-process atomic CAS.
func (c *OriginalSocialDirectoryCaller) CurrentOriginalRequest(r *http.Request) error {
	if c == nil || c.request == nil {
		return ErrDenied
	}
	return c.request.localCurrent(r)
}

// Current checks the original registered Unix DATA endpoint outside Store
// locks. Socketpair credentials are not Node identity: Main created that pair.
func (c *OriginalSocialDirectoryCaller) Current(ctx context.Context) error {
	if c == nil || c.request == nil || c.request.peer.Load() == nil {
		return ErrDenied
	}
	if err := c.request.localCurrent(c.request.original); err != nil {
		return err
	}
	return c.request.peer.Load().current(ctx)
}
