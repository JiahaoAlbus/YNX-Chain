//go:build darwin || linux

package commerce

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"reflect"
	"strings"
	"sync"
	"unicode"

	originalclient "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-history-client/go"
	native "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-runtime/go"
	openprotocol "github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go"
	policy "ynx.local/authgrantpolicy"
)

type shopTaskEffectSource interface {
	Current(context.Context) error
	TaskAuthorityProfile(context.Context) (native.TaskAuthorityProfile, error)
	ResolveTaskGrant(context.Context, native.OriginalTaskRequest) (native.TaskAuthorization, error)
	Retire() error
	Close() error
}
type shopTaskHistorySource interface {
	Current(context.Context) error
	TaskAuthorityQueryProfile(context.Context) (native.TaskAuthorityProfile, error)
	ResolveOriginalTaskQueryMaterial(context.Context, native.OriginalTaskRequest) (native.OriginalTaskQueryMaterial, error)
	Retire() error
	Join() error
	Close() error
}
type shopTaskAuthorityClient interface {
	Current(context.Context) error
	Close() error
}

// OriginalShopTaskOrderResult is result DATA from the actual Auth verifier.
// Error/UNKNOWN observations retain only original state/op/remote reference;
// they never retain body, Source, scope, bindings or an opaque receipt as usable
// authority. OriginalOp comes from the original Node once owner, never StepID.
type OriginalShopTaskOrderResult struct {
	State, OriginalOperation, RemoteRef string
	Resource                            *originalclient.TaskResourceResult
}

// OriginalShopTaskOrderConsumer is an in-process normal Shop controller. Its
// exported factory acquires only original zero-input authorities; it exports no
// Source/provider/caller/role setter and installs no anonymous HTTP endpoint.
// The same original Store supplies current order permissions/snapshot checks.
type OriginalShopTaskOrderConsumer struct {
	store         *Store
	effect        shopTaskEffectSource
	history       shopTaskHistorySource
	client        shopTaskAuthorityClient
	broker        shopTaskTypedBroker
	endpoint      *shopTaskCallerEndpoint
	effectError   error
	effectEnabled bool
	mu            sync.Mutex
	retired       bool
	active        sync.WaitGroup
	cancels       map[uint64]context.CancelFunc
	next          uint64
	closeOnce     sync.Once
	closeErr      error
}

// OpenOriginalShopTaskOrderConsumer adopts all partial owners before checking
// errors. runtimeDirectory is only a short filesystem placement supplied by the
// host (external disk during migration), never a Source or socket authority.
// Always Close a nonnil result even on error. History may remain available when
// only the separate NEW-effect projection has expired or disappeared.
func OpenOriginalShopTaskOrderConsumer(ctx context.Context, store *Store, runtimeDirectory string) (*OriginalShopTaskOrderConsumer, error) {
	c := &OriginalShopTaskOrderConsumer{store: store, cancels: make(map[uint64]context.CancelFunc)}
	if ctx == nil || store == nil {
		return c, ErrUnavailable
	}
	if err := ctx.Err(); err != nil {
		return c, err
	}
	effect, effectErr := native.OpenOriginalGrantRuntime()
	if effect != nil {
		c.effect = effect
	}
	c.effectError = effectErr
	history, historyErr := native.OpenOriginalGrantQueryRuntime()
	if history != nil {
		c.history = history
	}
	client, clientErr := originalclient.OpenOriginalTaskAuthorityClient()
	if client != nil {
		c.client = client
	}
	if historyErr != nil || clientErr != nil || history == nil || client == nil {
		return c, errors.Join(effectErr, historyErr, clientErr, ErrUnavailable)
	}
	broker, err := originalclient.OpenOriginalTaskAuthorityBroker(ctx, client)
	if broker != nil {
		c.broker = &originalShopTypedBroker{owner: broker}
	}
	if err != nil || broker == nil {
		return c, errors.Join(effectErr, err, ErrUnavailable)
	}
	registration, err := broker.ReadRegistration(ctx)
	if err != nil {
		return c, errors.Join(effectErr, err)
	}
	c.endpoint, c.effectEnabled, err = openShopTaskCallerEndpoint(ctx, runtimeDirectory, registration, c.broker)
	if err != nil {
		return c, errors.Join(effectErr, err)
	}
	if err := c.queryCurrent(ctx); err != nil {
		return c, errors.Join(effectErr, err)
	}
	return c, nil
}

