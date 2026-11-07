//go:build (linux || darwin) && ynx_public_trace_testsupport

package consensus

import (
	"context"
	"errors"
	"testing"
	"time"
)

func newPUBLICAccountHandler(t *testing.T, f *committedTraceObserver) *PQCommittedAccountHandler {
	t.Helper()
	h, err := NewPQCommittedAccountHandler(context.Background(), f.app)
	if h != nil {
		t.Cleanup(func() { _ = h.Close() })
	}
	if err != nil {
		t.Fatal("normal owning App factory", err)
	}
	return h
}

func TestPQCommittedAccountHandlerPUBLICOriginalEngineFlow(t *testing.T) {
	f := committedAccountFixture(t, "atomic-json", 10)
	originalNode := f.node
	t.Run("UnpairedFactory", func(t *testing.T) {
		if h, e := NewPQCommittedAccountHandler(context.Background(), &Application{}); h != nil || e == nil {
			t.Fatal("unpaired engine accepted")
		}
	})
	t.Run("NoCaptureReadFailsPermanently", func(t *testing.T) {
		h := newPUBLICAccountHandler(t, f)
		_, first := h.Read()
		if first == nil {
			t.Fatal("read before capture")
		}
		if p, e := h.Capture(f.expected.Owner); p != nil || e != first {
			t.Fatal("first failed operation replayed")
		}
		if e := h.Close(); e != first || !h.IsClosed() {
			t.Fatal("failure/physical close conflated", e)
		}
	})
	t.Run("MalformedFirstCaptureCannotChangeOwner", func(t *testing.T) {
		h := newPUBLICAccountHandler(t, f)
		_, first := h.Capture("not-an-account")
		if first == nil {
			t.Fatal("malformed owner")
		}
		if p, e := h.Capture(f.expected.Owner); p != nil || e != first {
			t.Fatal("malformed capture replaced")
		}
	})
	h := newPUBLICAccountHandler(t, f)
	t.Run("SingleCaptureNotReady", func(t *testing.T) {
		if p, e := h.Capture(f.expected.Owner); p != nil || e != ErrPQCommittedAccountNotReady {
			t.Fatal("tip capture promoted", e)
		}
		if p, e := h.Read(); p != nil || e != ErrPQCommittedAccountNotReady {
			t.Fatal("same capture read changed", e)
		}
		if p, e := h.Current(); p != nil || e != ErrPQCommittedAccountNotReady {
			t.Fatal("uncommitted successor current", e)
		}
	})
	f.advance(t, 11)
	p, err := h.Read()
	if err != nil {
		t.Fatal("same original H+1", err)
	}
	v, err := p.View()
	if err != nil || v.Proof.Height != 10 || v.CurrentCheckpoint.Height != 11 {
		t.Fatal("capture moved", err)
	}
	f.advance(t, 12)
	t.Run("OriginalNonceAndCurrentFacts", func(t *testing.T) {
		p, e := h.Current()
		if e != nil {
			t.Fatal(e)
		}
		v, e := p.View()
		if e != nil || v.Proof.Height != 10 || v.CurrentCheckpoint.Height != 12 || v.HistoricalAccount.LedgerNonce != 3 || v.CurrentAccount.LedgerNonce != 4 || f.node != originalNode {
			t.Fatal("historical/current nonce or owning engine changed", e)
		}
		origin, e := p.Origin()
		if e != nil || origin.OwnedBy(f.app) != nil {
			t.Fatal("not same original engine", e)
		}
	})
	t.Run("SecondCaptureFailsNoRebase", func(t *testing.T) {
		if p, e := h.Capture(f.expected.Owner); p != nil || !errors.Is(e, ErrPQCommittedAccountCaptureSelected) {
			t.Fatal("second capture changed H", e)
		}
		if p, e := h.Read(); p != nil || !errors.Is(e, ErrPQCommittedAccountCaptureSelected) {
			t.Fatal("capture violation lost first cause", e)
		}
	})
	t.Run("CopiedHandlerSharesClose", func(t *testing.T) {
		copy := *h
		err := copy.Close()
		if !errors.Is(err, ErrPQCommittedAccountCaptureSelected) || !h.IsClosed() {
			t.Fatal("copy changed lifecycle", err)
		}
	})
	coldBound := newPUBLICAccountHandler(t, f)
	f.reopen(t)
	t.Run("NormalColdOwnerCannotRetargetOldFactory", func(t *testing.T) {
		if p, e := coldBound.Capture(f.expected.Owner); p != nil || e == nil {
			t.Fatal("old factory retargeted new App")
		}
		fresh := newPUBLICAccountHandler(t, f)
		if p, e := fresh.Capture(f.expected.Owner); p != nil || e != ErrPQCommittedAccountNotReady {
			t.Fatal("cold factory chose an older H", e)
		}
	})
}

