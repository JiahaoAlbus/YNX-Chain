package main

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/nativeconsent"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/ownednode"
)

// Lifecycle doubles do not open Cocoa or establish a human decision.
type sessionProducer struct {
	identity func(context.Context) (nativeconsent.Identity, error)
	confirm  func(context.Context, ownednode.Intent, string) error
	close    func() error
}

func (p sessionProducer) ReadIdentity(c context.Context) (nativeconsent.Identity, error) {
	return p.identity(c)
}
func (p sessionProducer) Confirm(c context.Context, i ownednode.Intent, m string) error {
	return p.confirm(c, i, m)
}
func (p sessionProducer) Close() error { return p.close() }

func TestP09NativeConsentSessionIdentityPerRequest(t *testing.T) {
	var reads, prompts int
	want := ownednode.Intent{NodeID: ownednode.NodeID, Action: "start", Generation: 19}
	s := &nativeConsentSession{producer: sessionProducer{
		identity: func(context.Context) (nativeconsent.Identity, error) {
			reads++
			switch reads {
			case 1:
				return nativeconsent.Identity{}, context.DeadlineExceeded
			case 3:
				return nativeconsent.Identity{}, nativeconsent.ErrInvalid
			}
			return nativeconsent.Identity{}, nil
		},
		confirm: func(_ context.Context, intent ownednode.Intent, mode string) error {
			prompts++
			if intent != want || mode != "isolated-lifecycle-fixture" {
				t.Fatal("original intent or mode changed")
			}
			if prompts == 1 {
				return nil
			}
			return nativeconsent.ErrCancelled
		},
		close: func() error { return nil },
	}}
	defer s.Close()
	for _, wantErr := range []error{context.DeadlineExceeded, nil, nativeconsent.ErrInvalid, nativeconsent.ErrCancelled} {
		before := reads
		if err := s.Confirm(context.Background(), want, "isolated-lifecycle-fixture"); !errors.Is(err, wantErr) {
			t.Fatalf("request result %v want %v", err, wantErr)
		}
		if reads != before+1 {
			t.Fatal("identity retried automatically or skipped")
		}
	}
	if reads != 4 || prompts != 2 {
		t.Fatalf("identity%d prompts%d", reads, prompts)
	}
}

func TestP09NativeConsentSessionCloseAndOverlap(t *testing.T) {
	for _, phase := range []string{"identity", "review"} {
		t.Run(phase, func(t *testing.T) {
			entered, exited := make(chan struct{}), make(chan struct{})
			var prompts atomic.Int32
			var cleaned atomic.Bool
			wait := func(ctx context.Context) error {
				close(entered)
				<-ctx.Done()
				close(exited)
				return ctx.Err()
			}
			s := &nativeConsentSession{producer: sessionProducer{
				identity: func(ctx context.Context) (nativeconsent.Identity, error) {
					if phase == "identity" {
						return nativeconsent.Identity{}, wait(ctx)
					}
					return nativeconsent.Identity{}, nil
				},
				confirm: func(ctx context.Context, _ ownednode.Intent, _ string) error {
					prompts.Add(1)
					return wait(ctx)
				},
				close: func() error {
					select {
					case <-exited:
					default:
						t.Error("capture cleanup before child phase returned")
					}
					cleaned.Store(true)
					return nativeconsent.ErrInvalid // preserved unknown capture material
				},
			}}
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			result := make(chan error, 1)
			go func() { result <- s.Confirm(ctx, ownednode.Intent{}, "production") }()
			select {
			case <-entered:
			case <-ctx.Done():
				t.Fatal("phase not entered")
			}
			if err := s.Confirm(ctx, ownednode.Intent{}, "production"); !errors.Is(err, nativeconsent.ErrBusy) {
				t.Fatalf("overlap result %v", err)
			}
			if err := s.Close(); !errors.Is(err, nativeconsent.ErrInvalid) {
				t.Fatalf("cleanup error lost: %v", err)
			}
			if err := <-result; !errors.Is(err, context.Canceled) {
				t.Fatalf("active phase %v", err)
			}
			if !cleaned.Load() || (phase == "identity" && prompts.Load() != 0) {
				t.Fatal("cleanup/prompt boundary violated")
			}
			if err := s.Confirm(ctx, ownednode.Intent{}, "production"); !errors.Is(err, nativeconsent.ErrUnavailable) {
				t.Fatalf("closed session reused: %v", err)
			}
		})
	}
}

func TestP09NativeConsentSessionCancelledIdentityCannotReview(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	var reads, prompts int
	s := &nativeConsentSession{producer: sessionProducer{
		identity: func(context.Context) (nativeconsent.Identity, error) {
			reads++
			cancel() // cancellation after identity succeeds, before review starts
			return nativeconsent.Identity{}, nil
		},
		confirm: func(context.Context, ownednode.Intent, string) error { prompts++; return nil },
		close:   func() error { return nil },
	}}
	defer s.Close()
	if err := s.Confirm(nil, ownednode.Intent{}, "production"); !errors.Is(err, nativeconsent.ErrInvalid) {
		t.Fatal(err)
	}
	if err := s.Confirm(ctx, ownednode.Intent{}, "production"); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if err := s.Confirm(ctx, ownednode.Intent{}, "production"); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if reads != 1 || prompts != 0 {
		t.Fatalf("reads%d prompts%d", reads, prompts)
	}
}

func TestP09NativeConsentSessionCancelledReviewCannotApprove(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s := &nativeConsentSession{producer: sessionProducer{
		identity: func(context.Context) (nativeconsent.Identity, error) { return nativeconsent.Identity{}, nil },
		confirm:  func(context.Context, ownednode.Intent, string) error { cancel(); return nil },
		close:    func() error { return nil },
	}}
	defer s.Close()
	if err := s.Confirm(ctx, ownednode.Intent{}, "production"); !errors.Is(err, context.Canceled) {
		t.Fatalf("late review approval escaped cancellation: %v", err)
	}
}
