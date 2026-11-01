package resourceauthority

import (
	"bytes"
	"context"
	"errors"
	"sync"

	auth "github.com/JiahaoAlbus/YNX-Chain/apps/network/internal/authresourcesource"
)

var ErrReviewSelected = errors.New("original resource review already selected")
var ErrReviewPending = errors.New("original resource review acquisition or drain pending")

// The actual Auth review is the sole production implementation. This private
// shape lets lifecycle tests exercise late/partial/PENDING without a public
// provider, approval boolean, signer callback or caller-chosen original body.
type originalReview interface {
	Current(context.Context) error
	ReadOriginalPreview(context.Context) ([]byte, error)
	Retire() error
	Join() (bool, error)
	Close() (bool, error)
}

type Review struct {
	mu       sync.Mutex
	drain    chan struct{}
	original originalReview
	usable   bool
	retired  bool
	closed   bool
	first    error
}

func adoptReview(original originalReview, cause error) *Review {
	if original == nil {
		return nil
	}
	return &Review{original: original, drain: make(chan struct{}, 1), usable: cause == nil, first: cause}
}

func (r *Review) fail(err error) error {
	if err != nil {
		r.usable = false
		if r.first == nil {
			r.first = err
		}
	}
	return err
}

// ReadOriginalPreview preserves the exact original unsigned Consent DATA. It
// is neither a signature nor SDK readOriginalUnsigned, authority or work entry.
func (r *Review) ReadOriginalPreview(ctx context.Context) ([]byte, error) {
	if r == nil {
		return nil, auth.ErrNotSupplied
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.usable || r.retired || r.closed {
		return nil, errors.Join(auth.ErrRetired, r.first)
	}
	if err := ctx.Err(); err != nil {
		return nil, r.fail(err)
	}
	if err := r.original.Current(ctx); err != nil {
		return nil, r.fail(err)
	}
	raw, err := r.original.ReadOriginalPreview(ctx)
	if err != nil {
		return nil, r.fail(err)
	}
	if len(raw) == 0 || len(raw) > 49152 {
		return nil, r.fail(errors.New("original resource preview bounds"))
	}
	result := bytes.Clone(raw)
	if err = r.original.Current(ctx); err != nil {
		return nil, r.fail(err)
	}
	if err = ctx.Err(); err != nil {
		return nil, r.fail(err)
	}
	return result, nil
}

// Close retains this exact owner across canceled/PENDING cleanup and preserves
// the first failure separately from physical completion. No reacquisition.
func (r *Review) Close(ctx context.Context) (bool, error) {
	if r == nil {
		return true, nil
	}
	r.mu.Lock()
	if r.closed {
		first := r.first
		r.mu.Unlock()
		return true, first
	}
	r.usable = false
	if ctx.Err() != nil {
		r.fail(ctx.Err())
	}
	r.mu.Unlock()
	select {
	case r.drain <- struct{}{}:
		defer func() { <-r.drain }()
	case <-ctx.Done():
		return false, ctx.Err()
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return true, r.first
	}
	if !r.retired {
		r.retired = true
		r.usable = false
		r.fail(r.original.Retire())
	}
	if err := ctx.Err(); err != nil {
		return false, errors.Join(r.first, err)
	}
	done, err := r.original.Join()
	r.fail(err)
	if !done {
		return false, r.first
	}
	if err = ctx.Err(); err != nil {
		return false, errors.Join(r.first, err)
	}
	done, err = r.original.Close()
	r.fail(err)
	r.closed = done
	return done, r.first
}

// Only one attempt may be selected for this immutable Source. A partial or a
// late review is adopted before checking errors, and can never be rearmed.
func (o *Owner) prepareOriginalReview(ctx context.Context, acquire func() (originalReview, error)) (*Review, error) {
	if o == nil {
		return nil, auth.ErrNotSupplied
	}
	o.mu.Lock()
	if o.retired || o.closed || !o.status.Current {
		o.mu.Unlock()
		return nil, auth.ErrRetired
	}
	if o.reviewSelected {
		o.mu.Unlock()
		return nil, ErrReviewSelected
	}
	if err := ctx.Err(); err != nil {
		o.mu.Unlock()
		return nil, err
	}
	o.reviewSelected = true
	o.reviewPreparing = true
	o.mu.Unlock()
	original, err := acquire()
	review := adoptReview(original, err)
	o.mu.Lock()
	o.review = review
	o.reviewPreparing = false
	late := o.retired || o.closed || o.reviewCanceled
	o.mu.Unlock()
	if late {
		err = errors.Join(err, auth.ErrRetired)
	}
	if err == nil {
		err = ctx.Err()
	}
	if err == nil && review == nil {
		err = auth.ErrNotSupplied
	}
	if review != nil && err != nil {
		review.mu.Lock()
		review.fail(err)
		review.mu.Unlock()
		_, _ = review.Close(ctx)
	}
	return review, err
}
