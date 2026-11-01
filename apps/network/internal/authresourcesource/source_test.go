package networkresourcesource

import (
	"bytes"
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// Explicit PUBLIC boundary: this cannot be installed by normal callers.
type publicNative struct {
	block                   chan struct{}
	entered                 chan struct{}
	once                    sync.Once
	retired                 atomic.Bool
	joins, closes, verified atomic.Int32
	late                    error
	partial                 bool
	closeComplete           bool
}

func (n *publicNative) acquire() (handle, error) {
	if n.partial {
		return handle{1, 2}, ErrNotSupplied
	}
	return handle{1, 2}, nil
}
func (n *publicNative) current(handle) error {
	if n.entered != nil {
		n.once.Do(func() { close(n.entered) })
		<-n.block
	}
	if n.retired.Load() {
		return ErrRetired
	}
	return n.late
}
func (n *publicNative) read(_ handle, k uint32) ([]byte, error) {
	if k == 4 {
		return []byte(`{"canonicalIssuer":"issuer"}`), nil
	}
	if k == 5 {
		return []byte(`{"principal":"principal"}`), nil
	}
	return []byte(`{"original":true}`), nil
}
func (n *publicNative) verify(handle, uint32, []byte, []byte) error { n.verified.Add(1); return nil }
func (n *publicNative) retire(handle) error                         { n.retired.Store(true); return nil }
func (n *publicNative) join(handle) drain                           { n.joins.Add(1); return drain{true, nil} }
func (n *publicNative) close(handle) drain                          { n.closes.Add(1); return drain{n.closeComplete, nil} }
func TestNormalNoRootOrArchive(t *testing.T) {
	if NativeLinked() {
		t.Skip("archive present; actual Root0 partial is covered by TestActualNativeEmptyRootPartialDrain")
	}
	s, e := Open(context.Background())
	if e == nil || s != nil {
		t.Fatal("normal empty platform must deny")
	}
}
func TestPartialAdoptAndDrain(t *testing.T) {
	n := &publicNative{partial: true, closeComplete: true}
	s, e := openNative(context.Background(), n)
	if s == nil || e == nil {
		t.Fatal("lost partial")
	}
	_ = s.Retire()
	if b, e := s.Join(context.Background()); !b || e != nil {
		t.Fatal(b, e)
	}
	if b, e := s.Close(context.Background()); !b || e != nil {
		t.Fatal(b, e)
	}
}
func TestPayloadCannotReconstructOrCrossMap(t *testing.T) {
	n := &publicNative{closeComplete: true}
	s, e := openNative(context.Background(), n)
	if e != nil {
		t.Fatal(e)
	}
	raw, _ := s.ReadOriginalManifest(context.Background())
	if e = s.VerifyManifest(context.Background(), "other", raw, []byte{1}); e == nil {
		t.Fatal("cross issuer")
	}
	if e = s.VerifyManifest(context.Background(), "issuer", append(raw, ' '), []byte{1}); e == nil {
		t.Fatal("nonoriginal bytes")
	}
	if n.verified.Load() != 0 {
		t.Fatal("reached math")
	}
	if e = s.VerifyManifest(context.Background(), "issuer", bytes.Clone(raw), []byte{1}); e != nil {
		t.Fatal(e)
	}
}
func TestCurrentLateRetirementDrains(t *testing.T) {
	n := &publicNative{closeComplete: true}
	s, e := openNative(context.Background(), n)
	if e != nil {
		t.Fatal(e)
	}
	n.entered = make(chan struct{})
	n.block = make(chan struct{})
	current := make(chan error, 1)
	go func() { current <- s.Current(context.Background()) }()
	<-n.entered
	_ = s.Retire()
	done := make(chan bool, 1)
	go func() { b, _ := s.Join(context.Background()); done <- b }()
	select {
	case <-done:
		t.Fatal("joined before Current drained")
	case <-time.After(time.Millisecond * 5):
	}
	close(n.block)
	if e := <-current; !errors.Is(e, ErrRetired) {
		t.Fatal(e)
	}
	if !<-done {
		t.Fatal("failed join")
	}
}
func TestContextCancellationAfterNative(t *testing.T) {
	n := &publicNative{closeComplete: true}
	s, _ := openNative(context.Background(), n)
	ctx, cancel := context.WithCancel(context.Background())
	n.entered = make(chan struct{})
	n.block = make(chan struct{})
	done := make(chan error, 1)
	go func() { done <- s.Current(ctx) }()
	<-n.entered
	cancel()
	close(n.block)
	if e := <-done; !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
}
func TestPendingCloseRetainsOriginal(t *testing.T) {
	n := &publicNative{}
	s, _ := openNative(context.Background(), n)
	_ = s.Retire()
	_, _ = s.Join(context.Background())
	for i := 0; i < 2; i++ {
		b, e := s.Close(context.Background())
		if b || e != nil {
			t.Fatal("pending became complete", b, e)
		}
	}
	if n.closes.Load() != 2 {
		t.Fatal("same original drain was not observed")
	}
	if e := s.ClaimOriginalExecution(context.Background()); !errors.Is(e, ErrClaimNotSupplied) {
		t.Fatal("invented effect", e)
	}
}
