package networkresourcesource

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type blockingRetireNative struct {
	publicNative
	entered, release chan struct{}
	retireCalls      atomic.Int32
	retireErr        error
}

func (n *blockingRetireNative) retire(handle) error {
	n.retireCalls.Add(1)
	close(n.entered)
	<-n.release
	return n.retireErr
}

func TestOriginalRetireCompletesBeforeSharedJoin(t *testing.T) {
	for _, failed := range []bool{false, true} {
		t.Run(map[bool]string{false: "success", true: "first-cause"}[failed], func(t *testing.T) {
			n := &blockingRetireNative{publicNative: publicNative{closeComplete: true}, entered: make(chan struct{}), release: make(chan struct{})}
			var release sync.Once
			defer release.Do(func() { close(n.release) })
			if failed {
				n.retireErr = errors.New("original retire failure")
			}
			s, err := openNative(context.Background(), n)
			if err != nil {
				t.Fatal(err)
			}
			retired := make(chan error, 1)
			go func() { retired <- s.Retire() }()
			<-n.entered
			// A concurrent owner may call Retire again while the original call is blocked.
			if err := s.Retire(); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
			defer cancel()
			if done, err := s.Join(ctx); done || !errors.Is(err, context.DeadlineExceeded) {
				t.Fatalf("early join: %v %v", done, err)
			}
			if n.joins.Load() != 0 {
				t.Fatal("native Join ran before original Retire returned")
			}
			release.Do(func() { close(n.release) })
			if err := <-retired; !errors.Is(err, n.retireErr) {
				t.Fatalf("retire result %v", err)
			}
			if done, err := s.Join(context.Background()); !done || err != nil {
				t.Fatalf("shared join: %v %v", done, err)
			}
			if n.retireCalls.Load() != 1 || n.joins.Load() != 1 {
				t.Fatal("duplicated original native effect")
			}
			if !errors.Is(s.FirstCause(), n.retireErr) {
				t.Fatal("first cause lost")
			}
			for i := 0; i < 2; i++ {
				if done, err := s.Close(context.Background()); !done || err != nil {
					t.Fatalf("original close: %v %v", done, err)
				}
			}
			if n.closes.Load() != 1 || !errors.Is(s.FirstCause(), n.retireErr) {
				t.Fatal("close repeated or replaced first cause")
			}
		})
	}
}
