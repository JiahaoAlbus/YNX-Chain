package originalclient

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"net/http"
	"sync"

	link "github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
)

var ErrOriginalBrokerRetired = errors.New("original authority broker retired")
var ErrOriginalBrokerDuplicate = errors.New("original authority call already held or entered; query original result")

// The broker borrows the normal client. Its owner must retire/join the actual
// LINK server and this broker before closing that client. No JSON decoder can
// manufacture a call: the original signed wires and input remain in a lease.
type OriginalTaskAuthorityBroker struct {
	self         *OriginalTaskAuthorityBroker
	mu           sync.Mutex
	client       originalBrokerClient
	registration OriginalLocalCallerRegistration
	pending      map[originalBrokerKey]*OriginalTaskAuthorityCallLease
	entered      map[originalBrokerKey]bool
	retired      bool
	active       sync.WaitGroup
}
type originalBrokerClient interface {
	ReadOriginalLocalCallerRegistration(context.Context) (OriginalLocalCallerRegistration, error)
	qualifyOriginalPendingCall(context.Context, TaskAuthorityCall) error
	AuthorizeAtEffect(context.Context, TaskAuthorityCall) (TaskAuthorityResult, error)
	QueryOriginalEffect(context.Context, TaskAuthorityCall) (TaskAuthorityResult, error)
}
type originalBrokerKey struct {
	path   string
	digest [32]byte
}
type OriginalTaskAuthorityCallLease struct {
	self    *OriginalTaskAuthorityCallLease
	broker  *OriginalTaskAuthorityBroker
	key     originalBrokerKey
	call    TaskAuthorityCall
	body    []byte
	ctx     context.Context
	cancel  context.CancelFunc
	done    chan struct{}
	once    sync.Once
	mu      sync.Mutex
	started bool
	result  TaskAuthorityResult
	err     error
}

