package commerce

import "context"

// The shared Auth/SDK qualified Native ProductSource read callee is not supplied
// in this frozen supplier. AI task grants, ProductSession, LocalCaller material
// and copied Root/Source JSON cannot replace it. Only the original Auth adapter
// may implement this normal zero-input factory; no public injection API exists.
func openOriginalShopInvoiceReadAuthority(ctx context.Context) (originalShopInvoiceReadAuthority, error) {
	if ctx == nil {
		return nil, ErrShopInvoiceReadSourceNotSupplied
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return nil, ErrShopInvoiceReadSourceNotSupplied
}
