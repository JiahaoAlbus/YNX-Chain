package commerce

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
)

const OriginalShopInvoiceReadPath = "/v5/shop/source/shop.order/invoice-intents/"

var ErrShopInvoiceReadSourceNotSupplied = errors.New("SHOP_ORIGINAL_NATIVE_INVOICE_READ_SOURCE_NOT_SUPPLIED")
var errShopInvoiceReadDenied = errors.New("SHOP_ORIGINAL_NATIVE_INVOICE_READ_DENIED")

// Private consumer projection of the EXISTING Auth/SDK qualification. These
// are not a wire schema, Source constructor, signed domain or request fields.
// Only the normal Auth adapter may derive them from genuine held registration.
type originalShopInvoiceReadProfile struct {
	realm, tenant, purpose string
	epoch                  uint64
	socket, service        string
	uid                    uint32
	pid                    int
	orders                 []string
}
type originalShopInvoiceReadScope struct {
	realm, tenant, purpose                       string
	epoch                                        uint64
	actor, role, storeID, productID, sourceOrder string
}
type originalShopInvoiceReadAuthority interface {
	current(context.Context) error
	profile(context.Context) (originalShopInvoiceReadProfile, error)
	open(context.Context, *http.Request, string, string) (originalShopInvoiceReadHold, error)
	retire() error
	close() error
}
type originalShopInvoiceReadHold interface {
	scope() (originalShopInvoiceReadScope, error)
	// Synchronous local current/epoch/retirement check. No I/O, refresh or
	// reentry into this Store while its original read lock is held.
	current(context.Context) error
	close() error
}

// OpenOriginalShopInvoiceReadService calls the sole normal factory. No caller
// supplied principal/profile/provider/ENV can create a business authority.
// open borrows the same already-open original Store; it is not another engine.
// Partial ownership escapes on error so the normal parent can drain/close it.
func OpenOriginalShopInvoiceReadService(ctx context.Context, open func() (*Store, error)) (*OriginalShopInvoiceReadService, error) {
	a, err := openOriginalShopInvoiceReadAuthority(ctx)
	if err != nil {
		return &OriginalShopInvoiceReadService{authority: a, sessionRequired: true}, err
	}
	return prepareOriginalShopSessionReadService(ctx, a, open)
}

// The normal factory's session binding is part of construction, independently
// of the original Source-only fixture preparer. Partials remain owned.
func prepareOriginalShopSessionReadService(ctx context.Context, a originalShopInvoiceReadAuthority, open func() (*Store, error)) (*OriginalShopInvoiceReadService, error) {
	s, err := prepareOriginalShopInvoiceReadServiceMode(ctx, a, open, true)
	if err == nil {
		s.sessionDomain, err = s.store.bindOriginalShopSessionDomain(a, s.profile)
	}
	return s, err
}

type OriginalShopInvoiceReadService struct {
	// Set only by the normal constructor, including all returned partials.
	// A live listener is a cleanup obligation, not a successful Session bind.
	sessionRequired   bool
	sessionDomain     *originalShopSessionDomain
	authority         originalShopInvoiceReadAuthority
	profile           originalShopInvoiceReadProfile
	store             *Store
	link              *securelink.LocalCallerServer
	listener          net.Listener
	retired           atomic.Bool
	closeMu           sync.Mutex
	stateMu           sync.Mutex
	children          map[uint64]originalShopInvoiceReadHold
	childID           atomic.Uint64
	first, closeFirst error
	closed            bool
}

func prepareOriginalShopInvoiceReadService(ctx context.Context, a originalShopInvoiceReadAuthority, open func() (*Store, error)) (*OriginalShopInvoiceReadService, error) {
	return prepareOriginalShopInvoiceReadServiceMode(ctx, a, open, false)
}

