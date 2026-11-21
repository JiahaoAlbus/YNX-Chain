package securelink

import (
	"context"
	"errors"
	"net/http"
)

// ErrOriginalV4OwnerUnknown retains an owner whose callback could not be
// observed to complete; it is never a physical-close witness.
var ErrOriginalV4OwnerUnknown = errors.New("LINK original V4 response owner outcome unknown")

// OriginalV4ResponseOwner retains the original product-owned Source and
// session. It grants no authority by itself: Current must recheck those
// originals for the exact request. Close is selected once, only after the
// original transport close is confirmed. Drain advances only the same owner;
// it must not repeat an uncertain physical close.
type OriginalV4ResponseOwner interface {
	Current(*http.Request) error
	Close() error
	PhysicalClosed() bool
	Drain(context.Context) error
}

// OriginalV4ResponseLease is the witness for one transferred owner and one
// original server connection. Copies retain the same underlying ownership.
type OriginalV4ResponseLease struct{ state *originalV4ResponseLease }

type OriginalV4ResponseStatus struct {
	ConnectionCloseConfirmed bool
	HandlerDrained           bool
	OwnerCloseReturned       bool
	OwnerPhysicalClosed      bool
	FirstError               error
}

// AdoptOriginalV4ResponseOwner transfers the original owner only on success.
// It must run on the exact active request before any response header or body.
// On failure the caller retains the owner and all of its cleanup obligations.
func (c *LocalCaller) AdoptOriginalV4ResponseOwner(r *http.Request, owner OriginalV4ResponseOwner) (*OriginalV4ResponseLease, error) {
	if c == nil || c.state == nil || r == nil || owner == nil {
		return nil, ErrDenied
	}
	return c.state.adoptOriginalV4ResponseOwner(r, owner)
}

// Status is a local snapshot. It does not itself drive cleanup or confer
// Source authority, and an unconfirmed close remains unknown.
func (l *OriginalV4ResponseLease) Status() OriginalV4ResponseStatus {
	if l == nil || l.state == nil {
		return OriginalV4ResponseStatus{FirstError: ErrDenied}
	}
	return l.state.status()
}

// Drain advances only an already-transferred original owner. It never retries
// the original connection close. An active handler or unconfirmed physical
// close remains draining and retains the owner.
func (l *OriginalV4ResponseLease) Drain(ctx context.Context) error {
	if l == nil || l.state == nil || ctx == nil {
		return ErrDenied
	}
	return l.state.drain(ctx)
}
