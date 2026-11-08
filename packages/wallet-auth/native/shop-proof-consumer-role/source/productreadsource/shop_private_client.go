package productreadsource

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
)

// ShopPrivateClient is a concrete read-only original Source owner. Its only
// normal constructor below acquires the EXISTING independently qualified
// productreadsource.Authority. Copied Scope/Profile values cannot construct it.
// It does not import Member5, ProductPay14, a server listener, or a caller URL.
type ShopPrivateClient struct {
	source                      *Authority
	ctx                         context.Context
	cancel                      context.CancelFunc
	capture                     OriginalCaptureDATA
	transport                   resourceOriginal
	expectedPeer                securelink.LocalCallerExpectedProcess
	mu                          sync.Mutex
	active                      int
	responses                   map[*ShopOriginalResponse]bool
	retired                     atomic.Bool
	changed                     chan struct{}
	first                       error
	closeSelected, physicalDone bool
	closeError                  error
	cleanupError                error
}

// Every nonnil client is owned before any acquisition error is interpreted.
// Default-empty Root resources refuse in the original Authority constructor.
func OpenOriginalShopPrivateClient(ctx context.Context) (*ShopPrivateClient, error) {
	c := &ShopPrivateClient{responses: map[*ShopOriginalResponse]bool{}, changed: make(chan struct{}, 1)}
	if ctx == nil {
		return c, c.fail(ErrDenied)
	}
	c.ctx, c.cancel = context.WithCancel(ctx)
	var err error
	c.source, err = OpenOriginalProductReadAuthority(c.ctx)
	if err != nil {
		return c, c.fail(err)
	}
	if c.source == nil {
		return c, c.fail(ErrNotSupplied)
	}
	c.capture, err = c.source.CaptureDATA(c.ctx)
	if err != nil {
		return c, c.fail(err)
	}
	if err = c.validateCapture(); err != nil {
		return c, c.fail(err)
	}
	if err = c.captureOriginalClientTransport(ctx); err != nil {
		return c, c.fail(err)
	}
	return c, c.Current(ctx)
}
func (c *ShopPrivateClient) fail(err error) error {
	if err == nil {
		err = ErrDenied
	}
	c.mu.Lock()
	if c.first == nil {
		c.first = err
	}
	first := c.first
	c.mu.Unlock()
	c.retired.Store(true)
	if c.cancel != nil {
		c.cancel()
	}
	return first
}
func (c *ShopPrivateClient) validateCapture() error {
	d := c.capture
	p := d.Profile
	if validateScope(d.Scope) != nil || p.Purpose != Purpose || p.Epoch == 0 || p.Realm == "" || p.Tenant == "" || p.PeerUID == 0 || p.PeerPID <= 0 || p.Socket == "" || p.Service == "" || len(p.Orders) == 0 || len(p.Orders) > 64 {
		return ErrDenied
	}
	selected := map[string]bool{}
	for _, r := range d.Selections {
		if r.ProductID != "shop.order" {
			continue
		}
		if r.Purpose != Purpose || r.Epoch != p.Epoch || r.Realm != p.Realm || r.Tenant != p.Tenant || r.Actor != d.Scope.Account || r.StoreID == "" || (r.Role != "buyer" && r.Role != "seller") || !scopeAllows(d.Scope, r.ProductID, r.SourceOrder) || selected[r.SourceOrder] {
			return ErrDenied
		}
		selected[r.SourceOrder] = true
	}
	for _, order := range p.Orders {
		if !token.MatchString(order) || !selected[order] {
			return ErrDenied
		}
		delete(selected, order)
	}
	if len(selected) != 0 {
		return ErrDenied
	}
	return nil
}
func (c *ShopPrivateClient) Current(ctx context.Context) error {
	if c == nil || ctx == nil {
		return ErrDenied
	}
	if err := ctx.Err(); err != nil {
		return c.fail(err)
	}
	if c.retired.Load() {
		c.mu.Lock()
		first := c.first
		c.mu.Unlock()
		if first != nil {
			return first
		}
		return ErrRetired
	}
	c.mu.Lock()
	source := c.source
	c.mu.Unlock()
	if c.ctx == nil || source == nil {
		return c.fail(ErrNotSupplied)
	}
	if err := c.ctx.Err(); err != nil {
		return c.fail(err)
	}
	if err := source.Current(ctx); err != nil {
		return c.fail(err)
	}
	d, err := source.captureObservedDATA(ctx)
	if err != nil {
		return c.fail(err)
	}
	// The same captured Root-selected resource, account, role/order map is held.
	// A current refresh may advance Source watermarks, never replace this map.
	if !sameShopCapture(c.capture, d) {
		return c.fail(ErrRetired)
	}
	if c.capture.Profile.PeerUID != uint32(os.Geteuid()) || c.capture.Profile.PeerPID != os.Getpid() {
		return c.fail(ErrDenied)
	}
	if c.retired.Load() || ctx.Err() != nil || c.ctx.Err() != nil {
		return c.fail(ErrRetired)
	}
	return nil
}
func sameShopCapture(a, b OriginalCaptureDATA) bool {
	if a.Scope.Version != b.Scope.Version || a.Scope.NetworkID != b.Scope.NetworkID || a.Scope.Account != b.Scope.Account || a.Scope.ProtectedResourceRef != b.Scope.ProtectedResourceRef || a.Profile.Realm != b.Profile.Realm || a.Profile.Tenant != b.Profile.Tenant || a.Profile.Purpose != b.Profile.Purpose || a.Profile.Epoch != b.Profile.Epoch || a.Profile.Socket != b.Profile.Socket || a.Profile.Service != b.Profile.Service || a.Profile.PeerUID != b.Profile.PeerUID || a.Profile.PeerPID != b.Profile.PeerPID || len(a.Scope.Operations) != len(b.Scope.Operations) || len(a.Scope.Products) != len(b.Scope.Products) || len(a.Selections) != len(b.Selections) || len(a.Profile.Orders) != len(b.Profile.Orders) {
		return false
	}
	for i, v := range a.Scope.Operations {
		if v != b.Scope.Operations[i] {
			return false
		}
	}
	for i, v := range a.Scope.Products {
		if v != b.Scope.Products[i] {
			return false
		}
	}
	for i, v := range a.Selections {
		if v != b.Selections[i] {
			return false
		}
	}
	for i, v := range a.Profile.Orders {
		if v != b.Profile.Orders[i] {
			return false
		}
	}
	return true
}

