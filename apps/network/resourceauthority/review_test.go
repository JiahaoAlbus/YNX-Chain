package resourceauthority

import (
	"bytes"
	"context"
	"errors"
	"sync"
	"testing"

	auth "github.com/JiahaoAlbus/YNX-Chain/apps/network/internal/authresourcesource"
)

type publicReview struct {
	mu                     sync.Mutex
	data                   []byte
	currentErr             error
	complete               bool
	retires, joins, closes int
}

func (r *publicReview) Current(context.Context) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.currentErr
}
func (r *publicReview) ReadOriginalPreview(context.Context) ([]byte, error) { return r.data, nil }
func (r *publicReview) Retire() error                                       { r.mu.Lock(); defer r.mu.Unlock(); r.retires++; return nil }
func (r *publicReview) Join() (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.joins++
	return r.complete, nil
}
func (r *publicReview) Close() (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.closes++
	return r.complete, nil
}

func TestOriginalReviewLifetime(t *testing.T) {
	t.Run("exact-preview-single-selection-and-no-rearm-after-current-loss", func(t *testing.T) {
		o := adopt(context.Background(), &publicSource{complete: true}, nil, true)
		original := &publicReview{data: []byte("PUBLIC original DATA\x00\xff"), complete: true}
		calls := 0
		acquire := func() (originalReview, error) { calls++; return original, nil }
		review, err := o.prepareOriginalReview(context.Background(), acquire)
		if err != nil {
			t.Fatal(err)
		}
		got, err := review.ReadOriginalPreview(context.Background())
		if err != nil || !bytes.Equal(got, original.data) {
			t.Fatal(got, err)
		}
		got[0] = 'x'
		if original.data[0] == 'x' {
			t.Fatal("original memory leaked")
		}
		if _, err = o.prepareOriginalReview(context.Background(), acquire); !errors.Is(err, ErrReviewSelected) || calls != 1 {
			t.Fatal("reopened attempt", calls, err)
		}
		original.currentErr = errors.New("PUBLIC current revoked")
		if _, err = review.ReadOriginalPreview(context.Background()); err == nil {
			t.Fatal("lost current accepted")
		}
		original.currentErr = nil
		if _, err = review.ReadOriginalPreview(context.Background()); !errors.Is(err, auth.ErrRetired) {
			t.Fatal("review rearmed", err)
		}
		done, _ := o.Close(context.Background())
		if !done || original.closes != 1 || original.retires != 1 {
			t.Fatal("original child debt not drained", done, original)
		}
	})
	t.Run("nonnull-error-partial-and-pending-close-retain-first-owner", func(t *testing.T) {
		o := adopt(context.Background(), &publicSource{complete: true}, nil, true)
		first := errors.New("PUBLIC original prepare error")
		original := &publicReview{data: []byte("not usable")}
		review, err := o.prepareOriginalReview(context.Background(), func() (originalReview, error) { return original, first })
		if review == nil || !errors.Is(err, first) || o.review != review || review.original != original {
			t.Fatal("partial lost", review, err)
		}
		if _, err = review.ReadOriginalPreview(context.Background()); !errors.Is(err, first) {
			t.Fatal("partial used", err)
		}
		if done, _ := o.Close(context.Background()); done {
			t.Fatal("pending reported complete")
		}
		original.complete = true
		if done, err := o.Close(context.Background()); !done || !errors.Is(err, first) {
			t.Fatal("physical vs first cause lost", done, err)
		}
		if done, err := review.Close(context.Background()); !done || !errors.Is(err, first) || original.closes != 1 {
			t.Fatal("repeat changed owner", done, err)
		}
	})
	t.Run("parent-retire-during-acquisition-adopts-late-review-before-drain", func(t *testing.T) {
		o := adopt(context.Background(), &publicSource{complete: true}, nil, true)
		entered, release := make(chan struct{}), make(chan struct{})
		original := &publicReview{data: []byte("late"), complete: true}
		done := make(chan error, 1)
		go func() {
			r, e := o.prepareOriginalReview(context.Background(), func() (originalReview, error) { close(entered); <-release; return original, nil })
			if r == nil {
				done <- errors.New("late partial lost")
				return
			}
			done <- e
		}()
		<-entered
		if complete, err := o.Close(context.Background()); complete || !errors.Is(err, ErrReviewPending) {
			t.Fatal("acquisition debt lost", complete, err)
		}
		close(release)
		if err := <-done; !errors.Is(err, auth.ErrRetired) {
			t.Fatal("late review usable", err)
		}
		if complete, err := o.Close(context.Background()); !complete || !errors.Is(err, auth.ErrRetired) {
			t.Fatal("late drain failed", complete, err)
		}
		if original.closes != 1 || o.review == nil {
			t.Fatal("original late owner replaced")
		}
	})
	t.Run("cancel-during-prepare-late-partial-cannot-become-usable", func(t *testing.T) {
		o := adopt(context.Background(), &publicSource{complete: true}, nil, true)
		entered, release := make(chan struct{}), make(chan struct{})
		original := &publicReview{data: []byte("late"), complete: true}
		done := make(chan error, 1)
		go func() {
			_, err := o.prepareOriginalReview(context.Background(), func() (originalReview, error) { close(entered); <-release; return original, nil })
			done <- err
		}()
		<-entered
		if complete, err := o.CancelOriginalReview(context.Background()); complete || !errors.Is(err, ErrReviewPending) {
			t.Fatal("cancel debt lost", complete, err)
		}
		close(release)
		if err := <-done; !errors.Is(err, auth.ErrRetired) {
			t.Fatal("late cancellation ignored", err)
		}
		if _, err := o.review.ReadOriginalPreview(context.Background()); !errors.Is(err, auth.ErrRetired) {
			t.Fatal("late canceled review became usable", err)
		}
		if complete, _ := o.Close(context.Background()); !complete || original.closes != 1 {
			t.Fatal("late same-owner drain lost")
		}
	})
	t.Run("canceled-drain-is-cleanup-only-and-same-owner-resumes", func(t *testing.T) {
		original := &publicReview{data: []byte("PUBLIC")}
		review := adoptReview(original, nil)
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if done, _ := review.Close(ctx); done {
			t.Fatal("canceled complete")
		}
		if _, err := review.ReadOriginalPreview(context.Background()); !errors.Is(err, context.Canceled) {
			t.Fatal("canceled review reused", err)
		}
		original.complete = true
		if done, err := review.Close(context.Background()); !done || !errors.Is(err, context.Canceled) || original.closes != 1 {
			t.Fatal(done, err)
		}
	})
}

