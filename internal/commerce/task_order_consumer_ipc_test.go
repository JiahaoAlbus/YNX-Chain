//go:build darwin || linux

package commerce

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	link "github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	originalclient "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-history-client/go"
	native "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-runtime/go"
	openprotocol "github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go"
	policy "ynx.local/authgrantpolicy"
)

// All authority/typed-broker fixtures below are explicitly PUBLIC boundaries.
// Actual production Store/SDK/controller and actual OS Unix LINK run. They do
// not mint Root registration, exercise a protected signer or claim Core math;
// the immutable Auth owner whole/CoreAND/actual-broker evidence is reused.
type publicShopConsumerOwner struct {
	mu      sync.Mutex
	err     error
	closed  int
	retired bool
}

func (p *publicShopConsumerOwner) Current(ctx context.Context) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.retired {
		return ErrUnavailable
	}
	return errors.Join(p.err, ctx.Err())
}
func (p *publicShopConsumerOwner) Retire() error {
	p.mu.Lock()
	p.retired = true
	p.mu.Unlock()
	return nil
}
func (*publicShopConsumerOwner) Join() error      { return nil }
func (p *publicShopConsumerOwner) Close() error   { p.mu.Lock(); p.closed++; p.mu.Unlock(); return nil }
func (p *publicShopConsumerOwner) fail(err error) { p.mu.Lock(); p.err = err; p.mu.Unlock() }

type publicShopConsumerEffect struct {
	publicShopConsumerOwner
	request     native.OriginalTaskRequest
	call        OriginalShopTaskOrderCall
	resolves    int
	profileHook func()
}

func (p *publicShopConsumerEffect) TaskAuthorityProfile(ctx context.Context) (native.TaskAuthorityProfile, error) {
	if p.profileHook != nil {
		p.profileHook()
	}
	return native.TaskAuthorityProfile{Realm: p.call.Binding.Realm, Tenant: p.call.Binding.Tenant, Authority: "PUBLIC-authority"}, p.Current(ctx)
}
func (p *publicShopConsumerEffect) ResolveTaskGrant(ctx context.Context, q native.OriginalTaskRequest) (native.TaskAuthorization, error) {
	if err := p.Current(ctx); err != nil {
		return native.TaskAuthorization{}, err
	}
	if q != p.request {
		return native.TaskAuthorization{}, ErrUnauthorized
	}
	p.resolves++
	return native.TaskAuthorization{Binding: p.call.Binding, Grant: p.call.Grant, Holder: p.call.Holder}, nil
}

type publicShopConsumerHistory struct {
	publicShopConsumerOwner
	request     native.OriginalTaskRequest
	material    native.OriginalTaskQueryMaterial
	queries     int
	profileHook func()
}

func (p *publicShopConsumerHistory) TaskAuthorityQueryProfile(ctx context.Context) (native.TaskAuthorityProfile, error) {
	if p.profileHook != nil {
		p.profileHook()
	}
	return native.TaskAuthorityProfile{Realm: p.material.Binding.Realm, Tenant: p.material.Binding.Tenant, Authority: "PUBLIC-history-authority"}, p.Current(ctx)
}
func (p *publicShopConsumerHistory) ResolveOriginalTaskQueryMaterial(ctx context.Context, q native.OriginalTaskRequest) (native.OriginalTaskQueryMaterial, error) {
	if err := p.Current(ctx); err != nil {
		return native.OriginalTaskQueryMaterial{}, err
	}
	if q != p.request {
		return native.OriginalTaskQueryMaterial{}, ErrUnauthorized
	}
	p.queries++
	return p.material, nil
}

type publicShopConsumerLease struct {
	mu     sync.Mutex
	path   string
	body   []byte
	done   chan struct{}
	result originalclient.TaskAuthorityResult
	err    error
	once   sync.Once
}

func (l *publicShopConsumerLease) RequestDATA() (string, []byte, error) {
	return l.path, bytes.Clone(l.body), nil
}
func (l *publicShopConsumerLease) Wait(ctx context.Context) (originalclient.TaskAuthorityResult, error) {
	select {
	case <-l.done:
		l.mu.Lock()
		defer l.mu.Unlock()
		return l.result, l.err
	case <-ctx.Done():
		return originalclient.TaskAuthorityResult{}, ctx.Err()
	}
}
func (l *publicShopConsumerLease) finish(r originalclient.TaskAuthorityResult, err error) {
	l.once.Do(func() { l.mu.Lock(); l.result, l.err = r, err; l.mu.Unlock(); close(l.done) })
}
func (*publicShopConsumerLease) Close() error { return nil }

