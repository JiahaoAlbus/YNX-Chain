package productreadsource

import (
	"context"
	"errors"
	"sync"
	"testing"
)

func witnessFixture() (*Authority, *Hold, *VerifiedShopGET) {
	ctx, cancel := context.WithCancel(context.Background())
	a := &Authority{changed: make(chan struct{}, 1)}
	a.children.Store(1)
	h := &Hold{parent: a, ctx: ctx}
	v := &VerifiedShopGET{hold: h, ctx: ctx, cancel: cancel}
	h.v4.Store(v)
	return a, h, v
}
func TestShopV4ClosedWitnessDoneKeepsFirstZeroAndError(t *testing.T) {
	for _, first := range []error{&shopV4Failure{Code: "PUBLIC", FirstKind: "number", FirstValue: []byte("0")}, errors.New("PUBLIC original failure")} {
		a, h, v := witnessFixture()
		v.remember(first)
		if e := v.Close(); e != first {
			t.Fatal("original close error lost", e)
		}
		if e := v.AssertOriginalClosed(); e != nil {
			t.Fatal("done must not be inferred from original failure", e)
		}
		if e := h.AssertOriginalClosed(); !errors.Is(e, ErrPending) {
			t.Fatal("proof done is not original Hold release", e)
		}
		if e := h.Close(); e != first {
			t.Fatal(e)
		}
		if e := h.AssertOriginalClosed(); e != nil {
			t.Fatal(e)
		}
		if a.children.Load() != 0 {
			t.Fatal("actual child not released")
		}
		for i := 0; i < 4; i++ {
			if e := h.AssertOriginalClosed(); e != nil {
				t.Fatal(e)
			}
			if e := v.AssertOriginalClosed(); e != nil {
				t.Fatal(e)
			}
		}
		if v.originalError() != first || a.children.Load() != 0 {
			t.Fatal("witness must not replace first or redispatch release")
		}
	}
}
func TestShopV4ClosedWitnessPendingUnknownAndSelectedRelease(t *testing.T) {
	a, h, v := witnessFixture()
	v.active.Store(1)
	v.physical.Store(false)
	if e := h.Close(); !errors.Is(e, ErrPending) {
		t.Fatal(e)
	}
	if e := v.AssertOriginalClosed(); !errors.Is(e, ErrPending) {
		t.Fatal(e)
	}
	if e := h.AssertOriginalClosed(); !errors.Is(e, ErrPending) {
		t.Fatal(e)
	}
	if a.children.Load() != 1 {
		t.Fatal("pending released parent")
	}
	v.finishOriginalWork()
	if e := h.AssertOriginalClosed(); e != nil {
		t.Fatal(e)
	}
	if e := v.AssertOriginalClosed(); e != nil {
		t.Fatal(e)
	}
	_, h2, v2 := witnessFixture()
	v2.retired.Store(true)
	v2.physical.Store(false)
	for i := 0; i < 4; i++ {
		if e := v2.AssertOriginalClosed(); !errors.Is(e, ErrUnknown) {
			t.Fatal("unknown must remain unknown", e)
		}
	}
	if v2.physical.Load() || h2.releaseDone.Load() {
		t.Fatal("witness changed UNKNOWN state")
	}
	h2.closed.Store(true)
	h2.released.Store(true)
	if e := h2.AssertOriginalClosed(); !errors.Is(e, ErrPending) {
		t.Fatal("selected release is not completion", e)
	}
}
func TestShopV4ClosedWitnessRejectsNilAndLive(t *testing.T) {
	var nilHold *Hold
	var nilVerified *VerifiedShopGET
	if !errors.Is(nilHold.AssertOriginalClosed(), ErrDenied) || !errors.Is(nilVerified.AssertOriginalClosed(), ErrDenied) {
		t.Fatal("nil must not prove done")
	}
	_, h, v := witnessFixture()
	v.physical.Store(true)
	if !errors.Is(v.AssertOriginalClosed(), ErrPending) || !errors.Is(h.AssertOriginalClosed(), ErrPending) {
		t.Fatal("finished old work is not selected close")
	}
}
func TestShopV4ClosedWitnessNoWorkAfterRetireConcurrent(t *testing.T) {
	a, h, v := witnessFixture()
	first := errors.New("PUBLIC preserved")
	v.remember(first)
	if e := h.Close(); e != first {
		t.Fatal(e)
	}
	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 20; j++ {
				if e := v.Current(h.ctx); e != first {
					t.Errorf("postclose work changed cause %v", e)
				}
				if e := v.AssertOriginalClosed(); e != nil {
					t.Errorf("postclose Current reopened work %v", e)
				}
				if e := h.AssertOriginalClosed(); e != nil {
					t.Errorf("hold witness %v", e)
				}
			}
		}()
	}
	wg.Wait()
	if v.active.Load() != 0 || !v.physical.Load() || a.children.Load() != 0 || v.originalError() != first {
		t.Fatal("postclose call reentered or changed original debt")
	}
}

