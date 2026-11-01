package networkresourcesource

import (
	"bytes"
	"context"
	"errors"
	"sync"
)

type reviewNative interface {
	prepareReview(handle) (uintptr, error)
	reviewCurrent(uintptr) error
	reviewOriginal(uintptr) ([]byte, error)
	reviewRetire(uintptr) error
	reviewJoin(uintptr) drain
	reviewClose(uintptr) drain
}
type Review struct {
	mu                              sync.Mutex
	source                          *Source
	abi                             reviewNative
	handle                          uintptr
	usable, retired, joined, closed bool
	first                           error
}

// Caller holds mu. A failed/late original observation cannot be refreshed into
// a fresh usable review. It remains this same cleanup owner, never reacquired.
func (r *Review) fail(e error) error {
	if e != nil {
		r.usable = false
		if r.first == nil {
			r.first = e
		}
	}
	return e
}

// No approve(bool)/decision setter. The actual Native prompt is solely inside
// protected production, AFTER a genuinely supplied fixed typed signer exists.
func (s *Source) PrepareOriginalReview(ctx context.Context) (*Review, error) {
	done, e := s.enter(ctx)
	if e != nil {
		return nil, e
	}
	defer done()
	abi, ok := s.abi.(reviewNative)
	if !ok {
		return nil, ErrNotSupplied
	}
	if e = s.abi.current(s.h); e != nil {
		return nil, e
	}
	h, e := abi.prepareReview(s.h)
	if h == 0 {
		return nil, errors.Join(ErrNotSupplied, e)
	}
	r := &Review{source: s, abi: abi, handle: h, first: e}
	if e != nil {
		return r, e
	}
	if e = s.abi.current(s.h); e == nil {
		e = s.post(ctx)
	}
	if e != nil {
		r.first = e
		return r, e
	}
	r.usable = true
	return r, nil
}
func (r *Review) Current(ctx context.Context) error {
	if r == nil {
		return ErrNotSupplied
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.usable || r.retired || r.closed {
		return errors.Join(ErrRetired, r.first)
	}
	if e := ctx.Err(); e != nil {
		return r.fail(e)
	}
	if e := r.abi.reviewCurrent(r.handle); e != nil {
		return r.fail(e)
	}
	return r.fail(ctx.Err())
}
func (r *Review) ReadOriginalPreview(ctx context.Context) ([]byte, error) {
	if r == nil {
		return nil, ErrNotSupplied
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.usable || r.retired || r.closed {
		return nil, errors.Join(ErrRetired, r.first)
	}
	if e := ctx.Err(); e != nil {
		return nil, r.fail(e)
	}
	if e := r.abi.reviewCurrent(r.handle); e != nil {
		return nil, r.fail(e)
	}
	b, e := r.abi.reviewOriginal(r.handle)
	if e != nil {
		return nil, r.fail(e)
	}
	copy := bytes.Clone(b)
	if e = r.abi.reviewCurrent(r.handle); e != nil {
		return nil, r.fail(e)
	}
	if e = ctx.Err(); e != nil {
		return nil, r.fail(e)
	}
	return copy, nil
}
func (r *Review) Retire() error {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.retired {
		return r.first
	}
	r.retired = true
	r.usable = false
	e := r.abi.reviewRetire(r.handle)
	if r.first == nil {
		r.first = e
	}
	return e
}
func (r *Review) Join() (bool, error) {
	if r == nil {
		return true, nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.retired {
		return false, ErrRetired
	}
	if r.joined {
		return true, r.first
	}
	d := r.abi.reviewJoin(r.handle)
	r.joined = d.complete
	if r.first == nil {
		r.first = d.err
	}
	return d.complete, r.first
}
func (r *Review) Close() (bool, error) {
	if r == nil {
		return true, nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return true, r.first
	}
	if !r.joined {
		return false, ErrRetired
	}
	d := r.abi.reviewClose(r.handle)
	r.closed = d.complete
	if r.first == nil {
		r.first = d.err
	}
	return d.complete, r.first
}
