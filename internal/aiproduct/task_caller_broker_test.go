package aiproduct

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	link "github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	originalclient "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-history-client/go"
	open "github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go"
)

// PUBLIC controlled lease/result boundary. Actual Auth Capture/handler/whole
// proof production code stays in its own package, with no exported test setter.
// These consumer tests exercise our actual Unix composition and original DATA
// encoder, not Root admission, Native TLS or a real account/order effect.
type p08CallerLeaseControl struct {
	path   string
	body   []byte
	call   originalclient.TaskAuthorityCall
	done   chan struct{}
	once   sync.Once
	result originalclient.TaskAuthorityResult
	err    error
}

func (l *p08CallerLeaseControl) RequestDATA() (string, []byte, error) {
	return l.path, bytes.Clone(l.body), nil
}
func (l *p08CallerLeaseControl) Wait(ctx context.Context) (originalclient.TaskAuthorityResult, error) {
	select {
	case <-l.done:
		return l.result, errors.Join(l.err, ctx.Err())
	default:
	}
	select {
	case <-l.done:
		return l.result, errors.Join(l.err, ctx.Err())
	case <-ctx.Done():
		return originalclient.TaskAuthorityResult{}, ctx.Err()
	}
}
func (l *p08CallerLeaseControl) Close() error {
	l.once.Do(func() { l.err = context.Canceled; close(l.done) })
	return nil
}

type p08OSCallerRequiredClient struct{ *p08BrokerClientFixture }

func (c *p08OSCallerRequiredClient) AuthorizeAtEffect(ctx context.Context, call originalclient.TaskAuthorityCall) (originalclient.TaskAuthorityResult, error) {
	if _, err := link.LocalCallerFromContext(ctx); err != nil {
		return originalclient.TaskAuthorityResult{}, err
	}
	return c.p08BrokerClientFixture.AuthorizeAtEffect(ctx, call)
}
func (c *p08OSCallerRequiredClient) QueryOriginalEffect(ctx context.Context, call originalclient.TaskAuthorityCall) (originalclient.TaskAuthorityResult, error) {
	if _, err := link.LocalCallerFromContext(ctx); err != nil {
		return originalclient.TaskAuthorityResult{}, err
	}
	return c.p08BrokerClientFixture.QueryOriginalEffect(ctx, call)
}

type p08CallerTypedBrokerControl struct {
	registration originalclient.OriginalLocalCallerRegistration
	client       *p08OSCallerRequiredClient
	mu           sync.Mutex
	lease        *p08CallerLeaseControl
	ackStatus    int
	handled      atomic.Int32
}

func (b *p08CallerTypedBrokerControl) ReadRegistration(ctx context.Context) (originalclient.OriginalLocalCallerRegistration, error) {
	return b.registration, ctx.Err()
}
func (b *p08CallerTypedBrokerControl) Capture(ctx context.Context, call originalclient.TaskAuthorityCall) (taskCallerCallLease, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	body, err := originalclient.EncodeOriginalAuthorityBodyDATA(call)
	if err != nil {
		return nil, err
	}
	path := b.registration.Effect.Path
	if call.OriginalOperation != "" {
		path = b.registration.Query.Path
	}
	lease := &p08CallerLeaseControl{path: path, body: body, call: call, done: make(chan struct{})}
	b.mu.Lock()
	b.lease = lease
	b.mu.Unlock()
	return lease, nil
}
func (b *p08CallerTypedBrokerControl) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	caller, err := link.LocalCallerFromRequest(r)
	if err != nil {
		w.WriteHeader(403)
		return
	}
	material, err := caller.Current(r.Context())
	if err != nil {
		w.WriteHeader(403)
		return
	}
	b.mu.Lock()
	lease := b.lease
	b.mu.Unlock()
	if lease == nil || material.Path != lease.path || !bytes.Equal(material.RequestBody, lease.body) {
		w.WriteHeader(403)
		return
	}
	b.handled.Add(1)
	var result originalclient.TaskAuthorityResult
	if lease.call.OriginalOperation == "" {
		result, err = b.client.AuthorizeAtEffect(r.Context(), lease.call)
	} else {
		result, err = b.client.QueryOriginalEffect(r.Context(), lease.call)
	}
	lease.once.Do(func() { lease.result, lease.err = result, err; close(lease.done) })
	status := b.ackStatus
	if status == 0 {
		status = 204
	}
	w.WriteHeader(status)
	if status == 200 {
		_, _ = w.Write([]byte(`{"verified":true,"state":"COMMITTED"}`))
	}
}

