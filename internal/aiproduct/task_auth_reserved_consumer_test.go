//go:build darwin || linux

package aiproduct

import (
	"context"
	"encoding/json"
	"errors"
	"sync/atomic"
	"testing"

	tasklocal "github.com/JiahaoAlbus/YNX-Chain/internal/authtasklocal"
	link "github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	native "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-runtime/go"
	policy "ynx.local/authgrantpolicy"
)

var _ policy.OriginalTaskReservationVerifier = (*native.Runtime)(nil)
var _ policy.OriginalTaskReservationVerifier = (*tasklocal.Owner)(nil)

// Test probe only delegates the actual original runtime; it neither supplies a
// Source projection nor implements/duplicates the Auth D decoder/proof checks.
type p08OriginalRuntimeProbe struct {
	runtime       *native.Runtime
	borrowedAlive atomic.Bool
	partial       atomic.Bool
}

func (p *p08OriginalRuntimeProbe) OpenTaskGrantSource(ctx context.Context, b policy.TaskEffectBinding, g, h policy.Proof) (policy.HeldTaskGrantSource, error) {
	return p.runtime.OpenTaskGrantSource(ctx, b, g, h)
}
func (p *p08OriginalRuntimeProbe) OpenOriginalTaskReservationSource(ctx context.Context, b policy.TaskEffectBinding, g, h policy.Proof, op string) (policy.HeldOriginalTaskReservationSource, error) {
	cap, err := link.OriginalTaskReadContinuationFromContext(ctx)
	if err != nil {
		return nil, err
	}
	owned, err := p.runtime.OpenOriginalTaskReservationSource(ctx, b, g, h, op)
	if owned == nil {
		return nil, err
	}
	p.partial.Store(err != nil)
	return &p08OriginalRuntimeHeldProbe{HeldOriginalTaskReservationSource: owned, parent: p, borrowed: cap}, err
}

type p08OriginalRuntimeHeldProbe struct {
	policy.HeldOriginalTaskReservationSource
	parent   *p08OriginalRuntimeProbe
	borrowed *link.OriginalTaskReadContinuation
}

func (p *p08OriginalRuntimeHeldProbe) Close() error {
	err := p.HeldOriginalTaskReservationSource.Close()
	l := p.borrowed.Lifetime()
	p.parent.borrowedAlive.Store(!l.Retired && !l.Closed)
	return err
}

func TestP08ActualAuthReservedMethodRejectsUnrecognizedContext(t *testing.T) {
	runtime := &native.Runtime{}
	_, request, _ := taskResourceFixture(t)
	for _, ctx := range []context.Context{context.Background(), context.TODO()} {
		held, err := runtime.OpenOriginalTaskReservationSource(ctx, request.Binding, request.Grant, request.Holder, request.AuthorityOperationID)
		if held != nil {
			_ = held.Close()
		}
		if !errors.Is(err, link.ErrDenied) {
			t.Fatalf("plain context acquired original transport: %v", err)
		}
	}
	local, openErr := tasklocal.OpenOriginalLocalTaskGrantSource()
	if local == nil || openErr == nil {
		if local != nil {
			_ = local.Close()
		}
		t.Fatal("independent production admission unexpectedly supplied; do not operate it in this test")
	}
	// Even with the real new method, unavailable original selection is not a
	// fixture grant. No public Source table/setter is populated by this test.
	held, err := local.OpenOriginalTaskReservationSource(context.Background(), request.Binding, request.Grant, request.Holder, request.AuthorityOperationID)
	if held != nil {
		_ = held.Close()
	}
	if err == nil {
		t.Fatal("missing original source admitted reserved read")
	}
	if err = local.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestP08ActualAuthReservedSCMWithoutSourceRefusesAndPreservesBorrow(t *testing.T) {
	resource, request, registration := p08ReadReceiverFixture(t)
	probe := &p08OriginalRuntimeProbe{runtime: &native.Runtime{}}
	resource.verifier = probe
	// PUBLIC registration/lifetime seam only. The actual runtime remains empty,
	// so the original Source/Core gate must reject before D/F, with no Store read.
	owner, err := openOriginalTaskReadReceiver(context.Background(), &OriginalTaskReadReceiver{resource: resource, done: make(chan struct{})}, registration)
	if err != nil {
		p08CloseReadReceiver(t, owner)
		t.Fatal(err)
	}
	t.Cleanup(func() { p08CloseReadReceiver(t, owner) })
	before, _ := json.Marshal(resource.store.state)
	wire, _ := json.Marshal(request)
	response, err := p08MountedContinuationProbe(registration.path, wire, false)
	if err != nil || response.StatusCode != 409 {
		t.Fatalf("actual Auth source absence not refused: %d %v", response.StatusCode, err)
	}
	after, _ := json.Marshal(resource.store.state)
	if string(before) != string(after) || !probe.partial.Load() || !probe.borrowedAlive.Load() {
		t.Fatalf("source failure changed Store/lost partial/closed borrowed cap: partial=%v borrowedAlive=%v", probe.partial.Load(), probe.borrowedAlive.Load())
	}
}
