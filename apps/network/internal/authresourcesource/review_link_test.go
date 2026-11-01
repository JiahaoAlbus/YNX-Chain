//go:build darwin && cgo && ynx_network_source_native

package networkresourcesource

import (
	"context"
	"testing"
)

func TestActualNativeReviewRoot0NoPromptOrSigner(t *testing.T) {
	ctx := context.Background()
	s, e := Open(ctx)
	if s == nil || e == nil {
		t.Fatal(s, e)
	}
	r, e := s.PrepareOriginalReview(ctx)
	if r != nil || e == nil {
		t.Fatal("Root0 got review", r, e)
	}
	ptr, e := darwinNative{}.prepareReview(s.h)
	if ptr != 0 || e == nil {
		t.Fatal("native Root0 bypass", ptr, e)
	}
	if e = (darwinNative{}).reviewCurrent(1); e == nil {
		t.Fatal("foreign current")
	}
	d := (darwinNative{}).reviewClose(1)
	if d.complete || d.err == nil {
		t.Fatal("foreign close", d)
	}
	_ = s.Retire()
	if done, e := s.Join(ctx); !done || e != nil {
		t.Fatal(done, e)
	}
	if done, e := s.Close(ctx); !done || e != nil {
		t.Fatal(done, e)
	}
}