func TestOriginalReviewAvailabilityReflectsSameAttempt(t *testing.T) {
	var absent *Owner
	if prepare, cancel := absent.ReviewAvailability(); prepare || cancel {
		t.Fatal("absent current capabilities")
	}
	o := adopt(context.Background(), &publicSource{complete: true}, nil, true)
	if prepare, cancel := o.ReviewAvailability(); !prepare || cancel {
		t.Fatal("initial attempt availability")
	}
	original := &publicReview{data: []byte("PUBLIC")}
	review, err := o.prepareOriginalReview(context.Background(), func() (originalReview, error) { return original, nil })
	if err != nil {
		t.Fatal(err)
	}
	if prepare, cancel := o.ReviewAvailability(); prepare || !cancel {
		t.Fatal("selected attempt rearmed")
	}
	if complete, _ := review.Close(context.Background()); complete {
		t.Fatal("pending not retained")
	}
	if prepare, cancel := o.ReviewAvailability(); prepare || !cancel {
		t.Fatal("pending lost cleanup capability")
	}
	original.complete = true
	if complete, _ := review.Close(context.Background()); !complete {
		t.Fatal("same attempt did not close")
	}
	if prepare, cancel := o.ReviewAvailability(); prepare || cancel {
		t.Fatal("closed attempt rearmed")
	}
	if complete, _ := o.Close(context.Background()); !complete {
		t.Fatal("parent did not close")
	}
}