func prepareOriginalShopInvoiceReadServiceMode(ctx context.Context, a originalShopInvoiceReadAuthority, open func() (*Store, error), sessionRequired bool) (s *OriginalShopInvoiceReadService, err error) {
	s = &OriginalShopInvoiceReadService{authority: a, sessionRequired: sessionRequired}
	if ctx == nil || a == nil || open == nil {
		return s, ErrShopInvoiceReadSourceNotSupplied
	}
	if err = a.current(ctx); err != nil {
		return s, err
	}
	p, err := a.profile(ctx)
	if err != nil {
		return s, err
	}
	p.orders = append([]string(nil), p.orders...)
	s.profile = p
	if p.realm == "" || p.tenant == "" || p.purpose == "" || p.epoch == 0 || p.socket == "" || p.service == "" || p.uid == 0 || p.pid <= 0 {
		return s, errShopInvoiceReadDenied
	}
	if len(p.orders) == 0 || len(p.orders) > 64 {
		return s, errShopInvoiceReadDenied
	}
	bodyLimit := int64(1)
	if sessionRequired {
		bodyLimit = 0
	}
	routes := make([]securelink.LocalCallerRoute, 0, len(p.orders))
	seen := map[string]bool{}
	for _, order := range p.orders {
		path, e := OriginalShopInvoiceReadPathFor("shop.order", order)
		if e != nil || seen[path] {
			return s, errShopInvoiceReadDenied
		}
		seen[path] = true
		routes = append(routes, securelink.LocalCallerRoute{Method: "GET", Path: path, MaxBodyBytes: bodyLimit, Timeout: 10 * time.Second})
	}
	s.store, err = open()
	if err != nil {
		return s, err
	}
	if s.store == nil {
		return s, ErrUnavailable
	}
	if err = a.current(ctx); err != nil {
		return s, err
	}
	cfg := securelink.LocalCallerServerConfig{
		Service: p.service, PeerUID: p.uid, PeerPID: p.pid, Routes: routes,
		Handler: http.HandlerFunc(s.serveHTTP), MaxHeaderBytes: 64 << 10,
	}
	if sessionRequired {
		cfg.MaxHeaderBytes = securelink.MaxProductSessionProofV4RequestHeaderBytes
		s.link, err = securelink.NewProductSessionProofV4LocalCallerServer(cfg)
	} else {
		s.link, err = securelink.NewLocalCallerServer(cfg)
	}
	if err != nil {
		return s, err
	}
	s.listener, err = securelink.ListenPrivate(p.socket, p.uid)
	if err != nil {
		return s, err
	}
	if err = a.current(ctx); err != nil {
		return s, err
	}
	return s, nil
}

func (s *OriginalShopInvoiceReadService) Serve() error {
	if s == nil || s.retired.Load() || s.link == nil || s.listener == nil || s.sessionRequired && (s.sessionDomain == nil || s.sessionDomain.retired.Load()) {
		return ErrShopInvoiceReadSourceNotSupplied
	}
	return s.link.Serve(s.listener)
}

// Retire/Join always precede parent authority close; timeout leaves real drain
// debt held. The Store is borrowed and is never closed/reopened by this service.
func (s *OriginalShopInvoiceReadService) Close(ctx context.Context) error {
	if s == nil {
		return nil
	}
	s.closeMu.Lock()
	defer s.closeMu.Unlock()
	if s.closed {
		return s.finalCloseError()
	}
	s.retired.Store(true)
	if s.store != nil {
		s.store.retireOriginalShopSessionDomain(s.sessionDomain)
	}
	remember := func(err error) {
		if err != nil && s.closeFirst == nil {
			s.closeFirst = err
		}
	}
	if s.authority != nil {
		remember(s.authority.retire())
	}
	if s.link != nil {
		remember(s.link.Retire())
	}
	if s.listener != nil {
		_ = s.listener.Close()
	}
	if s.link != nil {
		if err := s.link.Join(ctx); err != nil {
			remember(err)
			return s.finalCloseError()
		}
	}
	s.stateMu.Lock()
	pending := make(map[uint64]originalShopInvoiceReadHold, len(s.children))
	for id, held := range s.children {
		pending[id] = held
	}
	s.stateMu.Unlock()
	for id, held := range pending {
		// A previously pending original may finish asynchronously. Observe its
		// genuine witness before selecting another close attempt.
		witness, hasWitness := held.(originalShopClosedWitness)
		if !hasWitness || witness.assertOriginalClosed() != nil {
			err := held.close()
			remember(err)
			if !originalShopCloseComplete(held, err) {
				return s.finalCloseError()
			}
		}
		s.stateMu.Lock()
		delete(s.children, id)
		s.stateMu.Unlock()
	}
	if s.store != nil {
		err, done := s.store.closeOriginalShopSessionDomain(s.sessionDomain)
		remember(err)
		if !done {
			return s.finalCloseError()
		}
	}
	if s.authority != nil {
		witness, hasWitness := s.authority.(originalShopClosedWitness)
		if !hasWitness || witness.assertOriginalClosed() != nil {
			err := s.authority.close()
			remember(err)
			if !originalShopCloseComplete(s.authority, err) {
				return s.finalCloseError()
			}
		}
	}
	s.closed = true
	if s.store != nil {
		s.store.releaseOriginalShopSessionDomain(s.sessionDomain)
	}
	return s.finalCloseError()
}

