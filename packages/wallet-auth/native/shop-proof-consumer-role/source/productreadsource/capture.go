package productreadsource

import "context"

// Copied public qualification DATA from this genuine owner, not a constructor.
type OriginalCaptureDATA struct {
	Scope      ScopeDATA
	Profile    ProfileDATA
	Selections []ReadScopeDATA
}

func (a *Authority) CaptureDATA(ctx context.Context) (OriginalCaptureDATA, error) {
	var out OriginalCaptureDATA
	if a == nil {
		return out, ErrNotSupplied
	}
	if e := a.Current(ctx); e != nil {
		return out, e
	}
	return a.captureObservedDATA(ctx)
}
func (a *Authority) captureObservedDATA(ctx context.Context) (OriginalCaptureDATA, error) {
	var out OriginalCaptureDATA
	if e := a.atomicCurrent(ctx, nil); e != nil {
		return out, e
	}
	s := a.state.Load()
	p := s.resource
	scope := s.scope
	scope.Operations = append([]string(nil), scope.Operations...)
	scope.Products = append([]ProductReference(nil), scope.Products...)
	out.Scope = scope
	out.Profile = ProfileDATA{Realm: p.Realm, Tenant: p.Tenant, Purpose: Purpose, Epoch: p.Epoch, Socket: p.Socket, Service: p.Service, PeerUID: p.PeerUID, PeerPID: p.PeerPID, Orders: append([]string(nil), p.Orders...)}
	for _, b := range p.Bindings {
		out.Selections = append(out.Selections, ReadScopeDATA{Realm: p.Realm, Tenant: p.Tenant, Purpose: Purpose, Epoch: p.Epoch, Actor: b.Actor, Role: b.Role, StoreID: b.StoreID, ProductID: b.ProductID, SourceOrder: b.SourceOrder})
	}
	if e := a.atomicCurrent(ctx, nil); e != nil {
		return OriginalCaptureDATA{}, e
	}
	return out, nil
}