type shopClientHold struct {
	parent *Authority
	epoch  *epoch
	ctx    context.Context
	closed atomic.Bool
}

func (a *Authority) openOriginalShopClientHold(ctx context.Context, order string) (*shopClientHold, error) {
	if a == nil || ctx == nil || !token.MatchString(order) {
		return nil, ErrDenied
	}
	if err := a.atomicCurrent(ctx, nil); err != nil {
		return nil, err
	}
	s := a.state.Load()
	if !scopeAllows(s.scope, "shop.order", order) {
		return nil, ErrDenied
	}
	found := false
	for _, v := range s.resource.Bindings {
		if v.ProductID == "shop.order" && v.SourceOrder == order && v.Actor == s.scope.Account && (v.Role == "buyer" || v.Role == "seller") && v.StoreID != "" {
			if found {
				return nil, ErrDenied
			}
			found = true
		}
	}
	if !found {
		return nil, ErrDenied
	}
	h := &shopClientHold{parent: a, epoch: s, ctx: ctx}
	a.children.Add(1)
	return h, h.current()
}
func (h *shopClientHold) current() error {
	if h == nil || h.closed.Load() || h.parent == nil {
		return ErrRetired
	}
	return h.parent.atomicCurrent(h.ctx, h.epoch)
}
func (h *shopClientHold) release() {
	if h != nil && h.closed.CompareAndSwap(false, true) {
		h.parent.children.Add(-1)
		select {
		case h.parent.changed <- struct{}{}:
		default:
		}
	}
}