func (s *OriginalShopInvoiceReadService) finalCloseError() error {
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	if s.first != nil {
		return s.first
	}
	return s.closeFirst
}
func (s *OriginalShopInvoiceReadService) track(held originalShopInvoiceReadHold) uint64 {
	if held == nil {
		return 0
	}
	id := s.childID.Add(1)
	s.stateMu.Lock()
	if s.children == nil {
		s.children = map[uint64]originalShopInvoiceReadHold{}
	}
	s.children[id] = held
	s.stateMu.Unlock()
	return id
}
func (s *OriginalShopInvoiceReadService) release(id uint64, held originalShopInvoiceReadHold) error {
	if held == nil {
		return nil
	}
	err := held.close()
	complete := originalShopCloseComplete(held, err)
	s.stateMu.Lock()
	if complete {
		delete(s.children, id)
	}
	if err != nil && s.first == nil {
		s.first = err
	}
	s.stateMu.Unlock()
	if err != nil && !complete {
		s.retired.Store(true)
		if s.link != nil {
			_ = s.link.Retire()
		}
	}
	return err
}

// The existing two-key Main selector maps to a GET resource path. The product
// is fixed; only Root-registered original order paths are admitted by LINK.
// This helper encodes DATA selection, never Source/transport/role authority.
func OriginalShopInvoiceReadPathFor(product, order string) (string, error) {
	if product != "shop.order" || !invoiceRecoveryID.MatchString(order) {
		return "", ErrInvalidState
	}
	return OriginalShopInvoiceReadPath + order, nil
}

