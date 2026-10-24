package developerauthority

import (
	"context"
	"time"
)

// Catalog remains the sole serializable ACL/revision owner. This method
// proves only that its original service Source and the SAME authenticated
// principal are still current; no membership, publisher or grant is created.
// It is intentionally not an alias for successful login alone.
func (o *OriginalDeveloperSourceFactory) AssertCatalogAuthorityCurrent(ctx context.Context, p Principal) error {
	if o == nil || ctx == nil || ctx.Err() != nil || !principalValid(p, time.Now().UnixMilli()) {
		return ErrDenied
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if !o.usable() {
		return ErrUnknown
	}
	if e := o.control.AssertSourceCurrent(ctx); e != nil {
		return e
	}
	if e := o.principal.AssertPrincipalCurrent(ctx, p); e != nil {
		return e
	}
	// Source may have retired while the HTTP current callback was in flight.
	if e := o.control.AssertSourceCurrent(ctx); e != nil {
		return ErrUnknown
	}
	// The last subprocess may complete after a previously checked principal
	// expires. Never renew its signed time or infer a replacement principal.
	if ctx.Err() != nil || !principalValid(p, time.Now().UnixMilli()) {
		return ErrUnknown
	}
	return nil
}