func newP08CallerTypedJourney(t *testing.T, queryOnly bool) (*taskIPCBrokerClient, *p08CallerTypedBrokerControl, originalclient.TaskAuthorityCall) {
	t.Helper()
	_ = p08CallerEndpointRegistration(t)
	f, _, raw := newP08BrokerFixture(t, true)
	f.approve(t)
	auth := f.authority.authorization
	g, err := open.DecodeBoundGrant(auth.Grant.Payload)
	if err != nil {
		t.Fatal(err)
	}
	call := originalclient.TaskAuthorityCall{Grant: auth.Grant, Holder: auth.Holder, RawInput: bytes.Clone(f.input), GrantRef: open.LegacyGrantRefV1{Realm: g.Realm, Tenant: g.Tenant, Kind: "grant", ID: g.ID, Rev: g.Rev}}
	raw.result = originalclient.TaskAuthorityResult{State: "UNKNOWN", OriginalOperation: strings.Repeat("ab", 32)}
	registration := originalclient.OriginalLocalCallerRegistration{LocalService: "public-task-authority", PeerUID: uint32(os.Geteuid()), PeerPID: os.Getpid(), Actions: []string{"effect", "query"}, Effect: originalclient.OriginalLocalCallerRoute{Method: "POST", Path: "/public-effect", ContentType: "application/json", MaxBodyBytes: 1 << 20}, Query: originalclient.OriginalLocalCallerRoute{Method: "POST", Path: "/public-query", ContentType: "application/json", MaxBodyBytes: 1 << 20}}
	if queryOnly {
		registration.Actions = []string{"query"}
		registration.Effect = originalclient.OriginalLocalCallerRoute{}
	}
	control := &p08CallerTypedBrokerControl{registration: registration, client: &p08OSCallerRequiredClient{raw}}
	local, effect, err := taskCallerRegistration(registration)
	if err != nil {
		t.Fatal(err)
	}
	endpoint, err := openTaskCallerEndpoint(context.Background(), local, control)
	if err != nil {
		t.Fatal(err)
	}
	p08CallerEndpointCleanup(t, endpoint)
	return &taskIPCBrokerClient{client: control.client, broker: control, endpoint: endpoint, effectAvailable: effect}, control, call
}

func TestP08TaskCallerTypedRPCUsesActualOSHandler(t *testing.T) {
	client, control, call := newP08CallerTypedJourney(t, false)
	if _, err := control.client.AuthorizeAtEffect(context.Background(), call); err == nil {
		t.Fatal("ordinary caller context reached protected boundary")
	}
	result, err := client.AuthorizeAtEffect(context.Background(), call)
	if err != nil || result.State != "UNKNOWN" || result.OriginalOperation != control.client.result.OriginalOperation || len(control.client.news) != 1 || control.handled.Load() != 1 {
		t.Fatalf("real caller route failed: %+v %v", result, err)
	}
	call.OriginalOperation = result.OriginalOperation
	result, err = client.QueryOriginalEffect(context.Background(), call)
	if err != nil || result.OriginalOperation != call.OriginalOperation || len(control.client.queries) != 1 || len(control.client.news) != 1 || control.handled.Load() != 2 {
		t.Fatalf("original query did not use registered caller: %+v %v", result, err)
	}
}

func TestP08TaskCallerTypedRPCAckIsNotReceipt(t *testing.T) {
	client, control, call := newP08CallerTypedJourney(t, false)
	control.ackStatus = 200
	result, err := client.AuthorizeAtEffect(context.Background(), call)
	if err == nil || result.State != "UNKNOWN" || result.OriginalOperation != control.client.result.OriginalOperation || result.Resource != nil || len(control.client.news) != 1 {
		t.Fatalf("HTTP claimed business result or lost partial: %+v %v", result, err)
	}
}

func TestP08TaskCallerQueryOnlyNeverDispatchesEffect(t *testing.T) {
	client, control, call := newP08CallerTypedJourney(t, true)
	if _, err := client.AuthorizeAtEffect(context.Background(), call); !errors.Is(err, errTaskEffectSourceUnavailable) || control.handled.Load() != 0 {
		t.Fatalf("query-only caller admitted NEW: %v", err)
	}
	call.OriginalOperation = control.client.result.OriginalOperation
	if _, err := client.QueryOriginalEffect(context.Background(), call); err != nil || len(control.client.queries) != 1 || len(control.client.news) != 0 {
		t.Fatalf("independent original query unavailable: %v", err)
	}
}

func TestP08TaskCallerSourceCausePrecedesFailureAck(t *testing.T) {
	client, control, call := newP08CallerTypedJourney(t, false)
	cause := errors.New("PUBLIC original whole-proof failure")
	control.client.effectErr = cause
	control.ackStatus = 409
	result, err := client.AuthorizeAtEffect(context.Background(), call)
	if !errors.Is(err, cause) || !strings.HasPrefix(err.Error(), cause.Error()) || result.OriginalOperation != control.client.result.OriginalOperation || len(control.client.news) != 1 {
		t.Fatalf("Source cause/partial replaced by failure ack: %+v %v", result, err)
	}
}
