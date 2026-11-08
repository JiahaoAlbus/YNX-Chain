package securelink

import (
	"context"
	"net/http"
	"time"
)

const (
	TaskRuntimeProfile     = "AUTH_AI_V6_PRIVATE_RUNTIME_TRANSPORT/v1"
	TaskRuntimeEffectPath  = "/internal/auth/ai-task-v6/effect"
	TaskRuntimeQueryPath   = "/internal/auth/ai-task-v6/effect-query"
	TaskRuntimeMaxEnvelope = 1835008
	TaskRuntimeMaxResponse = 2097152
	TaskRuntimeMaxRequest  = 1048576
	TaskRuntimeMaxReply    = 33554432
)

// TaskRuntimeReply contains exact original DATA. StatusCode is a transport
// status (100..599), never a COMMITTED classifier. Returning an error together
// with Body preserves that original partial DATA on the T sideband; LINK never
// creates an owned business error.partial or an authorization result.
type TaskRuntimeReply struct {
	StatusCode int
	Body       []byte
}

// TaskRuntimeSession belongs to the original Auth Go owner, holding real P08
// objects. Current is its own phase-aware writer/outcome check, invoked ONLY on
// asynchronous C requests. T checks transport before/after; it cannot recheck an
// obsolete writer after an actual commit. These methods are not HTTP routes or
// caller-selected Source providers. LINK neither decodes nor marshals business.
type TaskRuntimeSession interface {
	Current() error
	Capture(context.Context, []byte) (TaskRuntimeReply, error)
	CaptureConversation(context.Context, []byte) (TaskRuntimeReply, error)
	ExecuteLocal(context.Context, []byte) (TaskRuntimeReply, error)
	Observe(context.Context, []byte) (TaskRuntimeReply, error)
	Outcome(context.Context, []byte) (TaskRuntimeReply, error)
	ObserveOutcome(context.Context, []byte) (TaskRuntimeReply, error)
	ReconcileObserve(context.Context, []byte) (TaskRuntimeReply, error)
	Release(context.Context, []byte) (TaskRuntimeReply, error)
	Retire()
	Join(context.Context) error
	Close() error
}

type TaskRuntimeOpener func(context.Context, *http.Request, *OriginalTaskRuntimeCaller) (TaskRuntimeSession, error)

// All registration is fixed by the original startup owner. Missing Root/peer
// registration stays unavailable; no endpoint/authority can be selected by JSON.
type TaskRuntimeForwarderConfig struct {
	Service, SocketPath   string
	PeerUID               uint32
	PeerPID               int
	Timeout               time.Duration
	MaxConcurrentRequests int
	OpenSession           TaskRuntimeOpener
}

// OriginalTaskRuntimeCaller is minted only inside Forward for its exact Go
// request. It is ordinary HTTP plus actual Go->Node OS transport DATA, not a
// LocalCaller, TLS channel, Root/session enrollment or business permission.
type OriginalTaskRuntimeCaller struct{ state *taskRuntimeRequest }

// CurrentOriginalRequest is an error-only, memory-only observed lifecycle fence
// for the same request. It does not acquire a Store/server lock, perform I/O,
// clone a body or call a caller-supplied callback. At the real Go CAS, Auth must
// independently AND it with the actual P08 snapshot/outcome Current.
func (c *OriginalTaskRuntimeCaller) CurrentOriginalRequest(r *http.Request) error {
	if c == nil || c.state == nil {
		return ErrDenied
	}
	return c.state.localCurrent(r)
}

// Current obtains fresh OS peer/liveness outside a Store lock. It is NOT the
// business session.Current, an atomic cross-process read, or a Source grant.
func (c *OriginalTaskRuntimeCaller) Current(ctx context.Context) error {
	if c == nil || c.state == nil {
		return ErrDenied
	}
	return c.state.freshCurrent(ctx)
}

// The C profile is distinct from AuthorityIngressMetadata: no Channel exists
// because an ordinary Go HTTP request must never be presented as native TLS.
// Method/Path/Host/length describe the actual fixed Go->Node carrier; the frame
// tail is the exact owned Node envelope. Auth retains the user request itself.
type TaskRuntimeMetadata struct {
	Profile, Service, Method, Path, Host, ContentType string
	ContentLength                                     int64
}