func TestShopV4ClosedWitnessZeroObjectsDoNotPanicOrProveDone(t *testing.T) {
	h := &Hold{}
	v := &VerifiedShopGET{}
	if !errors.Is(h.Close(), ErrDenied) || !errors.Is(h.AssertOriginalClosed(), ErrDenied) {
		t.Fatal("zero Hold must refuse without releasing a parent")
	}
	if !errors.Is(v.Close(), ErrDenied) || !errors.Is(v.Current(context.Background()), ErrDenied) || !errors.Is(v.AssertOriginalClosed(), ErrDenied) {
		t.Fatal("zero Verified must refuse without cancel/finish dereference")
	}
	if v.active.Load() != 0 || v.physical.Load() || h.released.Load() || h.releaseDone.Load() {
		t.Fatal("zero object mutated into physical completion")
	}
}

func TestShopV4ClosedWitnessActualWaitAndPairedZero(t *testing.T) {
	a, ctx := publicProcessAuthority(t, `{"version":1,"phase":"VERIFY","errorPresent":true,"failure":{"code":"PUBLIC_ZERO","firstKind":"number","firstValue":0},"projection":null}`)
	child, cancel := context.WithCancel(ctx)
	defer cancel()
	a.children.Store(1)
	a.changed = make(chan struct{}, 1)
	h := &Hold{parent: a, ctx: ctx}
	v := &VerifiedShopGET{hold: h, ctx: child, cancel: cancel}
	h.v4.Store(v)
	if !v.beginOriginalWork() {
		t.Fatal("begin")
	}
	_, first := a.shopV4RuntimeOwned(child, "VERIFY", []byte(`{}`), v)
	var original *shopV4Failure
	if !errors.As(first, &original) || string(original.FirstValue) != "0" {
		t.Fatal(first)
	}
	v.remember(first)
	if v.processPending.Load() || v.processUnknown.Load() {
		t.Fatal("actual Wait did not resolve process/pipe debt")
	}
	v.finishOriginalWork()
	if e := h.Close(); e != first {
		t.Fatal(e)
	}
	if e := h.AssertOriginalClosed(); e != nil {
		t.Fatal(e)
	}
	if e := v.AssertOriginalClosed(); e != nil {
		t.Fatal(e)
	}
	if a.children.Load() != 0 || v.originalError() != first {
		t.Fatal("physical witness cleared original first or leaked parent")
	}
}

func TestShopV4ClosedWitnessUnknownProcessCannotClearOnClose(t *testing.T) {
	a, h, v := witnessFixture()
	first := errors.New("PUBLIC unresolved Wait")
	v.remember(first)
	v.retired.Store(true)
	v.physical.Store(true)
	v.processPending.Store(true)
	v.processUnknown.Store(true)
	for i := 0; i < 5; i++ {
		if e := v.AssertOriginalClosed(); !errors.Is(e, ErrUnknown) {
			t.Fatal(e)
		}
		if e := h.Close(); e != first {
			t.Fatal(e)
		}
		if e := h.AssertOriginalClosed(); !errors.Is(e, ErrPending) {
			t.Fatal(e)
		}
	}
	if !v.processPending.Load() || !v.processUnknown.Load() || h.released.Load() || a.children.Load() != 1 {
		t.Fatal("unknown process was redispatched or falsely closed")
	}
}
