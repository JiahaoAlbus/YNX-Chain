//go:build darwin || linux

package securelink

import (
	"context"
	"net/http"
	"sync/atomic"
)

// An implementation must hold the same original proof, Source and Device
// throughout this loan. Both methods are bounded, worker-safe and free of
// I/O and actor/N-API work. The private adapter is the only producer of
// this borrow; its native holder contract is supplied independently.
type originalShopV4ProofWorker interface {
	copyOriginalShopV4Proof() (path string, proof ProductSessionProofV4DATA, err error)
	currentOriginalShopV4NoIO() error
}

type originalShopV4Borrow struct {
	worker   originalShopV4ProofWorker
	selected atomic.Bool
}

// If adopted, the borrow belongs to the returned exact exchange even on an
// error. An unselected borrow remains the caller's responsibility. The caller
// must adopt a nonnil exchange before inspecting response or operation error.
func (c *LocalCallerClient) callOriginalShopGETV4Fenced(ctx context.Context, expected LocalCallerExpectedProcess, borrow *originalShopV4Borrow) (*OriginalLocalCallerExchange, LocalCallerResponse, error) {
	if borrow == nil || borrow.worker == nil {
		return nil, LocalCallerResponse{}, ErrDenied
	}
	return c.callOriginalOwnedWithBorrow(ctx, http.MethodGet, "", "", nil, expected, nil, nil, borrow)
}

// The original actor can discharge its own loan after this transfer. A
// draining or ambiguous exchange keeps the borrow in private custody. The
// transfer does not call actor methods or erase the original operation error.
func (x *OriginalLocalCallerExchange) takeClosedOriginalShopV4Borrow() (*originalShopV4Borrow, error) {
	if err := x.AssertOriginalClosed(); err != nil {
		return nil, err
	}
	s := x.state
	s.mu.Lock()
	borrow := s.shopV4Borrow
	s.shopV4Borrow = nil
	s.mu.Unlock()
	if borrow == nil {
		return nil, ErrDenied
	}
	originalLocalCallerExchangeCustody.Lock()
	delete(originalLocalCallerExchangeCustody.owners, s)
	originalLocalCallerExchangeCustody.Unlock()
	return borrow, nil
}
