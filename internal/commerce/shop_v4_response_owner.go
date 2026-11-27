package commerce

import (
	"context"
	"net/http"
	"sync"
)

// shopV4ResponseOwner retains the original Source and Shop session together.
// LINK owns it only after a successful transfer on the original request.
type shopV4ResponseOwner struct {
	mu                  sync.Mutex
	service             *OriginalShopInvoiceReadService
	request             *http.Request
	childID             uint64
	held                originalShopInvoiceReadHold
	session             *OriginalShopSession
	product, order      string
	closing, sourceDone bool
	first               error
}

func (o *shopV4ResponseOwner) Current(r *http.Request) error {
	if o == nil || r == nil || r != o.request || o.service == nil || o.held == nil || o.session == nil {
		return errShopInvoiceReadDenied
	}
	o.mu.Lock()
	closing := o.closing
	o.mu.Unlock()
	if closing || o.service.retired.Load() || r.Context().Err() != nil {
		return errShopInvoiceReadDenied
	}
	if err := o.held.current(r.Context()); err != nil {
		return err
	}
	if err := o.session.CurrentOrder(r.Context(), o.product, o.order); err != nil {
		return err
	}
	return o.held.current(r.Context())
}

func (o *shopV4ResponseOwner) Close() error {
	if o == nil {
		return errShopInvoiceReadDenied
	}
	o.mu.Lock()
	if o.closing {
		o.mu.Unlock()
		return ErrConflict
	}
	o.closing = true
	o.mu.Unlock()
	return o.Drain(context.Background())
}

// Drain advances the original holders only; LINK retains sole ownership of
// the original socket and never selects another physical connection close.
func (o *shopV4ResponseOwner) Drain(ctx context.Context) error {
	if o == nil || ctx == nil {
		return errShopInvoiceReadDenied
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if !o.closing || o.service == nil || o.held == nil || o.session == nil {
		return errShopInvoiceReadDenied
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if !o.sourceDone {
		if witness, ok := o.held.(originalShopClosedWitness); ok && witness.assertOriginalClosed() == nil {
			o.service.stateMu.Lock()
			delete(o.service.children, o.childID)
			o.service.stateMu.Unlock()
			o.sourceDone = true
		} else {
			err := o.service.release(o.childID, o.held)
			if err != nil && o.first == nil {
				o.first = err
			}
			o.sourceDone = originalShopCloseComplete(o.held, err)
		}
		if !o.sourceDone {
			return o.first
		}
	}
	if !o.session.PhysicalClosed() {
		err := o.session.Close()
		if err != nil && o.first == nil {
			o.first = err
		}
	}
	if !o.session.PhysicalClosed() {
		if o.first != nil {
			return o.first
		}
		return ErrConflict
	}
	return o.first
}

func (o *shopV4ResponseOwner) PhysicalClosed() bool {
	if o == nil {
		return false
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.sourceDone && o.session != nil && o.session.PhysicalClosed()
}