func (c *OriginalShopTaskOrderConsumer) begin(ctx context.Context) (context.Context, func(), error) {
	if c == nil || ctx == nil || c.store == nil {
		return nil, nil, ErrUnavailable
	}
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.retired {
		return nil, nil, ErrUnavailable
	}
	child, cancel := context.WithCancel(ctx)
	c.next++
	id := c.next
	if c.cancels == nil {
		c.cancels = make(map[uint64]context.CancelFunc)
	}
	c.cancels[id] = cancel
	c.active.Add(1)
	return child, func() {
		cancel()
		c.mu.Lock()
		delete(c.cancels, id)
		c.mu.Unlock()
		c.active.Done()
	}, nil
}
func (c *OriginalShopTaskOrderConsumer) queryCurrent(ctx context.Context) error {
	if c == nil || ctx == nil || missingTaskOrderOperand(c.history) || missingTaskOrderOperand(c.client) || missingTaskOrderOperand(c.broker) || c.endpoint == nil {
		return ErrUnavailable
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := c.history.Current(ctx); err != nil {
		return err
	}
	if err := c.client.Current(ctx); err != nil {
		return err
	}
	if _, err := c.broker.ReadRegistration(ctx); err != nil {
		return err
	}
	return c.endpoint.Current(ctx)
}
func (c *OriginalShopTaskOrderConsumer) NewEffectsUnavailable() error {
	if c == nil {
		return ErrUnavailable
	}
	if c.effectError != nil {
		return c.effectError
	}
	if !c.effectEnabled || missingTaskOrderOperand(c.effect) {
		return ErrUnavailable
	}
	return nil
}

func shopTaskRequestInput(q native.OriginalTaskRequest, input []byte, profile native.TaskAuthorityProfile) (native.OriginalTaskRequest, error) {
	if _, err := DecodeShopOrderReadSelection(input); err != nil {
		return q, err
	}
	if q.Input != taskOrderBytesBinding(input) || profile.Realm == "" || profile.Tenant == "" || profile.Authority == "" || q.Realm != "" && q.Realm != profile.Realm || q.Tenant != "" && q.Tenant != profile.Tenant {
		return q, ErrUnauthorized
	}
	q.Realm, q.Tenant = profile.Realm, profile.Tenant
	return q, nil
}

func (s *Store) checkShopTaskConsumerSelection(call OriginalShopTaskOrderCall, history bool) (ShopOrderReadSelection, error) {
	selection, err := DecodeShopOrderReadSelection(call.Input)
	if err != nil {
		return selection, err
	}
	if len(call.Binding.Resources) != 1 {
		return selection, ErrUnauthorized
	}
	if _, err := originalShopSDKProfile(call.Binding.Target, call.Binding.Resources[0].Kind); err != nil {
		return selection, err
	}
	reader := &originalShopTaskOrderReader{tool: ShopOrderReadToolDescriptor(), target: call.Binding.Target, orderKind: call.Binding.Resources[0].Kind}
	if err := reader.selected(call, selection); err != nil {
		return selection, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	order, ok := s.s.Orders[selection.OrderID]
	if !ok {
		return selection, ErrNotFound
	}
	role := "buyer"
	if order.Buyer != call.Binding.Account {
		role = "seller"
	}
	snapshot := selection.Snapshot
	if history {
		// Check current ownership/membership, but never reconstruct an old
		// receipt by reading today's order or requiring today's snapshot hash.
		snapshot = ""
	}
	_, err = s.readScopedOrderLocked(call.Binding.Account, role, selection.OrderID, selection.Fields, snapshot)
	return selection, err
}

func shopTaskOperation(id string) bool {
	b, err := hex.DecodeString(id)
	return len(id) == 64 && err == nil && hex.EncodeToString(b) == id
}
func shopTaskObservation(result originalclient.TaskAuthorityResult) OriginalShopTaskOrderResult {
	out := OriginalShopTaskOrderResult{}
	if !shopTaskOperation(result.OriginalOperation) {
		return out
	}
	out.OriginalOperation = result.OriginalOperation
	if result.State == "COMMITTED" || result.State == "UNKNOWN" || result.State == "FAILED" {
		out.State = result.State
	}
	if result.Resource != nil && result.Resource.OperationID == result.OriginalOperation && len(result.Resource.RemoteRef) <= 4096 && strings.IndexFunc(result.Resource.RemoteRef, unicode.IsControl) == -1 {
		out.RemoteRef = result.Resource.RemoteRef
	}
	return out
}

// Read performs one NEW original authority call. The genuine effect Source
// resolves all proofs/binding; input/request metadata cannot choose authority.
// It does not reserve or mint an operation locally and never retries a send.
func (c *OriginalShopTaskOrderConsumer) Read(ctx context.Context, request native.OriginalTaskRequest, input []byte) (out OriginalShopTaskOrderResult, err error) {
	ctx, done, err := c.begin(ctx)
	if err != nil {
		return out, err
	}
	defer done()
	input = bytes.Clone(input)
	if err := c.NewEffectsUnavailable(); err != nil {
		return out, err
	}
	if err := c.queryCurrent(ctx); err != nil {
		return out, err
	}
	profile, err := c.effect.TaskAuthorityProfile(ctx)
	if err != nil {
		return out, err
	}
	q, err := shopTaskRequestInput(request, input, profile)
	if err != nil {
		return out, err
	}
	auth, err := c.effect.ResolveTaskGrant(ctx, q)
	if err != nil {
		if code, op := policy.Classified(err); code == policy.OriginalOnly && shopTaskOperation(op) {
			out.OriginalOperation = op
		}
		return out, err
	}
	call := copyShopTaskOrderCall(OriginalShopTaskOrderCall{Binding: auth.Binding, Grant: auth.Grant, Holder: auth.Holder, Input: input})
	selection, err := c.store.checkShopTaskConsumerSelection(call, false)
	if err != nil {
		return out, err
	}
	grant, err := openprotocol.DecodeBoundGrant(call.Grant.Payload)
	if err != nil {
		return out, err
	}
	if err := c.effect.Current(ctx); err != nil {
		return out, err
	}
	result, err := c.exchange(ctx, originalclient.TaskAuthorityCall{Grant: call.Grant, Holder: call.Holder, RawInput: bytes.Clone(input), GrantRef: openprotocol.LegacyGrantRefV1{Realm: grant.Realm, Tenant: grant.Tenant, Kind: "grant", ID: grant.ID, Rev: grant.Rev}})
	out = shopTaskObservation(result)
	if err != nil {
		return out, err
	}
	out, err = c.accept(ctx, call, selection, result)
	if err == nil {
		err = c.effect.Current(ctx)
		if err != nil {
			out.Resource = nil
		}
	}
	return out, err
}

// Recover uses only the independently admitted query projection and original
// Node operation. It never calls NEW ResolveTaskGrant/OpenCheck or uses cached
// consumer proofs. A missing observed op is resolved only by that actual query
// Source; a supplied observed op must match it exactly. No Shop POST is repeated.
func (c *OriginalShopTaskOrderConsumer) Recover(ctx context.Context, request native.OriginalTaskRequest, input []byte, observedOperation string) (out OriginalShopTaskOrderResult, err error) {
	ctx, done, err := c.begin(ctx)
	if err != nil {
		return out, err
	}
	defer done()
	input = bytes.Clone(input)
	if observedOperation != "" && !shopTaskOperation(observedOperation) {
		return out, ErrInvalidState
	}
	if err := c.queryCurrent(ctx); err != nil {
		return out, err
	}
	profile, err := c.history.TaskAuthorityQueryProfile(ctx)
	if err != nil {
		return out, err
	}
	q, err := shopTaskRequestInput(request, input, profile)
	if err != nil {
		return out, err
	}
	material, err := c.history.ResolveOriginalTaskQueryMaterial(ctx, q)
	if err != nil {
		return out, err
	}
	if !shopTaskOperation(material.OriginalOperationID) || observedOperation != "" && observedOperation != material.OriginalOperationID {
		return out, ErrConflict
	}
	out.OriginalOperation = material.OriginalOperationID
	call := copyShopTaskOrderCall(OriginalShopTaskOrderCall{Binding: material.Binding, Grant: material.Grant, Holder: material.Holder, Input: input})
	selection, err := c.store.checkShopTaskConsumerSelection(call, true)
	if err != nil {
		return out, err
	}
	result, err := c.exchange(ctx, originalclient.TaskAuthorityCall{Grant: call.Grant, Holder: call.Holder, RawInput: bytes.Clone(input), GrantRef: material.CurrentGrantRef, OriginalOperation: material.OriginalOperationID})
	if result.OriginalOperation != "" && result.OriginalOperation != material.OriginalOperationID {
		return out, errors.Join(err, ErrConflict)
	}
	if result.OriginalOperation != "" {
		out = shopTaskObservation(result)
	}
	if err != nil {
		return out, err
	}
	if result.OriginalOperation != material.OriginalOperationID {
		return out, ErrConflict
	}
	return c.accept(ctx, call, selection, result)
}

func (c *OriginalShopTaskOrderConsumer) accept(ctx context.Context, call OriginalShopTaskOrderCall, selection ShopOrderReadSelection, result originalclient.TaskAuthorityResult) (out OriginalShopTaskOrderResult, err error) {
	out = shopTaskObservation(result)
	if result.State != "COMMITTED" || !shopTaskOperation(result.OriginalOperation) || result.Resource == nil {
		return out, ErrInvalidState
	}
	r := *result.Resource
	if len(r.ResponseOriginal) < 1 || len(r.ResponseOriginal) > maxBody || len(r.SourceBytes) < 1 || len(r.SourceBytes) > maxBody {
		return out, ErrInvalidState
	}
	r.ResponseOriginal, r.SourceBytes = bytes.Clone(r.ResponseOriginal), bytes.Clone(r.SourceBytes)
	r.Source.Fields = append([]string(nil), r.Source.Fields...)
	if r.OperationID != result.OriginalOperation || r.RemoteRef == "" || out.RemoteRef != r.RemoteRef || r.AuthScope != string(policy.EgressOnlyReadFence) || !reflect.DeepEqual(r.Source, call.Binding.Sources[0]) || r.Source.Binding != taskOrderBytesBinding(r.SourceBytes) || r.ResponseBinding != taskOrderBytesBinding(r.ResponseOriginal) {
		return out, ErrConflict
	}
	source := r.Source
	ref := source.Resource
	expected := openprotocol.ShopOrderReadExpectedResponseDATA{Selection: openprotocol.ShopOrderReadSelection{OrderID: selection.OrderID, Fields: selection.Fields, Snapshot: selection.Snapshot}, Source: openprotocol.ShopOrderReadDeclaredSourceDATA{Resource: openprotocol.LegacyGrantRefV1{Realm: ref.Realm, Tenant: ref.Tenant, Kind: ref.Kind, ID: ref.ID, Rev: ref.Revision}, Fields: source.Fields, Label: source.Label, Binding: openprotocol.GrantBindV1{Bytes: source.Binding.Bytes, SHA3_512: source.Binding.SHA3_512, SHA512: source.Binding.SHA512}}}
	decoded, err := openprotocol.DecodeShopOrderReadResponseDATA(r.ResponseOriginal, expected)
	if err != nil || !bytes.Equal(decoded.SourceBytes, r.SourceBytes) || decoded.AuthFence != r.AuthScope {
		return out, errors.Join(ErrConflict, err)
	}
	if _, err := c.store.checkShopTaskConsumerSelection(call, true); err != nil {
		return out, err
	}
	if err := c.queryCurrent(ctx); err != nil {
		return out, err
	}
	out.Resource = &r
	return out, nil
}

// Close retires product admission/cancels its actual calls, drains LINK and the
// original broker, then releases Source owners. It preserves operator socket
// identity, original op/UNKNOWN and the first error; it performs no retry/write.
func (c *OriginalShopTaskOrderConsumer) Close() error {
	if c == nil {
		return nil
	}
	c.closeOnce.Do(func() {
		c.mu.Lock()
		c.retired = true
		for _, cancel := range c.cancels {
			cancel()
		}
		c.mu.Unlock()
		if c.endpoint != nil {
			c.closeErr = errors.Join(c.closeErr, c.endpoint.Retire())
		}
		if !missingTaskOrderOperand(c.broker) {
			c.closeErr = errors.Join(c.closeErr, c.broker.Retire())
		}
		c.active.Wait()
		if c.endpoint != nil {
			c.closeErr = errors.Join(c.closeErr, c.endpoint.Join(context.Background()))
		}
		if !missingTaskOrderOperand(c.broker) {
			c.closeErr = errors.Join(c.closeErr, c.broker.Close())
		}
		if !missingTaskOrderOperand(c.client) {
			c.closeErr = errors.Join(c.closeErr, c.client.Close())
		}
		if !missingTaskOrderOperand(c.effect) {
			c.closeErr = errors.Join(c.closeErr, c.effect.Retire(), c.effect.Close())
		}
		if !missingTaskOrderOperand(c.history) {
			c.closeErr = errors.Join(c.closeErr, c.history.Retire(), c.history.Join(), c.history.Close())
		}
	})
	return c.closeErr
}
