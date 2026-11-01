package networkresourcesource

import (
	"context"
	"errors"
	"testing"
)

type publicClaimNative struct {
	publicNative
	claimErr, errorClose   error
	claimHandle            uintptr
	claimCalls, closeCalls int
	claimComplete          bool
	afterClaim             func()
}

func (n *publicClaimNative) claim(handle) (uintptr, error) {
	n.claimCalls++
	if n.afterClaim != nil {
		n.afterClaim()
	}
	return n.claimHandle, n.claimErr
}
func (n *publicClaimNative) claimCurrent(uintptr) error { return nil }
func (n *publicClaimNative) claimRead(uintptr) ([]byte, error) {
	return []byte("PUBLIC actual original"), nil
}
func (n *publicClaimNative) claimClose(uintptr) drain {
	n.closeCalls++
	return drain{n.claimComplete, n.errorClose}
}

func TestClaimPartialPreservesFirstAndNoRedispatch(t *testing.T) {
	first := errors.New("PUBLIC unknown after durable entry")
	later := errors.New("PUBLIC cleanup late")
	n := &publicClaimNative{claimHandle: 5, claimErr: first, errorClose: later}
	s, e := openNative(context.Background(), n)
	if e != nil {
		t.Fatal(e)
	}
	c, e := s.ClaimOriginal(context.Background())
	if c == nil || !errors.Is(e, first) {
		t.Fatal(c, e)
	}
	if b, e := c.Close(); b || !errors.Is(e, first) {
		t.Fatal(b, e)
	}
	n.claimComplete = true
	if b, e := c.Close(); !b || !errors.Is(e, first) {
		t.Fatal(b, e)
	}
	if b, e := c.Close(); !b || !errors.Is(e, first) {
		t.Fatal(b, e)
	}
	if n.claimCalls != 1 || n.closeCalls != 2 {
		t.Fatal("re-dispatch or closed twice", n.claimCalls, n.closeCalls)
	}
}
func TestClaimLateCancelKeepsOriginalOwner(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	n := &publicClaimNative{claimHandle: 6, claimComplete: true, afterClaim: cancel}
	s, e := openNative(ctx, n)
	if e != nil {
		t.Fatal(e)
	}
	c, e := s.ClaimOriginal(ctx)
	if c == nil || !errors.Is(e, context.Canceled) {
		t.Fatal(c, e)
	}
	if b, e := c.Close(); !b || !errors.Is(e, context.Canceled) {
		t.Fatal(b, e)
	}
	if n.claimCalls != 1 {
		t.Fatal("replayed")
	}
}
func TestClaimUnavailableDoesNotMakeEffect(t *testing.T) {
	n := &publicNative{}
	s, e := openNative(context.Background(), n)
	if e != nil {
		t.Fatal(e)
	}
	if c, e := s.ClaimOriginal(context.Background()); c != nil || !errors.Is(e, ErrClaimNotSupplied) {
		t.Fatal(c, e)
	}
}
