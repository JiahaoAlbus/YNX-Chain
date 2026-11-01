package networkresourcesource

import (
	"bytes"
	"context"
	"errors"
	"sync"
)

// Native physical original nonce fence; it never replaces P09's authoritative
// transaction/history store or proves execution/finality.
type claimNative interface {
	claim(handle) (uintptr, error)
	claimCurrent(uintptr) error
	claimRead(uintptr) ([]byte, error)
	claimClose(uintptr) drain
}
type Claim struct {
	mu     sync.Mutex
	source *Source
	abi    claimNative
	handle uintptr
	closed bool
	first  error
}

func (s *Source) ClaimOriginal(ctx context.Context) (*Claim, error) {
	done, e := s.enter(ctx)
	if e != nil {
		return nil, e
	}
	defer done()
	abi, ok := s.abi.(claimNative)
	if !ok {
		return nil, ErrClaimNotSupplied
	}
	if e = s.abi.current(s.h); e != nil {
		return nil, e
	}
	handle, e := abi.claim(s.h)
	if handle == 0 {
		return nil, errors.Join(ErrClaimNotSupplied, e)
	}
	claim := &Claim{source: s, abi: abi, handle: handle, first: e}
	if e != nil {
		return claim, e
	}
	if e = s.post(ctx); e != nil {
		claim.first = e
		return claim, e
	}
	return claim, nil
}

// Synchronous ORIGINAL P09 transaction/fence only, never an async check-only
// callback. No Go owner lock or Source refresh. Not globally atomic remote
// revocation; this finite public read/egress does not authorize foreign writes.
func (c *Claim) CurrentNoIO() error {
	if c == nil {
		return ErrClaimNotSupplied
	}
	return c.abi.claimCurrent(c.handle)
}
func (c *Claim) ReadOriginal(ctx context.Context) ([]byte, error) {
	if e := ctx.Err(); e != nil {
		return nil, e
	}
	if c == nil {
		return nil, ErrClaimNotSupplied
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return nil, ErrRetired
	}
	b, e := c.abi.claimRead(c.handle)
	if e != nil {
		return nil, e
	}
	if e = ctx.Err(); e != nil {
		return nil, e
	}
	return bytes.Clone(b), nil
}
func (c *Claim) Close() (bool, error) {
	if c == nil {
		return true, nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return true, c.first
	}
	r := c.abi.claimClose(c.handle)
	if r.err != nil && c.first == nil {
		c.first = r.err
	}
	c.closed = r.complete
	return r.complete, c.first
}
