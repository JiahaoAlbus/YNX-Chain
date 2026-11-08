package productreadsource

import (
	"context"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	"net/http"
	"sync"
	"sync/atomic"
	"time"
)

type epoch struct {
	observation *semanticObservation
	until       time.Time
	wallStart   int64
	scope       ScopeDATA
	resource    resourceOriginal
	fingerprint string
}
type semanticObservation struct{ marker byte }
type Authority struct {
	mu       sync.Mutex
	files    originalFiles
	release  release
	previous *previous
	parent   context.Context
	state    atomic.Pointer[epoch]
	retired  atomic.Bool
	closed   bool
	children atomic.Int64
	changed  chan struct{}
	first    error
}
type Hold struct {
	parent      *Authority
	epoch       *epoch
	ctx         context.Context
	request     *http.Request
	caller      *securelink.LocalCaller
	scope       ReadScopeDATA
	closed      atomic.Bool
	released    atomic.Bool
	releaseDone atomic.Bool
	v4          atomic.Pointer[VerifiedShopGET]
	first       atomic.Pointer[holdError]
}
type holdError struct{ err error }

// Only the zero-input private compiled release table can acquire this owner.
// A nonnil owner is returned before an acquisition error so the original caller
// can always retire/drain/close a partially held FD set.
func OpenOriginalProductReadAuthority(ctx context.Context) (*Authority, error) {
	if ctx == nil {
		return nil, ErrDenied
	}
	if e := ctx.Err(); e != nil {
		return nil, e
	}
	if len(originalProductReleases) != 1 {
		return nil, ErrNotSupplied
	}
	r := originalProductReleases[0]
	a := &Authority{release: r, parent: ctx, changed: make(chan struct{}, 1), files: originalFiles{uid: r.uid}}
	if e := a.refresh(ctx); e != nil {
		a.fail(e)
		return a, e
	}
	if e := a.atomicCurrent(ctx, nil); e != nil {
		a.fail(e)
		return a, e
	}
	return a, nil
}
func (a *Authority) fail(e error) error {
	if e == nil {
		e = ErrDenied
	}
	a.retired.Store(true)
	if a.first == nil {
		a.first = e
	}
	return a.first
}
func (a *Authority) atomicCurrent(ctx context.Context, want *epoch) error {
	if a == nil || ctx == nil {
		return ErrDenied
	}
	if e := ctx.Err(); e != nil {
		return e
	}
	if a.parent == nil {
		return ErrDenied
	}
	if e := a.parent.Err(); e != nil {
		return e
	}
	if a.retired.Load() {
		return ErrRetired
	}
	s := a.state.Load()
	if s == nil || want != nil && (s.observation == nil || s.observation != want.observation) {
		return ErrRetired
	}
	now := time.Now()
	if !now.Before(s.until) || now.UnixMilli() < s.wallStart {
		return ErrRetired
	}
	if want != nil && (!now.Before(want.until) || now.UnixMilli() < want.wallStart) {
		return ErrRetired
	}
	return nil
}

