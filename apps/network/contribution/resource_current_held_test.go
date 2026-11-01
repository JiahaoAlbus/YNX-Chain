package contribution

import (
	"context"
	"errors"
	"testing"
	"time"
)

// Actual original Runner mutex/read debt, not a substitute current provider.
func TestResourceCurrentHeldReaderBlockedOriginalAndPartialDrain(t *testing.T) {
	r, _ := currentTestRunner(t)
	if err := r.InitializeCurrentResource(context.Background(), publicResourceIdentity); err != nil {
		t.Fatal(err)
	}
	reader, err := r.BorrowCurrentResourceReader(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	r.mu.Lock()
	released := false
	defer func() {
		if !released {
			r.mu.Unlock()
		}
	}()
	done := make(chan error, 1)
	go func() { _, err := reader.ReadCurrentResourceDATA(context.Background()); done <- err }()
	deadline := time.Now().Add(time.Second)
	for {
		reader.mu.Lock()
		active := reader.active
		reader.mu.Unlock()
		if active == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("actual original read did not acquire debt")
		}
		time.Sleep(time.Millisecond)
	}
	if err = reader.Retire(); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	complete, err := reader.Join(ctx)
	cancel()
	if complete || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("blocked original current debt disappeared", complete, err)
	}
	if complete, err = reader.Close(context.Background()); complete || !errors.Is(err, ErrCurrentReaderRetired) {
		t.Fatal("premature physical close", complete, err)
	}
	r.mu.Unlock()
	released = true
	if err = <-done; !errors.Is(err, ErrCurrentReaderRetired) {
		t.Fatal("late current bytes escaped retirement", err)
	}
	if complete, err = reader.Join(context.Background()); !complete || !errors.Is(err, ErrCurrentReaderRetired) {
		t.Fatal("same original join failed", complete, err)
	}
	if complete, err = reader.Close(context.Background()); !complete || !errors.Is(err, ErrCurrentReaderRetired) {
		t.Fatal("same original physical close failed", complete, err)
	}
	if _, err = r.ReadCurrentResourceDATA(context.Background()); err != nil {
		t.Fatal("borrow close closed original Runner", err)
	}
}
