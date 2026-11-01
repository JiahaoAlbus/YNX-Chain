package networkresourcesource

import (
	"context"
	"errors"
	"testing"
)

type publicReviewNative struct {
	publicNative
	preview                 []byte
	reviewErr               error
	partial                 bool
	afterPrepare, afterRead func()
	joined, closed          bool
	prepares, closes        int
}

func (n *publicReviewNative) prepareReview(handle) (uintptr, error) {
	n.prepares++
	if n.afterPrepare != nil {
		n.afterPrepare()
	}
	if n.partial {
		return 7, ErrNotSupplied
	}
	return 7, nil
}
func (n *publicReviewNative) reviewCurrent(uintptr) error { return n.reviewErr }
func (n *publicReviewNative) reviewOriginal(uintptr) ([]byte, error) {
	if n.afterRead != nil {
		n.afterRead()
	}
	return n.preview, nil
}
func (n *publicReviewNative) reviewRetire(uintptr) error { return nil }
func (n *publicReviewNative) reviewJoin(uintptr) drain   { return drain{n.joined, nil} }
func (n *publicReviewNative) reviewClose(uintptr) drain  { n.closes++; return drain{n.closed, nil} }
func TestReviewPartialIsCleanupOnly(t *testing.T) {
	n := &publicReviewNative{partial: true, joined: true, closed: true}
	s, e := openNative(context.Background(), n)
	if e != nil {
		t.Fatal(e)
	}
	r, e := s.PrepareOriginalReview(context.Background())
	if r == nil || e == nil {
		t.Fatal(r, e)
	}
	if e := r.Current(context.Background()); e == nil {
		t.Fatal("partial granted current")
	}
	if b, e := r.ReadOriginalPreview(context.Background()); b != nil || e == nil {
		t.Fatal(b, e)
	}
	_ = r.Retire()
	if b, e := r.Join(); !b || !errors.Is(e, ErrNotSupplied) {
		t.Fatal(b, e)
	}
	if b, e := r.Close(); !b || !errors.Is(e, ErrNotSupplied) {
		t.Fatal(b, e)
	}
}
func TestReviewLateCancelKeepsSameOwner(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	n := &publicReviewNative{afterPrepare: cancel, joined: true, closed: true}
	s, e := openNative(ctx, n)
	if e != nil {
		t.Fatal(e)
	}
	r, e := s.PrepareOriginalReview(ctx)
	if r == nil || !errors.Is(e, context.Canceled) {
		t.Fatal(r, e)
	}
	_ = r.Retire()
	_, _ = r.Join()
	_, _ = r.Close()
	if n.prepares != 1 {
		t.Fatal("recapture")
	}
}
func TestReviewOriginalOwnedAndLateRevocation(t *testing.T) {
	n := &publicReviewNative{preview: []byte("PUBLIC exact original")}
	s, _ := openNative(context.Background(), n)
	r, e := s.PrepareOriginalReview(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	b, e := r.ReadOriginalPreview(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	n.preview[0] = 'X'
	if b[0] != 'P' {
		t.Fatal("not owned")
	}
	n.afterRead = func() { n.reviewErr = ErrRetired }
	if b, e := r.ReadOriginalPreview(context.Background()); b != nil || !errors.Is(e, ErrRetired) {
		t.Fatal(b, e)
	}
}
func TestReviewPendingDrainNoReprepare(t *testing.T) {
	n := &publicReviewNative{}
	s, _ := openNative(context.Background(), n)
	r, _ := s.PrepareOriginalReview(context.Background())
	_ = r.Retire()
	if b, e := r.Join(); b || e != nil {
		t.Fatal(b, e)
	}
	n.joined = true
	if b, e := r.Join(); !b || e != nil {
		t.Fatal(b, e)
	}
	if b, e := r.Close(); b || e != nil {
		t.Fatal(b, e)
	}
	n.closed = true
	if b, e := r.Close(); !b || e != nil {
		t.Fatal(b, e)
	}
	_, _ = r.Close()
	if n.prepares != 1 || n.closes != 2 {
		t.Fatal(n.prepares, n.closes)
	}
}
