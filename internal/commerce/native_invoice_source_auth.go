package commerce

import (
	"context"
	"errors"
	productsource "github.com/JiahaoAlbus/YNX-Chain/authowned/productreadsource"
	"net/http"
)

// Preserve genuine Auth failure identity while retaining the original Shop
// denial contract. A revoked native loan must not become an HTTP500 or DATA.
func isOriginalShopInvoiceReadDenied(err error) bool {
	return errors.Is(err, errShopInvoiceReadDenied) || errors.Is(err, productsource.ErrDenied) || errors.Is(err, productsource.ErrRetired)
}

// Normal startup adopts the genuine Auth supplier before copying its existing
// ProductScopeDATA/resource registration into the original Store read plane.
// The concrete Auth producer owns Source-v2/current and protected resource
// mapping. These private adapters never construct authority from copied DATA.
func openOriginalShopInvoiceReadAuthority(ctx context.Context) (originalShopInvoiceReadAuthority, error) {
	if ctx == nil {
		return nil, ErrShopInvoiceReadSourceNotSupplied
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	source, err := acquireOriginalShopProductReadSource(ctx)
	// Adopt an Auth partial before inspecting its acquisition error. Neither a
	// detached scope nor LINK caller material can enter this normal boundary.
	authority := &originalShopProductReadAuthority{source: source}
	if err != nil {
		return authority, err
	}
	return authority, authority.capture(ctx)
}

func acquireOriginalShopProductReadSource(ctx context.Context) (originalShopProductReadSource, error) {
	owner, err := productsource.OpenOriginalProductReadAuthority(ctx)
	if owner == nil {
		if err != nil {
			return nil, errors.Join(ErrShopInvoiceReadSourceNotSupplied, err)
		}
		return nil, ErrShopInvoiceReadSourceNotSupplied
	}
	// Always retain a nonnull partial before classifying the original failure.
	source := &originalAuthShopProductReadSource{owner: owner}
	if err != nil {
		return source, errors.Join(ErrShopInvoiceReadSourceNotSupplied, err)
	}
	return source, nil
}

type originalAuthShopProductReadSource struct{ owner *productsource.Authority }

var _ originalShopProductReadSource = (*originalAuthShopProductReadSource)(nil)

func (s *originalAuthShopProductReadSource) current(ctx context.Context) error {
	if s == nil || s.owner == nil {
		return ErrShopInvoiceReadSourceNotSupplied
	}
	return s.owner.Current(ctx)
}
func (s *originalAuthShopProductReadSource) capture(ctx context.Context) (originalShopProductContext, error) {
	var out originalShopProductContext
	if s == nil || s.owner == nil {
		return out, ErrShopInvoiceReadSourceNotSupplied
	}
	data, err := s.owner.CaptureDATA(ctx)
	if err != nil {
		return out, err
	}
	p := data.Profile
	out.purpose = productsource.Purpose
	out.selection = productsource.SelectionKey
	out.sourceEpoch = p.Epoch
	out.scope = originalShopProductScopeDATA{version: uint32(data.Scope.Version), networkID: data.Scope.NetworkID, account: data.Scope.Account, protectedResourceRef: data.Scope.ProtectedResourceRef, operations: append([]string(nil), data.Scope.Operations...)}
	for _, v := range data.Scope.Products {
		out.scope.products = append(out.scope.products, originalShopProductReference{v.ProductID, v.SourceOrder})
	}
	out.resource = originalShopProductResource{ref: data.Scope.ProtectedResourceRef, networkID: data.Scope.NetworkID, account: data.Scope.Account, profile: originalShopInvoiceReadProfile{realm: p.Realm, tenant: p.Tenant, purpose: p.Purpose, epoch: p.Epoch, socket: p.Socket, service: p.Service, uid: p.PeerUID, pid: p.PeerPID, orders: append([]string(nil), p.Orders...)}}
	for _, v := range data.Selections {
		out.resource.selections = append(out.resource.selections, originalShopInvoiceReadScope{realm: v.Realm, tenant: v.Tenant, purpose: v.Purpose, epoch: v.Epoch, actor: v.Actor, role: v.Role, storeID: v.StoreID, productID: v.ProductID, sourceOrder: v.SourceOrder})
	}
	return out, nil
}
func (s *originalAuthShopProductReadSource) borrow(ctx context.Context, r *http.Request, ref originalShopProductReference) (originalShopProductPermission, error) {
	if s == nil || s.owner == nil {
		return nil, ErrShopInvoiceReadSourceNotSupplied
	}
	owner, err := s.owner.OpenShopRead(ctx, r, ref.productID, ref.sourceOrder)
	if owner == nil {
		return nil, err
	}
	return &originalAuthShopProductPermission{owner: owner}, err
}
func (s *originalAuthShopProductReadSource) retire() error {
	if s == nil || s.owner == nil {
		return nil
	}
	return s.owner.Retire()
}
func (s *originalAuthShopProductReadSource) close() error {
	if s == nil || s.owner == nil {
		return nil
	}
	s.owner.Retire()
	return s.owner.Close()
}

type originalAuthShopProductPermission struct{ owner *productsource.Hold }

var _ originalShopProductPermission = (*originalAuthShopProductPermission)(nil)

func (p *originalAuthShopProductPermission) current(ctx context.Context) error {
	if p == nil || p.owner == nil {
		return errShopInvoiceReadDenied
	}
	return p.owner.Current(ctx)
}
func (p *originalAuthShopProductPermission) close() error {
	if p == nil || p.owner == nil {
		return nil
	}
	return p.owner.Close()
}
