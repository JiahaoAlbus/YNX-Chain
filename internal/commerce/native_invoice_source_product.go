package commerce

import (
	"context"
	"encoding/hex"
	"net/http"
	"sync/atomic"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
)

const shopProductSourcePurpose = "wallet-native-product-source-v1"
const shopProductSourceSelection = "walletNativeProductV1"

// In-process projection of Auth's EXISTING ProductScopeDATA. This is not a
// decoder, a new signed schema or a qualification constructor. Only the sole
// SDK/Native Source-v2 verifier may produce it through the owning Auth bridge.
type originalShopProductScopeDATA struct {
	version                                  uint32
	networkID, account, protectedResourceRef string
	operations                               []string
	products                                 []originalShopProductReference
}
type originalShopProductReference struct{ productID, sourceOrder string }

// The independent Root-selected protected resource map supplies every service
// identity and original product role. No role is inferred from Wallet Member,
// CodeRoot, TLS, the requested path, or the scope's public account alone.
type originalShopProductResource struct {
	ref, networkID, account string
	profile                 originalShopInvoiceReadProfile
	selections              []originalShopInvoiceReadScope
}
type originalShopProductContext struct {
	purpose, selection string
	sourceEpoch        uint64
	scope              originalShopProductScopeDATA
	resource           originalShopProductResource
}
type originalShopProductReadSource interface {
	current(context.Context) error // full independent Source/current, outside Store
	capture(context.Context) (originalShopProductContext, error)
	// Owns the SAME original LINK request and actual Main/Source epoch ANDs.
	// A partial permission must escape even on failure. No JSON scope is a loan.
	borrow(context.Context, *http.Request, originalShopProductReference) (originalShopProductPermission, error)
	retire() error
	close() error // actual Auth child drain/one-shot parent close, sticky first cause
}
type originalShopProductPermission interface {
	current(context.Context) error // pure Native observed epoch/deadline; no I/O
	close() error
}
type originalShopProductReadAuthority struct {
	source       originalShopProductReadSource
	profileValue originalShopInvoiceReadProfile
	selected     map[string]originalShopInvoiceReadScope
	retired      atomic.Bool
}