type publicShopConsumerBroker struct {
	mu               sync.Mutex
	registration     originalclient.OriginalLocalCallerRegistration
	lease            *publicShopConsumerLease
	result           originalclient.TaskAuthorityResult
	err              error
	hook             func(context.Context)
	effects, queries int
	retired          bool
	t                *testing.T
}

func (b *publicShopConsumerBroker) ReadRegistration(ctx context.Context) (originalclient.OriginalLocalCallerRegistration, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.retired {
		return originalclient.OriginalLocalCallerRegistration{}, ErrUnavailable
	}
	return b.registration, ctx.Err()
}
func (b *publicShopConsumerBroker) Capture(ctx context.Context, call originalclient.TaskAuthorityCall) (shopTaskCallLease, error) {
	if _, err := link.LocalCallerFromContext(ctx); err == nil {
		b.t.Error("capture unexpectedly borrowed a handler capability")
	}
	body, err := originalclient.EncodeOriginalAuthorityBodyDATA(call)
	if err != nil {
		return nil, err
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.retired {
		return nil, ErrUnavailable
	}
	path := b.registration.Effect.Path
	if call.OriginalOperation != "" {
		path = b.registration.Query.Path
		b.queries++
		if call.OriginalOperation != strings.Repeat("a", 64) || call.GrantRef.Rev != "2" {
			return nil, ErrConflict
		}
	} else {
		b.effects++
	}
	b.lease = &publicShopConsumerLease{path: path, body: bytes.Clone(body), done: make(chan struct{})}
	return b.lease, nil
}
func (b *publicShopConsumerBroker) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	caller, err := link.LocalCallerFromRequest(r)
	if err != nil {
		http.Error(w, "unminted", 403)
		return
	}
	fromContext, err := link.LocalCallerFromContext(r.Context())
	if err != nil || fromContext != caller {
		http.Error(w, "wrong context", 403)
		return
	}
	material, err := caller.Current(r.Context())
	if err != nil {
		http.Error(w, "retired", 403)
		return
	}
	b.mu.Lock()
	lease, result, cause, hook := b.lease, b.result, b.err, b.hook
	b.mu.Unlock()
	if lease == nil || material.PeerPID != os.Getpid() || material.PeerUID != uint32(os.Geteuid()) || material.Method != "POST" || material.Path != lease.path || !bytes.Equal(material.RequestBody, lease.body) {
		http.Error(w, "mismatched real caller", 403)
		return
	}
	if hook != nil {
		hook(r.Context())
	}
	lease.finish(result, cause)
	if cause != nil {
		http.Error(w, "original rejected", 503)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (b *publicShopConsumerBroker) Retire() error {
	b.mu.Lock()
	b.retired = true
	b.mu.Unlock()
	return nil
}
func (*publicShopConsumerBroker) Close() error { return nil }

func publicShopConsumerFixture(t *testing.T) (*OriginalShopTaskOrderConsumer, native.OriginalTaskRequest, []byte, *publicShopConsumerEffect, *publicShopConsumerHistory, *publicShopConsumerBroker) {
	t.Helper()
	_, call, codec := publicShopSDKRequest(t)
	s := codec.source.store
	b := call.Binding
	request := native.OriginalTaskRequest{AuthorizationRef: "PUBLIC-original-reference", Realm: b.Realm, Tenant: b.Tenant, Account: b.Account, TaskID: b.Task.ID, TaskRevision: b.Task.Revision, Generation: b.Generation, StepID: b.StepID, Holder: b.Holder.ID, SessionID: b.SessionID, Input: b.Input}
	effect := &publicShopConsumerEffect{request: request, call: call}
	grant, err := openprotocol.DecodeBoundGrant(call.Grant.Payload)
	if err != nil {
		t.Fatal(err)
	}
	history := &publicShopConsumerHistory{request: request, material: native.OriginalTaskQueryMaterial{State: "COMMITTED", OriginalOperationID: strings.Repeat("a", 64), CurrentGrantRef: openprotocol.LegacyGrantRefV1{Realm: grant.Realm, Tenant: grant.Tenant, Kind: "grant", ID: grant.ID, Rev: "2"}, Binding: b, Grant: call.Grant, Holder: call.Holder}}
	projection, err := s.ReadScopedOrder(b.Account, "buyer", b.Resources[0].ID, b.Fields, "")
	if err != nil {
		t.Fatal(err)
	}
	frozen, err := encodeOriginalShopOrderDATA(OriginalShopTaskOrderResponse{Projection: projection, Source: b.Sources[0], AuthScope: policy.EgressOnlyReadFence})
	if err != nil {
		t.Fatal(err)
	}
	op := strings.Repeat("a", 64)
	broker := &publicShopConsumerBroker{t: t, registration: originalclient.OriginalLocalCallerRegistration{LocalService: "PUBLIC-shop-task", PeerUID: uint32(os.Geteuid()), PeerPID: os.Getpid(), Actions: []string{"effect", "query"}, Effect: originalclient.OriginalLocalCallerRoute{Method: "POST", Path: "/task/effect", ContentType: "application/json", MaxBodyBytes: maxBody}, Query: originalclient.OriginalLocalCallerRoute{Method: "POST", Path: "/task/query", ContentType: "application/json", MaxBodyBytes: maxBody}}, result: originalclient.TaskAuthorityResult{State: "COMMITTED", OriginalOperation: op, Original: "opaque-original-not-json", Resource: &originalclient.TaskResourceResult{OperationID: op, RemoteRef: "PUBLIC-original-ref", AuthScope: string(policy.EgressOnlyReadFence), Source: b.Sources[0], ResponseBinding: taskOrderBytesBinding(frozen.ResponseOriginal), ResponseOriginal: bytes.Clone(frozen.ResponseOriginal), SourceBytes: bytes.Clone(frozen.SourceBytes)}}}
	base := "/Volumes/西部数据/YNX-large-work/.p07-caller-public"
	if err := os.MkdirAll(base, 0700); err != nil {
		t.Fatal(err)
	}
	parent, err := os.MkdirTemp(base, "t-")
	if err != nil {
		t.Fatal(err)
	}
	c := &OriginalShopTaskOrderConsumer{store: s, effect: effect, history: history, client: &publicShopConsumerOwner{}, broker: broker, cancels: make(map[uint64]context.CancelFunc)}
	c.endpoint, c.effectEnabled, err = openShopTaskCallerEndpoint(context.Background(), parent, broker.registration, broker)
	if err != nil {
		_ = c.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := c.Close(); err != nil {
			t.Error(err)
		}
		_ = os.RemoveAll(parent)
	})
	return c, request, bytes.Clone(call.Input), effect, history, broker
}

func TestShopTaskOrderConsumerActualUnixReadAndIndependentSameOpRecovery(t *testing.T) {
	c, q, input, effect, history, broker := publicShopConsumerFixture(t)
	result, err := c.Read(context.Background(), q, input)
	if err != nil || result.Resource == nil || result.OriginalOperation != strings.Repeat("a", 64) {
		t.Fatal("normal Unix consumer lost actual typed result", result, err)
	}
	originalBody := bytes.Clone(result.Resource.ResponseOriginal)
	selection, _ := DecodeShopOrderReadSelection(input)
	if _, err := c.store.transition(q.Account, "buyer", selection.OrderID, "cancelled", nil, nil, nil, "consumer-recovery-order-change"); err != nil {
		t.Fatal(err)
	}
	effect.fail(errors.New("PUBLIC original effect projection removed"))
	recovered, err := c.Recover(context.Background(), q, input, result.OriginalOperation)
	if err != nil || recovered.Resource == nil || !bytes.Equal(recovered.Resource.ResponseOriginal, originalBody) || history.queries != 1 || effect.resolves != 1 || broker.effects != 1 || broker.queries != 1 {
		t.Fatal("history re-read today's order or replayed NEW", recovered, err, history.queries, effect.resolves, broker.effects, broker.queries)
	}
	_, err = c.Recover(context.Background(), q, input, strings.Repeat("b", 64))
	if err == nil || broker.effects != 1 || broker.queries != 1 {
		t.Fatal("query rebound original op", err)
	}
}

func TestShopTaskOrderConsumerLateErrorKeepsOnlyOriginalReference(t *testing.T) {
	c, q, input, _, _, broker := publicShopConsumerFixture(t)
	cause := errors.New("PUBLIC original Source late rejection")
	broker.err = cause
	result, err := c.Read(context.Background(), q, input)
	if !errors.Is(err, cause) || result.Resource != nil || result.OriginalOperation != strings.Repeat("a", 64) || result.RemoteRef != "PUBLIC-original-ref" || broker.effects != 1 {
		t.Fatal("late Source body escaped or original ref/cause lost", result, err)
	}
}

func TestShopTaskOrderConsumerUnknownNeverBecomesModelResult(t *testing.T) {
	c, q, input, _, _, broker := publicShopConsumerFixture(t)
	broker.result.State = "UNKNOWN"
	result, err := c.Read(context.Background(), q, input)
	if err == nil || result.Resource != nil || result.State != "UNKNOWN" || result.OriginalOperation != strings.Repeat("a", 64) || broker.effects != 1 {
		t.Fatal("UNKNOWN body promoted or retried", result, err)
	}
}

func TestShopTaskOrderConsumerRejectsResultMutationAndWrongAccount(t *testing.T) {
	for _, fault := range []string{"body", "source", "operation", "account", "ack-only", "late-current", "membership"} {
		t.Run(fault, func(t *testing.T) {
			c, q, input, _, _, broker := publicShopConsumerFixture(t)
			switch fault {
			case "body":
				broker.result.Resource.ResponseOriginal = []byte(`{}`)
			case "source":
				broker.result.Resource.Source.Resource.Revision = "9"
			case "operation":
				broker.result.Resource.OperationID = strings.Repeat("b", 64)
			case "account":
				q.Account = "PUBLIC-other-account"
			case "ack-only":
				broker.result.Resource = nil
			case "late-current":
				broker.hook = func(context.Context) { c.client.(*publicShopConsumerOwner).fail(ErrUnauthorized) }
			case "membership":
				broker.hook = func(context.Context) {
					selection, _ := DecodeShopOrderReadSelection(input)
					c.store.mu.Lock()
					order := c.store.s.Orders[selection.OrderID]
					order.Buyer = "PUBLIC-different-owner"
					c.store.s.Orders[order.ID] = order
					c.store.mu.Unlock()
				}
			}
			result, err := c.Read(context.Background(), q, input)
			if err == nil || result.Resource != nil {
				t.Fatal("mismatched result accepted", fault, result, err)
			}
			if fault == "account" && broker.effects != 0 {
				t.Fatal("unapproved account reached dispatch")
			}
		})
	}
}

func TestShopTaskOrderConsumerOwnsVerifiedResultBytes(t *testing.T) {
	c, q, input, _, _, broker := publicShopConsumerFixture(t)
	result, err := c.Read(context.Background(), q, input)
	if err != nil || result.Resource == nil {
		t.Fatal(err)
	}
	original := bytes.Clone(result.Resource.ResponseOriginal)
	originalSource := bytes.Clone(result.Resource.SourceBytes)
	broker.result.Resource.ResponseOriginal[0] = 'x'
	broker.result.Resource.SourceBytes[0] = 'x'
	broker.result.Resource.Source.Fields[0] = "PUBLIC-mutated-after-verification"
	if !bytes.Equal(result.Resource.ResponseOriginal, original) || !bytes.Equal(result.Resource.SourceBytes, originalSource) || result.Resource.Source.Fields[0] == "PUBLIC-mutated-after-verification" {
		t.Fatal("verified consumer result borrowed Source/broker buffers")
	}
}

func TestShopTaskOrderConsumerFreezesInputBeforeSourceCallbacks(t *testing.T) {
	for _, mode := range []string{"effect", "query"} {
		t.Run(mode, func(t *testing.T) {
			c, q, input, effect, history, _ := publicShopConsumerFixture(t)
			mutate := func() { input[0] = 'x' }
			var result OriginalShopTaskOrderResult
			var err error
			if mode == "effect" {
				effect.profileHook = mutate
				result, err = c.Read(context.Background(), q, input)
			} else {
				history.profileHook = mutate
				result, err = c.Recover(context.Background(), q, input, strings.Repeat("a", 64))
			}
			if err != nil || result.Resource == nil || input[0] != 'x' {
				t.Fatal("Source callback changed the original captured input", mode, result, err)
			}
		})
	}
}

func TestShopTaskOrderConsumerQueryNeverRebindsEvenOnLateError(t *testing.T) {
	c, q, input, effect, _, broker := publicShopConsumerFixture(t)
	broker.result.OriginalOperation = strings.Repeat("b", 64)
	cause := errors.New("PUBLIC late original query error")
	broker.err = cause
	result, err := c.Recover(context.Background(), q, input, strings.Repeat("a", 64))
	if !errors.Is(err, cause) || result.OriginalOperation != strings.Repeat("a", 64) || result.Resource != nil || broker.effects != 0 || broker.queries != 1 || effect.resolves != 0 {
		t.Fatal("original history op was rebound or NEW was used", result, err)
	}
}

func TestShopTaskOrderConsumerCloseDrainsRealUnixHandler(t *testing.T) {
	c, q, input, _, _, broker := publicShopConsumerFixture(t)
	before := transitionDomainSnapshot(t, c.store)
	entered, finished := make(chan struct{}), make(chan struct{})
	broker.hook = func(ctx context.Context) { close(entered); <-ctx.Done(); close(finished) }
	resultDone := make(chan struct{})
	go func() {
		defer close(resultDone)
		r, err := c.Read(context.Background(), q, input)
		if err == nil || r.Resource != nil {
			t.Error("retired handler returned a result")
		}
	}()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("actual Unix handler did not enter")
	}
	if err := c.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-finished:
	default:
		t.Fatal("consumer released Source before handler drained")
	}
	select {
	case <-resultDone:
	case <-time.After(5 * time.Second):
		t.Fatal("retired ordinary-context call did not return")
	}
	if !bytes.Equal(before, transitionDomainSnapshot(t, c.store)) {
		t.Fatal("cancelled read mutated original business state")
	}
}
