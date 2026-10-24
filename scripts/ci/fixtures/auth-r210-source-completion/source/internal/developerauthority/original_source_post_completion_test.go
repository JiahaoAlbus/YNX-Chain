package developerauthority

import (
	"bytes"
	"context"
	"testing"
	"time"
)

func TestOriginalSourcePostWatermarkCompletionExpiryRetainsOriginalAndNeverRetries(t *testing.T) {
	o, state, _, _, _ := newControlRuntimeFixture(t, "")
	at := time.Now()
	samples := 0
	o.now = func() time.Time {
		samples++
		if samples == 1 {
			return at
		}
		return at.Add(time.Minute)
	}
	if e := o.AssertSourceCurrent(context.Background()); e != ErrUnknown {
		t.Fatal("late expiry accepted", e)
	}
	if samples != 2 || o.firstCause != errOriginalSourcePostWatermarkCurrent || len(o.lastSourceOriginal) == 0 {
		t.Fatal("original/cause/final fence not retained")
	}
	original := append([]byte(nil), o.lastSourceOriginal...)
	state.mu.Lock()
	heads := len(state.heads)
	state.mu.Unlock()
	if heads != 1 {
		t.Fatal("actual durable watermark not exercised")
	}
	if e := o.AssertSourceCurrent(context.Background()); e != ErrUnknown {
		t.Fatal("UNKNOWN restarted", e)
	}
	if samples != 2 || !bytes.Equal(original, o.lastSourceOriginal) {
		t.Fatal("UNKNOWN re-entered or replaced original")
	}
}

func TestOriginalSourcePostWatermarkCompletionClockRollbackFailsClosed(t *testing.T) {
	o, _, _, _, _ := newControlRuntimeFixture(t, "")
	at := time.Now()
	samples := 0
	o.now = func() time.Time {
		samples++
		if samples == 1 {
			return at
		}
		return at.Add(-time.Millisecond)
	}
	if e := o.AssertSourceCurrent(context.Background()); e != ErrUnknown {
		t.Fatal("clock rollback accepted", e)
	}
	if o.firstCause != errOriginalSourcePostWatermarkCurrent {
		t.Fatal("first cause lost")
	}
}
