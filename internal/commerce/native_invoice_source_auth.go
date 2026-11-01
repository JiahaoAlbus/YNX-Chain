package commerce

import (
	"context"
	"errors"
)

// Normal startup adopts the genuine Auth supplier before copying its existing
// ProductScopeDATA/resource registration into the original Store read plane.
// Auth's Native Root component exists; its Go/service resource bridge remains
// explicitly absent below. No public injection API or replacement Source exists.
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

var errShopProductAuthCalleeNotLinked = errors.New("SHOP_NATIVE_PRODUCT_AUTH_GO_CALLEE_NOT_LINKED")

// Auth's accepted Native component supplies acquire_original_product_root,
// read_original_product_scope and borrow_original_product_read_permission.
// It does NOT yet supply a Go/owned-C bridge plus Root-selected Shop resource
// registration. Its Node/Main image is not a shopd service ABI; it cannot replace
// original service caller/tenant/role mapping or introduce another Go runtime.
// This is the precise remaining Auth supplier CAS, not a missing Root consent.
// There is deliberately no ENV path, callback installer, JSON or public setter.
func acquireOriginalShopProductReadSource(context.Context) (originalShopProductReadSource, error) {
	return nil, errors.Join(ErrShopInvoiceReadSourceNotSupplied, errShopProductAuthCalleeNotLinked)
}