func TestPQCommittedAccountHandlerPUBLICCaptureCloseDebt(t *testing.T) {
	f := committedAccountFixture(t, "atomic-json", 10)
	t.Run("CanceledFactoryPartial", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		h, e := NewPQCommittedAccountHandler(ctx, f.app)
		if h == nil || !errors.Is(e, context.Canceled) {
			t.Fatal("partial canceled factory", e)
		}
		if !errors.Is(h.Close(), context.Canceled) || !h.IsClosed() {
			t.Fatal("partial cleanup lost failure")
		}
	})
	t.Run("FailedOpenRetainsAndClosesActualPartial", func(t *testing.T) {
		h := newPUBLICAccountHandler(t, f)
		p, first := h.Capture("0x1111111111111111111111111111111111111111")
		h.core.mu.Lock()
		reader := h.core.reader
		h.core.mu.Unlock()
		if p != nil || first == nil || reader == nil || reader.IsClosed() {
			t.Fatal("actual failed Open partial not adopted")
		}
		if e := h.Close(); e != first || !h.IsClosed() || !reader.IsClosed() {
			t.Fatal("actual failed Open partial not physically closed", e)
		}
	})
	t.Run("JoinDoesNotSelectClose", func(t *testing.T) {
		h := newPUBLICAccountHandler(t, f)
		if h.Join() == nil {
			t.Fatal("join before retire")
		}
		if h.Retire() != nil || h.Join() != nil || h.IsClosed() {
			t.Fatal("join forged close")
		}
		if h.Close() != nil || !h.IsClosed() {
			t.Fatal("empty handler close")
		}
	})
	h := newPUBLICAccountHandler(t, f)
	// Hold the REAL owning App lock so Capture has been selected/admitted but
	// cannot yet reach Open/publish its underlying reader. No alternate provider
	// or production callback is injected. This is the important close race.
	f.app.mu.Lock()
	locked := true
	defer func() {
		if locked {
			f.app.mu.Unlock()
		}
	}()
	captured := make(chan error, 1)
	go func() {
		p, e := h.Capture(f.expected.Owner)
		if p != nil {
			captured <- errors.New("capture published through close")
			return
		}
		captured <- e
	}()
	deadline := time.Now().Add(time.Second)
	for {
		h.core.mu.Lock()
		admitted := h.core.running && h.core.selected && h.core.reader == nil
		h.core.mu.Unlock()
		if admitted {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("capture did not enter owned operation")
		}
		time.Sleep(time.Millisecond)
	}
	if p, e := h.Read(); p != nil || !errors.Is(e, ErrPQCommittedAccountBusy) {
		t.Fatal("single-flight boundary", e)
	}
	closed := make(chan error, 1)
	go func() { closed <- h.Close() }()
	select {
	case <-closed:
		t.Fatal("close skipped pre-reader capture debt")
	case <-time.After(20 * time.Millisecond):
	}
	if h.IsClosed() {
		t.Fatal("inflight open reported physically closed")
	}
	f.app.mu.Unlock()
	locked = false
	select {
	case e := <-captured:
		if !errors.Is(e, context.Canceled) {
			t.Fatal("capture lost cancel first cause", e)
		}
	case <-time.After(time.Second):
		t.Fatal("capture did not drain")
	}
	var first error
	select {
	case first = <-closed:
		if !errors.Is(first, context.Canceled) || !h.IsClosed() {
			t.Fatal("handler close failed to adopt/drain late partial", first)
		}
	case <-time.After(time.Second):
		t.Fatal("handler close did not drain")
	}
	h.core.mu.Lock()
	reader := h.core.reader
	h.core.mu.Unlock()
	if reader != nil && !reader.IsClosed() {
		t.Fatal("late underlying partial abandoned")
	}
	if again := h.Close(); again != first || !h.IsClosed() {
		t.Fatal("sticky failure changed on repeated close", again)
	}
	if p, e := h.Current(); p != nil || e != first {
		t.Fatal("closed original operation reissued", e)
	}
}
