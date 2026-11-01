//go:build darwin && cgo && ynx_network_source_native

package networkresourcesource

import (
	"context"
	"testing"
)

// Actual same-process Go→C ABI→normal SourceAuthority/CurrentOwner, NOT a
// PUBLIC Source implementation. Empty independent release denies before IO.
func TestActualNativeEmptyRootPartialDrain(t *testing.T) {
	ctx := context.Background()
	s, e := Open(ctx)
	if s == nil || e == nil {
		t.Fatal("normal missing Source must retain actual partial", s, e)
	}
	if s.FirstCause() == nil {
		t.Fatal("lost first cause")
	}
	if e = s.Current(ctx); e == nil {
		t.Fatal("Root0 became current")
	}
	if e = s.Retire(); e != nil {
		t.Fatal(e)
	}
	if b, e := s.Join(ctx); !b || e != nil {
		t.Fatal("join", b, e)
	}
	if b, e := s.Close(ctx); !b || e != nil {
		t.Fatal("close", b, e)
	}
	if b, e := s.Close(ctx); !b || e != nil {
		t.Fatal("repeat", b, e)
	}
}