func (s *OriginalShopInvoiceReadService) serveHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	deny := func(err error) {
		code := status(err)
		if errors.Is(err, ErrShopInvoiceReadSourceNotSupplied) || (s != nil && s.retired.Load()) {
			code = 503
		} else if isOriginalShopInvoiceReadDenied(err) {
			code = 403
		}
		fail(w, code, err)
	}
	if r.Method != "GET" || r.URL == nil || !strings.HasPrefix(r.URL.Path, OriginalShopInvoiceReadPath) || r.URL.RawQuery != "" || r.URL.ForceQuery {
		deny(errShopInvoiceReadDenied)
		return
	}
	if s == nil || s.retired.Load() || s.authority == nil || s.store == nil || s.sessionRequired && (s.sessionDomain == nil || s.sessionDomain.retired.Load()) {
		deny(ErrShopInvoiceReadSourceNotSupplied)
		return
	}
	caller, err := securelink.LocalCallerFromRequest(r)
	if err != nil {
		deny(errShopInvoiceReadDenied)
		return
	}
	before, err := caller.Current(r.Context())
	if err != nil {
		deny(errShopInvoiceReadDenied)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 2))
	if err != nil || len(body) != 0 || r.ContentLength != 0 || !bytes.Equal(body, before.RequestBody) {
		deny(ErrInvalidState)
		return
	}
	product, order := "shop.order", strings.TrimPrefix(r.URL.Path, OriginalShopInvoiceReadPath)
	path, err := OriginalShopInvoiceReadPathFor(product, order)
	if err != nil || path != r.URL.Path {
		deny(ErrInvalidState)
		return
	}
	if err = s.authority.current(r.Context()); err != nil {
		deny(errShopInvoiceReadDenied)
		return
	}
	held, err := s.authority.open(r.Context(), r, product, order)
	childID := s.track(held)
	// Adopt a partial held child before considering its error.
	closed := false
	closeHeld := func() error {
		if held == nil || closed {
			return nil
		}
		closed = true
		return s.release(childID, held)
	}
	defer func() { _ = closeHeld() }()
	if err != nil {
		err = errors.Join(err, closeHeld())
		deny(err)
		return
	}
	if held == nil {
		deny(errShopInvoiceReadDenied)
		return
	}
	scope, err := held.scope()
	p := s.profile
	if err != nil || scope.realm != p.realm || scope.tenant != p.tenant || scope.purpose != p.purpose || scope.epoch != p.epoch || scope.actor == "" || (scope.role != "buyer" && scope.role != "seller") || scope.storeID == "" || scope.productID != product || scope.sourceOrder != order {
		deny(errShopInvoiceReadDenied)
		return
	}
	var session *OriginalShopSession
	if s.sessionDomain != nil {
		session, err = s.store.captureOriginalShopSessionForSourceRead(r.Context(), r, scope, held)
		if session != nil {
			defer session.Close()
		}
		if err != nil {
			deny(err)
			return
		}
		if session == nil {
			deny(ErrUnauthorized)
			return
		}
		if err = session.CurrentOrder(r.Context(), product, order); err != nil {
			deny(err)
			return
		}
	}
	fence := func() error {
		if s.retired.Load() {
			return errShopInvoiceReadDenied
		}
		if err := r.Context().Err(); err != nil {
			return err
		}
		if session != nil {
			if err := session.CurrentLocal(); err != nil {
				return err
			}
		}
		return held.current(r.Context())
	}
	// Scope current is local/no-I/O. ACL, exact original order/bill and DATA
	// copy share this same original Store lock; no nonce/journal/state is written.
	s.store.mu.Lock()
	data, err := func() (NativeShopInvoiceRequestDATA, error) {
		if e := fence(); e != nil {
			return NativeShopInvoiceRequestDATA{}, e
		}
		o, ok := s.store.s.Orders[order]
		if !ok {
			return NativeShopInvoiceRequestDATA{}, ErrNotFound
		}
		if o.StoreID != scope.storeID {
			return NativeShopInvoiceRequestDATA{}, errShopInvoiceReadDenied
		}
		v, e := s.store.readOriginalShopNativeInvoiceRequestLocked(scope.actor, scope.role, order)
		if e != nil {
			return v, e
		}
		if e = fence(); e != nil {
			return NativeShopInvoiceRequestDATA{}, e
		}
		return v, nil
	}()
	s.store.mu.Unlock()
	if err != nil {
		deny(err)
		return
	}
	if session != nil {
		if err = session.CurrentOrder(r.Context(), product, order); err != nil {
			deny(err)
			return
		}
	}
	if err = fence(); err != nil {
		deny(errShopInvoiceReadDenied)
		return
	}
	after, err := caller.Current(r.Context())
	if err != nil || before.Service != after.Service || before.PeerUID != after.PeerUID || before.PeerPID != after.PeerPID || !bytes.Equal(before.RequestBody, after.RequestBody) {
		deny(errShopInvoiceReadDenied)
		return
	}
	encoded, err := json.Marshal(data)
	if err != nil || len(encoded) > maxBody {
		deny(ErrInvalidState)
		return
	}
	if err = closeHeld(); err != nil {
		deny(err)
		return
	}
	if s.retired.Load() || s.authority.current(r.Context()) != nil {
		deny(errShopInvoiceReadDenied)
		return
	}
	if _, err = caller.Current(r.Context()); err != nil {
		deny(errShopInvoiceReadDenied)
		return
	}
	// Keep the Session borrower alive through every Source/caller close/current
	// await. A revoke during those awaits must still invalidate the response.
	if session != nil {
		if session.CurrentLocal() != nil || session.verified.current(r.Context()) != nil {
			deny(errShopInvoiceReadDenied)
			return
		}
		if err = session.Close(); err != nil || !session.PhysicalClosed() {
			deny(errShopInvoiceReadDenied)
			return
		}
	}
	// Existing NativeInvoiceProductIntent DATA only. This is NOT Source proof.
	_, _ = w.Write(encoded)
}

// A sticky first failure is not a physical ownership receipt. Callers retain
// the original service until the real drain/children/Source close completed.
func (s *OriginalShopInvoiceReadService) PhysicalClosed() bool {
	if s == nil {
		return true
	}
	s.closeMu.Lock()
	defer s.closeMu.Unlock()
	return s.closed
}