func (a *originalShopProductReadAuthority) capture(ctx context.Context) error {
	if err := a.current(ctx); err != nil {
		return err
	}
	c, err := a.source.capture(ctx)
	if err != nil {
		return err
	}
	if err = a.current(ctx); err != nil {
		return err
	}
	s, r, p := c.scope, c.resource, c.resource.profile
	network, ne := hex.DecodeString(s.networkID)
	account, ae := accountaddress.Normalize(s.account)
	if c.purpose != shopProductSourcePurpose || c.selection != shopProductSourceSelection || c.sourceEpoch == 0 ||
		s.version != 1 || ne != nil || len(network) != 32 || hex.EncodeToString(network) != s.networkID || ae != nil || account != s.account || len(account) != 42 ||
		s.protectedResourceRef == "" || r.ref != s.protectedResourceRef || r.networkID != s.networkID || r.account != s.account ||
		p.purpose != c.purpose || p.epoch != c.sourceEpoch || p.realm == "" || p.tenant == "" || len(s.products) == 0 || len(s.products) > 64 {
		return errShopInvoiceReadDenied
	}
	allowed := false
	for _, op := range s.operations {
		if op == "readOriginalInvoiceIntent" {
			if allowed {
				return errShopInvoiceReadDenied
			}
			allowed = true
		}
	}
	if !allowed {
		return errShopInvoiceReadDenied
	}
	selected := map[string]originalShopInvoiceReadScope{}
	for _, v := range r.selections {
		if v.productID != "shop.order" || v.sourceOrder == "" || v.realm != p.realm || v.tenant != p.tenant || v.purpose != c.purpose || v.epoch != c.sourceEpoch || v.storeID == "" ||
			(v.role != "buyer" && v.role != "seller") || !sameBusinessAccount(v.actor, s.account) {
			return errShopInvoiceReadDenied
		}
		if _, exists := selected[v.sourceOrder]; exists {
			return errShopInvoiceReadDenied
		}
		selected[v.sourceOrder] = v
	}
	orders := make([]string, 0, len(s.products))
	seen := map[originalShopProductReference]bool{}
	for _, v := range s.products {
		if seen[v] {
			return errShopInvoiceReadDenied
		}
		seen[v] = true
		if v.productID != "shop.order" {
			if v.productID != "cloud.ide-usage" {
				return errShopInvoiceReadDenied
			}
			continue
		}
		if _, err := OriginalShopInvoiceReadPathFor(v.productID, v.sourceOrder); err != nil {
			return err
		}
		if _, exists := selected[v.sourceOrder]; !exists {
			return errShopInvoiceReadDenied
		}
		orders = append(orders, v.sourceOrder)
	}
	// An extra service map row must not silently add a Root-unselected order.
	if len(orders) == 0 || len(orders) != len(selected) {
		return errShopInvoiceReadDenied
	}
	p.orders = orders
	a.profileValue = p
	a.selected = selected
	return a.current(ctx)
}
func (a *originalShopProductReadAuthority) current(ctx context.Context) error {
	if a == nil || a.source == nil {
		return ErrShopInvoiceReadSourceNotSupplied
	}
	if ctx == nil || a.retired.Load() {
		return errShopInvoiceReadDenied
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := a.source.current(ctx); err != nil {
		return err
	}
	return ctx.Err()
}
func (a *originalShopProductReadAuthority) profile(ctx context.Context) (originalShopInvoiceReadProfile, error) {
	if err := a.current(ctx); err != nil {
		return originalShopInvoiceReadProfile{}, err
	}
	p := a.profileValue
	p.orders = append([]string(nil), p.orders...)
	return p, nil
}
func (a *originalShopProductReadAuthority) open(ctx context.Context, r *http.Request, product, order string) (originalShopInvoiceReadHold, error) {
	if err := a.current(ctx); err != nil {
		return nil, err
	}
	selected, ok := a.selected[order]
	if !ok || product != "shop.order" || selected.productID != product {
		return nil, errShopInvoiceReadDenied
	}
	caller, err := securelink.LocalCallerFromRequest(r)
	if err != nil {
		return nil, errShopInvoiceReadDenied
	}
	peer, err := caller.Current(ctx)
	p := a.profileValue
	path, pathErr := OriginalShopInvoiceReadPathFor(product, order)
	if err != nil || pathErr != nil || r.URL == nil || r.URL.Path != path || r.Method != "GET" || peer.Service != p.service || peer.PeerUID != p.uid || peer.PeerPID != p.pid {
		return nil, errShopInvoiceReadDenied
	}
	loan, err := a.source.borrow(ctx, r, originalShopProductReference{product, order})
	held := &originalShopProductReadHold{authority: a, permission: loan, selected: selected, request: r.Context()}
	if err != nil {
		return held, err
	}
	if err = a.current(ctx); err != nil {
		return held, err
	}
	return held, held.current(ctx)
}
func (a *originalShopProductReadAuthority) retire() error {
	if a == nil {
		return nil
	}
	a.retired.Store(true)
	if a.source != nil {
		return a.source.retire()
	}
	return nil
}
func (a *originalShopProductReadAuthority) close() error {
	if a == nil || a.source == nil {
		return nil
	}
	return a.source.close()
}

type originalShopProductReadHold struct {
	authority  *originalShopProductReadAuthority
	permission originalShopProductPermission
	selected   originalShopInvoiceReadScope
	request    context.Context
	closed     atomic.Bool
}

func (h *originalShopProductReadHold) scope() (originalShopInvoiceReadScope, error) {
	if h == nil {
		return originalShopInvoiceReadScope{}, errShopInvoiceReadDenied
	}
	if err := h.current(h.request); err != nil {
		return originalShopInvoiceReadScope{}, err
	}
	return h.selected, nil
}
func (h *originalShopProductReadHold) current(ctx context.Context) error {
	if h == nil || h.authority == nil || h.permission == nil || h.closed.Load() || h.authority.retired.Load() || ctx == nil || h.request == nil {
		return errShopInvoiceReadDenied
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := h.request.Err(); err != nil {
		return err
	}
	return h.permission.current(ctx)
}
func (h *originalShopProductReadHold) close() error {
	if h == nil || h.closed.Load() {
		return nil
	}
	if h.permission == nil {
		h.closed.Store(true)
		return nil
	}
	// The actual permission owns close-once/uncertain outcome. Service retains
	// this original child if cleanup fails; never replace it with a fresh loan.
	err := h.permission.close()
	if originalShopCloseComplete(h.permission, err) {
		h.closed.Store(true)
	}
	return err
}