func OpenOriginalTaskAuthorityBroker(ctx context.Context, client *TaskAuthorityClient) (*OriginalTaskAuthorityBroker, error) {
	if client == nil {
		return nil, ErrUnavailable
	}
	return openOriginalBroker(ctx, client)
}
func openOriginalBroker(ctx context.Context, client originalBrokerClient) (*OriginalTaskAuthorityBroker, error) {
	if ctx == nil || client == nil {
		return nil, ErrUnavailable
	}
	r, err := client.ReadOriginalLocalCallerRegistration(ctx)
	if err != nil {
		return nil, err
	}
	if r.LocalService == "" || r.PeerPID <= 0 || len(r.Actions) == 0 {
		return nil, ErrBinding
	}
	b := &OriginalTaskAuthorityBroker{client: client, registration: r, pending: make(map[originalBrokerKey]*OriginalTaskAuthorityCallLease), entered: make(map[originalBrokerKey]bool)}
	b.self = b
	return b, nil
}
func (b *OriginalTaskAuthorityBroker) ReadRegistration(ctx context.Context) (OriginalLocalCallerRegistration, error) {
	if b == nil || b.self != b || ctx == nil {
		return OriginalLocalCallerRegistration{}, ErrUnavailable
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.retired {
		return OriginalLocalCallerRegistration{}, ErrOriginalBrokerRetired
	}
	r, err := b.client.ReadOriginalLocalCallerRegistration(ctx)
	if err != nil {
		return OriginalLocalCallerRegistration{}, err
	}
	if !sameOriginalRegistration(r, b.registration) {
		return OriginalLocalCallerRegistration{}, ErrBinding
	}
	r.Actions = append([]string(nil), r.Actions...)
	return r, nil
}
func sameOriginalRegistration(a, b OriginalLocalCallerRegistration) bool {
	if a.LocalService != b.LocalService || a.PeerUID != b.PeerUID || a.PeerPID != b.PeerPID || a.Effect != b.Effect || a.Query != b.Query || a.Expires != b.Expires || len(a.Actions) != len(b.Actions) {
		return false
	}
	for i := range a.Actions {
		if a.Actions[i] != b.Actions[i] {
			return false
		}
	}
	return true
}

// Capture is ordinary-context validation only: no reserve, IPC or effect. The
// returned route/body are DATA for LINK.Call; Wait returns the actual verified
// typed result independently of LINK's HTTP acknowledgement.
func (b *OriginalTaskAuthorityBroker) Capture(ctx context.Context, input TaskAuthorityCall) (*OriginalTaskAuthorityCallLease, error) {
	if b == nil || b.self != b || ctx == nil {
		return nil, ErrUnavailable
	}
	call, err := authorityCall(input, input.OriginalOperation != "")
	if err != nil {
		return nil, err
	}
	body, err := EncodeOriginalAuthorityBodyDATA(call)
	if err != nil {
		return nil, err
	}
	r, err := b.ReadRegistration(ctx)
	if err != nil {
		return nil, err
	}
	route := r.Effect
	if call.OriginalOperation != "" {
		route = r.Query
	}
	if route.Method != "POST" || route.ContentType != "application/json" || route.Path == "" || int64(len(body)) > route.MaxBodyBytes {
		return nil, ErrBinding
	}
	if err = b.client.qualifyOriginalPendingCall(ctx, call); err != nil {
		return nil, err
	}
	child, cancel := context.WithCancel(ctx)
	l := &OriginalTaskAuthorityCallLease{broker: b, key: originalBrokerKey{route.Path, sha256.Sum256(body)}, call: call, body: bytes.Clone(body), ctx: child, cancel: cancel, done: make(chan struct{})}
	l.self = l
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.retired {
		cancel()
		return nil, ErrOriginalBrokerRetired
	}
	if b.pending[l.key] != nil || b.entered[l.key] {
		cancel()
		return nil, ErrOriginalBrokerDuplicate
	}
	// Bounded fail-closed replay memory, never evict a possibly entered effect.
	if len(b.pending)+len(b.entered) >= 4096 {
		cancel()
		return nil, ErrOriginalBrokerDuplicate
	}
	b.pending[l.key] = l
	return l, nil
}
func (l *OriginalTaskAuthorityCallLease) RequestDATA() (string, []byte, error) {
	if l == nil || l.self != l || l.broker == nil {
		return "", nil, ErrUnavailable
	}
	l.broker.mu.Lock()
	defer l.broker.mu.Unlock()
	if l.broker.retired || l.broker.pending[l.key] != l || l.ctx.Err() != nil {
		return "", nil, ErrOriginalBrokerRetired
	}
	return l.key.path, bytes.Clone(l.body), nil
}
func cloneOriginalBrokerResult(r TaskAuthorityResult) TaskAuthorityResult {
	r.Resource = cloneTaskResource(r.Resource)
	r.OriginalServiceResponse = bytes.Clone(r.OriginalServiceResponse)
	return r
}

// Verified observations accompanying an error are recovery metadata, never
// permission to consume a stale resource or model-readable body as success.
func originalBrokerPartial(r TaskAuthorityResult) TaskAuthorityResult {
	p := TaskAuthorityResult{State: r.State, OriginalOperation: r.OriginalOperation, RecoveryOnly: true}
	if r.Resource != nil {
		p.Resource = &TaskResourceResult{OperationID: r.Resource.OperationID, RemoteRef: r.Resource.RemoteRef}
	}
	return p
}
func (l *OriginalTaskAuthorityCallLease) finish(r TaskAuthorityResult, err error) {
	l.once.Do(func() {
		l.mu.Lock()
		l.result = cloneOriginalBrokerResult(r)
		l.err = err
		l.mu.Unlock()
		close(l.done)
	})
}
func (l *OriginalTaskAuthorityCallLease) Wait(ctx context.Context) (TaskAuthorityResult, error) {
	if l == nil || l.self != l || ctx == nil {
		return TaskAuthorityResult{}, ErrUnavailable
	}
	// Prefer already published observations over a simultaneously cancelled
	// waiter; cancellation must not erase the original operation/UNKNOWN facts.
	select {
	case <-l.done:
	default:
		select {
		case <-l.done:
		case <-ctx.Done():
			select {
			case <-l.done:
			default:
				return TaskAuthorityResult{}, ctx.Err()
			}
		}
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return originalBrokerPartial(l.result), errors.Join(l.err, err)
	}
	return cloneOriginalBrokerResult(l.result), l.err
}
func (l *OriginalTaskAuthorityCallLease) Close() error {
	if l == nil || l.broker == nil {
		return nil
	}
	if l.self != l {
		return ErrBinding
	}
	b := l.broker
	b.mu.Lock()
	l.cancel()
	if !l.started && b.pending[l.key] == l {
		delete(b.pending, l.key)
		l.finish(TaskAuthorityResult{}, context.Canceled)
	}
	b.mu.Unlock()
	return nil
}

// ServeHTTP must be installed directly on the real LINK LocalCallerServer.
// Plain requests and requests cloned with the same context fail closed.
func (b *OriginalTaskAuthorityBroker) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if b == nil || b.self != b || r == nil {
		w.WriteHeader(403)
		return
	}
	c, err := link.LocalCallerFromRequest(r)
	if err != nil {
		w.WriteHeader(403)
		return
	}
	m, err := c.Current(r.Context())
	if err != nil {
		w.WriteHeader(403)
		return
	}
	reg, err := b.ReadRegistration(r.Context())
	if err != nil {
		w.WriteHeader(403)
		return
	}
	if m.Service != reg.LocalService || m.PeerUID != reg.PeerUID || m.PeerPID != reg.PeerPID || m.Method != "POST" || m.ContentType != "application/json" || m.ContentLength != int64(len(m.RequestBody)) {
		w.WriteHeader(403)
		return
	}
	key := originalBrokerKey{m.Path, sha256.Sum256(m.RequestBody)}
	b.mu.Lock()
	l := b.pending[key]
	if b.retired || l == nil || l.started || l.ctx.Err() != nil || !bytes.Equal(l.body, m.RequestBody) {
		b.mu.Unlock()
		w.WriteHeader(403)
		return
	}
	l.started = true
	if l.call.OriginalOperation == "" {
		b.entered[key] = true
	}
	b.active.Add(1)
	b.mu.Unlock()
	defer b.active.Done()
	ctx, cancel := context.WithCancel(r.Context())
	stop := context.AfterFunc(l.ctx, cancel)
	defer cancel()
	defer stop()
	var result TaskAuthorityResult
	// A panic is terminal for this lease, never permission to retry the effect.
	defer func() {
		if recover() != nil {
			l.finish(TaskAuthorityResult{}, ErrUnavailable)
			w.WriteHeader(500)
		}
		b.mu.Lock()
		if b.pending[key] == l {
			delete(b.pending, key)
		}
		b.mu.Unlock()
	}()
	if l.call.OriginalOperation == "" {
		result, err = b.client.AuthorizeAtEffect(ctx, l.call)
	} else {
		result, err = b.client.QueryOriginalEffect(ctx, l.call)
	}
	if err == nil {
		_, err = c.Current(ctx)
	}
	if err == nil {
		err = ctx.Err()
	}
	if err != nil {
		result = originalBrokerPartial(result)
	}
	l.finish(result, err)
	// No business result or bool is transported as an unverified HTTP claim.
	if err != nil {
		w.WriteHeader(409)
		return
	}
	w.WriteHeader(204)
}
func (b *OriginalTaskAuthorityBroker) Retire() error {
	if b == nil {
		return nil
	}
	if b.self != b {
		return ErrBinding
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.retired = true
	for key, l := range b.pending {
		l.cancel()
		if !l.started {
			delete(b.pending, key)
			l.finish(TaskAuthorityResult{}, ErrOriginalBrokerRetired)
		}
	}
	return nil
}
func (b *OriginalTaskAuthorityBroker) Join() error {
	if b != nil && b.self != b {
		return ErrBinding
	}
	if b != nil {
		b.active.Wait()
	}
	return nil
}
func (b *OriginalTaskAuthorityBroker) Close() error {
	if b == nil {
		return nil
	}
	if b.self != b {
		return ErrBinding
	}
	_ = b.Retire()
	return b.Join()
}