// This is transport DATA, not a bill decoder, receipt, Source or session. The
// original sole SDK decoder consumes exact body bytes only after full Current.
type ShopOriginalResponse struct {
	mu           sync.Mutex
	parent       *ShopPrivateClient
	hold         *shopClientHold
	original     securelink.LocalCallerResponse
	exchange     *securelink.OriginalLocalCallerExchange
	releaseBusy  bool
	cleanupFirst error
	ctx          context.Context
	first        error
	released     bool
	finished     atomic.Bool
	cancel       context.CancelFunc
	proofCancel  context.CancelFunc
	stop         func() bool
}

func (c *ShopPrivateClient) ReadOriginalShopNativeInvoiceRequest(ctx context.Context, orderID string) (*ShopOriginalResponse, error) {
	return c.readOriginalShopRequest(ctx, orderID, nil)
}

// Continuation only from recognized same-worker Main proof borrow. Not a public
// header/URL/signer factory or a substitute for actual Source/Session/ACL.
func (c *ShopPrivateClient) readOriginalShopRequest(ctx context.Context, orderID string, proof *securelink.ProductSessionProofV2DATA) (result *ShopOriginalResponse, failure error) {
	defer func() {
		if v := recover(); v != nil {
			failure = c.fail(&shopPanicCause{value: v})
			if result != nil {
				result.first = failure
			}
		}
	}()
	if err := c.Current(ctx); err != nil {
		return nil, err
	}
	r, err := c.readOriginalWithProofAtObserved(ctx, orderID, proof)
	// Always preserve/adopt an original response before late Source checks.
	if err != nil {
		return r, err
	}
	if err = c.Current(ctx); err != nil {
		r.first = err
		return r, err
	}
	if err = r.hold.current(); err != nil {
		r.first = c.fail(err)
		return r, r.first
	}
	return r, nil
}

// Continuation only, reached after the full normal Source gate. PUBLIC tests
// exercise actual LINK peer/request/lifetime here with an explicitly untrusted
// observed Source boundary; there is no runtime bool/provider skip switch.
func (c *ShopPrivateClient) readOriginalAtObserved(ctx context.Context, orderID string) (out *ShopOriginalResponse, err error) {
	return c.readOriginalWithProofAtObserved(ctx, orderID, nil)
}
func (c *ShopPrivateClient) readOriginalWithProofAtObserved(ctx context.Context, orderID string, proof *securelink.ProductSessionProofV2DATA) (out *ShopOriginalResponse, err error) {
	if c == nil || ctx == nil || !token.MatchString(orderID) || c.retired.Load() {
		return nil, ErrDenied
	}
	c.mu.Lock()
	if c.closeSelected || c.active >= 8 {
		c.mu.Unlock()
		return nil, ErrPending
	}
	c.active++
	c.mu.Unlock()
	readCtx, cancel := context.WithCancel(ctx)
	out = &ShopOriginalResponse{parent: c, ctx: readCtx, cancel: cancel}
	out.stop = context.AfterFunc(c.ctx, cancel)
	c.mu.Lock()
	c.responses[out] = true
	c.mu.Unlock()
	defer func() {
		if v := recover(); v != nil {
			err = &shopPanicCause{value: v}
		}
		out.finished.Store(true)
		c.mu.Lock()
		c.active--
		c.mu.Unlock()
		select {
		case c.changed <- struct{}{}:
		default:
		}
		if err != nil {
			out.first = c.fail(err)
		}
	}()
	out.hold, err = c.source.openOriginalShopClientHold(readCtx, orderID)
	if err != nil {
		return out, err
	}
	p := c.transport
	timeout := time.Until(out.hold.epoch.until)
	if timeout > 10*time.Second {
		timeout = 10 * time.Second
	}
	if timeout <= 0 {
		return out, ErrRetired
	}
	// Exact finite Root-selected order slot, no wildcard/URL/query/body input.
	client, err := securelink.NewLocalCallerClient(securelink.LocalCallerClientConfig{SocketPath: p.Socket, Service: p.Service, PeerUID: p.PeerUID, PeerPID: p.PeerPID, Timeout: timeout, MaxHeaderBytes: 16384, MaxResponseBytes: 1 << 20, Routes: []securelink.LocalCallerRoute{{Method: http.MethodGet, Path: shopPath(orderID), MaxBodyBytes: 0, Timeout: timeout}}})
	if err != nil {
		return out, err
	}
	if err = out.hold.current(); err != nil {
		return out, err
	}
	if proof == nil {
		out.exchange, out.original, err = client.CallOriginalOwned(readCtx, http.MethodGet, shopPath(orderID), "", nil, c.expectedPeer)
	} else {
		out.exchange, out.original, err = client.CallOriginalShopGETOwned(readCtx, shopPath(orderID), *proof, c.expectedPeer)
	}
	// Both nonnil exchange and original packet were adopted into SAME response
	// above, BEFORE error/late Source checks. Never open another connection.
	if err != nil {
		return out, err
	}
	if out.exchange == nil {
		return out, ErrDenied
	}
	if err = out.exchange.Current(readCtx); err != nil {
		return out, err
	}
	if err = out.hold.current(); err != nil {
		return out, err
	}
	if !out.original.PacketPresent || !out.original.BodyComplete || out.original.Method != http.MethodGet || out.original.RequestPath != shopPath(orderID) || out.original.StatusCode != http.StatusOK || out.original.Header.Get("Content-Type") != "application/json" || len(out.original.Body) == 0 || len(out.original.Body) > 1<<20 {
		return out, ErrDenied
	}
	return out, nil
}

