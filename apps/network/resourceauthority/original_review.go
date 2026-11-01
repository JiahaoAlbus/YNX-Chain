package resourceauthority

import (
	"context"

	auth "github.com/JiahaoAlbus/YNX-Chain/apps/network/internal/authresourcesource"
)

// PrepareOriginalReview uses only the original concrete Source acquired at
// normal helper startup. No caller may supply a review, body, provider or
// approval. An unsigned preview is not consent production or worker admission.
func (o *Owner) PrepareOriginalReview(ctx context.Context) (*Review, error) {
	if o == nil {
		return nil, auth.ErrNotSupplied
	}
	o.mu.Lock()
	original, ok := o.source.(*auth.Source)
	o.mu.Unlock()
	if !ok || original == nil {
		return nil, auth.ErrNotSupplied
	}
	return o.prepareOriginalReview(ctx, func() (originalReview, error) {
		review, err := original.PrepareOriginalReview(ctx)
		if review == nil {
			return nil, err
		}
		return review, err
	})
}

// CancelOriginalReview releases only the review already owned by this helper.
// It does not retire or reacquire a different Source and cannot rearm a review.
func (o *Owner) CancelOriginalReview(ctx context.Context) (bool, error) {
	if o == nil {
		return true, nil
	}
	o.mu.Lock()
	review, preparing := o.review, o.reviewPreparing
	if o.reviewSelected {
		o.reviewCanceled = true
	}
	o.mu.Unlock()
	if preparing {
		return false, ErrReviewPending
	}
	return review.Close(ctx)
}

// ReviewAvailability observes this original attempt without acquiring,
// renewing, reading protected data or changing Source/review state. Cancel may
// remain possible solely to drain a retained partial after current is lost.
func (o *Owner) ReviewAvailability() (canPrepare, canCancel bool) {
	if o == nil {
		return false, false
	}
	o.mu.Lock()
	live := !o.retired && !o.closed && o.status.Current && !o.status.CleanupPending
	selected, preparing, review := o.reviewSelected, o.reviewPreparing, o.review
	o.mu.Unlock()
	canPrepare = live && !selected
	if preparing {
		return canPrepare, true
	}
	if review == nil {
		return canPrepare, false
	}
	review.mu.Lock()
	canCancel = !review.closed
	review.mu.Unlock()
	return canPrepare, canCancel
}