// Current performs full fresh Source-v2 verification and protected-file I/O.
// Call OUTSIDE the product Store mutex; Hold.Current is the separate no-I/O fence.
func (a *Authority) Current(ctx context.Context) error {
	if a == nil || ctx == nil {
		return ErrDenied
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closed || a.retired.Load() {
		if a.first != nil {
			return a.first
		}
		return ErrRetired
	}
	// Pre-math physical observation also makes every outside-lock post-read
	// Current reject an already substituted original before any network/SDK work.
	if e := a.files.current(); e != nil {
		return a.fail(e)
	}
	if e := a.refresh(ctx); e != nil {
		return a.fail(e)
	}
	if e := a.atomicCurrent(ctx, nil); e != nil {
		return a.fail(e)
	}
	return nil
}
func (a *Authority) ProfileDATA(ctx context.Context) (ProfileDATA, error) {
	if a == nil {
		return ProfileDATA{}, ErrDenied
	}
	if e := a.Current(ctx); e != nil {
		return ProfileDATA{}, e
	}
	s := a.state.Load()
	p := s.resource
	p.Orders = append([]string(nil), p.Orders...)
	return ProfileDATA{Realm: p.Realm, Tenant: p.Tenant, Purpose: Purpose, Epoch: p.Epoch, Socket: p.Socket, Service: p.Service, PeerUID: p.PeerUID, PeerPID: p.PeerPID, Orders: p.Orders}, nil
}
func shopPath(order string) string { return "/v5/shop/source/shop.order/invoice-intents/" + order }
func (a *Authority) OpenShopRead(ctx context.Context, r *http.Request, product, order string) (*Hold, error) {
	if a == nil || ctx == nil || r == nil || product != "shop.order" || !token.MatchString(order) {
		return nil, ErrDenied
	}
	if e := a.Current(ctx); e != nil {
		return nil, e
	}
	return a.openShopReadAtCurrent(ctx, r, product, order)
}

// Private continuation, reached normally only after full SDK/physical refresh.
// PUBLIC tests exercise the real OS request and atomic fence here without
// pretending their deliberately constructed Root snapshot is admitted.
func (a *Authority) openShopReadAtCurrent(ctx context.Context, r *http.Request, product, order string) (*Hold, error) {
	if a == nil || ctx == nil || r == nil || product != "shop.order" || !token.MatchString(order) {
		return nil, ErrDenied
	}
	caller, e := securelink.LocalCallerFromRequest(r)
	if e != nil {
		return nil, e
	}
	material, e := caller.Current(ctx)
	if e != nil {
		return nil, e
	}
	s := a.state.Load()
	if s == nil {
		return nil, ErrRetired
	}
	p := s.resource
	if material.Service != p.Service || material.PeerUID != p.PeerUID || material.PeerPID != p.PeerPID || material.Method != "GET" || material.Path != shopPath(order) || material.ContentLength != 0 || len(material.RequestBody) != 0 || material.ContentType != "" || r.Method != "GET" || r.URL == nil || r.URL.RawQuery != "" || r.URL.EscapedPath() != shopPath(order) {
		return nil, ErrDenied
	}
	var mapping *resourceOrder
	for i := range p.Bindings {
		b := &p.Bindings[i]
		if b.ProductID == product && b.SourceOrder == order {
			mapping = b
			break
		}
	}
	if mapping == nil || !scopeAllows(s.scope, product, order) {
		return nil, ErrDenied
	}
	h := &Hold{parent: a, epoch: s, ctx: ctx, request: r, caller: caller, scope: ReadScopeDATA{Realm: p.Realm, Tenant: p.Tenant, Purpose: Purpose, Epoch: p.Epoch, Actor: mapping.Actor, Role: mapping.Role, StoreID: mapping.StoreID, ProductID: product, SourceOrder: order}}
	a.children.Add(1)
	if e = h.Current(ctx); e != nil {
		return h, e
	}
	return h, nil
}
func scopeAllows(s ScopeDATA, product, order string) bool {
	read := false
	for _, op := range s.Operations {
		if op == "readOriginalInvoiceIntent" {
			read = true
		}
	}
	if !read {
		return false
	}
	for _, p := range s.Products {
		if p.ProductID == product && p.SourceOrder == order {
			return true
		}
	}
	return false
}
func (h *Hold) ScopeDATA() (ReadScopeDATA, error) {
	if h == nil {
		return ReadScopeDATA{}, ErrDenied
	}
	if e := h.Current(h.ctx); e != nil {
		return ReadScopeDATA{}, e
	}
	return h.scope, nil
}

// Current is deliberately pure: context/clock/atomic epoch and the original
// LINK same-request local getter only. No FD, network, caller fresh-OS poll,
// Source verifier, callback, Store lock or auto-recapture is permitted here.
func (h *Hold) Current(ctx context.Context) error {
	if h == nil || ctx == nil {
		return ErrDenied
	}
	if p := h.first.Load(); p != nil {
		return p.err
	}
	var e error
	if h.closed.Load() {
		e = ErrRetired
	} else if h.ctx == nil {
		e = ErrDenied
	} else if e = h.ctx.Err(); e == nil {
		e = h.parent.atomicCurrent(ctx, h.epoch)
		if e == nil {
			if h.caller == nil {
				e = ErrDenied
			} else {
				e = h.caller.CurrentOriginalCaller(h.request)
			}
		}
	}
	if e != nil {
		h.first.CompareAndSwap(nil, &holdError{e})
		return h.first.Load().err
	}
	return nil
}
func (h *Hold) Close() error {
	if h == nil {
		return nil
	}
	if h.parent == nil || h.ctx == nil {
		return ErrDenied
	}
	h.closed.Store(true)
	if v := h.v4.Load(); v != nil {
		err := v.originalError()
		if v.AssertOriginalClosed() != nil {
			err = v.Close()
		}
		if physical := v.AssertOriginalClosed(); physical != nil {
			if err != nil {
				return err
			}
			return physical
		}
		if err != nil {
			h.first.CompareAndSwap(nil, &holdError{err})
		}
	}
	if h.released.CompareAndSwap(false, true) {
		h.parent.children.Add(-1)
		select {
		case h.parent.changed <- struct{}{}:
		default:
		}
		h.releaseDone.Store(true)
	}
	if p := h.first.Load(); p != nil {
		return p.err
	}
	return nil
}

// SAME original Hold's physical release only, not parent Authority shutdown.
// A retained first error does not block this witness after actual completion.
func (h *Hold) AssertOriginalClosed() error {
	if h == nil || h.parent == nil || h.ctx == nil {
		return ErrDenied
	}
	if !h.closed.Load() || !h.releaseDone.Load() {
		return ErrPending
	}
	if v := h.v4.Load(); v != nil {
		return v.AssertOriginalClosed()
	}
	return nil
}
func (a *Authority) Retire() error {
	if a == nil {
		return nil
	}
	a.retired.Store(true)
	return nil
}
func (a *Authority) Join(ctx context.Context) error {
	if a == nil {
		return nil
	}
	if ctx == nil {
		return ErrDenied
	}
	for a.children.Load() != 0 {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-a.changed:
		}
	}
	return nil
}
func (a *Authority) Close() error {
	if a == nil {
		return nil
	}
	if a.parent == nil || a.changed == nil {
		return ErrDenied
	}
	a.Retire()
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closed {
		return a.first
	}
	if a.children.Load() != 0 {
		return ErrPending
	}
	a.closed = true
	if e := a.files.close(); e != nil && a.first == nil {
		a.first = errors.Join(ErrUnknown, e)
	}
	return a.first
}

// No-I/O witness of THIS Authority's actual child drain and original FD close
// observations. Retained first failure and physical completion are separate.
func (a *Authority) AssertOriginalClosed() error {
	if a == nil || a.parent == nil || a.changed == nil {
		return ErrDenied
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.closed || a.children.Load() != 0 {
		return ErrPending
	}
	return a.files.assertOriginalClosed()
}