// Retained only in the original private owner; never serialized to transport,
// logs or an SDK response. It preserves a panic value even if it is falsy.
type shopPanicCause struct{ value any }

func (*shopPanicCause) Error() string { return "SHOP_ORIGINAL_PRIVATE_UNKNOWN" }
func (r *ShopOriginalResponse) originalCurrent() error {
	if r == nil || r.hold == nil || r.released {
		return ErrRetired
	}
	return r.hold.current()
}
func (r *ShopOriginalResponse) ReadOriginalTransportDATA() (securelink.LocalCallerResponse, error) {
	if r == nil {
		return securelink.LocalCallerResponse{}, ErrDenied
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r == nil || r.parent == nil || r.released || !r.finished.Load() {
		return securelink.LocalCallerResponse{}, ErrDenied
	}
	if r.first != nil {
		return securelink.LocalCallerResponse{}, r.first
	}
	if r.exchange == nil {
		return securelink.LocalCallerResponse{}, ErrDenied
	}
	if err := r.exchange.Current(r.ctx); err != nil {
		r.first = r.parent.fail(err)
		return securelink.LocalCallerResponse{}, r.first
	}
	if err := r.parent.Current(r.ctx); err != nil {
		r.first = err
		return securelink.LocalCallerResponse{}, err
	}
	if err := r.originalCurrent(); err != nil {
		r.first = r.parent.fail(err)
		return securelink.LocalCallerResponse{}, r.first
	}
	copy := r.original
	copy.Header = copy.Header.Clone()
	copy.Body = bytes.Clone(copy.Body)
	if err := r.parent.Current(r.ctx); err != nil {
		r.first = err
		return securelink.LocalCallerResponse{}, err
	}
	if err := r.originalCurrent(); err != nil {
		r.first = r.parent.fail(err)
		return securelink.LocalCallerResponse{}, r.first
	}
	if err := r.exchange.Current(r.ctx); err != nil {
		r.first = r.parent.fail(err)
		return securelink.LocalCallerResponse{}, r.first
	}
	return copy, nil
}

func (r *ShopOriginalResponse) originalTransportDrainPending() bool {
	if r == nil {
		return false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.released || r.releaseBusy || r.exchange == nil {
		return false
	}
	l := r.exchange.Lifetime()
	return !l.Joined && !l.Closed && !l.CleanupUnknown
}
func (r *ShopOriginalResponse) Release() (error, bool) {
	if r == nil {
		return nil, true
	}
	c := r.parent
	if c == nil {
		return ErrDenied, false
	}
	r.mu.Lock()
	if !r.finished.Load() {
		r.mu.Unlock()
		return ErrPending, false
	}
	if r.released {
		first := r.first
		r.mu.Unlock()
		return first, true
	}
	if r.releaseBusy {
		r.mu.Unlock()
		return ErrPending, false
	}
	r.releaseBusy = true
	r.mu.Unlock()
	// Actual transport retirement/join/close/witness occurs OUTSIDE Source,
	// response and C inventory locks. Original operation failure is not an ACK.
	done := true
	if x := r.exchange; x != nil {
		_ = x.Retire()
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		joined := x.Join(ctx)
		cancel()
		if !x.Lifetime().Joined {
			done = false
			if r.cleanupFirst == nil {
				r.cleanupFirst = errors.Join(ErrPending, joined)
			}
		} else {
			_ = x.Close()
			if witness := x.AssertOriginalClosed(); witness != nil {
				done = false
				if r.cleanupFirst == nil {
					r.cleanupFirst = errors.Join(ErrUnknown, witness)
				}
			}
		}
	}
	r.mu.Lock()
	r.releaseBusy = false
	if !done {
		cause := r.cleanupFirst
		if r.first != nil {
			cause = errors.Join(r.first, cause)
		}
		r.mu.Unlock()
		return cause, false
	}
	// A prior join timeout was progress, not a permanent physical error. Actual
	// selected UNKNOWN never reaches the successful witness above.
	r.cleanupFirst = nil
	c.mu.Lock()
	if !r.released {
		r.released = true
		if r.stop != nil {
			r.stop()
		}
		if r.cancel != nil {
			r.cancel()
		}
		if r.proofCancel != nil {
			r.proofCancel()
			r.proofCancel = nil
		}
		r.hold.release()
		r.original = securelink.LocalCallerResponse{}
		delete(c.responses, r)
		select {
		case c.changed <- struct{}{}:
		default:
		}
	}
	c.mu.Unlock()
	first := r.first
	r.mu.Unlock()
	return first, true
}
func (c *ShopPrivateClient) Retire() {
	if c == nil {
		return
	}
	c.retired.Store(true)
	if c.cancel != nil {
		c.cancel()
	}
	c.mu.Lock()
	source := c.source
	c.mu.Unlock()
	if source != nil {
		_ = source.Retire()
	}
}
func (c *ShopPrivateClient) Join(ctx context.Context) (error, bool) {
	if c == nil || ctx == nil {
		return ErrDenied, false
	}
	c.Retire()
	for {
		c.mu.Lock()
		done := c.active == 0 && len(c.responses) == 0
		first := c.first
		c.mu.Unlock()
		if done {
			return first, true
		}
		select {
		case <-ctx.Done():
			return ctx.Err(), false
		case <-c.changed:
		}
	}
}
func (c *ShopPrivateClient) Close() (error, bool) {
	if c == nil {
		return nil, true
	}
	c.Retire()
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closeSelected {
		return c.closeError, c.physicalDone
	}
	if c.active != 0 || len(c.responses) != 0 {
		return ErrPending, false
	}
	c.closeSelected = true
	// This owner exclusively acquired the Authority. Preserve original failure
	// independently from real close ACKs; the old files.first is NOT physicaldone.
	done := true
	if a := c.source; a != nil {
		a.mu.Lock()
		if a.children.Load() != 0 {
			c.closeSelected = false
			a.mu.Unlock()
			return ErrPending, false
		}
		a.closed = true
		for i := len(a.files.files) - 1; i >= 0; i-- {
			h := a.files.files[i]
			if h.closed {
				done = false
				continue
			}
			h.closed = true
			if err := h.file.Close(); err != nil {
				done = false
				if c.cleanupError == nil {
					c.cleanupError = errors.Join(ErrUnknown, err)
				}
			}
		}
		for i := len(a.files.dirs) - 1; i >= 0; i-- {
			h := a.files.dirs[i]
			if h.closed {
				done = false
				continue
			}
			h.closed = true
			if err := h.file.Close(); err != nil {
				done = false
				if c.cleanupError == nil {
					c.cleanupError = errors.Join(ErrUnknown, err)
				}
			}
		}
		a.mu.Unlock()
	}
	c.physicalDone = done
	c.closeError = c.first
	if c.closeError == nil {
		c.closeError = c.cleanupError
	}
	if done {
		c.source = nil
	}
	return c.closeError, done
}
